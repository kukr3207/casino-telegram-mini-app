export interface TokenBalances {
  casino_chips: number;
  withdraw_tokens: number;
  hol_tokens: number;
}

const MAX_TOKEN_BALANCE = Number.MAX_SAFE_INTEGER;

function storedToken(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(Math.floor(numeric), MAX_TOKEN_BALANCE);
}

export function readTokenBalances(
  source: Record<string, unknown> | null | undefined,
): TokenBalances {
  return {
    casino_chips: storedToken(source?.casino_chips),
    withdraw_tokens: storedToken(source?.withdraw_tokens),
    hol_tokens: storedToken(source?.hol_tokens),
  };
}

export function requirePositiveTokenAmount(
  value: unknown,
  label = "amount",
): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new RangeError(`${label} must be a positive whole number`);
  }
  return numeric;
}

export function addCasinoChips(
  balances: TokenBalances,
  amount: unknown,
): TokenBalances {
  const delta = requirePositiveTokenAmount(amount, "tokens");
  const next = balances.casino_chips + delta;
  if (!Number.isSafeInteger(next) || next > MAX_TOKEN_BALANCE) {
    throw new RangeError("casino chip balance exceeds the supported maximum");
  }
  return { ...balances, casino_chips: next };
}

export interface TokenConversion {
  converted: number;
  balances: TokenBalances;
}

export function convertWithdrawTokens(
  balances: TokenBalances,
  percentageValue: unknown,
): TokenConversion {
  const percentage = Number(percentageValue);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
    throw new RangeError("percentage must be greater than 0 and at most 100");
  }

  const converted = Math.floor(balances.withdraw_tokens * (percentage / 100));
  if (converted < 1) {
    throw new RangeError("Insufficient withdrawable tokens");
  }

  return {
    converted,
    balances: {
      ...balances,
      casino_chips: balances.casino_chips + converted,
      withdraw_tokens: balances.withdraw_tokens - converted,
    },
  };
}

