export type AssetCode = "CHIP" | "WITHDRAW" | "HOL" | "STAR" | string;

export interface Money {
  asset: AssetCode;
  units: bigint;
}

const ASSET_PATTERN = /^[A-Z][A-Z0-9_]{1,15}$/;

export function assetCode(value: unknown): AssetCode {
  if (typeof value !== "string" || !ASSET_PATTERN.test(value.trim().toUpperCase())) {
    throw new RangeError("asset must be an uppercase code from 2 to 16 characters");
  }
  return value.trim().toUpperCase();
}

export function units(value: unknown, field = "units"): bigint {
  try {
    const parsed = typeof value === "bigint" ? value : BigInt(String(value));
    if (parsed < 0n) throw new RangeError(`${field} cannot be negative`);
    return parsed;
  } catch (error) {
    if (error instanceof RangeError && error.message.includes("cannot be negative")) throw error;
    throw new RangeError(`${field} must be a non-negative whole number`);
  }
}

export function positiveUnits(value: unknown, field = "units"): bigint {
  const parsed = units(value, field);
  if (parsed === 0n) throw new RangeError(`${field} must be positive`);
  return parsed;
}

export function money(asset: unknown, value: unknown): Money {
  return { asset: assetCode(asset), units: units(value) };
}

export function add(left: Money, right: Money): Money {
  if (left.asset !== right.asset) throw new RangeError("money assets must match");
  return { asset: left.asset, units: left.units + right.units };
}

export function subtract(left: Money, right: Money): Money {
  if (left.asset !== right.asset) throw new RangeError("money assets must match");
  if (right.units > left.units) throw new RangeError("money subtraction would be negative");
  return { asset: left.asset, units: left.units - right.units };
}

export function multiply(value: Money, numerator: bigint, denominator = 1n): Money {
  if (numerator < 0n || denominator <= 0n) throw new RangeError("money multiplier is invalid");
  return { asset: value.asset, units: (value.units * numerator) / denominator };
}

export function compare(left: Money, right: Money): number {
  if (left.asset !== right.asset) throw new RangeError("money assets must match");
  return left.units < right.units ? -1 : left.units > right.units ? 1 : 0;
}

export function serializeMoney(value: Money): { asset: string; units: string } {
  return { asset: value.asset, units: value.units.toString() };
}

export function parseMoney(value: unknown): Money {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("money must be an object");
  }
  const candidate = value as Record<string, unknown>;
  return money(candidate.asset, candidate.units);
}

export function formatMoney(value: Money, displayName = value.asset): string {
  return `${value.units.toLocaleString("en-US")} ${displayName}`;
}
