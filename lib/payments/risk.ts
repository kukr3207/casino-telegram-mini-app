import type {
  PaymentAmount,
  PaymentParty,
} from "./types.ts";
import {
  PaymentValidationError,
  normalizePaymentId,
  validatePaymentAmount,
} from "./types.ts";

export type RiskDecision = "allow" | "review" | "deny";

export interface PaymentRiskInput {
  player: PaymentParty;
  amount: PaymentAmount;
  direction: "deposit" | "withdrawal";
  paymentMethodFingerprint?: string;
  ipAddress?: string;
  deviceId?: string;
  occurredAt: Date;
}

export interface RiskSignal {
  code: string;
  severity: number;
  message: string;
}

export interface RiskAssessment {
  score: number;
  decision: RiskDecision;
  signals: readonly RiskSignal[];
  assessedAt: Date;
}

export interface RiskRule {
  readonly name: string;
  evaluate(input: PaymentRiskInput, context: RiskContext): RiskSignal | undefined;
}

export interface RiskContext {
  recentPayments(playerId: string, since: Date): readonly PaymentRiskInput[];
  isCountryBlocked(country: string): boolean;
  isFingerprintShared(fingerprint: string, playerId: string): boolean;
}

export interface PaymentRiskPolicy {
  reviewScore: number;
  denyScore: number;
  velocityWindowMs: number;
  velocityCount: number;
  largeAmountMinor: bigint;
}

const DEFAULT_POLICY: PaymentRiskPolicy = {
  reviewScore: 40,
  denyScore: 80,
  velocityWindowMs: 10 * 60 * 1000,
  velocityCount: 4,
  largeAmountMinor: 100_000n,
};

export class CountryBlockRule implements RiskRule {
  readonly name = "blocked_country";

  evaluate(input: PaymentRiskInput, context: RiskContext): RiskSignal | undefined {
    if (input.player.country && context.isCountryBlocked(input.player.country)) {
      return {
        code: this.name,
        severity: 100,
        message: `payments are not allowed from ${input.player.country}`,
      };
    }
    return undefined;
  }
}

export class SharedPaymentMethodRule implements RiskRule {
  readonly name = "shared_payment_method";

  evaluate(input: PaymentRiskInput, context: RiskContext): RiskSignal | undefined {
    if (
      input.paymentMethodFingerprint &&
      context.isFingerprintShared(input.paymentMethodFingerprint, input.player.playerId)
    ) {
      return {
        code: this.name,
        severity: 45,
        message: "payment method is associated with another player",
      };
    }
    return undefined;
  }
}

export class VelocityRule implements RiskRule {
  readonly name = "payment_velocity";
  private readonly policy: PaymentRiskPolicy;

  constructor(policy: PaymentRiskPolicy) {
    this.policy = policy;
  }

  evaluate(input: PaymentRiskInput, context: RiskContext): RiskSignal | undefined {
    const since = new Date(input.occurredAt.getTime() - this.policy.velocityWindowMs);
    const count = context.recentPayments(input.player.playerId, since).length;
    if (count >= this.policy.velocityCount) {
      return {
        code: this.name,
        severity: Math.min(75, 25 + count * 5),
        message: `${count} recent payments exceed the configured velocity`,
      };
    }
    return undefined;
  }
}

export class LargeWithdrawalRule implements RiskRule {
  readonly name = "large_withdrawal";
  private readonly policy: PaymentRiskPolicy;

  constructor(policy: PaymentRiskPolicy) {
    this.policy = policy;
  }

  evaluate(input: PaymentRiskInput): RiskSignal | undefined {
    if (input.direction === "withdrawal" && input.amount.minor >= this.policy.largeAmountMinor) {
      return {
        code: this.name,
        severity: 40,
        message: "withdrawal requires enhanced review",
      };
    }
    return undefined;
  }
}

export class AnonymousNetworkRule implements RiskRule {
  readonly name = "anonymous_network";
  private readonly blockedPrefixes: readonly string[];

  constructor(blockedPrefixes: readonly string[]) {
    this.blockedPrefixes = [...blockedPrefixes];
  }

