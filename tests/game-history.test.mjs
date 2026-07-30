import assert from "node:assert/strict";
import test from "node:test";

import {
  diceHistoryFromDocument,
  gameHistoryLabel,
  parseBefore,
  parseGameFilter,
  parseHistoryLimit,
  sortHistory,
  summarizeHistory,
  wheelHistoryFromDocument,
} from "../lib/domain/game-history.ts";

const DICE = {
  _id: "dice-0001",
  dice1: 3,
  dice2: 5,
  seed: "a".repeat(64),
  hash: "b".repeat(64),
  createdAt: new Date("2026-07-30T10:00:00Z"),
};

const WHEEL = {
  _id: "wheel-0001",
  outcome: { type: "token", value: 25 },
  outcomeIndex: 1,
  seed: "c".repeat(64),
  hash: "d".repeat(64),
  createdAt: new Date("2026-07-30T11:00:00Z"),
};

test("Mongo dice documents become transport-safe history records", () => {
  const record = diceHistoryFromDocument(DICE);
  assert.deepEqual(record, {
    id: "dice-0001",
    game: "dice",
    playedAt: "2026-07-30T10:00:00.000Z",
    seed: DICE.seed,
    hash: DICE.hash,
    dice1: 3,
    dice2: 5,
    total: 8,
  });
  assert.equal(gameHistoryLabel(record), "Dice 3 + 5 = 8");
});

test("Mongo wheel documents become transport-safe history records", () => {
  const record = wheelHistoryFromDocument(WHEEL);
  assert.equal(record.game, "wheel");
  assert.deepEqual(record.outcome, { type: "token", value: 25 });
  assert.equal(gameHistoryLabel(record), "Wheel: 25 casino chips");
});

test("malformed stored documents are excluded from history", () => {
  assert.equal(diceHistoryFromDocument({ ...DICE, dice1: 9 }), null);
  assert.equal(diceHistoryFromDocument({ ...DICE, createdAt: "not-a-date" }), null);
  assert.equal(wheelHistoryFromDocument({ ...WHEEL, outcome: { type: "gift" } }), null);
});

test("history is sorted newest first with a deterministic id tie break", () => {
  const dice = diceHistoryFromDocument(DICE);
  const wheel = wheelHistoryFromDocument(WHEEL);
  assert.deepEqual(sortHistory([dice, wheel]).map((record) => record.id), [
    "wheel-0001",
    "dice-0001",
  ]);
});

test("history summary counts games, verification, and prizes", () => {
  const dice = diceHistoryFromDocument(DICE);
  const wheel = wheelHistoryFromDocument(WHEEL);
  const verification = new Map([
    [dice.id, { valid: true, code: "verified", message: "ok" }],
    [wheel.id, { valid: false, code: "outcome_mismatch", message: "bad" }],
  ]);
  assert.deepEqual(summarizeHistory([dice, wheel], verification), {
    totalGames: 2,
    diceRolls: 1,
    wheelSpins: 1,
    verifiedGames: 1,
    tokenPrizes: 25,
    boosterPrizes: 0,
  });
});

test("history query parsing applies bounds and accepted filters", () => {
  assert.equal(parseHistoryLimit(null), 20);
  assert.equal(parseHistoryLimit("50"), 50);
  assert.throws(() => parseHistoryLimit("51"), RangeError);
  assert.equal(parseGameFilter("dice"), "dice");
  assert.equal(parseGameFilter("all"), "all");
  assert.throws(() => parseGameFilter("cards"), RangeError);
  assert.equal(parseBefore("2026-07-30T12:00:00Z").toISOString(), "2026-07-30T12:00:00.000Z");
  assert.throws(() => parseBefore("tomorrow-ish"), RangeError);
});

