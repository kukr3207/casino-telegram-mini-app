import { createHash, randomBytes } from "crypto";

export interface VerifiableSelection<T> {
  outcome: T;
  outcomeIndex: number;
  seed: string;
  hash: string;
}

function digest(seed: string, purpose: string): Buffer {
  return createHash("sha256").update(`${purpose}:${seed}`, "utf8").digest();
}

function randomSeed(): string {
  return randomBytes(32).toString("hex");
}

export function selectVerifiableOutcome<T>(
  outcomes: readonly T[],
): VerifiableSelection<T> {
  if (outcomes.length < 1 || outcomes.length > 256) {
    throw new RangeError("outcomes must contain between 1 and 256 entries");
  }

  const seed = randomSeed();
  const bytes = digest(seed, "wheel");
  const outcomeIndex = bytes.readUInt32BE(0) % outcomes.length;
  const outcome = outcomes[outcomeIndex];
  const hash = createHash("sha256")
    .update(`${seed}:${JSON.stringify(outcome)}`, "utf8")
    .digest("hex");

  return { outcome, outcomeIndex, seed, hash };
}

export interface VerifiableDiceRoll {
  dice1: number;
  dice2: number;
  seed: string;
  hash: string;
}

export function rollVerifiableDice(): VerifiableDiceRoll {
  const seed = randomSeed();
  const bytes = digest(seed, "dice");
  const dice1 = (bytes.readUInt16BE(0) % 6) + 1;
  const dice2 = (bytes.readUInt16BE(2) % 6) + 1;
  const hash = createHash("sha256")
    .update(`${seed}:${dice1}:${dice2}`, "utf8")
    .digest("hex");

  return { dice1, dice2, seed, hash };
}

