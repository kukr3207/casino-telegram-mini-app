import assert from "node:assert/strict";
import test from "node:test";

import { SeedChain, combineSeeds, seedHash, uniformInteger, verifySeedCommitment } from "../lib/fairness/seed-chain.ts";
import { blackjackValue, cardCode, createShoe, isBlackjack, parseCard, shuffleShoe } from "../lib/games/cards.ts";
import {
  doubleDown, hit, publicBlackjackRound, settleBlackjack, split, stand, startBlackjackRound, surrender,
} from "../lib/games/blackjack.ts";
import { rouletteBetWins, rouletteColor, rouletteOdds, spinRoulette, validateRouletteBet } from "../lib/games/roulette.ts";
import { spinSlots, theoreticalReturn, validateSlotConfiguration } from "../lib/games/slots.ts";

const SERVER = "01".repeat(32);
const CLIENT = "player-seed";

test("seed commitments hide, consume, and reveal deterministic server seeds", () => {
  const chains = new SeedChain();
  const created = chains.create("chain", CLIENT, "2026-01-01T00:00:00Z", SERVER);
  assert.equal(created.commitment, seedHash(SERVER));
  assert.equal(created.serverSeed, undefined);
  assert.equal(chains.consume("chain").nonce, 0n);
  assert.equal(chains.consume("chain").nonce, 1n);
  const revealed = chains.reveal("chain", "2026-01-02T00:00:00Z");
  assert.equal(revealed.serverSeed, SERVER);
  assert.equal(verifySeedCommitment(revealed.commitment, revealed.serverSeed), true);
  assert.throws(() => chains.consume("chain"), /revealed/);
});

test("uniform integer is stable and stays inside every requested bound", () => {
  assert.deepEqual(combineSeeds(SERVER, CLIENT, 0n), combineSeeds(SERVER, CLIENT, 0n));
  for (const bound of [1, 2, 6, 37, 1000]) {
    const values = Array.from({ length: 100 }, (_, cursor) => uniformInteger(SERVER, CLIENT, 7, bound, cursor));
    assert.ok(values.every((value) => value >= 0 && value < bound));
    assert.deepEqual(values, Array.from({ length: 100 }, (_, cursor) => uniformInteger(SERVER, CLIENT, 7, bound, cursor)));
  }
});

test("card shoes contain complete decks and shuffle reproducibly", () => {
  const shoe = createShoe(2);
  assert.equal(shoe.length, 104);
  assert.equal(new Set(shoe.map((card) => `${card.deck}:${cardCode(card)}`)).size, 104);
  const first = shuffleShoe(shoe, SERVER, CLIENT, 0n);
  const second = shuffleShoe(shoe, SERVER, CLIENT, 0n);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, shoe);
});

test("blackjack hand values handle soft and hard aces", () => {
  assert.deepEqual(blackjackValue([parseCard("AS"), parseCard("6H")]), { total: 17, soft: true });
  assert.deepEqual(blackjackValue([parseCard("AS"), parseCard("6H"), parseCard("10C")]), { total: 17, soft: false });
  assert.equal(isBlackjack([parseCard("AS"), parseCard("KH")]), true);
  assert.equal(isBlackjack([parseCard("AS"), parseCard("5H"), parseCard("5C")]), false);
});

test("blackjack rounds expose only one dealer card during player turn", () => {
  const round = startBlackjackRound({
    roundId: "r1", playerId: "p1", stake: 100n,
    serverSeed: SERVER, clientSeed: CLIENT, nonce: 0n, decks: 1,
    at: "2026-01-01T00:00:00Z",
  });
  const publicRound = publicBlackjackRound(round);
  if (round.state === "player_turn") assert.equal(publicRound.dealer[1], "hidden");
  assert.equal(round.hands[0].cards.length, 2);
  assert.equal(round.dealer.length, 2);
});

