import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBest, parseCard, shuffledDeck, verifyShuffle } from "../lib/poker/cards.ts";
import { PokerIntegrityMonitor } from "../lib/poker/integrity.ts";
import { buildSidePots, uncalledBetReturn } from "../lib/poker/pots.ts";
import { PokerTableService } from "../lib/poker/table.ts";
import { PokerTournamentService } from "../lib/poker/tournaments.ts";

test("poker shuffle is deterministic and independently verifiable", () => {
  const first = shuffledDeck("server-secret", "player-seed", 4);
  const retry = shuffledDeck("server-secret", "player-seed", 4);
  const next = shuffledDeck("server-secret", "player-seed", 5);
  assert.deepEqual(first, retry);
  assert.notDeepEqual(first.cards, next.cards);
  assert.equal(verifyShuffle(first, "server-secret", "player-seed"), true);
  assert.equal(verifyShuffle(first, "wrong", "player-seed"), false);
});

test("hand evaluator orders straight flush above four of a kind", () => {
  const straightFlush = evaluateBest(["Ah", "Kh", "Qh", "Jh", "Th", "2c", "3d"].map(parseCard));
  const quads = evaluateBest(["As", "Ah", "Ad", "Ac", "Kh", "2c", "3d"].map(parseCard));
  assert.equal(straightFlush.category, "straight_flush");
  assert.equal(quads.category, "four_of_a_kind");
  assert.equal(straightFlush.score > quads.score, true);
});

test("hand evaluator handles wheel straights and duplicate rejection", () => {
  const wheel = evaluateBest(["As", "2h", "3d", "4c", "5s", "Kh", "Qd"].map(parseCard));
  assert.equal(wheel.category, "straight");
  assert.deepEqual(wheel.kickers, [5]);
  assert.throws(() => evaluateBest(["As", "As", "3d", "4c", "5s"].map(parseCard)));
});

test("side pots preserve folded contributions and eligibility", () => {
  const pots = buildSidePots({
    alice: 100n,
    bob: 300n,
    cara: 300n,
    dan: 500n,
  }, ["cara"]);
  assert.deepEqual(pots.map((pot) => pot.amountMinor), [400n, 600n, 200n]);
  assert.deepEqual(pots[0].eligiblePlayerIds, ["alice", "bob", "dan"]);
  assert.deepEqual(pots[1].eligiblePlayerIds, ["bob", "dan"]);
  assert.deepEqual(pots[2].eligiblePlayerIds, ["dan"]);
});

test("uncalled bet returns only the unmatched highest commitment", () => {
  assert.deepEqual(uncalledBetReturn({ alice: 500n, bob: 300n, cara: 300n }), {
    playerId: "alice",
    amountMinor: 200n,
  });
  assert.equal(uncalledBetReturn({ alice: 300n, bob: 300n }), null);
});

function tableInput() {
  return {
    id: "table",
    name: "Test table",
    variant: "holdem",
    currency: "CHIP",
    minimumBuyInMinor: 2_000n,
    maximumBuyInMinor: 20_000n,
    smallBlindMinor: 50n,
    bigBlindMinor: 100n,
    anteMinor: 0n,
    minimumPlayers: 2,
    maximumPlayers: 6,
    actionTimeoutSeconds: 30,
    rakeBasisPoints: 500,
    rakeCapMinor: 300n,
    status: "waiting",
  };
}

test("table seating uses optimistic versions and unique seats", () => {
  const service = new PokerTableService();
  let table = service.create(tableInput());
  table = service.join(table.id, table.version, {
    playerId: "alice",
    displayName: "Alice",
    seat: 1,
    buyInMinor: 10_000n,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
  });
  assert.throws(() => service.join(table.id, table.version, {
    playerId: "bob",
    displayName: "Bob",
    seat: 1,
    buyInMinor: 10_000n,
  }));
  table = service.join(table.id, table.version, {
    playerId: "bob",
    displayName: "Bob",
    seat: 3,
    buyInMinor: 10_000n,
  });
  assert.equal(table.players.length, 2);
});

test("starting a poker hand posts blinds and deals private cards", () => {
  const service = new PokerTableService();
  let table = service.create(tableInput());
  table = service.join(table.id, table.version, { playerId: "alice", displayName: "Alice", seat: 1, buyInMinor: 10_000n });
  table = service.join(table.id, table.version, { playerId: "bob", displayName: "Bob", seat: 3, buyInMinor: 10_000n });
  const started = service.startHand(table.id, table.version, "server", "players", new Date("2026-01-01T00:01:00Z"));
  assert.equal(started.hand.stage, "preflop");
  assert.equal(started.hand.holeCards.alice.length, 2);
  assert.equal(started.hand.holeCards.bob.length, 2);
  assert.equal(Object.values(started.hand.commitments).reduce((sum, value) => sum + value, 0n), 150n);
});

function tournamentInput() {
  return {
    id: "tournament",
    name: "Sunday game",
    currency: "CHIP",
    buyInMinor: 1_000n,
    feeMinor: 100n,
    startingStackMinor: 10_000n,
    maximumEntries: 100,
    reentryLimit: 1,
    lateRegistrationEndsAt: "2026-01-01T13:00:00Z",
    startsAt: "2026-01-01T12:00:00Z",
    blindLevels: [
      { level: 1, durationMinutes: 15, smallBlindMinor: 50n, bigBlindMinor: 100n, anteMinor: 0n },
      { level: 2, durationMinutes: 15, smallBlindMinor: 100n, bigBlindMinor: 200n, anteMinor: 25n },
    ],
    prizesBasisPoints: [7_000, 3_000],
    status: "registering",
    version: 1,
  };
}

test("tournament registration is idempotent and enforces reentry", () => {
  const service = new PokerTournamentService();
  const tournament = service.create(tournamentInput());
  const first = service.register(tournament.id, "alice", "payment-1", new Date("2026-01-01T11:00:00Z"));
  const retry = service.register(tournament.id, "alice", "payment-1", new Date("2026-01-01T11:00:01Z"));
  assert.deepEqual(retry, first);
  assert.equal(service.ledger(tournament.id).length, 2);
  assert.throws(() => service.register(tournament.id, "alice", "payment-2", new Date("2026-01-01T11:01:00Z")));
});

test("tournament blind schedule advances by elapsed time", () => {
  const service = new PokerTournamentService();
  service.create(tournamentInput());
  assert.equal(service.blindLevel("tournament", new Date("2026-01-01T12:05:00Z")).level, 1);
  assert.equal(service.blindLevel("tournament", new Date("2026-01-01T12:20:00Z")).level, 2);
});

test("integrity monitor detects shared devices in the same hand", () => {
  const monitor = new PokerIntegrityMonitor();
  for (const [playerId, action] of [["alice", "raise"], ["bob", "call"]]) {
    monitor.record({
      playerId,
      tableId: "table",
      handId: "hand",
      deviceId: "shared-device",
      ipAddress: "203.0.113.10",
      actionDelayMs: 100,
      action,
      amountMinor: 500n,
      potBeforeMinor: 400n,
      occurredAt: "2026-01-01T00:00:00Z",
    });
  }
  const findings = monitor.analyze(new Date("2025-12-31T23:00:00Z"), new Date("2026-01-01T01:00:00Z"));
  assert.equal(findings.some((finding) => finding.kind === "shared_device"), true);
  assert.equal(findings.some((finding) => finding.kind === "shared_network"), true);
});
