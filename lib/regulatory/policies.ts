import {
  type JurisdictionPolicy,
  type PlayerRegulatoryProfile,
  type RegulatoryDecision,
  RegulatoryConflictError,
  RegulatoryValidationError,
  regulatoryCurrency,
  regulatoryDate,
  regulatoryText,
} from "./types.ts";

export interface RegulatoryActivity {
  product: string;
  currency: string;
  kind:
    | "registration"
    | "login"
    | "deposit"
    | "withdrawal"
    | "wager"
    | "marketing";
  amountMinor?: bigint;
  paymentMethod?: string;
  occurredAt: Date;
  dailyDepositedMinor?: bigint;
  monthlyDepositedMinor?: bigint;
}

export class JurisdictionPolicyService {
  readonly #policies = new Map<string, JurisdictionPolicy[]>();
  readonly #profiles = new Map<string, PlayerRegulatoryProfile>();

  addPolicy(value: JurisdictionPolicy): JurisdictionPolicy {
    const policy = validatePolicy(value);
    const versions = this.#policies.get(policy.code) ?? [];
    if (versions.some((item) => item.version === policy.version))
      throw new RegulatoryConflictError("policy version already exists");
    const latest = versions.at(-1);
    if (latest && policy.version !== latest.version + 1)
      throw new RegulatoryConflictError(
        "policy version must follow latest version",
      );
    if (
      latest &&
      new Date(policy.effectiveFrom) <= new Date(latest.effectiveFrom)
    )
      throw new RegulatoryConflictError(
        "policy effective date must move forward",
      );
    versions.push(policy);
    versions.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    this.#policies.set(policy.code, versions);
    return clonePolicy(policy);
  }

  policy(code: string, at = new Date()): JurisdictionPolicy {
    const versions =
      this.#policies.get(
        regulatoryText(code, "jurisdiction code").toUpperCase(),
      ) ?? [];
    const policy = [...versions]
      .reverse()
      .find(
        (item) =>
          new Date(item.effectiveFrom) <= at &&
          (!item.effectiveTo || new Date(item.effectiveTo) > at),
      );
    if (!policy)
      throw new RegulatoryValidationError(
        "no jurisdiction policy is effective",
      );
    return clonePolicy(policy);
  }

  upsertProfile(
    value: PlayerRegulatoryProfile,
    expectedVersion?: number,
  ): PlayerRegulatoryProfile {
    const profile = validateProfile(value);
    const current = this.#profiles.get(profile.playerId);
    if (current && expectedVersion !== current.version)
      throw new RegulatoryConflictError(
        "regulatory profile version does not match",
      );
    if (!current && expectedVersion !== undefined && expectedVersion !== 0)
      throw new RegulatoryConflictError(
        "new regulatory profile expected version must be zero",
      );
    const changed = { ...profile, version: (current?.version ?? 0) + 1 };
    this.#profiles.set(changed.playerId, changed);
    return cloneProfile(changed);
  }

  decide(playerId: string, activity: RegulatoryActivity): RegulatoryDecision {
    const profile = this.#profiles.get(playerId);
    if (!profile)
      throw new RegulatoryValidationError("regulatory profile does not exist");
    const policy = this.policy(profile.jurisdiction, activity.occurredAt);
    const reasons: string[] = [];
    const requirements: string[] = [];
    if (profile.risk === "prohibited") reasons.push("player_prohibited");
    if (profile.sanctionsMatch) reasons.push("sanctions_match");
    if (profile.identityStatus === "rejected")
      reasons.push("identity_rejected");
    if (
      policy.identityVerificationRequired &&
      profile.identityStatus !== "verified" &&
      !["registration", "login"].includes(activity.kind)
    )
      requirements.push("identity_verification");
    if (
      !policy.allowedProducts.includes(activity.product) ||
      policy.blockedProducts.includes(activity.product)
    )
      reasons.push("product_not_allowed");
    if (!policy.currencies.includes(regulatoryCurrency(activity.currency)))
      reasons.push("currency_not_allowed");
    if (
      activity.paymentMethod &&
      activity.kind === "deposit" &&
      !policy.depositMethods.includes(activity.paymentMethod)
    )
      reasons.push("payment_method_not_allowed");
    if (
      activity.kind === "deposit" &&
      policy.maximumDailyDepositMinor !== undefined &&
      (activity.dailyDepositedMinor ?? 0n) + (activity.amountMinor ?? 0n) >
        policy.maximumDailyDepositMinor
    )
      reasons.push("daily_deposit_limit");
    if (
      activity.kind === "deposit" &&
      policy.maximumMonthlyDepositMinor !== undefined &&
      (activity.monthlyDepositedMinor ?? 0n) + (activity.amountMinor ?? 0n) >
        policy.maximumMonthlyDepositMinor
    )
      reasons.push("monthly_deposit_limit");
    if (
      activity.kind === "wager" &&
      policy.maximumStakeMinor !== undefined &&
      (activity.amountMinor ?? 0n) > policy.maximumStakeMinor
    )
      reasons.push("stake_limit");
    if (
      policy.sourceOfFundsThresholdMinor !== undefined &&
      (activity.monthlyDepositedMinor ?? 0n) >=
        policy.sourceOfFundsThresholdMinor &&
      profile.sourceOfFundsStatus !== "accepted"
    )
      requirements.push("source_of_funds");
    if (
      policy.enhancedDueDiligenceThresholdMinor !== undefined &&
      (activity.monthlyDepositedMinor ?? 0n) >=
        policy.enhancedDueDiligenceThresholdMinor &&
      profile.enhancedDueDiligenceStatus !== "accepted"
    )
      requirements.push("enhanced_due_diligence");
    return {
      allowed: reasons.length === 0 && requirements.length === 0,
      reasons: [...new Set(reasons)],
      requirements: [...new Set(requirements)],
      limits: {
        maximumDailyDepositMinor: policy.maximumDailyDepositMinor,
        maximumMonthlyDepositMinor: policy.maximumMonthlyDepositMinor,
        maximumStakeMinor: policy.maximumStakeMinor,
        maximumWinMinor: policy.maximumWinMinor,
      },
      policyVersion: policy.version,
    };
  }

  tax(playerId: string, grossWinMinor: bigint, at = new Date()): bigint {
    const profile = this.#profiles.get(playerId);
    if (!profile)
      throw new RegulatoryValidationError("regulatory profile does not exist");
    const policy = this.policy(profile.jurisdiction, at);
    const taxable =
      grossWinMinor > policy.taxFreeWinMinor
        ? grossWinMinor - policy.taxFreeWinMinor
        : 0n;
    return (taxable * BigInt(policy.taxBasisPoints)) / 10_000n;
  }
  profile(playerId: string): PlayerRegulatoryProfile | undefined {
    const value = this.#profiles.get(playerId.trim());
    return value ? cloneProfile(value) : undefined;
  }
}

