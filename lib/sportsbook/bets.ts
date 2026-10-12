import { createHash, randomUUID } from "node:crypto";

import { SportsbookCatalog } from "./catalog.ts";
import {
  type Bet,
  type BetKind,
  type BetLeg,
  type BetQuote,
  type Price,
  SportsbookConflictError,
  SportsbookValidationError,
  multiplyPrice,
  normalizedCurrency,
  parsedDate,
  positiveMinor,
  requiredText,
  returnForStake,
} from "./types.ts";

export interface BetRequest {
  playerId: string;
  requestId: string;
  currency: string;
  stakeMinor: bigint;
  kind: BetKind;
  selections: readonly {
    marketId: string;
    selectionId: string;
  }[];
  systemSize?: number;
}

export interface BetAcceptancePolicy {
  quoteLifetimeMs: number;
  minimumStakeMinor: bigint;
  maximumStakeMinor: bigint;
  maximumLegs: number;
  maximumReturnMinor: bigint;
  allowedCurrencies: readonly string[];
  allowRelatedSelections: boolean;
  priceChangeToleranceBasisPoints: number;
}

export interface WalletReservation {
  reference: string;
  playerId: string;
  currency: string;
  amountMinor: bigint;
}

export interface BetWallet {
  reserve(input: WalletReservation): void;
  release(reference: string): void;
  settle(reference: string, returnMinor: bigint): void;
}

export class BetRepository {
  readonly #bets = new Map<string, Bet>();
  readonly #byRequest = new Map<string, string>();
  readonly #byPlayer = new Map<string, Set<string>>();

  add(value: Bet): Bet {
    if (this.#bets.has(value.id)) {
      throw new SportsbookConflictError("bet id already exists");
    }
    const requestKey = `${value.playerId}:${value.requestId}`;
    const existingId = this.#byRequest.get(requestKey);
    if (existingId) {
      const existing = this.#bets.get(existingId)!;
      if (betIdentity(existing) !== betIdentity(value)) {
        throw new SportsbookConflictError(
          "request id was already used for another bet",
        );
      }
      return cloneBet(existing);
    }
    const stored = cloneBet(value);
    this.#bets.set(stored.id, stored);
    this.#byRequest.set(requestKey, stored.id);
    const player = this.#byPlayer.get(stored.playerId) ?? new Set<string>();
    player.add(stored.id);
    this.#byPlayer.set(stored.playerId, player);
    return cloneBet(stored);
  }

  replace(value: Bet, expectedVersion: number): Bet {
    const current = this.#bets.get(value.id);
    if (!current) throw new SportsbookValidationError("bet does not exist");
    if (current.version !== expectedVersion) {
      throw new SportsbookConflictError("bet version does not match");
    }
    const changed = cloneBet({ ...value, version: expectedVersion + 1 });
    this.#bets.set(changed.id, changed);
    return cloneBet(changed);
  }

  get(betId: string): Bet | undefined {
    const value = this.#bets.get(betId.trim());
    return value ? cloneBet(value) : undefined;
  }

