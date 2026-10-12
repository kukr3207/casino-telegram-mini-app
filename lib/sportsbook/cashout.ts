import { createHash, randomUUID } from "node:crypto";

import { BetRepository, type BetWallet } from "./bets.ts";
import {
  type Bet,
  type CashOutQuote,
  type Price,
  SportsbookConflictError,
  SportsbookValidationError,
  requiredText,
} from "./types.ts";

export interface CashOutPolicy {
  enabled: boolean;
  minimumOfferMinor: bigint;
  maximumOfferMinor: bigint;
  preMatchMarginBasisPoints: number;
  inPlayMarginBasisPoints: number;
  quoteLifetimeMs: number;
  disabledMarketIds: readonly string[];
}

export interface CashOutInput {
  betId: string;
  currentPrices: Readonly<Record<string, Price>>;
  suspendedMarketIds?: readonly string[];
  inPlay: boolean;
  at?: Date;
}

export class CashOutService {
  readonly #quotes = new Map<string, CashOutQuote>();
  readonly #byBet = new Map<string, Set<string>>();
  readonly #bets: BetRepository;
  readonly #wallet: BetWallet;
  readonly #policy: CashOutPolicy;

  constructor(
    bets: BetRepository,
    wallet: BetWallet,
    policy: CashOutPolicy,
  ) {
    validatePolicy(policy);
    this.#bets = bets;
    this.#wallet = wallet;
    this.#policy = policy;
  }

