import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  rollVerifiableDice,
  selectVerifiableOutcome,
} from "../lib/security/fair-random.ts";

test("wheel selection always returns one of the supplied outcomes", () => {
  const outcomes = [
    { type: "token", value: 10 },
    { type: "booster", value: 20 },
  ];

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const selection = selectVerifiableOutcome(outcomes);
    assert.deepEqual(selection.outcome, outcomes[selection.outcomeIndex]);
    assert.match(selection.seed, /^[a-f0-9]{64}$/);
    assert.match(selection.hash, /^[a-f0-9]{64}$/);
  }
});

test("wheel result hash commits to its seed and selected outcome", () => {
  const selection = selectVerifiableOutcome(["red", "black", "green"]);
  const expected = createHash("sha256")
    .update(`${selection.seed}:${JSON.stringify(selection.outcome)}`, "utf8")
    .digest("hex");
  assert.equal(selection.hash, expected);
});

test("wheel selection validates the outcome collection", () => {
  assert.throws(() => selectVerifiableOutcome([]), RangeError);
  assert.throws(() => selectVerifiableOutcome(new Array(257).fill("x")), RangeError);
});

test("dice rolls remain inside two six-sided dice bounds", () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const roll = rollVerifiableDice();
    assert.ok(roll.dice1 >= 1 && roll.dice1 <= 6);
    assert.ok(roll.dice2 >= 1 && roll.dice2 <= 6);
    assert.match(roll.seed, /^[a-f0-9]{64}$/);
    assert.match(roll.hash, /^[a-f0-9]{64}$/);
  }
});

test("dice result hash commits to seed and both faces", () => {
  const roll = rollVerifiableDice();
  const expected = createHash("sha256")
    .update(`${roll.seed}:${roll.dice1}:${roll.dice2}`, "utf8")
    .digest("hex");
  assert.equal(roll.hash, expected);
});

