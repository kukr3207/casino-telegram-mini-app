import { createHash } from "node:crypto";

import { BetRepository, type BetWallet } from "./bets.ts";
import {
  type Bet,
  type BetLeg,
  type BetPayout,
  type Price,
  type SelectionResult,
  SportsbookConflictError,
  SportsbookValidationError,
  multiplyPrice,
  requiredText,
  returnForStake,
} from "./types.ts";

export interface MarketSettlement {
  marketId: string;
  eventId: string;
  results: Readonly<Record<string, SelectionResult>>;
  source: string;
  sourceRevision: number;
  settledAt: string;
  fingerprint: string;
}

export interface TaxPolicy {
  currency: string;
  winTaxBasisPoints: number;
  taxFreeWinMinor: bigint;
  maximumTaxMinor?: bigint;
}

export interface SettlementAuditEntry {
  sequence: number;
  kind: "market_settled" | "market_corrected" | "bet_settled";
  reference: string;
  occurredAt: string;
  payloadHash: string;
  previousHash: string;
  hash: string;
}

export class SportsbookSettlementService {
  readonly #marketSettlements = new Map<string, MarketSettlement>();
  readonly #payouts = new Map<string, BetPayout>();
  readonly #taxPolicies = new Map<string, TaxPolicy>();
  readonly #audit: SettlementAuditEntry[] = [];
  readonly #bets: BetRepository;
  readonly #wallet: BetWallet;

  constructor(bets: BetRepository, wallet: BetWallet) {
    this.#bets = bets;
    this.#wallet = wallet;
  }

  setTaxPolicy(value: TaxPolicy): TaxPolicy {
    const currency = value.currency.trim().toUpperCase();
    if (!currency)
      throw new SportsbookValidationError("tax currency is required");
    if (
      !Number.isSafeInteger(value.winTaxBasisPoints) ||
      value.winTaxBasisPoints < 0 ||
      value.winTaxBasisPoints > 10_000
    ) {
      throw new SportsbookValidationError("win tax rate is invalid");
    }
    if (
      value.taxFreeWinMinor < 0n ||
      (value.maximumTaxMinor !== undefined && value.maximumTaxMinor < 0n)
    ) {
      throw new SportsbookValidationError("tax thresholds cannot be negative");
    }
    const policy = { ...value, currency };
    this.#taxPolicies.set(currency, policy);
    return { ...policy };
  }