  evaluate(input: PaymentRiskInput): RiskSignal | undefined {
    if (input.ipAddress && this.blockedPrefixes.some((prefix) => input.ipAddress!.startsWith(prefix))) {
      return {
        code: this.name,
        severity: 35,
        message: "payment originated from an anonymous network",
      };
    }
    return undefined;
  }
}

export class InMemoryRiskContext implements RiskContext {
  private readonly payments: PaymentRiskInput[] = [];
  private readonly blockedCountries = new Set<string>();
  private readonly fingerprints = new Map<string, Set<string>>();

  blockCountry(country: string): void {
    this.blockedCountries.add(normalizePaymentId(country, "country").toUpperCase());
  }

  unblockCountry(country: string): void {
    this.blockedCountries.delete(country.trim().toUpperCase());
  }

  record(input: PaymentRiskInput): void {
    validateRiskInput(input);
    this.payments.push(cloneRiskInput(input));
    if (input.paymentMethodFingerprint) {
      const owners = this.fingerprints.get(input.paymentMethodFingerprint) ?? new Set<string>();
      owners.add(input.player.playerId);
      this.fingerprints.set(input.paymentMethodFingerprint, owners);
    }
  }

  recentPayments(playerId: string, since: Date): readonly PaymentRiskInput[] {
    return this.payments
      .filter((payment) => payment.player.playerId === playerId && payment.occurredAt >= since)
      .map(cloneRiskInput);
  }

  isCountryBlocked(country: string): boolean {
    return this.blockedCountries.has(country.trim().toUpperCase());
  }

  isFingerprintShared(fingerprint: string, playerId: string): boolean {
    const owners = this.fingerprints.get(fingerprint);
    return owners ? [...owners].some((owner) => owner !== playerId) : false;
  }
}

export class PaymentRiskEngine {
  readonly policy: PaymentRiskPolicy;
  private readonly rules: readonly RiskRule[];

  constructor(policy: Partial<PaymentRiskPolicy> = {}, rules?: readonly RiskRule[]) {
    this.policy = validatePolicy({ ...DEFAULT_POLICY, ...policy });
    this.rules = rules ?? [
      new CountryBlockRule(),
      new SharedPaymentMethodRule(),
      new VelocityRule(this.policy),
      new LargeWithdrawalRule(this.policy),
    ];
  }

  assess(input: PaymentRiskInput, context: RiskContext): RiskAssessment {
    validateRiskInput(input);
    const signals = this.rules
      .map((rule) => rule.evaluate(input, context))
      .filter((signal): signal is RiskSignal => signal !== undefined);
    const score = Math.min(100, signals.reduce((sum, signal) => sum + signal.severity, 0));
    const decision: RiskDecision = score >= this.policy.denyScore
      ? "deny"
      : score >= this.policy.reviewScore
        ? "review"
        : "allow";
    return {
      score,
      decision,
      signals: signals.map((signal) => ({ ...signal })),
      assessedAt: new Date(input.occurredAt),
    };
  }
}

function validatePolicy(policy: PaymentRiskPolicy): PaymentRiskPolicy {
  for (const [name, value] of Object.entries({
    reviewScore: policy.reviewScore,
    denyScore: policy.denyScore,
    velocityWindowMs: policy.velocityWindowMs,
    velocityCount: policy.velocityCount,
  })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new PaymentValidationError(`${name} must be a positive integer`);
    }
  }
  if (policy.reviewScore >= policy.denyScore || policy.denyScore > 100) {
    throw new PaymentValidationError("risk thresholds are invalid");
  }
  if (policy.largeAmountMinor <= 0n) {
    throw new PaymentValidationError("large amount threshold must be positive");
  }
  return { ...policy };
}

function validateRiskInput(input: PaymentRiskInput): void {
  normalizePaymentId(input.player.playerId, "player id");
  validatePaymentAmount(input.amount);
  if (!(input.occurredAt instanceof Date) || !Number.isFinite(input.occurredAt.getTime())) {
    throw new PaymentValidationError("risk occurrence time is invalid");
  }
}

function cloneRiskInput(input: PaymentRiskInput): PaymentRiskInput {
  return {
    ...input,
    player: { ...input.player },
    amount: { ...input.amount },
    occurredAt: new Date(input.occurredAt),
  };
}
