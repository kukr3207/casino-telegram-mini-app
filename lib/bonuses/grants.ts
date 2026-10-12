import { randomUUID } from "node:crypto";
import type { BonusCampaign } from "./campaigns.ts";
import { BonusConflictError, BonusValidationError, required, validDate } from "./campaigns.ts";

export type BonusGrantStatus = "active" | "completed" | "expired" | "forfeited" | "cancelled";

export interface BonusGrant {
  id: string;
  playerId: string;
  campaignId: string;
  currency: string;
  grantedMinor: bigint;
  remainingMinor: bigint;
  wageringRequiredMinor: bigint;
  wageringCompletedMinor: bigint;
  status: BonusGrantStatus;
  grantedAt: Date;
  expiresAt: Date;
  completedAt?: Date;
  sourceReference: string;
  eligibleGames: readonly string[];
  version: number;
}

export interface BonusProgress {
  grant: BonusGrant;
  contributedMinor: bigint;
  releasedMinor: bigint;
}

export class BonusGrantService {
  private readonly grants = new Map<string, BonusGrant>();
  private readonly sourceReferences = new Map<string, string>();
  private readonly campaignSpend = new Map<string, bigint>();

  grant(
    campaign: BonusCampaign,
    input: { playerId: string; currency: string; depositMinor?: bigint; sourceReference: string; expiresAt?: Date },
    at = new Date(),
  ): BonusGrant {
    const sourceReference = required(input.sourceReference, "bonus source reference");
    const sourceKey = `${campaign.id}:${sourceReference}`;
    const existingId = this.sourceReferences.get(sourceKey);
    if (existingId) return cloneGrant(this.grants.get(existingId)!);
    if (!campaign.enabled || at < campaign.claimStartsAt || at >= campaign.claimEndsAt) {
      throw new BonusConflictError("campaign is not claimable");
    }
    const currency = input.currency.toUpperCase();
    if (!campaign.currencies.includes(currency)) throw new BonusValidationError("currency is not eligible for campaign");
    const amount = calculateGrant(campaign, input.depositMinor);
    const spent = this.campaignSpend.get(campaign.id) ?? 0n;
    if (campaign.budgetMinor !== undefined && spent + amount > campaign.budgetMinor) {
      throw new BonusConflictError("campaign budget is exhausted");
    }
    const grantedAt = validDate(at, "grant time");
    const expiresAt = input.expiresAt ? validDate(input.expiresAt, "grant expiry") : new Date(campaign.endsAt);
    if (expiresAt <= grantedAt || expiresAt > campaign.endsAt) throw new BonusValidationError("grant expiry is outside campaign bounds");
    const grant: BonusGrant = {
      id: randomUUID(),
      playerId: required(input.playerId, "player id"),
      campaignId: campaign.id,
      currency,
      grantedMinor: amount,
      remainingMinor: amount,
      wageringRequiredMinor: amount * BigInt(campaign.wageringMultiplier),
      wageringCompletedMinor: 0n,
      status: campaign.wageringMultiplier === 0 ? "completed" : "active",
      grantedAt,
      expiresAt,
      completedAt: campaign.wageringMultiplier === 0 ? grantedAt : undefined,
      sourceReference,
      eligibleGames: [...campaign.eligibleGames],
      version: 1,
    };
    this.grants.set(grant.id, grant);
    this.sourceReferences.set(sourceKey, grant.id);
    this.campaignSpend.set(campaign.id, spent + amount);
    return cloneGrant(grant);
  }

  contribute(
    grantId: string,
    expectedVersion: number,
    game: string,
    wagerMinor: bigint,
    contributionBasisPoints: number,
    at = new Date(),
  ): BonusProgress {
    const current = this.requireVersion(grantId, expectedVersion);
    if (current.status !== "active") throw new BonusConflictError("bonus grant is not active");
    const now = validDate(at, "wager time");
    if (now >= current.expiresAt) {
      this.expire(current.id, current.version, now);
      throw new BonusConflictError("bonus grant expired");
    }
    if (!current.eligibleGames.includes(game.toLowerCase())) throw new BonusValidationError("game does not contribute to this bonus");
    if (wagerMinor <= 0n) throw new BonusValidationError("wager contribution must be positive");
    if (!Number.isInteger(contributionBasisPoints) || contributionBasisPoints < 0 || contributionBasisPoints > 10_000) {
      throw new BonusValidationError("wager contribution rate is invalid");
    }
    const contributedMinor = wagerMinor * BigInt(contributionBasisPoints) / 10_000n;
    const previous = current.wageringCompletedMinor;
    const completed = min(current.wageringRequiredMinor, previous + contributedMinor);
    const status: BonusGrantStatus = completed >= current.wageringRequiredMinor ? "completed" : "active";
    const releasedMinor = status === "completed" ? current.remainingMinor : 0n;
    const updated: BonusGrant = {
      ...current,
      wageringCompletedMinor: completed,
      remainingMinor: current.remainingMinor - releasedMinor,
      status,
      completedAt: status === "completed" ? now : undefined,
      version: current.version + 1,
    };
    this.grants.set(updated.id, updated);
    return { grant: cloneGrant(updated), contributedMinor, releasedMinor };
  }