  settleMarket(
    input: Omit<MarketSettlement, "fingerprint">,
  ): readonly BetPayout[] {
    const settlement = validateSettlement(input);
    const existing = this.#marketSettlements.get(settlement.marketId);
    if (existing) {
      if (settlement.sourceRevision < existing.sourceRevision) {
        throw new SportsbookConflictError(
          "settlement source revision moved backwards",
        );
      }
      if (settlement.sourceRevision === existing.sourceRevision) {
        if (settlement.fingerprint !== existing.fingerprint) {
          throw new SportsbookConflictError(
            "settlement revision contains different results",
          );
        }
        return this.affectedPayouts(settlement.marketId);
      }
      this.assertCorrectionSafe(existing, settlement);
    }
    this.#marketSettlements.set(settlement.marketId, settlement);
    this.recordAudit(
      existing ? "market_corrected" : "market_settled",
      settlement.marketId,
      settlement.settledAt,
      settlement,
    );
    const payouts: BetPayout[] = [];
    for (const bet of this.#bets.open()) {
      if (!bet.legs.some((leg) => leg.marketId === settlement.marketId))
        continue;
      const changed = this.applyMarketResult(bet, settlement);
      const complete = changed.legs.every((leg) => leg.result !== "pending");
      const updated = this.#bets.replace(
        {
          ...changed,
          status: complete ? finalStatus(changed.legs) : "partially_settled",
          settledAt: complete ? settlement.settledAt : undefined,
        },
        bet.version,
      );
      if (complete) payouts.push(this.pay(updated, settlement.settledAt));
    }
    return payouts;
  }

  voidMarket(
    marketId: string,
    eventId: string,
    selectionIds: readonly string[],
    source: string,
    sourceRevision: number,
    settledAt = new Date(),
  ): readonly BetPayout[] {
    if (selectionIds.length === 0) {
      throw new SportsbookValidationError(
        "void settlement requires selections",
      );
    }
    const results = Object.fromEntries(
      selectionIds.map((id) => [id, "void" as const]),
    );
    return this.settleMarket({
      marketId,
      eventId,
      results,
      source,
      sourceRevision,
      settledAt: settledAt.toISOString(),
    });
  }

  payout(betId: string): BetPayout | undefined {
    const value = this.#payouts.get(betId.trim());
    return value ? { ...value } : undefined;
  }

  marketSettlement(marketId: string): MarketSettlement | undefined {
    const value = this.#marketSettlements.get(marketId.trim());
    return value ? cloneSettlement(value) : undefined;
  }

  audit(): readonly SettlementAuditEntry[] {
    return this.#audit.map((entry) => ({ ...entry }));
  }

  verifyAudit(): boolean {
    let previousHash = "0".repeat(64);
    for (const entry of this.#audit) {
      if (entry.previousHash !== previousHash) return false;
      const calculated = hashAudit({
        sequence: entry.sequence,
        kind: entry.kind,
        reference: entry.reference,
        occurredAt: entry.occurredAt,
        payloadHash: entry.payloadHash,
        previousHash: entry.previousHash,
      });
      if (calculated !== entry.hash) return false;
      previousHash = entry.hash;
    }
    return true;
  }

  private applyMarketResult(bet: Bet, settlement: MarketSettlement): Bet {
    const legs = bet.legs.map((leg): BetLeg => {
      if (leg.marketId !== settlement.marketId) return leg;
      const result = settlement.results[leg.selectionId];
      if (!result)
        throw new SportsbookValidationError(
          "settlement omits a selected outcome",
        );
      return {
        ...leg,
        result,
        settledAt: settlement.settledAt,
      };
    });
    return { ...bet, legs };
  }

  private pay(bet: Bet, settledAt: string): BetPayout {
    const existing = this.#payouts.get(bet.id);
    if (existing) return { ...existing };
    const grossReturnMinor = calculateReturn(bet);
    const taxableWinMinor =
      grossReturnMinor > bet.stakeMinor
        ? grossReturnMinor - bet.stakeMinor
        : 0n;
    const taxMinor = this.calculateTax(bet.currency, taxableWinMinor);
    const netReturnMinor = grossReturnMinor - taxMinor;
    const payout: BetPayout = {
      betId: bet.id,
      stakeMinor: bet.stakeMinor,
      grossReturnMinor,
      taxableWinMinor,
      taxMinor,
      netReturnMinor,
      result: bet.status,
      settledAt,
    };
    this.#wallet.settle(`sportsbook:${bet.id}`, netReturnMinor);
    this.#payouts.set(bet.id, payout);
    this.recordAudit("bet_settled", bet.id, settledAt, payout);
    return { ...payout };
  }

  private calculateTax(currency: string, winMinor: bigint): bigint {
    const policy = this.#taxPolicies.get(currency);
    if (!policy || winMinor <= policy.taxFreeWinMinor) return 0n;
    const taxable = winMinor - policy.taxFreeWinMinor;
    const calculated = (taxable * BigInt(policy.winTaxBasisPoints)) / 10_000n;
    if (
      policy.maximumTaxMinor !== undefined &&
      calculated > policy.maximumTaxMinor
    ) {
      return policy.maximumTaxMinor;
    }
    return calculated;
  }

  private assertCorrectionSafe(
    previous: MarketSettlement,
    next: MarketSettlement,
  ): void {
    if (previous.eventId !== next.eventId) {
      throw new SportsbookConflictError(
        "settlement cannot move to another event",
      );
    }
    const affected = this.affectedPayouts(previous.marketId);
    if (affected.length > 0) {
      throw new SportsbookConflictError(
        "paid market correction requires manual reversal",
      );
    }
  }

  private affectedPayouts(marketId: string): BetPayout[] {
    return this.#bets
      .open()
      .filter((bet) => bet.legs.some((leg) => leg.marketId === marketId))
      .map((bet) => this.#payouts.get(bet.id))
      .filter((value): value is BetPayout => Boolean(value))
      .map((value) => ({ ...value }));
  }

  private recordAudit(
    kind: SettlementAuditEntry["kind"],
    reference: string,
    occurredAt: string,
    payload: unknown,
  ): void {
    const previousHash = this.#audit.at(-1)?.hash ?? "0".repeat(64);
    const base = {
      sequence: this.#audit.length + 1,
      kind,
      reference,
      occurredAt,
      payloadHash: stableHash(payload),
      previousHash,
    };
    this.#audit.push({ ...base, hash: hashAudit(base) });
  }
}

