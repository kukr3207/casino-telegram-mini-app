export type LimitPeriod = "day" | "week" | "month";
export type LimitKind = "deposit" | "loss" | "wager" | "session_minutes";

export interface PlayerLimit {
  id: string;
  playerId: string;
  kind: LimitKind;
  period: LimitPeriod;
  value: bigint;
  effectiveAt: string;
  requestedAt: string;
  status: "scheduled" | "active" | "cancelled" | "replaced";
}

export interface LimitUsage {
  kind: LimitKind;
  period: LimitPeriod;
  periodStart: string;
  periodEnd: string;
  limit: bigint;
  used: bigint;
  remaining: bigint;
  allowed: boolean;
}

function iso(value: string | Date, field: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${field} is invalid`);
  return parsed.toISOString();
}

function boundary(now: Date, period: LimitPeriod): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === "month") start.setUTCDate(1);
  const end = new Date(start);
  if (period === "day") end.setUTCDate(end.getUTCDate() + 1);
  if (period === "week") end.setUTCDate(end.getUTCDate() + 7);
  if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export class PlayerLimitService {
  readonly #limits = new Map<string, PlayerLimit>();
  readonly #events: { playerId: string; kind: LimitKind; value: bigint; at: string; reference: string }[] = [];

  request(input: {
    id: string;
    playerId: string;
    kind: LimitKind;
    period: LimitPeriod;
    value: bigint;
    at: string | Date;
  }): PlayerLimit {
    if (!input.id.trim() || !input.playerId.trim()) throw new RangeError("limit and player ids cannot be blank");
    if (input.value <= 0n) throw new RangeError("player limit must be positive");
    const kinds = new Set<LimitKind>(["deposit", "loss", "wager", "session_minutes"]);
    const periods = new Set<LimitPeriod>(["day", "week", "month"]);
    if (!kinds.has(input.kind) || !periods.has(input.period)) throw new RangeError("player limit kind or period is invalid");
    const requested = new Date(iso(input.at, "limit request time"));
    const existing = this.active(input.playerId, input.kind, input.period, requested);
    const isIncrease = existing && input.value > existing.value;
    const effectiveAt = new Date(requested);
    if (isIncrease) effectiveAt.setUTCDate(effectiveAt.getUTCDate() + 7);
    const value: PlayerLimit = {
      id: input.id.trim(), playerId: input.playerId.trim(), kind: input.kind,
      period: input.period, value: input.value,
      requestedAt: requested.toISOString(), effectiveAt: effectiveAt.toISOString(),
      status: isIncrease ? "scheduled" : "active",
    };
    if (this.#limits.has(value.id)) throw new Error("player limit id already exists");
    if (!isIncrease && existing) this.#limits.set(existing.id, { ...existing, status: "replaced" });
    this.#limits.set(value.id, value);
    return value;
  }

  activateScheduled(now: string | Date): PlayerLimit[] {
    const timestamp = new Date(iso(now, "limit activation time"));
    const activated: PlayerLimit[] = [];
    for (const limit of this.#limits.values()) {
      if (limit.status !== "scheduled" || new Date(limit.effectiveAt) > timestamp) continue;
      const prior = this.active(limit.playerId, limit.kind, limit.period, timestamp);
      if (prior && prior.id !== limit.id) this.#limits.set(prior.id, { ...prior, status: "replaced" });
      const changed = { ...limit, status: "active" as const };
      this.#limits.set(limit.id, changed);
      activated.push(changed);
    }
    return activated;
  }

  record(playerId: string, kind: LimitKind, value: bigint, at: string | Date, reference: string): void {
    if (value <= 0n || !reference.trim()) throw new RangeError("limit usage value and reference must be valid");
    if (this.#events.some((event) => event.reference === reference)) return;
    this.#events.push({ playerId, kind, value, at: iso(at, "usage time"), reference: reference.trim() });
  }

  check(playerId: string, kind: LimitKind, period: LimitPeriod, proposed: bigint, now: string | Date): LimitUsage | null {
    if (proposed < 0n) throw new RangeError("proposed usage cannot be negative");
    const timestamp = new Date(iso(now, "limit check time"));
    const limit = this.active(playerId, kind, period, timestamp);
    if (!limit) return null;
    const { start, end } = boundary(timestamp, period);
    const used = this.#events
      .filter((event) => event.playerId === playerId && event.kind === kind)
      .filter((event) => new Date(event.at) >= start && new Date(event.at) < end)
      .reduce((total, event) => total + event.value, 0n);
    const remaining = used >= limit.value ? 0n : limit.value - used;
    return {
      kind, period, periodStart: start.toISOString(), periodEnd: end.toISOString(),
      limit: limit.value, used, remaining, allowed: proposed <= remaining,
    };
  }

  active(playerId: string, kind: LimitKind, period: LimitPeriod, now: string | Date): PlayerLimit | null {
    const timestamp = new Date(iso(now, "limit lookup time"));
    return [...this.#limits.values()]
      .filter((limit) => limit.playerId === playerId && limit.kind === kind && limit.period === period)
      .filter((limit) => limit.status === "active" && new Date(limit.effectiveAt) <= timestamp)
      .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] ?? null;
  }
}
