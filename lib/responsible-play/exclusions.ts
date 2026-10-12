export type ExclusionScope = "all" | "casino" | "payments" | "promotions";

export interface PlayerExclusion {
  id: string;
  playerId: string;
  scope: ExclusionScope;
  startsAt: string;
  endsAt: string | null;
  reason: string;
  source: "player" | "operator" | "regulator";
  revokedAt?: string;
}

export interface ExclusionCheck {
  excluded: boolean;
  scopes: readonly ExclusionScope[];
  exclusions: readonly PlayerExclusion[];
  earliestEnd: string | null;
}

function time(value: string | Date, field: string): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${field} is invalid`);
  return parsed;
}

export class ExclusionRegistry {
  readonly #exclusions = new Map<string, PlayerExclusion>();

  exclude(input: {
    id: string;
    playerId: string;
    scope?: ExclusionScope;
    startsAt: string | Date;
    endsAt?: string | Date | null;
    reason: string;
    source: PlayerExclusion["source"];
  }): PlayerExclusion {
    if (!input.id.trim() || !input.playerId.trim() || !input.reason.trim()) throw new RangeError("exclusion fields cannot be blank");
    const starts = time(input.startsAt, "exclusion start");
    const ends = input.endsAt ? time(input.endsAt, "exclusion end") : null;
    if (ends && ends <= starts) throw new RangeError("exclusion end must follow start");
    const scope = input.scope ?? "all";
    if (!new Set<ExclusionScope>(["all", "casino", "payments", "promotions"]).has(scope)) throw new RangeError("exclusion scope is invalid");
    const value: PlayerExclusion = {
      id: input.id.trim(), playerId: input.playerId.trim(), scope,
      startsAt: starts.toISOString(), endsAt: ends?.toISOString() ?? null,
      reason: input.reason.trim(), source: input.source,
    };
    const existing = this.#exclusions.get(value.id);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(value)) return existing;
      throw new Error("exclusion id already exists");
    }
    this.#exclusions.set(value.id, value);
    return value;
  }

  revoke(id: string, at: string | Date): PlayerExclusion {
    const exclusion = this.#exclusions.get(id);
    if (!exclusion) throw new Error("exclusion was not found");
    if (exclusion.source !== "operator") throw new Error("only operator exclusions may be revoked");
    if (exclusion.revokedAt) return exclusion;
    const revokedAt = time(at, "revocation time");
    if (revokedAt < new Date(exclusion.startsAt)) throw new RangeError("revocation cannot precede exclusion");
    const changed = { ...exclusion, revokedAt: revokedAt.toISOString() };
    this.#exclusions.set(id, changed);
    return changed;
  }

  check(playerId: string, requestedScope: ExclusionScope, at: string | Date): ExclusionCheck {
    const timestamp = time(at, "exclusion check time");
    const exclusions = [...this.#exclusions.values()]
      .filter((value) => value.playerId === playerId && !value.revokedAt)
      .filter((value) => new Date(value.startsAt) <= timestamp && (!value.endsAt || new Date(value.endsAt) > timestamp))
      .filter((value) => value.scope === "all" || value.scope === requestedScope)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    const ends = exclusions.map((value) => value.endsAt).filter((value): value is string => value !== null).sort();
    return {
      excluded: exclusions.length > 0,
      scopes: [...new Set(exclusions.map((value) => value.scope))],
      exclusions,
      earliestEnd: exclusions.some((value) => value.endsAt === null) ? null : ends[0] ?? null,
    };
  }
}