function validateSettlement(
  value: Omit<MarketSettlement, "fingerprint">,
): MarketSettlement {
  const marketId = requiredText(value.marketId, "market id");
  const eventId = requiredText(value.eventId, "event id");
  const source = requiredText(value.source, "settlement source");
  if (!Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1) {
    throw new SportsbookValidationError(
      "settlement source revision must be positive",
    );
  }
  const settledAt = new Date(value.settledAt);
  if (!Number.isFinite(settledAt.getTime())) {
    throw new SportsbookValidationError("settlement time is invalid");
  }
  const entries = Object.entries(value.results);
  if (entries.length === 0) {
    throw new SportsbookValidationError(
      "settlement requires selection results",
    );
  }
  const results = Object.fromEntries(
    entries.map(([selectionId, result]) => {
      requiredText(selectionId, "selection id");
      if (result === "pending") {
        throw new SportsbookValidationError(
          "settlement result cannot remain pending",
        );
      }
      return [selectionId, result];
    }),
  );
  const normalized = {
    ...value,
    marketId,
    eventId,
    source,
    results,
    settledAt: settledAt.toISOString(),
  };
  return {
    ...normalized,
    fingerprint: stableHash(normalized),
  };
}

export function calculateReturn(bet: Bet): bigint {
  if (bet.kind === "system") return calculateSystemReturn(bet);
  if (bet.legs.some((leg) => ["lost", "half_lost"].includes(leg.result))) {
    const halfLostCount = bet.legs.filter(
      (leg) => leg.result === "half_lost",
    ).length;
    if (halfLostCount === 0 || bet.legs.some((leg) => leg.result === "lost"))
      return 0n;
  }
  let adjustedStake = bet.stakeMinor;
  let price: Price = { numerator: 1n, denominator: 1n };
  for (const leg of bet.legs) {
    if (leg.result === "void") continue;
    if (leg.result === "half_lost") {
      adjustedStake /= 2n;
      continue;
    }
    if (leg.result === "half_won") {
      const halfPrice = {
        numerator: leg.acceptedPrice.numerator + leg.acceptedPrice.denominator,
        denominator: leg.acceptedPrice.denominator * 2n,
      };
      price = multiplyPrice(price, halfPrice);
      continue;
    }
    price = multiplyPrice(price, leg.acceptedPrice);
  }
  if (adjustedStake === 0n) return 0n;
  return returnForStake(adjustedStake, price);
}

function calculateSystemReturn(bet: Bet): bigint {
  const size = bet.systemSize;
  if (!size || size < 1 || size >= bet.legs.length) {
    throw new SportsbookValidationError("system bet size is invalid");
  }
  const combinations = combinationsOf(bet.legs, size);
  const unit = bet.stakeMinor / BigInt(combinations.length);
  const remainder = bet.stakeMinor % BigInt(combinations.length);
  return combinations.reduce((total, legs, index) => {
    const synthetic: Bet = {
      ...bet,
      kind: "accumulator",
      stakeMinor: unit + (BigInt(index) < remainder ? 1n : 0n),
      legs,
    };
    return (
      total + (synthetic.stakeMinor > 0n ? calculateReturn(synthetic) : 0n)
    );
  }, 0n);
}

function combinationsOf<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  const walk = (start: number, selected: T[]): void => {
    if (selected.length === size) {
      output.push([...selected]);
      return;
    }
    for (
      let index = start;
      index <= values.length - (size - selected.length);
      index += 1
    ) {
      selected.push(values[index]);
      walk(index + 1, selected);
      selected.pop();
    }
  };
  walk(0, []);
  return output;
}

function finalStatus(legs: readonly BetLeg[]): Bet["status"] {
  if (legs.every((leg) => leg.result === "void")) return "voided";
  if (legs.some((leg) => leg.result === "lost")) return "lost";
  if (
    legs.some((leg) => leg.result === "half_lost") &&
    !legs.some((leg) => ["won", "half_won"].includes(leg.result))
  )
    return "lost";
  return "won";
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    )
    .digest("hex");
}

function hashAudit(value: Omit<SettlementAuditEntry, "hash">): string {
  return stableHash(value);
}

function cloneSettlement(value: MarketSettlement): MarketSettlement {
  return {
    ...value,
    results: { ...value.results },
  };
}
