import {
  type Bet,
  type BetLeg,
  type Exposure,
  type LimitDecision,
  SportsbookValidationError,
  normalizedCurrency,
  positiveMinor,
  requiredText,
} from "./types.ts";

export interface SportsbookRiskLimits {
  currency: string;
  minimumStakeMinor: bigint;
  maximumStakeMinor: bigint;
  maximumBetReturnMinor: bigint;
  maximumPlayerOpenStakeMinor: bigint;
  maximumPlayerDailyStakeMinor: bigint;
  maximumEventLiabilityMinor: bigint;
  maximumMarketLiabilityMinor: bigint;
  maximumSelectionLiabilityMinor: bigint;
  reviewStakeMinor: bigint;
  reviewReturnMinor: bigint;
}

export interface PlayerRiskProfile {
  playerId: string;
  segment: "standard" | "trusted" | "sharp" | "restricted";
  stakeMultiplierBasisPoints: number;
  returnMultiplierBasisPoints: number;
  blockedSports: readonly string[];
  blockedCompetitions: readonly string[];
  blocked: boolean;
  reason?: string;
  version: number;
}

export interface RiskContext {
  playerId: string;
  currency: string;
  stakeMinor: bigint;
  potentialReturnMinor: bigint;
  legs: readonly BetLeg[];
  sportByEvent: Readonly<Record<string, string>>;
  competitionByEvent: Readonly<Record<string, string>>;
  placedAt: Date;
}

export interface LiabilityReservation {
  betId: string;
  playerId: string;
  currency: string;
  stakeMinor: bigint;
  potentialReturnMinor: bigint;
  liabilityMinor: bigint;
  eventIds: readonly string[];
  marketIds: readonly string[];
  selectionIds: readonly string[];
  placedAt: string;
  status: "open" | "released" | "settled";
}

export class SportsbookRiskEngine {
  readonly #limits = new Map<string, SportsbookRiskLimits>();
  readonly #profiles = new Map<string, PlayerRiskProfile>();
  readonly #reservations = new Map<string, LiabilityReservation>();

  setLimits(value: SportsbookRiskLimits): SportsbookRiskLimits {
    const limits = validateLimits(value);
    this.#limits.set(limits.currency, limits);
    return cloneLimits(limits);
  }

  limits(currency: string): SportsbookRiskLimits | undefined {
    const value = this.#limits.get(normalizedCurrency(currency));
    return value ? cloneLimits(value) : undefined;
  }

  setPlayerProfile(value: PlayerRiskProfile): PlayerRiskProfile {
    const profile = validateProfile(value);
    const current = this.#profiles.get(profile.playerId);
    const stored = {
      ...profile,
      version: (current?.version ?? 0) + 1,
    };
    this.#profiles.set(stored.playerId, stored);
    return cloneProfile(stored);
  }

