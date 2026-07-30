import assert from "node:assert/strict";
import test from "node:test";

import { WHEEL_OUTCOMES } from "../lib/domain/wheel-outcomes.ts";
import {
  rollVerifiableDice,
  selectVerifiableOutcome,
} from "../lib/security/fair-random.ts";
import {
  deriveDiceFaces,
  deriveWheelIndex,
  verifyDiceProof,
  verifyGameProof,
  verifyWheelProof,
} from "../lib/security/fairness-verifier.ts";

test("generated dice proofs verify successfully", () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roll = rollVerifiableDice();
    assert.deepEqual(deriveDiceFaces(roll.seed), {
      dice1: roll.dice1,
      dice2: roll.dice2,
    });
    assert.deepEqual(verifyDiceProof(roll), {
      valid: true,
      code: "verified",
      message: "The seed, dice faces, and commitment are consistent.",
    });
  }
});

test("dice verification detects outcome and commitment tampering", () => {
  const roll = rollVerifiableDice();
  const changedFace = roll.dice1 === 6 ? 5 : roll.dice1 + 1;
  assert.equal(verifyDiceProof({ ...roll, dice1: changedFace }).code, "outcome_mismatch");
  assert.equal(
    verifyDiceProof({ ...roll, hash: "0".repeat(64) }).code,
    "commitment_mismatch",
  );
});

test("generated wheel proofs verify successfully", () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const selection = selectVerifiableOutcome(WHEEL_OUTCOMES);
    assert.equal(deriveWheelIndex(selection.seed), selection.outcomeIndex);
    assert.equal(verifyWheelProof(selection).valid, true);
    assert.equal(verifyGameProof("wheel", selection).code, "verified");
  }
});

test("wheel verification rejects a mismatched index and malformed proof", () => {
  const selection = selectVerifiableOutcome(WHEEL_OUTCOMES);
  const otherIndex = (selection.outcomeIndex + 1) % WHEEL_OUTCOMES.length;
  assert.equal(
    verifyWheelProof({
      ...selection,
      outcomeIndex: otherIndex,
      outcome: WHEEL_OUTCOMES[otherIndex],
    }).code,
    "outcome_mismatch",
  );
  assert.equal(verifyWheelProof({ ...selection, seed: "bad" }).code, "invalid_seed");
});