  quote(input: CashOutInput): CashOutQuote {
    if (!this.#policy.enabled) throw new SportsbookConflictError("cash out is disabled");
    const bet = this.#bets.get(requiredText(input.betId, "bet id"));
    if (!bet) throw new SportsbookValidationError("bet does not exist");
    if (!['accepted', 'partially_settled'].includes(bet.status)) {
      throw new SportsbookConflictError("bet is not eligible for cash out");
    }
    const disabled = new Set(this.#policy.disabledMarketIds);
    const suspended = new Set(input.suspendedMarketIds ?? []);
    if (bet.legs.some((leg) => disabled.has(leg.marketId))) {
      throw new SportsbookConflictError("cash out is disabled for a market");
    }
    if (bet.legs.some((leg) => suspended.has(leg.marketId))) {
      throw new SportsbookConflictError("cash out is unavailable while a market is suspended");
    }
    const fairValueMinor = fairCashOutValue(bet, input.currentPrices);
    const marginBasisPoints = input.inPlay
      ? this.#policy.inPlayMarginBasisPoints
      : this.#policy.preMatchMarginBasisPoints;
    let amountMinor = (fairValueMinor * BigInt(10_000 - marginBasisPoints)) / 10_000n;
    if (amountMinor > this.#policy.maximumOfferMinor) amountMinor = this.#policy.maximumOfferMinor;
    if (amountMinor < this.#policy.minimumOfferMinor) {
      throw new SportsbookConflictError("cash out amount is below the minimum offer");
    }
    const createdAt = input.at ? new Date(input.at) : new Date();
    if (!Number.isFinite(createdAt.getTime())) {
      throw new SportsbookValidationError("cash out quote time is invalid");
    }
    const quote: CashOutQuote = {
      id: randomUUID(),
      betId: bet.id,
      playerId: bet.playerId,
      currency: bet.currency,
      amountMinor,
      fairValueMinor,
      marginBasisPoints,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.#policy.quoteLifetimeMs).toISOString(),
      fingerprint: fingerprint(bet, input.currentPrices, amountMinor),
      status: "open",
    };
    this.#quotes.set(quote.id, quote);
    const ids = this.#byBet.get(bet.id) ?? new Set<string>();
    ids.add(quote.id);
    this.#byBet.set(bet.id, ids);
    return { ...quote };
  }

  accept(quoteId: string, playerId: string, at = new Date()): { quote: CashOutQuote; bet: Bet } {
    const quote = this.#quotes.get(requiredText(quoteId, "cash out quote id"));
    if (!quote) throw new SportsbookValidationError("cash out quote does not exist");
    if (quote.playerId !== requiredText(playerId, "player id")) {
      throw new SportsbookConflictError("cash out quote belongs to another player");
    }
    if (quote.status === "accepted") {
      const acceptedBet = this.#bets.get(quote.betId)!;
      return { quote: { ...quote }, bet: acceptedBet };
    }
    if (quote.status !== "open") throw new SportsbookConflictError("cash out quote is not open");
    const acceptedAt = new Date(at);
    if (acceptedAt >= new Date(quote.expiresAt)) {
      const expired = { ...quote, status: "expired" as const };
      this.#quotes.set(expired.id, expired);
      throw new SportsbookConflictError("cash out quote expired");
    }
    const bet = this.#bets.get(quote.betId);
    if (!bet || !['accepted', 'partially_settled'].includes(bet.status)) {
      throw new SportsbookConflictError("bet changed before cash out acceptance");
    }
    this.#wallet.settle(`sportsbook:${bet.id}`, quote.amountMinor);
    const changed = this.#bets.replace({
      ...bet,
      status: "cashed_out",
      cashOutMinor: quote.amountMinor,
      settledAt: acceptedAt.toISOString(),
    }, bet.version);
    const accepted = { ...quote, status: "accepted" as const };
    this.#quotes.set(accepted.id, accepted);
    this.withdrawOtherQuotes(bet.id, accepted.id);
    return { quote: { ...accepted }, bet: changed };
  }

  withdraw(quoteId: string): CashOutQuote {
    const quote = this.#quotes.get(requiredText(quoteId, "cash out quote id"));
    if (!quote) throw new SportsbookValidationError("cash out quote does not exist");
    if (quote.status !== "open") return { ...quote };
    const changed = { ...quote, status: "withdrawn" as const };
    this.#quotes.set(changed.id, changed);
    return { ...changed };
  }

  quotesForBet(betId: string): readonly CashOutQuote[] {
    return [...(this.#byBet.get(betId.trim()) ?? [])]
      .map((id) => this.#quotes.get(id)!)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((quote) => ({ ...quote }));
  }

  expire(at = new Date()): number {
    let count = 0;
    for (const [id, quote] of this.#quotes) {
      if (quote.status === "open" && new Date(quote.expiresAt) <= at) {
        this.#quotes.set(id, { ...quote, status: "expired" });
        count += 1;
      }
    }
    return count;
  }

  private withdrawOtherQuotes(betId: string, acceptedId: string): void {
    for (const id of this.#byBet.get(betId) ?? []) {
      if (id === acceptedId) continue;
      const quote = this.#quotes.get(id)!;
      if (quote.status === "open") this.#quotes.set(id, { ...quote, status: "withdrawn" });
    }
  }
}

export function fairCashOutValue(
  bet: Bet,
  currentPrices: Readonly<Record<string, Price>>,
): bigint {
  let probabilityNumerator = 1n;
  let probabilityDenominator = 1n;
  for (const leg of bet.legs) {
    if (leg.result === "lost" || leg.result === "half_lost") return 0n;
    if (["won", "void", "half_won"].includes(leg.result)) continue;
    const current = currentPrices[leg.selectionId];
    if (!current || current.numerator <= current.denominator || current.denominator <= 0n) {
      throw new SportsbookValidationError("current price is missing or invalid");
    }
    probabilityNumerator *= current.denominator;
    probabilityDenominator *= current.numerator;
  }
  if (probabilityDenominator === 0n) return 0n;
  return (bet.acceptedReturnMinor * probabilityNumerator) / probabilityDenominator;
}

function validatePolicy(value: CashOutPolicy): void {
  if (value.minimumOfferMinor <= 0n || value.maximumOfferMinor < value.minimumOfferMinor) {
    throw new SportsbookValidationError("cash out amount limits are invalid");
  }
  for (const margin of [value.preMatchMarginBasisPoints, value.inPlayMarginBasisPoints]) {
    if (!Number.isSafeInteger(margin) || margin < 0 || margin >= 10_000) {
      throw new SportsbookValidationError("cash out margin is invalid");
    }
  }
  if (!Number.isSafeInteger(value.quoteLifetimeMs) || value.quoteLifetimeMs < 100) {
    throw new SportsbookValidationError("cash out quote lifetime is invalid");
  }
}

function fingerprint(
  bet: Bet,
  prices: Readonly<Record<string, Price>>,
  amountMinor: bigint,
): string {
  const normalizedPrices = Object.fromEntries(Object.entries(prices)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, price]) => [id, `${price.numerator}/${price.denominator}`]));
  return createHash("sha256")
    .update(JSON.stringify({
      betId: bet.id,
      version: bet.version,
      amountMinor: amountMinor.toString(),
      prices: normalizedPrices,
    }))
    .digest("hex");
}