  playerProfile(playerId: string): PlayerRiskProfile {
    const id = requiredText(playerId, "player id");
    const value = this.#profiles.get(id) ?? {
      playerId: id,
      segment: "standard" as const,
      stakeMultiplierBasisPoints: 10_000,
      returnMultiplierBasisPoints: 10_000,
      blockedSports: [],
      blockedCompetitions: [],
      blocked: false,
      version: 0,
    };
    return cloneProfile(value);
  }

  decide(context: RiskContext): LimitDecision {
    const currency = normalizedCurrency(context.currency);
    const limits = this.#limits.get(currency);
    if (!limits)
      throw new SportsbookValidationError(
        "risk limits do not exist for currency",
      );
    const profile = this.playerProfile(context.playerId);
    const reasons: string[] = [];
    if (profile.blocked) reasons.push("player_blocked");
    for (const leg of context.legs) {
      const sport = context.sportByEvent[leg.eventId];
      const competition = context.competitionByEvent[leg.eventId];
      if (sport && profile.blockedSports.includes(sport))
        reasons.push("sport_blocked");
      if (competition && profile.blockedCompetitions.includes(competition))
        reasons.push("competition_blocked");
    }
    const maximumStakeMinor = minBigInt(
      (limits.maximumStakeMinor * BigInt(profile.stakeMultiplierBasisPoints)) /
        10_000n,
      this.remainingPlayerOpenStake(context.playerId, currency, limits),
      this.remainingPlayerDailyStake(
        context.playerId,
        currency,
        context.placedAt,
        limits,
      ),
    );
    if (context.stakeMinor < limits.minimumStakeMinor)
      reasons.push("below_minimum_stake");
    if (context.stakeMinor > maximumStakeMinor)
      reasons.push("stake_limit_exceeded");
    const maximumReturn =
      (limits.maximumBetReturnMinor *
        BigInt(profile.returnMultiplierBasisPoints)) /
      10_000n;
    if (context.potentialReturnMinor > maximumReturn)
      reasons.push("return_limit_exceeded");
    const requestedLiability =
      context.potentialReturnMinor - context.stakeMinor;
    for (const leg of context.legs) {
      const share = requestedLiability / BigInt(context.legs.length);
      if (
        this.eventLiability(leg.eventId, currency) + share >
        limits.maximumEventLiabilityMinor
      ) {
        reasons.push("event_liability_exceeded");
      }
      if (
        this.marketLiability(leg.marketId, currency) + share >
        limits.maximumMarketLiabilityMinor
      ) {
        reasons.push("market_liability_exceeded");
      }
      if (
        this.selectionLiability(leg.selectionId, currency) + share >
        limits.maximumSelectionLiabilityMinor
      ) {
        reasons.push("selection_liability_exceeded");
      }
    }
    const uniqueReasons = [...new Set(reasons)];
    const manualReview =
      uniqueReasons.length === 0 &&
      (context.stakeMinor >= limits.reviewStakeMinor ||
        context.potentialReturnMinor >= limits.reviewReturnMinor ||
        profile.segment === "sharp");
    return {
      accepted: uniqueReasons.length === 0,
      maximumStakeMinor: maximumStakeMinor > 0n ? maximumStakeMinor : 0n,
      reasons: uniqueReasons,
      manualReview,
    };
  }

  reserve(bet: Bet): LiabilityReservation {
    if (bet.status !== "accepted") {
      throw new SportsbookValidationError(
        "only accepted bets reserve liability",
      );
    }
    const existing = this.#reservations.get(bet.id);
    if (existing) return cloneReservation(existing);
    const eventIds = [...new Set(bet.legs.map((leg) => leg.eventId))];
    const marketIds = [...new Set(bet.legs.map((leg) => leg.marketId))];
    const selectionIds = [...new Set(bet.legs.map((leg) => leg.selectionId))];
    const reservation: LiabilityReservation = {
      betId: bet.id,
      playerId: bet.playerId,
      currency: bet.currency,
      stakeMinor: bet.stakeMinor,
      potentialReturnMinor: bet.acceptedReturnMinor,
      liabilityMinor:
        bet.acceptedReturnMinor > bet.stakeMinor
          ? bet.acceptedReturnMinor - bet.stakeMinor
          : 0n,
      eventIds,
      marketIds,
      selectionIds,
      placedAt: bet.placedAt,
      status: "open",
    };
    this.#reservations.set(bet.id, reservation);
    return cloneReservation(reservation);
  }

  release(betId: string, settled = false): LiabilityReservation {
    const reservation = this.#reservations.get(requiredText(betId, "bet id"));
    if (!reservation)
      throw new SportsbookValidationError(
        "liability reservation does not exist",
      );
    if (reservation.status !== "open") return cloneReservation(reservation);
    const changed: LiabilityReservation = {
      ...reservation,
      status: settled ? "settled" : "released",
    };
    this.#reservations.set(changed.betId, changed);
    return cloneReservation(changed);
  }

  exposure(currency?: string): readonly Exposure[] {
    const normalized = currency ? normalizedCurrency(currency) : undefined;
    const groups = new Map<string, Exposure>();
    for (const reservation of this.#reservations.values()) {
      if (reservation.status !== "open") continue;
      if (normalized && reservation.currency !== normalized) continue;
      const eventShare =
        reservation.liabilityMinor / BigInt(reservation.eventIds.length || 1);
      for (const eventId of reservation.eventIds) {
        mergeExposure(groups, {
          key: `event:${eventId}:${reservation.currency}`,
          eventId,
          currency: reservation.currency,
          liabilityMinor: eventShare,
          stakeMinor: reservation.stakeMinor,
          betCount: 1,
        });
      }
      const marketShare =
        reservation.liabilityMinor / BigInt(reservation.marketIds.length || 1);
      for (let index = 0; index < reservation.marketIds.length; index += 1) {
        const marketId = reservation.marketIds[index];
        const eventId =
          reservation.eventIds[
            Math.min(index, reservation.eventIds.length - 1)
          ];
        mergeExposure(groups, {
          key: `market:${marketId}:${reservation.currency}`,
          eventId,
          marketId,
          currency: reservation.currency,
          liabilityMinor: marketShare,
          stakeMinor: reservation.stakeMinor,
          betCount: 1,
        });
      }
      const selectionShare =
        reservation.liabilityMinor /
        BigInt(reservation.selectionIds.length || 1);
      for (let index = 0; index < reservation.selectionIds.length; index += 1) {
        const selectionId = reservation.selectionIds[index];
        const marketId =
          reservation.marketIds[
            Math.min(index, reservation.marketIds.length - 1)
          ];
        const eventId =
          reservation.eventIds[
            Math.min(index, reservation.eventIds.length - 1)
          ];
        mergeExposure(groups, {
          key: `selection:${selectionId}:${reservation.currency}`,
          eventId,
          marketId,
          selectionId,
          currency: reservation.currency,
          liabilityMinor: selectionShare,
          stakeMinor: reservation.stakeMinor,
          betCount: 1,
        });
      }
    }
    return [...groups.values()]
      .sort((left, right) => {
        if (left.liabilityMinor !== right.liabilityMinor) {
          return left.liabilityMinor > right.liabilityMinor ? -1 : 1;
        }
        return left.key.localeCompare(right.key);
      })
      .map((value) => ({ ...value }));
  }

  private remainingPlayerOpenStake(
    playerId: string,
    currency: string,
    limits: SportsbookRiskLimits,
  ): bigint {
    const used = [...this.#reservations.values()]
      .filter((value) => value.status === "open")
      .filter(
        (value) => value.playerId === playerId && value.currency === currency,
      )
      .reduce((total, value) => total + value.stakeMinor, 0n);
    return limits.maximumPlayerOpenStakeMinor > used
      ? limits.maximumPlayerOpenStakeMinor - used
      : 0n;
  }

  private remainingPlayerDailyStake(
    playerId: string,
    currency: string,
    at: Date,
    limits: SportsbookRiskLimits,
  ): bigint {
    const day = at.toISOString().slice(0, 10);
    const used = [...this.#reservations.values()]
      .filter(
        (value) => value.playerId === playerId && value.currency === currency,
      )
      .filter((value) => value.placedAt.slice(0, 10) === day)
      .reduce((total, value) => total + value.stakeMinor, 0n);
    return limits.maximumPlayerDailyStakeMinor > used
      ? limits.maximumPlayerDailyStakeMinor - used
      : 0n;
  }

  private eventLiability(eventId: string, currency: string): bigint {
    return this.exposure(currency)
      .filter((value) => value.eventId === eventId && !value.marketId)
      .reduce((total, value) => total + value.liabilityMinor, 0n);
  }

  private marketLiability(marketId: string, currency: string): bigint {
    return this.exposure(currency)
      .filter((value) => value.marketId === marketId && !value.selectionId)
      .reduce((total, value) => total + value.liabilityMinor, 0n);
  }

  private selectionLiability(selectionId: string, currency: string): bigint {
    return this.exposure(currency)
      .filter((value) => value.selectionId === selectionId)
      .reduce((total, value) => total + value.liabilityMinor, 0n);
  }
}

function validateLimits(value: SportsbookRiskLimits): SportsbookRiskLimits {
  const limits = {
    ...value,
    currency: normalizedCurrency(value.currency),
  };
  positiveMinor(limits.minimumStakeMinor, "minimum stake");
  positiveMinor(limits.maximumStakeMinor, "maximum stake");
  positiveMinor(limits.maximumBetReturnMinor, "maximum return");
  positiveMinor(limits.maximumPlayerOpenStakeMinor, "maximum open stake");
  positiveMinor(limits.maximumPlayerDailyStakeMinor, "maximum daily stake");
  positiveMinor(limits.maximumEventLiabilityMinor, "maximum event liability");
  positiveMinor(limits.maximumMarketLiabilityMinor, "maximum market liability");
  positiveMinor(
    limits.maximumSelectionLiabilityMinor,
    "maximum selection liability",
  );
  positiveMinor(limits.reviewStakeMinor, "review stake");
  positiveMinor(limits.reviewReturnMinor, "review return");
  if (limits.maximumStakeMinor < limits.minimumStakeMinor) {
    throw new SportsbookValidationError("maximum stake is below minimum stake");
  }
  return limits;
}

function validateProfile(value: PlayerRiskProfile): PlayerRiskProfile {
  const playerId = requiredText(value.playerId, "player id");
  for (const multiplier of [
    value.stakeMultiplierBasisPoints,
    value.returnMultiplierBasisPoints,
  ]) {
    if (
      !Number.isSafeInteger(multiplier) ||
      multiplier < 0 ||
      multiplier > 100_000
    ) {
      throw new SportsbookValidationError("player risk multiplier is invalid");
    }
  }
  return {
    ...value,
    playerId,
    blockedSports: [
      ...new Set(
        value.blockedSports.map((item) => requiredText(item, "sport")),
      ),
    ].sort(),
    blockedCompetitions: [
      ...new Set(
        value.blockedCompetitions.map((item) =>
          requiredText(item, "competition"),
        ),
      ),
    ].sort(),
    version: Math.max(0, value.version || 0),
  };
}

function mergeExposure(target: Map<string, Exposure>, value: Exposure): void {
  const current = target.get(value.key);
  target.set(
    value.key,
    current
      ? {
          ...current,
          liabilityMinor: current.liabilityMinor + value.liabilityMinor,
          stakeMinor: current.stakeMinor + value.stakeMinor,
          betCount: current.betCount + value.betCount,
        }
      : value,
  );
}

function minBigInt(...values: readonly bigint[]): bigint {
  return values.reduce((minimum, value) => (value < minimum ? value : minimum));
}

function cloneLimits(value: SportsbookRiskLimits): SportsbookRiskLimits {
  return { ...value };
}

function cloneProfile(value: PlayerRiskProfile): PlayerRiskProfile {
  return {
    ...value,
    blockedSports: [...value.blockedSports],
    blockedCompetitions: [...value.blockedCompetitions],
  };
}

function cloneReservation(value: LiabilityReservation): LiabilityReservation {
  return {
    ...value,
    eventIds: [...value.eventIds],
    marketIds: [...value.marketIds],
    selectionIds: [...value.selectionIds],
  };
}