  consume(grantId: string, expectedVersion: number, amountMinor: bigint): BonusGrant {
    const current = this.requireVersion(grantId, expectedVersion);
    if (current.status !== "active") throw new BonusConflictError("bonus grant is not active");
    if (amountMinor <= 0n || amountMinor > current.remainingMinor) throw new BonusValidationError("bonus consumption is invalid");
    const updated = { ...current, remainingMinor: current.remainingMinor - amountMinor, version: current.version + 1 };
    this.grants.set(updated.id, updated);
    return cloneGrant(updated);
  }

  expire(grantId: string, expectedVersion: number, at = new Date()): BonusGrant {
    const current = this.requireVersion(grantId, expectedVersion);
    if (current.status !== "active") return cloneGrant(current);
    const now = validDate(at, "expiry time");
    if (now < current.expiresAt) throw new BonusConflictError("bonus has not reached its expiry");
    const updated: BonusGrant = { ...current, status: "expired", remainingMinor: 0n, version: current.version + 1 };
    this.grants.set(updated.id, updated);
    return cloneGrant(updated);
  }

  forfeit(grantId: string, expectedVersion: number): BonusGrant {
    const current = this.requireVersion(grantId, expectedVersion);
    if (current.status !== "active") throw new BonusConflictError("only active grants can be forfeited");
    const updated: BonusGrant = { ...current, status: "forfeited", remainingMinor: 0n, version: current.version + 1 };
    this.grants.set(updated.id, updated);
    return cloneGrant(updated);
  }

  activeForPlayer(playerId: string, currency?: string, at = new Date()): readonly BonusGrant[] {
    return [...this.grants.values()]
      .filter((grant) => grant.playerId === playerId.trim() && grant.status === "active" && grant.expiresAt > at)
      .filter((grant) => !currency || grant.currency === currency.toUpperCase())
      .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime())
      .map(cloneGrant);
  }

  campaignCommitted(campaignId: string): bigint {
    return this.campaignSpend.get(campaignId.trim()) ?? 0n;
  }

  private requireVersion(grantId: string, expectedVersion: number): BonusGrant {
    const current = this.grants.get(required(grantId, "grant id"));
    if (!current) throw new BonusValidationError("bonus grant does not exist");
    if (current.version !== expectedVersion) throw new BonusConflictError("bonus grant version does not match");
    return current;
  }
}

function calculateGrant(campaign: BonusCampaign, depositMinor?: bigint): bigint {
  let amount: bigint;
  if (campaign.kind === "deposit_match") {
    if (depositMinor === undefined || depositMinor < (campaign.minimumDepositMinor ?? 0n)) {
      throw new BonusValidationError("qualifying deposit is required");
    }
    amount = depositMinor * BigInt(campaign.matchBasisPoints!) / 10_000n;
  } else if (campaign.kind === "fixed_credit") {
    amount = campaign.fixedBonusMinor!;
  } else if (campaign.kind === "free_spins") {
    amount = BigInt(campaign.freeSpinCount!) * campaign.freeSpinValueMinor!;
  } else {
    if (depositMinor === undefined) throw new BonusValidationError("cashback requires a source amount");
    amount = depositMinor * BigInt(campaign.matchBasisPoints ?? 500) / 10_000n;
  }
  return min(amount, campaign.maximumBonusMinor);
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function cloneGrant(value: BonusGrant): BonusGrant {
  return {
    ...value,
    grantedAt: new Date(value.grantedAt),
    expiresAt: new Date(value.expiresAt),
    completedAt: value.completedAt ? new Date(value.completedAt) : undefined,
    eligibleGames: [...value.eligibleGames],
  };
}