test("blackjack hit, stand, and dealer settlement reach a terminal round", () => {
  const round = startBlackjackRound({
    roundId: "r2", playerId: "p1", stake: 100n,
    serverSeed: SERVER, clientSeed: CLIENT, nonce: 1n, decks: 1,
    at: "2026-01-01T00:00:00Z",
  });
  while (round.state === "player_turn") {
    const value = blackjackValue(round.hands[round.activeHand].cards).total;
    if (value < 12) hit(round);
    else stand(round);
  }
  const settlements = settleBlackjack(round);
  assert.equal(round.state, "settled");
  assert.equal(settlements.length, round.hands.length);
  assert.ok(settlements.every((value) => value.payout >= 0n));
});

test("blackjack surrender refunds half the stake", () => {
  let nonce = 0;
  let round;
  do {
    round = startBlackjackRound({
      roundId: `s${nonce}`, playerId: "p1", stake: 101n,
      serverSeed: SERVER, clientSeed: CLIENT, nonce: nonce++, decks: 1,
      at: "2026-01-01T00:00:00Z",
    });
  } while (round.state !== "player_turn");
  surrender(round);
  assert.equal(settleBlackjack(round)[0].payout, 50n);
});

test("roulette colors, outside bets, and odds follow European rules", () => {
  assert.equal(rouletteColor(0), "green");
  assert.equal(rouletteColor(1), "red");
  assert.equal(rouletteColor(2), "black");
  assert.equal(rouletteBetWins({ id: "red", kind: "red", selection: [], stake: 1n }, 1), true);
  assert.equal(rouletteBetWins({ id: "even", kind: "even", selection: [], stake: 1n }, 0), false);
  assert.equal(rouletteOdds("straight"), 35);
});

test("roulette spins settle every winning bet deterministically", () => {
  const bets = [
    { id: "straight", kind: "straight", selection: [7], stake: 10n },
    { id: "red", kind: "red", selection: [], stake: 10n },
    { id: "dozen", kind: "dozen", selection: [1], stake: 10n },
  ];
  const first = spinRoulette({ bets, serverSeed: SERVER, clientSeed: CLIENT, nonce: 0n });
  const second = spinRoulette({ bets, serverSeed: SERVER, clientSeed: CLIENT, nonce: 0n });
  assert.deepEqual(first, second);
  assert.equal(first.totalStake, 30n);
  assert.equal(first.winningBets.reduce((total, bet) => total + bet.payout, 0n), first.totalPayout);
});

const SLOT = {
  id: "classic",
  reels: 5,
  rows: 3,
  paylines: [
    [0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2],
  ],
  symbols: [
    { id: "cherry", weight: 35, payouts: { 3: 2, 4: 5, 5: 10 } },
    { id: "bell", weight: 20, payouts: { 3: 4, 4: 10, 5: 25 } },
    { id: "seven", weight: 8, payouts: { 3: 10, 4: 30, 5: 100 } },
    { id: "wild", weight: 4, payouts: { 3: 15, 4: 50, 5: 200 }, wild: true },
    { id: "scatter", weight: 3, payouts: {}, scatter: true },
  ],
  scatterPayouts: { 3: 2, 4: 10, 5: 50 },
  freeSpins: { 3: 5, 4: 10, 5: 20 },
};

test("slot configuration validates paylines and symbol weights", () => {
  assert.equal(validateSlotConfiguration(SLOT), SLOT);
  assert.throws(() => validateSlotConfiguration({ ...SLOT, paylines: [[0, 0]] }), /payline/);
  assert.throws(() => validateSlotConfiguration({ ...SLOT, symbols: [{ id: "bad", weight: 0, payouts: {} }] }), /symbols|weight/);
});

test("slot spins are deterministic and account for all payouts", () => {
  const first = spinSlots({ configuration: SLOT, stakePerLine: 10n, serverSeed: SERVER, clientSeed: CLIENT, nonce: 4n });
  const second = spinSlots({ configuration: SLOT, stakePerLine: 10n, serverSeed: SERVER, clientSeed: CLIENT, nonce: 4n });
  assert.deepEqual(first, second);
  assert.equal(first.grid.length, 5);
  assert.ok(first.grid.every((reel) => reel.length === 3));
  assert.equal(first.totalPayout, first.paylineWins.reduce((total, win) => total + win.payout, first.scatterPayout));
  assert.ok(theoreticalReturn(SLOT) > 0);
});
