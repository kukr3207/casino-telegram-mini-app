import { randomUUID } from "node:crypto";

export type BonusKind = "deposit_match" | "free_spins" | "cashback" | "fixed_credit";

export interface BonusCampaign {
  id: string;
  name: string;
  kind: BonusKind;
  startsAt: Date;
  endsAt: Date;
  claimStartsAt: Date;
  claimEndsAt: Date;
  currencies: readonly string[];
  countries?: readonly string[];
  playerSegments?: readonly string[];
  minimumDepositMinor?: bigint;
  maximumBonusMinor: bigint;
  fixedBonusMinor?: bigint;
  matchBasisPoints?: number;
  freeSpinCount?: number;
  freeSpinValueMinor?: bigint;
  wageringMultiplier: number;
  eligibleGames: readonly string[];
  budgetMinor?: bigint;
  perPlayerClaims: number;
  enabled: boolean;
  version: number;
}

export interface BonusEligibility {
  eligible: boolean;
  reasons: readonly string[];
}

export class BonusValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BonusValidationError";
  }
}

export class BonusConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BonusConflictError";
  }
}

export class BonusCampaignRegistry {
  private readonly campaigns = new Map<string, BonusCampaign>();

  create(input: Omit<BonusCampaign, "id" | "version"> & { id?: string }): BonusCampaign {
    const campaign = normalizeCampaign({ ...input, id: input.id ?? randomUUID(), version: 1 });
    if (this.campaigns.has(campaign.id)) throw new BonusConflictError("bonus campaign id already exists");
    this.campaigns.set(campaign.id, campaign);
    return cloneCampaign(campaign);
  }

  update(campaignId: string, expectedVersion: number, changes: Partial<Omit<BonusCampaign, "id" | "version">>): BonusCampaign {
    const current = this.requireVersion(campaignId, expectedVersion);
    const updated = normalizeCampaign({ ...current, ...changes, id: current.id, version: current.version + 1 });
    this.campaigns.set(updated.id, updated);
    return cloneCampaign(updated);
  }

  setEnabled(campaignId: string, expectedVersion: number, enabled: boolean): BonusCampaign {
    return this.update(campaignId, expectedVersion, { enabled });
  }

  get(campaignId: string): BonusCampaign | undefined {
    const campaign = this.campaigns.get(campaignId.trim());
    return campaign ? cloneCampaign(campaign) : undefined;
  }

  available(
    player: { country?: string; segments?: readonly string[] },
    currency: string,
    at = new Date(),
  ): readonly BonusCampaign[] {
    return [...this.campaigns.values()]
      .filter((campaign) => campaign.enabled && campaign.claimStartsAt <= at && campaign.claimEndsAt > at)
      .filter((campaign) => campaign.currencies.includes(currency.toUpperCase()))
      .filter((campaign) => !campaign.countries || Boolean(player.country && campaign.countries.includes(player.country.toUpperCase())))
      .filter((campaign) => !campaign.playerSegments || campaign.playerSegments.some((segment) => player.segments?.includes(segment)))
      .sort((left, right) => left.claimEndsAt.getTime() - right.claimEndsAt.getTime())
      .map(cloneCampaign);
  }

  checkEligibility(
    campaignId: string,
    input: { country?: string; segments?: readonly string[]; currency: string; depositMinor?: bigint; claimedCount: number; at: Date },
  ): BonusEligibility {
    const campaign = this.campaigns.get(campaignId.trim());
    if (!campaign) return { eligible: false, reasons: ["campaign_not_found"] };
    const reasons: string[] = [];
    if (!campaign.enabled) reasons.push("campaign_disabled");
    if (input.at < campaign.claimStartsAt) reasons.push("claim_window_not_started");
    if (input.at >= campaign.claimEndsAt) reasons.push("claim_window_ended");
    if (!campaign.currencies.includes(input.currency.toUpperCase())) reasons.push("currency_not_supported");
    if (campaign.countries && (!input.country || !campaign.countries.includes(input.country.toUpperCase()))) reasons.push("country_not_eligible");
    if (campaign.playerSegments && !campaign.playerSegments.some((segment) => input.segments?.includes(segment))) reasons.push("segment_not_eligible");
    if (campaign.minimumDepositMinor !== undefined && (input.depositMinor ?? 0n) < campaign.minimumDepositMinor) reasons.push("minimum_deposit_not_met");
    if (input.claimedCount >= campaign.perPlayerClaims) reasons.push("claim_limit_reached");
    return { eligible: reasons.length === 0, reasons };
  }