  forPlayer(playerId: string): readonly Bet[] {
    return [...(this.#byPlayer.get(playerId.trim()) ?? [])]
      .map((id) => this.#bets.get(id)!)
      .sort(
        (left, right) =>
          right.placedAt.localeCompare(left.placedAt) ||
          right.id.localeCompare(left.id),
      )
      .map(cloneBet);
  }

  open(): readonly Bet[] {
    return [...this.#bets.values()]
      .filter((bet) =>
        ["pending", "accepted", "partially_settled"].includes(bet.status),
      )
      .sort(
        (left, right) =>
          left.placedAt.localeCompare(right.placedAt) ||
          left.id.localeCompare(right.id),
      )
      .map(cloneBet);
  }
}

export class BetService {
  readonly #quotes = new Map<string, BetQuote>();
  readonly #catalog: SportsbookCatalog;
  readonly #repository: BetRepository;
  readonly #wallet: BetWallet;
  readonly #policy: BetAcceptancePolicy;

  constructor(
    catalog: SportsbookCatalog,
    repository: BetRepository,
    wallet: BetWallet,
    policy: BetAcceptancePolicy,
  ) {
    validatePolicy(policy);
    this.#catalog = catalog;
    this.#repository = repository;
    this.#wallet = wallet;
    this.#policy = policy;
  }

  quote(request: BetRequest, now = new Date()): BetQuote {
    const input = validateRequest(request, this.#policy);
    const legs = input.selections.map(({ marketId, selectionId }): BetLeg => {
      const market = this.#catalog.market(marketId);
      if (!market) throw new SportsbookValidationError("market does not exist");
      if (market.status !== "open")
        throw new SportsbookConflictError("market is not open");
      const event = this.#catalog.event(market.eventId);
      if (
        !event ||
        ["finished", "cancelled", "abandoned"].includes(event.status)
      ) {
        throw new SportsbookConflictError("event is not accepting bets");
      }
      const selection = market.selections.find(
        (value) => value.id === selectionId,
      );
      if (!selection)
        throw new SportsbookValidationError("selection does not exist");
      if (selection.status !== "active") {
        throw new SportsbookConflictError("selection is not active");
      }
      return {
        eventId: market.eventId,
        marketId,
        selectionId,
        acceptedPrice: { ...selection.price },
        currentPrice: { ...selection.price },
        result: "pending",
      };
    });
    this.validateRelatedSelections(legs);
    const potentialReturnMinor = quoteReturn(
      input.stakeMinor,
      input.kind,
      legs,
      input.systemSize,
    );
    const cappedReturn =
      potentialReturnMinor > this.#policy.maximumReturnMinor
        ? this.#policy.maximumReturnMinor
        : potentialReturnMinor;
    const created = new Date(now);
    const quote: BetQuote = {
      id: randomUUID(),
      playerId: input.playerId,
      currency: input.currency,
      stakeMinor: input.stakeMinor,
      legs,
      kind: input.kind,
      systemSize: input.systemSize,
      potentialReturnMinor: cappedReturn,
      expiresAt: new Date(
        created.getTime() + this.#policy.quoteLifetimeMs,
      ).toISOString(),
      fingerprint: quoteFingerprint(input, legs),
    };
    this.#quotes.set(quote.id, cloneQuote(quote));
    return cloneQuote(quote);
  }

  accept(quoteId: string, requestId: string, now = new Date()): Bet {
    const quote = this.#quotes.get(requiredText(quoteId, "quote id"));
    if (!quote) throw new SportsbookValidationError("bet quote does not exist");
    const acceptedAt = new Date(now);
    if (acceptedAt >= new Date(quote.expiresAt)) {
      throw new SportsbookConflictError("bet quote expired");
    }
    const existing = this.#repository
      .forPlayer(quote.playerId)
      .find((bet) => bet.requestId === requestId.trim());
    if (existing) {
      if (
        existing.legs.length !== quote.legs.length ||
        existing.stakeMinor !== quote.stakeMinor
      ) {
        throw new SportsbookConflictError("request id was already used");
      }
      return existing;
    }
    const currentLegs = quote.legs.map((leg) => this.refreshLeg(leg));
    for (let index = 0; index < currentLegs.length; index += 1) {
      const quoted = quote.legs[index].acceptedPrice;
      const current = currentLegs[index].currentPrice!;
      const movement = priceMovementBasisPoints(quoted, current);
      if (movement < -this.#policy.priceChangeToleranceBasisPoints) {
        throw new SportsbookConflictError(
          "selection price moved beyond tolerance",
        );
      }
    }
    const acceptedReturnMinor = quoteReturn(
      quote.stakeMinor,
      quote.kind,
      currentLegs.map((leg) => ({ ...leg, acceptedPrice: leg.currentPrice! })),
      quote.systemSize,
    );
    const cappedReturn =
      acceptedReturnMinor > this.#policy.maximumReturnMinor
        ? this.#policy.maximumReturnMinor
        : acceptedReturnMinor;
    const id = randomUUID();
    const reservation = `sportsbook:${id}`;
    this.#wallet.reserve({
      reference: reservation,
      playerId: quote.playerId,
      currency: quote.currency,
      amountMinor: quote.stakeMinor,
    });
    const bet: Bet = {
      id,
      playerId: quote.playerId,
      kind: quote.kind,
      currency: quote.currency,
      stakeMinor: quote.stakeMinor,
      potentialReturnMinor: quote.potentialReturnMinor,
      acceptedReturnMinor: cappedReturn,
      legs: currentLegs.map((leg) => ({
        ...leg,
        acceptedPrice: { ...leg.currentPrice! },
      })),
      systemSize: quote.systemSize,
      status: "accepted",
      requestId: requiredText(requestId, "request id"),
      placedAt: acceptedAt.toISOString(),
      acceptedAt: acceptedAt.toISOString(),
      version: 1,
    };
    try {
      return this.#repository.add(bet);
    } catch (error) {
      this.#wallet.release(reservation);
      throw error;
    }
  }

  quoteById(quoteId: string): BetQuote | undefined {
    const value = this.#quotes.get(quoteId.trim());
    return value ? cloneQuote(value) : undefined;
  }

  purgeExpired(now = new Date()): number {
    let removed = 0;
    for (const [id, quote] of this.#quotes) {
      if (new Date(quote.expiresAt) <= now) {
        this.#quotes.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  private refreshLeg(leg: BetLeg): BetLeg {
    const market = this.#catalog.market(leg.marketId);
    if (!market || market.status !== "open") {
      throw new SportsbookConflictError("market closed before bet acceptance");
    }
    const selection = market.selections.find(
      (value) => value.id === leg.selectionId,
    );
    if (!selection || selection.status !== "active") {
      throw new SportsbookConflictError(
        "selection closed before bet acceptance",
      );
    }
    return {
      ...leg,
      currentPrice: { ...selection.price },
    };
  }

  private validateRelatedSelections(legs: readonly BetLeg[]): void {
    if (this.#policy.allowRelatedSelections) return;
    const events = new Set<string>();
    for (const leg of legs) {
      if (events.has(leg.eventId)) {
        throw new SportsbookValidationError(
          "related selections are not allowed",
        );
      }
      events.add(leg.eventId);
    }
  }
}

function validatePolicy(value: BetAcceptancePolicy): void {
  if (
    !Number.isSafeInteger(value.quoteLifetimeMs) ||
    value.quoteLifetimeMs < 100
  ) {
    throw new SportsbookValidationError("quote lifetime is invalid");
  }
  positiveMinor(value.minimumStakeMinor, "minimum stake");
  positiveMinor(value.maximumStakeMinor, "maximum stake");
  if (value.maximumStakeMinor < value.minimumStakeMinor) {
    throw new SportsbookValidationError("maximum stake is below minimum stake");
  }
  if (
    !Number.isSafeInteger(value.maximumLegs) ||
    value.maximumLegs < 1 ||
    value.maximumLegs > 100
  ) {
    throw new SportsbookValidationError("maximum legs is invalid");
  }
  positiveMinor(value.maximumReturnMinor, "maximum return");
  if (
    !Number.isSafeInteger(value.priceChangeToleranceBasisPoints) ||
    value.priceChangeToleranceBasisPoints < 0 ||
    value.priceChangeToleranceBasisPoints > 10_000
  ) {
    throw new SportsbookValidationError("price tolerance is invalid");
  }
  if (value.allowedCurrencies.length === 0) {
    throw new SportsbookValidationError("at least one currency is required");
  }
}

function validateRequest(
  value: BetRequest,
  policy: BetAcceptancePolicy,
): BetRequest {
  const playerId = requiredText(value.playerId, "player id");
  const requestId = requiredText(value.requestId, "request id");
  const currency = normalizedCurrency(value.currency);
  const stakeMinor = positiveMinor(value.stakeMinor, "stake");
  if (!policy.allowedCurrencies.map(normalizedCurrency).includes(currency)) {
    throw new SportsbookValidationError("currency is not accepted");
  }
  if (
    stakeMinor < policy.minimumStakeMinor ||
    stakeMinor > policy.maximumStakeMinor
  ) {
    throw new SportsbookValidationError("stake is outside allowed limits");
  }
  if (
    value.selections.length < 1 ||
    value.selections.length > policy.maximumLegs
  ) {
    throw new SportsbookValidationError(
      "selection count is outside allowed limits",
    );
  }
  if (value.kind === "single" && value.selections.length !== 1) {
    throw new SportsbookValidationError("single bet requires one selection");
  }
  if (value.kind === "accumulator" && value.selections.length < 2) {
    throw new SportsbookValidationError(
      "accumulator requires at least two selections",
    );
  }
  if (value.kind === "system") {
    if (
      !Number.isSafeInteger(value.systemSize) ||
      value.systemSize! < 1 ||
      value.systemSize! >= value.selections.length
    ) {
      throw new SportsbookValidationError("system size is invalid");
    }
  }
  const keys = new Set<string>();
  const selections = value.selections.map((selection) => {
    const marketId = requiredText(selection.marketId, "market id");
    const selectionId = requiredText(selection.selectionId, "selection id");
    const key = `${marketId}:${selectionId}`;
    if (keys.has(key))
      throw new SportsbookValidationError("duplicate selection");
    keys.add(key);
    return { marketId, selectionId };
  });
  return {
    ...value,
    playerId,
    requestId,
    currency,
    stakeMinor,
    selections,
  };
}

function quoteReturn(
  stakeMinor: bigint,
  kind: BetKind,
  legs: readonly BetLeg[],
  systemSize?: number,
): bigint {
  if (kind !== "system") {
    const combined = legs.reduce<Price>(
      (price, leg) => multiplyPrice(price, leg.acceptedPrice),
      { numerator: 1n, denominator: 1n },
    );
    return returnForStake(stakeMinor, combined);
  }
  const size = systemSize!;
  const combinations = choose(legs, size);
  const unitStake = stakeMinor / BigInt(combinations.length);
  const remainder = stakeMinor % BigInt(combinations.length);
  return combinations.reduce((total, combination, index) => {
    const combined = combination.reduce<Price>(
      (price, leg) => multiplyPrice(price, leg.acceptedPrice),
      { numerator: 1n, denominator: 1n },
    );
    const stake = unitStake + (BigInt(index) < remainder ? 1n : 0n);
    return total + (stake > 0n ? returnForStake(stake, combined) : 0n);
  }, 0n);
}

function choose<T>(values: readonly T[], size: number): T[][] {
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

function quoteFingerprint(input: BetRequest, legs: readonly BetLeg[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        playerId: input.playerId,
        requestId: input.requestId,
        currency: input.currency,
        stakeMinor: input.stakeMinor.toString(),
        kind: input.kind,
        systemSize: input.systemSize,
        legs: legs.map((leg) => ({
          marketId: leg.marketId,
          selectionId: leg.selectionId,
          numerator: leg.acceptedPrice.numerator.toString(),
          denominator: leg.acceptedPrice.denominator.toString(),
        })),
      }),
    )
    .digest("hex");
}

function priceMovementBasisPoints(previous: Price, current: Price): number {
  const oldDecimal = Number(previous.numerator) / Number(previous.denominator);
  const newDecimal = Number(current.numerator) / Number(current.denominator);
  return Math.trunc(((newDecimal - oldDecimal) / oldDecimal) * 10_000);
}

function betIdentity(value: Bet): string {
  return JSON.stringify({
    playerId: value.playerId,
    requestId: value.requestId,
    currency: value.currency,
    stakeMinor: value.stakeMinor.toString(),
    kind: value.kind,
    legs: value.legs.map((leg) => `${leg.marketId}:${leg.selectionId}`),
  });
}

function cloneBet(value: Bet): Bet {
  return {
    ...value,
    legs: value.legs.map((leg) => ({
      ...leg,
      acceptedPrice: { ...leg.acceptedPrice },
      currentPrice: leg.currentPrice ? { ...leg.currentPrice } : undefined,
    })),
  };
}

function cloneQuote(value: BetQuote): BetQuote {
  return {
    ...value,
    legs: value.legs.map((leg) => ({
      ...leg,
      acceptedPrice: { ...leg.acceptedPrice },
      currentPrice: leg.currentPrice ? { ...leg.currentPrice } : undefined,
    })),
  };
}

void parsedDate;
