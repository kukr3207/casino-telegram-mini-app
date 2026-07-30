import { createHash, timingSafeEqual } from "crypto";

import {
  isWheelOutcome,
  WHEEL_OUTCOMES,
  wheelOutcomeEquals,
} from "../domain/wheel-outcomes.ts";
import type { WheelOutcome } from "../domain/wheel-outcomes.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const DICE_MIN = 1;
const DICE_MAX = 6;

export type VerificationCode =
  | "verified"
  | "invalid_seed"
  | "invalid_hash"
  | "invalid_outcome"
  | "outcome_mismatch"
  | "commitment_mismatch";

export interface VerificationResult {
  valid: boolean;
  code: VerificationCode;
  message: string;
  expected?: unknown;
}

export interface DiceProof {
  seed: string;
  hash: string;
  dice1: number;
  dice2: number;
}

export interface WheelProof {
  seed: string;
  hash: string;
  outcomeIndex: number;
  outcome: WheelOutcome;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function hexadecimalDigest(value: string): string {
  return sha256(value).toString("hex");
}

function isSeed(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function hashesEqual(left: string, right: string): boolean {
  if (!isHash(left) || !isHash(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function invalid(code: VerificationCode, message: string, expected?: unknown): VerificationResult {
  return { valid: false, code, message, ...(expected === undefined ? {} : { expected }) };
}

function verified(message: string): VerificationResult {
  return { valid: true, code: "verified", message };
}

export function deriveDiceFaces(seed: string): { dice1: number; dice2: number } {
  if (!isSeed(seed)) {
    throw new TypeError("seed must be a 64-character lowercase hexadecimal value");
  }
  const bytes = sha256(`dice:${seed}`);
  return {
    dice1: (bytes.readUInt16BE(0) % DICE_MAX) + DICE_MIN,
    dice2: (bytes.readUInt16BE(2) % DICE_MAX) + DICE_MIN,
  };
}

export function diceCommitment(proof: Pick<DiceProof, "seed" | "dice1" | "dice2">): string {
  return hexadecimalDigest(`${proof.seed}:${proof.dice1}:${proof.dice2}`);
}

export function verifyDiceProof(input: DiceProof): VerificationResult {
  if (!isSeed(input.seed)) {
    return invalid("invalid_seed", "The dice seed is not valid hexadecimal data.");
  }
  if (!isHash(input.hash)) {
    return invalid("invalid_hash", "The dice commitment is not a SHA-256 hash.");
  }
  if (
    !Number.isInteger(input.dice1) ||
    !Number.isInteger(input.dice2) ||
    input.dice1 < DICE_MIN ||
    input.dice1 > DICE_MAX ||
    input.dice2 < DICE_MIN ||
    input.dice2 > DICE_MAX
  ) {
    return invalid("invalid_outcome", "Dice faces must both be whole numbers from 1 to 6.");
  }

  const expectedFaces = deriveDiceFaces(input.seed);
  if (input.dice1 !== expectedFaces.dice1 || input.dice2 !== expectedFaces.dice2) {
    return invalid(
      "outcome_mismatch",
      "The recorded dice faces do not match the seed-derived result.",
      expectedFaces,
    );
  }

  const expectedHash = diceCommitment(input);
  if (!hashesEqual(input.hash, expectedHash)) {
    return invalid(
      "commitment_mismatch",
      "The dice result does not match its stored commitment.",
      expectedHash,
    );
  }

  return verified("The seed, dice faces, and commitment are consistent.");
}

export function deriveWheelIndex(seed: string, outcomeCount = WHEEL_OUTCOMES.length): number {
  if (!isSeed(seed)) {
    throw new TypeError("seed must be a 64-character lowercase hexadecimal value");
  }
  if (!Number.isSafeInteger(outcomeCount) || outcomeCount < 1 || outcomeCount > 256) {
    throw new RangeError("outcome count must be between 1 and 256");
  }
  return sha256(`wheel:${seed}`).readUInt32BE(0) % outcomeCount;
}

export function wheelCommitment(
  proof: Pick<WheelProof, "seed" | "outcome">,
): string {
  return hexadecimalDigest(`${proof.seed}:${JSON.stringify(proof.outcome)}`);
}

export function verifyWheelProof(input: WheelProof): VerificationResult {
  if (!isSeed(input.seed)) {
    return invalid("invalid_seed", "The wheel seed is not valid hexadecimal data.");
  }
  if (!isHash(input.hash)) {
    return invalid("invalid_hash", "The wheel commitment is not a SHA-256 hash.");
  }
  if (!isWheelOutcome(input.outcome)) {
    return invalid("invalid_outcome", "The stored wheel outcome is not supported.");
  }
  if (
    !Number.isSafeInteger(input.outcomeIndex) ||
    input.outcomeIndex < 0 ||
    input.outcomeIndex >= WHEEL_OUTCOMES.length
  ) {
    return invalid("invalid_outcome", "The wheel outcome index is outside the configured wheel.");
  }

  const expectedIndex = deriveWheelIndex(input.seed);
  const expectedOutcome = WHEEL_OUTCOMES[expectedIndex];
  if (
    input.outcomeIndex !== expectedIndex ||
    !wheelOutcomeEquals(input.outcome, expectedOutcome)
  ) {
    return invalid(
      "outcome_mismatch",
      "The recorded wheel segment does not match the seed-derived result.",
      { outcomeIndex: expectedIndex, outcome: expectedOutcome },
    );
  }

  const expectedHash = wheelCommitment(input);
  if (!hashesEqual(input.hash, expectedHash)) {
    return invalid(
      "commitment_mismatch",
      "The wheel outcome does not match its stored commitment.",
      expectedHash,
    );
  }

  return verified("The seed, wheel segment, outcome, and commitment are consistent.");
}

export function verifyGameProof(
  game: "dice" | "wheel",
  proof: DiceProof | WheelProof,
): VerificationResult {
  if (game === "dice") return verifyDiceProof(proof as DiceProof);
  return verifyWheelProof(proof as WheelProof);
}