  private requireVersion(campaignId: string, expectedVersion: number): BonusCampaign {
    const current = this.campaigns.get(required(campaignId, "campaign id"));
    if (!current) throw new BonusValidationError("bonus campaign does not exist");
    if (current.version !== expectedVersion) throw new BonusConflictError("bonus campaign version does not match");
    return current;
  }
}

function normalizeCampaign(value: BonusCampaign): BonusCampaign {
  const startsAt = validDate(value.startsAt, "campaign start");
  const endsAt = validDate(value.endsAt, "campaign end");
  const claimStartsAt = validDate(value.claimStartsAt, "claim start");
  const claimEndsAt = validDate(value.claimEndsAt, "claim end");
  if (endsAt <= startsAt) throw new BonusValidationError("campaign end must follow its start");
  if (claimEndsAt <= claimStartsAt || claimStartsAt < startsAt || claimEndsAt > endsAt) {
    throw new BonusValidationError("claim window must be inside the campaign window");
  }
  if (value.maximumBonusMinor <= 0n) throw new BonusValidationError("maximum bonus must be positive");
  if (!Number.isInteger(value.wageringMultiplier) || value.wageringMultiplier < 0 || value.wageringMultiplier > 100) {
    throw new BonusValidationError("wagering multiplier must be between 0 and 100");
  }
  if (!Number.isInteger(value.perPlayerClaims) || value.perPlayerClaims < 1) throw new BonusValidationError("claim limit must be positive");
  if (value.kind === "deposit_match" && (!value.matchBasisPoints || value.matchBasisPoints < 1 || value.matchBasisPoints > 50_000)) {
    throw new BonusValidationError("deposit match percentage is invalid");
  }
  if (value.kind === "fixed_credit" && (!value.fixedBonusMinor || value.fixedBonusMinor <= 0n)) {
    throw new BonusValidationError("fixed-credit campaign requires an amount");
  }
  if (value.kind === "free_spins" && (!value.freeSpinCount || value.freeSpinCount < 1 || !value.freeSpinValueMinor || value.freeSpinValueMinor <= 0n)) {
    throw new BonusValidationError("free-spin campaign requires count and value");
  }
  return {
    ...value,
    id: required(value.id, "campaign id"),
    name: required(value.name, "campaign name"),
    startsAt,
    endsAt,
    claimStartsAt,
    claimEndsAt,
    currencies: normalizeList(value.currencies, "currency", true),
    countries: value.countries ? normalizeList(value.countries, "country", true) : undefined,
    playerSegments: value.playerSegments ? normalizeList(value.playerSegments, "player segment") : undefined,
    eligibleGames: normalizeList(value.eligibleGames, "eligible game"),
  };
}

function normalizeList(values: readonly string[], field: string, uppercase = false): string[] {
  if (values.length === 0) throw new BonusValidationError(`${field} list cannot be empty`);
  return [...new Set(values.map((value) => {
    const normalized = required(value, field);
    return uppercase ? normalized.toUpperCase() : normalized.toLowerCase();
  }))].sort();
}

export function required(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new BonusValidationError(`${field} is required`);
  return value.trim();
}

export function validDate(value: Date, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BonusValidationError(`${field} is invalid`);
  return date;
}

function cloneCampaign(value: BonusCampaign): BonusCampaign {
  return {
    ...value,
    startsAt: new Date(value.startsAt),
    endsAt: new Date(value.endsAt),
    claimStartsAt: new Date(value.claimStartsAt),
    claimEndsAt: new Date(value.claimEndsAt),
    currencies: [...value.currencies],
    countries: value.countries ? [...value.countries] : undefined,
    playerSegments: value.playerSegments ? [...value.playerSegments] : undefined,
    eligibleGames: [...value.eligibleGames],
  };
}

