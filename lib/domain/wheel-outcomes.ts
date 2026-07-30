export type WheelOutcomeType = "token" | "booster";

export interface WheelOutcome {
  type: WheelOutcomeType;
  value: number;
}

/**
 * The order is part of the public fairness contract and must match the wheel
 * rendered by the client. Reordering entries changes seed-derived results.
 */
export const WHEEL_OUTCOMES = Object.freeze<readonly WheelOutcome[]>([
  Object.freeze({ type: "token", value: 10 }),
  Object.freeze({ type: "token", value: 25 }),
  Object.freeze({ type: "token", value: 50 }),
  Object.freeze({ type: "token", value: 100 }),
  Object.freeze({ type: "token", value: 150 }),
  Object.freeze({ type: "booster", value: 15 }),
  Object.freeze({ type: "booster", value: 25 }),
  Object.freeze({ type: "booster", value: 35 }),
]);

export function isWheelOutcome(value: unknown): value is WheelOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.type === "token" || candidate.type === "booster") &&
    Number.isSafeInteger(candidate.value) &&
    Number(candidate.value) > 0
  );
}

export function wheelOutcomeAt(index: unknown): WheelOutcome {
  const numeric = Number(index);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric >= WHEEL_OUTCOMES.length) {
    throw new RangeError("wheel outcome index is outside the configured wheel");
  }
  return WHEEL_OUTCOMES[numeric];
}

export function wheelOutcomeEquals(left: WheelOutcome, right: WheelOutcome): boolean {
  return left.type === right.type && left.value === right.value;
}

export function wheelOutcomeLabel(outcome: WheelOutcome): string {
  return outcome.type === "token"
    ? `${outcome.value} casino chips`
    : `${outcome.value}% purchase booster`;
}

