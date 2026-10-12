export type RewardKind = "chips" | "withdraw_tokens" | "free_spin" | "booster";

export interface CampaignRule {
  game?: string;
  minimumStake?: bigint;
  minimumRounds?: number;
  minimumDeposit?: bigint;
  countries?: readonly string[];
  excludedCountries?: readonly string[];
  newPlayersOnly?: boolean;
}

export interface CampaignReward {
  kind: RewardKind;
  amount: bigint;
  expiresAfterDays?: number;
  wageringMultiplier?: number;
}

export interface Campaign {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  budget: bigint;
  perPlayerLimit: number;
  rules: readonly CampaignRule[];
  rewards: readonly CampaignReward[];
  status: "draft" | "active" | "paused" | "ended";
}

export interface PlayerCampaignContext {
  playerId: string;
  country: string;
  joinedAt: string;
  game?: string;
  stake?: bigint;
  rounds?: number;
  deposit?: bigint;
}

export interface RewardGrant {
  id: string;
  campaignId: string;
  playerId: string;
  reward: CampaignReward;
  grantedAt: string;
  expiresAt: string | null;
  status: "available" | "claimed" | "expired" | "cancelled";
  claimedAt?: string;
}

function instant(value: string | Date, field: string): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${field} is invalid`);
  return parsed;
}

export function validateCampaign(campaign: Campaign): Campaign {
  if (!campaign.id.trim() || !campaign.name.trim()) throw new RangeError("campaign id and name cannot be blank");
  const starts = instant(campaign.startsAt, "campaign start");
  const ends = instant(campaign.endsAt, "campaign end");
  if (ends <= starts) throw new RangeError("campaign end must follow start");
  if (campaign.budget <= 0n || !Number.isSafeInteger(campaign.perPlayerLimit) || campaign.perPlayerLimit <= 0) {
    throw new RangeError("campaign budget and player limit must be positive");
  }
  if (!campaign.rewards.length || campaign.rewards.some((reward) => reward.amount <= 0n)) {
    throw new RangeError("campaign requires positive rewards");
  }
  return { ...campaign, startsAt: starts.toISOString(), endsAt: ends.toISOString() };
}

function ruleMatches(rule: CampaignRule, context: PlayerCampaignContext, campaign: Campaign): boolean {
  if (rule.game && rule.game !== context.game) return false;
  if (rule.minimumStake && (context.stake ?? 0n) < rule.minimumStake) return false;
  if (rule.minimumRounds && (context.rounds ?? 0) < rule.minimumRounds) return false;
  if (rule.minimumDeposit && (context.deposit ?? 0n) < rule.minimumDeposit) return false;
  const country = context.country.toUpperCase();
  if (rule.countries && !rule.countries.map((value) => value.toUpperCase()).includes(country)) return false;
  if (rule.excludedCountries?.map((value) => value.toUpperCase()).includes(country)) return false;
  if (rule.newPlayersOnly && new Date(context.joinedAt) < new Date(campaign.startsAt)) return false;
  return true;
}

export class CampaignService {
  readonly #campaigns = new Map<string, Campaign>();
  readonly #grants = new Map<string, RewardGrant>();
  readonly #spend = new Map<string, bigint>();

  add(campaign: Campaign): void {
    const value = validateCampaign(campaign);
    if (this.#campaigns.has(value.id)) throw new Error("campaign id already exists");
    this.#campaigns.set(value.id, value);
    this.#spend.set(value.id, 0n);
  }

  eligible(campaignId: string, context: PlayerCampaignContext, at: string | Date): boolean {
    const campaign = this.get(campaignId);
    const timestamp = instant(at, "eligibility time");
    if (campaign.status !== "active" || timestamp < new Date(campaign.startsAt) || timestamp >= new Date(campaign.endsAt)) return false;
    if (campaign.rules.length && !campaign.rules.every((rule) => ruleMatches(rule, context, campaign))) return false;
    const prior = [...this.#grants.values()].filter((grant) => grant.campaignId === campaignId && grant.playerId === context.playerId);
    return prior.length < campaign.perPlayerLimit;
  }

  grant(campaignId: string, context: PlayerCampaignContext, at: string | Date): readonly RewardGrant[] {
    const campaign = this.get(campaignId);
    if (!this.eligible(campaignId, context, at)) throw new Error("player is not eligible for this campaign");
    const timestamp = instant(at, "reward grant time");
    const cost = campaign.rewards.reduce((total, reward) => total + reward.amount, 0n);
    if ((this.#spend.get(campaignId) ?? 0n) + cost > campaign.budget) throw new Error("campaign budget is exhausted");
    const sequence = [...this.#grants.values()].filter((grant) => grant.campaignId === campaignId && grant.playerId === context.playerId).length + 1;
    const grants = campaign.rewards.map((reward, index): RewardGrant => {
      const expires = reward.expiresAfterDays ? new Date(timestamp.getTime() + reward.expiresAfterDays * 86400000) : null;
      return {
        id: `${campaignId}:${context.playerId}:${sequence}:${index + 1}`,
        campaignId, playerId: context.playerId, reward,
        grantedAt: timestamp.toISOString(), expiresAt: expires?.toISOString() ?? null,
        status: "available",
      };
    });
    for (const grant of grants) this.#grants.set(grant.id, grant);
    this.#spend.set(campaignId, (this.#spend.get(campaignId) ?? 0n) + cost);
    return grants;
  }

  claim(grantId: string, at: string | Date): RewardGrant {
    const grant = this.#grants.get(grantId);
    if (!grant) throw new Error("reward grant was not found");
    const timestamp = instant(at, "reward claim time");
    if (grant.status === "claimed") return grant;
    if (grant.status !== "available") throw new Error("reward is not available");
    if (grant.expiresAt && timestamp >= new Date(grant.expiresAt)) {
      const expired = { ...grant, status: "expired" as const };
      this.#grants.set(grantId, expired);
      throw new Error("reward has expired");
    }
    const claimed = { ...grant, status: "claimed" as const, claimedAt: timestamp.toISOString() };
    this.#grants.set(grantId, claimed);
    return claimed;
  }

  get(campaignId: string): Campaign {
    const value = this.#campaigns.get(campaignId);
    if (!value) throw new Error("campaign was not found");
    return value;
  }
}
