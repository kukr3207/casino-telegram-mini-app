import { FraudValidationError } from "./device-graph.ts";

export type VelocityDimension = "player" | "device" | "ip" | "payment_method";

export interface VelocityEvent {
  id: string;
  kind: string;
  occurredAt: Date;
  playerId: string;
  deviceId?: string;
  ipAddress?: string;
  paymentFingerprint?: string;
  amountMinor?: bigint;
}

export interface VelocityRule {
  id: string;
  kinds: readonly string[];
  dimension: VelocityDimension;
  windowMs: number;
  maximumCount?: number;
  maximumAmountMinor?: bigint;
  action: "review" | "deny";
}

export interface VelocityBreach {
  ruleId: string;
  dimension: VelocityDimension;
  dimensionValue: string;
  count: number;
  amountMinor: bigint;
  action: "review" | "deny";
  windowStartedAt: Date;
}

export class VelocityTracker {
  private readonly events: VelocityEvent[] = [];
  private readonly eventIds = new Set<string>();
  private readonly rules = new Map<string, VelocityRule>();

  configure(rule: VelocityRule): VelocityRule {
    const normalized = normalizeRule(rule);
    this.rules.set(normalized.id, normalized);
    return cloneRule(normalized);
  }

  record(event: VelocityEvent): readonly VelocityBreach[] {
    const normalized = normalizeEvent(event);
    if (this.eventIds.has(normalized.id)) return this.evaluate(normalized);
    this.events.push(normalized);
    this.eventIds.add(normalized.id);
    return this.evaluate(normalized);
  }

  evaluate(event: VelocityEvent): readonly VelocityBreach[] {
    const normalized = normalizeEvent(event);
    const breaches: VelocityBreach[] = [];
    for (const rule of this.rules.values()) {
      if (!rule.kinds.includes(normalized.kind)) continue;
      const dimensionValue = dimensionValueFor(normalized, rule.dimension);
      if (!dimensionValue) continue;
      const windowStartedAt = new Date(normalized.occurredAt.getTime() - rule.windowMs);
      const matches = this.events.filter((candidate) => (
        rule.kinds.includes(candidate.kind)
        && candidate.occurredAt >= windowStartedAt
        && candidate.occurredAt <= normalized.occurredAt
        && dimensionValueFor(candidate, rule.dimension) === dimensionValue
      ));
      const amountMinor = matches.reduce((sum, candidate) => sum + (candidate.amountMinor ?? 0n), 0n);
      const countExceeded = rule.maximumCount !== undefined && matches.length > rule.maximumCount;
      const amountExceeded = rule.maximumAmountMinor !== undefined && amountMinor > rule.maximumAmountMinor;
      if (countExceeded || amountExceeded) {
        breaches.push({
          ruleId: rule.id,
          dimension: rule.dimension,
          dimensionValue,
          count: matches.length,
          amountMinor,
          action: rule.action,
          windowStartedAt,
        });
      }
    }
    return breaches.sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  }

  prune(before: Date): number {
    const cutoff = new Date(before);
    if (!Number.isFinite(cutoff.getTime())) throw new FraudValidationError("velocity cutoff is invalid");
    const retained = this.events.filter((event) => event.occurredAt >= cutoff);
    const removed = this.events.length - retained.length;
    this.events.splice(0, this.events.length, ...retained);
    this.eventIds.clear();
    for (const event of retained) this.eventIds.add(event.id);
    return removed;
  }
}

function normalizeRule(rule: VelocityRule): VelocityRule {
  if (!rule.id?.trim()) throw new FraudValidationError("velocity rule id is required");
  if (rule.kinds.length === 0) throw new FraudValidationError("velocity rule needs an event kind");
  if (!Number.isInteger(rule.windowMs) || rule.windowMs <= 0) throw new FraudValidationError("velocity window must be positive");
  if (rule.maximumCount === undefined && rule.maximumAmountMinor === undefined) {
    throw new FraudValidationError("velocity rule needs a count or amount threshold");
  }
  if (rule.maximumCount !== undefined && (!Number.isInteger(rule.maximumCount) || rule.maximumCount < 1)) {
    throw new FraudValidationError("velocity count threshold must be positive");
  }
  if (rule.maximumAmountMinor !== undefined && rule.maximumAmountMinor <= 0n) {
    throw new FraudValidationError("velocity amount threshold must be positive");
  }
  return { ...rule, id: rule.id.trim(), kinds: [...new Set(rule.kinds.map((kind) => kind.trim()))] };
}

function normalizeEvent(event: VelocityEvent): VelocityEvent {
  const occurredAt = new Date(event.occurredAt);
  if (!event.id?.trim() || !event.kind?.trim() || !event.playerId?.trim()) {
    throw new FraudValidationError("velocity event id, kind, and player are required");
  }
  if (!Number.isFinite(occurredAt.getTime())) throw new FraudValidationError("velocity event time is invalid");
  if (event.amountMinor !== undefined && event.amountMinor < 0n) throw new FraudValidationError("velocity amount cannot be negative");
  return { ...event, id: event.id.trim(), kind: event.kind.trim(), playerId: event.playerId.trim(), occurredAt };
}

function dimensionValueFor(event: VelocityEvent, dimension: VelocityDimension): string | undefined {
  if (dimension === "player") return event.playerId;
  if (dimension === "device") return event.deviceId;
  if (dimension === "ip") return event.ipAddress;
  return event.paymentFingerprint;
}

function cloneRule(rule: VelocityRule): VelocityRule {
  return { ...rule, kinds: [...rule.kinds] };
}

