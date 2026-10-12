import assert from "node:assert/strict";
import test from "node:test";

import { TournamentService } from "../lib/competition/tournaments.ts";
import { AuditLog } from "../lib/operations/audit.ts";
import { reconcileBalances, reconcileRounds, summarizeIssues } from "../lib/operations/reconciliation.ts";

const NOW = new Date("2026-09-01T00:00:00.000Z");

function tournament(metric = "profit") {
  return {
    id: "weekly", name: "Weekly Championship", game: "dice", metric,
    startsAt: NOW.toISOString(), endsAt: new Date(NOW.getTime() + 86400000).toISOString(),
    entryFee: 10n, minimumRounds: 2, maximumPlayers: 100,
    prizes: [
      { fromRank: 1, toRank: 1, kind: "chips", amount: 1000n },
      { fromRank: 2, toRank: 3, kind: "chips", amount: 500n },
    ],
    status: "open",
  };
}

test("tournament standings rank profit with deterministic tie breaks", () => {
  const service = new TournamentService();
  service.add(tournament());
  service.join("weekly", "a", NOW);
  service.join("weekly", "b", NOW);
  service.record({ eventId: "a1", tournamentId: "weekly", playerId: "a", game: "dice", stake: 100n, payout: 150n, at: NOW });
  service.record({ eventId: "a2", tournamentId: "weekly", playerId: "a", game: "dice", stake: 100n, payout: 150n, at: new Date(NOW.getTime() + 1000) });
  service.record({ eventId: "b1", tournamentId: "weekly", playerId: "b", game: "dice", stake: 100n, payout: 250n, at: NOW });
  const standings = service.standings("weekly");
  assert.equal(standings[0].playerId, "b");
  assert.equal(standings[0].eligible, false);
  assert.equal(standings[1].playerId, "a");
  assert.equal(standings[1].eligible, true);
});

test("tournament event ids make score updates idempotent", () => {
  const service = new TournamentService();
  service.add(tournament("wins"));
  service.join("weekly", "a", NOW);
  const event = { eventId: "round", tournamentId: "weekly", playerId: "a", game: "dice", stake: 10n, payout: 20n, at: NOW };
  service.record(event);
  service.record(event);
  const entry = service.standings("weekly")[0];
  assert.equal(entry.rounds, 1);
  assert.equal(entry.score, 1n);
});

test("audit log preserves sequence and verifies its hash chain", () => {
  const audit = new AuditLog();
  const first = audit.append({
    id: "one", actorId: "player", actorType: "player", action: "wager.created",
    subjectType: "wager", subjectId: "w1", occurredAt: NOW.toISOString(), details: { stake: 100 },
  });
  const second = audit.append({
    id: "two", actorId: "system", actorType: "system", action: "wager.settled",
    subjectType: "wager", subjectId: "w1", occurredAt: new Date(NOW.getTime() + 1000).toISOString(), details: { payout: 200 },
  });
  assert.equal(first.sequence, 1);
  assert.equal(second.previousHash, first.hash);
  assert.equal(audit.verify(), true);
  assert.equal(audit.query({ subjectId: "w1", afterSequence: 1 }).length, 1);
});

test("balance and round reconciliation produce actionable summaries", () => {
  const issues = [
    ...reconcileBalances([
      { playerId: "a", asset: "CHIP", ledgerBalance: 100n, storedBalance: 90n },
      { playerId: "b", asset: "CHIP", ledgerBalance: 50n, storedBalance: 50n },
    ]),
    ...reconcileRounds([
      { roundId: "r1", playerId: "a", stake: 10n, payout: 20n, wagerEntry: true, settlementEntry: false, proofValid: false },
    ]),
  ];
  assert.deepEqual(issues.map((issue) => issue.type), ["balance_mismatch", "missing_settlement", "invalid_proof"]);
  assert.deepEqual(summarizeIssues(issues), {
    total: 3, errors: 2, warnings: 1,
    balance_mismatch: 1, missing_settlement: 1, invalid_proof: 1,
  });
});