function validatePolicy(value: JurisdictionPolicy): JurisdictionPolicy {
  const effectiveFrom = regulatoryDate(
    value.effectiveFrom,
    "policy effective start",
  );
  const effectiveTo = value.effectiveTo
    ? regulatoryDate(value.effectiveTo, "policy effective end")
    : undefined;
  if (effectiveTo && effectiveTo <= effectiveFrom)
    throw new RegulatoryValidationError(
      "policy effective end must follow start",
    );
  if (
    !Number.isSafeInteger(value.legalAge) ||
    value.legalAge < 18 ||
    value.legalAge > 99
  )
    throw new RegulatoryValidationError("legal age is invalid");
  if (
    !Number.isSafeInteger(value.taxBasisPoints) ||
    value.taxBasisPoints < 0 ||
    value.taxBasisPoints > 10_000
  )
    throw new RegulatoryValidationError("tax rate is invalid");
  if (
    !Number.isSafeInteger(value.dataRetentionDays) ||
    value.dataRetentionDays < 1
  )
    throw new RegulatoryValidationError("data retention is invalid");
  return {
    ...value,
    code: regulatoryText(value.code, "jurisdiction code").toUpperCase(),
    name: regulatoryText(value.name, "jurisdiction name"),
    regulator: regulatoryText(value.regulator, "regulator"),
    currencies: normalized(value.currencies, true).map(regulatoryCurrency),
    allowedProducts: normalized(value.allowedProducts),
    blockedProducts: normalized(value.blockedProducts),
    depositMethods: normalized(value.depositMethods),
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: effectiveTo?.toISOString(),
  };
}
function validateProfile(
  value: PlayerRegulatoryProfile,
): PlayerRegulatoryProfile {
  return {
    ...value,
    playerId: regulatoryText(value.playerId, "player id"),
    country: regulatoryText(value.country, "country").toUpperCase(),
    jurisdiction: regulatoryText(
      value.jurisdiction,
      "jurisdiction",
    ).toUpperCase(),
    dateOfBirth: value.dateOfBirth
      ? regulatoryDate(value.dateOfBirth, "date of birth")
          .toISOString()
          .slice(0, 10)
      : undefined,
    citizenships: normalized(value.citizenships, true),
    occupations: normalized(value.occupations),
    restrictions: normalized(value.restrictions),
  };
}
function normalized(values: readonly string[], uppercase = false): string[] {
  return [
    ...new Set(
      values.map((value) => {
        const item = regulatoryText(value, "list item");
        return uppercase ? item.toUpperCase() : item.toLocaleLowerCase();
      }),
    ),
  ].sort();
}
function clonePolicy(value: JurisdictionPolicy): JurisdictionPolicy {
  return {
    ...value,
    currencies: [...value.currencies],
    allowedProducts: [...value.allowedProducts],
    blockedProducts: [...value.blockedProducts],
    depositMethods: [...value.depositMethods],
  };
}
function cloneProfile(value: PlayerRegulatoryProfile): PlayerRegulatoryProfile {
  return {
    ...value,
    citizenships: [...value.citizenships],
    occupations: [...value.occupations],
    restrictions: [...value.restrictions],
  };
}
