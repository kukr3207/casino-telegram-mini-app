import { createHash } from "node:crypto";

import {
  RegulatoryConflictError,
  RegulatoryValidationError,
  regulatoryCurrency,
  regulatoryDate,
  regulatoryText,
} from "./types.ts";

export interface PlayerProtectionProfile {
  playerId: string;
  currency: string;
  depositLimitMinor?: bigint;
  depositLimitPeriod?: "day" | "week" | "month";
  lossLimitMinor?: bigint;
  lossLimitPeriod?: "day" | "week" | "month";
  wagerLimitMinor?: bigint;
  wagerLimitPeriod?: "day" | "week" | "month";
  sessionLimitMinutes?: number;
  realityCheckMinutes?: number;
  marketingBlocked: boolean;
  productBlocks: readonly string[];
  version: number;
}

export interface ProtectionLimitChange {
  id: string;
  playerId: string;
  kind: "deposit" | "loss" | "wager" | "session" | "reality_check";
  previousValue?: string;
  requestedValue?: string;
  direction: "increase" | "decrease" | "remove";
  status: "pending" | "active" | "cancelled";
  requestedAt: string;
  effectiveAt: string;
  activatedAt?: string;
  cancelledAt?: string;
  reason?: string;
  version: number;
}

export interface ExclusionPeriod {
  id: string;
  playerId: string;
  kind: "cooling_off" | "self_exclusion" | "operator_exclusion";
  startsAt: string;
  endsAt?: string;
  products: readonly string[];
  reason: string;
  source: string;
  status: "scheduled" | "active" | "expired" | "revoked";
  revokedAt?: string;
  revokedBy?: string;
  version: number;
}

export interface PlayActivity {
  id: string;
  playerId: string;
  kind:
    | "session_start"
    | "session_end"
    | "deposit"
    | "wager"
    | "win"
    | "loss"
    | "reality_check_acknowledged";
  amountMinor?: bigint;
  currency?: string;
  product?: string;
  occurredAt: string;
}

export interface ProtectionDecision {
  allowed: boolean;
  reasons: readonly string[];
  remainingDepositMinor?: bigint;
  remainingLossMinor?: bigint;
  remainingWagerMinor?: bigint;
  sessionRemainingMinutes?: number;
  realityCheckDue: boolean;
  nextRealityCheckAt?: string;
}

export interface PlayerProtectionSummary {
  playerId: string;
  activeExclusions: readonly ExclusionPeriod[];
  pendingChanges: readonly ProtectionLimitChange[];
  openSessionStartedAt?: string;
  depositedMinor: bigint;
  wageredMinor: bigint;
  lostMinor: bigint;
  periodStartsAt: string;
  periodEndsAt: string;
}

export class ResponsiblePlayService {
  readonly #profiles = new Map<string, PlayerProtectionProfile>();
  readonly #changes = new Map<string, ProtectionLimitChange>();
  readonly #exclusions = new Map<string, ExclusionPeriod>();
  readonly #activities = new Map<string, PlayActivity>();

  setInitialProfile(
    input: Omit<PlayerProtectionProfile, "version">,
  ): PlayerProtectionProfile {
    const profile = validateProfile({ ...input, version: 1 });
    if (this.#profiles.has(profile.playerId))
      throw new RegulatoryConflictError(
        "player protection profile already exists",
      );
    this.#profiles.set(profile.playerId, profile);
    return cloneProfile(profile);
  }

  blockMarketing(
    playerId: string,
    blocked: boolean,
    expectedVersion: number,
  ): PlayerProtectionProfile {
    return this.#changeProfile(playerId, expectedVersion, (profile) => ({
      ...profile,
      marketingBlocked: blocked,
    }));
  }

  setProductBlocks(
    playerId: string,
    products: readonly string[],
    expectedVersion: number,
  ): PlayerProtectionProfile {
    return this.#changeProfile(playerId, expectedVersion, (profile) => ({
      ...profile,
      productBlocks: [
        ...new Set(
          products.map((product) =>
            regulatoryText(product, "product").toLowerCase(),
          ),
        ),
      ].sort(),
    }));
  }

  requestLimit(
    input: {
      playerId: string;
      kind: ProtectionLimitChange["kind"];
      value?: bigint | number;
      period?: "day" | "week" | "month";
      reason?: string;
    },
    at = new Date(),
  ): ProtectionLimitChange {
    const profile = this.#profile(input.playerId);
    const current = readLimit(profile, input.kind);
    const requested = normalizeLimit(input.kind, input.value, input.period);
    const direction =
      requested === undefined
        ? "remove"
        : current === undefined || compareLimit(requested, current) > 0
          ? "increase"
          : "decrease";
    const delayHours =
      direction === "increase" || direction === "remove" ? 24 : 0;
    const fingerprint = createHash("sha256")
      .update(
        `${profile.playerId}\u0000${input.kind}\u0000${at.toISOString()}\u0000${requested ?? "none"}`,
      )
      .digest("hex");
    const change: ProtectionLimitChange = {
      id: `limit_${fingerprint.slice(0, 24)}`,
      playerId: profile.playerId,
      kind: input.kind,
      previousValue: current,
      requestedValue: requested,
      direction,
      status: delayHours === 0 ? "active" : "pending",
      requestedAt: at.toISOString(),
      effectiveAt: new Date(
        at.getTime() + delayHours * 3_600_000,
      ).toISOString(),
      activatedAt: delayHours === 0 ? at.toISOString() : undefined,
      reason: input.reason?.trim(),
      version: 1,
    };
    if (delayHours === 0) this.#applyLimit(profile, change, profile.version);
    this.#changes.set(change.id, change);
    return { ...change };
  }

  activateDueChanges(at = new Date()): readonly ProtectionLimitChange[] {
    const activated: ProtectionLimitChange[] = [];
    for (const change of this.#changes.values()) {
      if (change.status !== "pending" || new Date(change.effectiveAt) > at)
        continue;
      const profile = this.#profile(change.playerId);
      this.#applyLimit(profile, change, profile.version);
      const current = {
        ...change,
        status: "active" as const,
        activatedAt: at.toISOString(),
        version: change.version + 1,
      };
      this.#changes.set(current.id, current);
      activated.push({ ...current });
    }
    return activated;
  }

  cancelChange(
    id: string,
    expectedVersion: number,
    at = new Date(),
  ): ProtectionLimitChange {
    const current = this.#changes.get(regulatoryText(id, "limit change id"));
    if (!current)
      throw new RegulatoryValidationError("limit change does not exist");
    if (current.version !== expectedVersion)
      throw new RegulatoryConflictError("limit change version does not match");
    if (current.status !== "pending")
      throw new RegulatoryConflictError(
        "only pending limit changes can be cancelled",
      );
    const changed = {
      ...current,
      status: "cancelled" as const,
      cancelledAt: at.toISOString(),
      version: current.version + 1,
    };
    this.#changes.set(changed.id, changed);
    return { ...changed };
  }

  exclude(
    input: Omit<
      ExclusionPeriod,
      "id" | "status" | "version" | "revokedAt" | "revokedBy"
    >,
    minimumSelfExclusionDays: number,
    at = new Date(),
  ): ExclusionPeriod {
    const startsAt = regulatoryDate(input.startsAt, "exclusion start");
    const endsAt = input.endsAt
      ? regulatoryDate(input.endsAt, "exclusion end")
      : undefined;
    if (endsAt && endsAt <= startsAt)
      throw new RegulatoryValidationError("exclusion end must follow start");
    if (
      input.kind === "self_exclusion" &&
      endsAt &&
      endsAt.getTime() - startsAt.getTime() <
        minimumSelfExclusionDays * 86_400_000
    )
      throw new RegulatoryValidationError(
        "self exclusion is shorter than the jurisdiction minimum",
      );
    if (input.kind === "cooling_off" && !endsAt)
      throw new RegulatoryValidationError("cooling-off periods require an end");
    const fingerprint = createHash("sha256")
      .update(
        `${input.playerId}\u0000${input.kind}\u0000${startsAt.toISOString()}`,
      )
      .digest("hex");
    const value: ExclusionPeriod = {
      id: `exclude_${fingerprint.slice(0, 24)}`,
      playerId: regulatoryText(input.playerId, "player id"),
      kind: input.kind,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt?.toISOString(),
      products: [
        ...new Set(
          input.products.map((product) =>
            regulatoryText(product, "product").toLowerCase(),
          ),
        ),
      ].sort(),
      reason: regulatoryText(input.reason, "exclusion reason"),
      source: regulatoryText(input.source, "exclusion source"),
      status:
        startsAt > at
          ? "scheduled"
          : endsAt && endsAt <= at
            ? "expired"
            : "active",
      version: 1,
    };
    this.#exclusions.set(value.id, value);
    return cloneExclusion(value);
  }

  revokeOperatorExclusion(
    id: string,
    actorId: string,
    expectedVersion: number,
    at = new Date(),
  ): ExclusionPeriod {
    const current = this.#exclusions.get(regulatoryText(id, "exclusion id"));
    if (!current)
      throw new RegulatoryValidationError("exclusion does not exist");
    if (current.version !== expectedVersion)
      throw new RegulatoryConflictError("exclusion version does not match");
    if (current.kind !== "operator_exclusion")
      throw new RegulatoryConflictError(
        "player exclusions cannot be revoked early",
      );
    if (!["active", "scheduled"].includes(current.status))
      throw new RegulatoryConflictError("exclusion is not active");
    const changed = {
      ...current,
      status: "revoked" as const,
      revokedAt: at.toISOString(),
      revokedBy: regulatoryText(actorId, "exclusion revoker"),
      version: current.version + 1,
    };
    this.#exclusions.set(changed.id, changed);
    return cloneExclusion(changed);
  }

  recordActivity(input: PlayActivity): PlayActivity {
    const value = validateActivity(input);
    const existing = this.#activities.get(value.id);
    if (existing) {
      if (activityIdentity(existing) !== activityIdentity(value))
        throw new RegulatoryConflictError("play activity id is already used");
      return { ...existing };
    }
    if (
      value.kind === "session_start" &&
      this.#openSession(value.playerId, new Date(value.occurredAt))
    )
      throw new RegulatoryConflictError("player already has an open session");
    if (
      value.kind === "session_end" &&
      !this.#openSession(value.playerId, new Date(value.occurredAt))
    )
      throw new RegulatoryConflictError("player does not have an open session");
    this.#activities.set(value.id, value);
    return { ...value };
  }

  decide(
    playerId: string,
    activity: {
      kind: "deposit" | "wager" | "login" | "marketing";
      amountMinor?: bigint;
      product?: string;
      at?: Date;
    },
  ): ProtectionDecision {
    const profile = this.#profile(playerId);
    const at = activity.at ?? new Date();
    this.#refreshExclusions(at);
    const reasons: string[] = [];
    const exclusions = this.activeExclusions(profile.playerId, at).filter(
      (exclusion) =>
        exclusion.products.length === 0 ||
        !activity.product ||
        exclusion.products.includes(activity.product.toLowerCase()),
    );
    if (exclusions.length) reasons.push("active_exclusion");
    if (
      activity.product &&
      profile.productBlocks.includes(activity.product.toLowerCase())
    )
      reasons.push("product_blocked");
    if (activity.kind === "marketing" && profile.marketingBlocked)
      reasons.push("marketing_blocked");
    const depositWindow = periodWindow(at, profile.depositLimitPeriod ?? "day");
    const lossWindow = periodWindow(at, profile.lossLimitPeriod ?? "day");
    const wagerWindow = periodWindow(at, profile.wagerLimitPeriod ?? "day");
    const deposited = this.#sum(
      profile.playerId,
      "deposit",
      depositWindow.start,
      at,
    );
    const lost = this.#sum(profile.playerId, "loss", lossWindow.start, at);
    const wagered = this.#sum(profile.playerId, "wager", wagerWindow.start, at);
    const remainingDepositMinor = remaining(
      profile.depositLimitMinor,
      deposited,
    );
    const remainingLossMinor = remaining(profile.lossLimitMinor, lost);
    const remainingWagerMinor = remaining(profile.wagerLimitMinor, wagered);
    if (
      activity.kind === "deposit" &&
      remainingDepositMinor !== undefined &&
      (activity.amountMinor ?? 0n) > remainingDepositMinor
    )
      reasons.push("deposit_limit");
    if (
      activity.kind === "wager" &&
      remainingWagerMinor !== undefined &&
      (activity.amountMinor ?? 0n) > remainingWagerMinor
    )
      reasons.push("wager_limit");
    const session = this.#openSession(profile.playerId, at);
    const elapsedMinutes = session
      ? Math.floor(
          (at.getTime() - new Date(session.occurredAt).getTime()) / 60_000,
        )
      : 0;
    const sessionRemainingMinutes =
      profile.sessionLimitMinutes === undefined
        ? undefined
        : Math.max(0, profile.sessionLimitMinutes - elapsedMinutes);
    if (sessionRemainingMinutes === 0) reasons.push("session_limit");
    const acknowledged = this.#latest(
      profile.playerId,
      "reality_check_acknowledged",
      at,
    );
    const realityBasis = acknowledged ?? session;
    const nextRealityCheckAt =
      realityBasis && profile.realityCheckMinutes
        ? new Date(
            new Date(realityBasis.occurredAt).getTime() +
              profile.realityCheckMinutes * 60_000,
          ).toISOString()
        : undefined;
    const realityCheckDue =
      nextRealityCheckAt !== undefined && new Date(nextRealityCheckAt) <= at;
    if (realityCheckDue && activity.kind === "wager")
      reasons.push("reality_check_due");
    return {
      allowed: reasons.length === 0,
      reasons,
      remainingDepositMinor,
      remainingLossMinor,
      remainingWagerMinor,
      sessionRemainingMinutes,
      realityCheckDue,
      nextRealityCheckAt,
    };
  }

  activeExclusions(
    playerId: string,
    at = new Date(),
  ): readonly ExclusionPeriod[] {
    this.#refreshExclusions(at);
    return [...this.#exclusions.values()]
      .filter(
        (value) => value.playerId === playerId && value.status === "active",
      )
      .map(cloneExclusion);
  }

  summary(playerId: string, at = new Date()): PlayerProtectionSummary {
    const profile = this.#profile(playerId);
    const period = periodWindow(at, "month");
    return {
      playerId: profile.playerId,
      activeExclusions: this.activeExclusions(profile.playerId, at),
      pendingChanges: [...this.#changes.values()]
        .filter(
          (change) =>
            change.playerId === profile.playerId && change.status === "pending",
        )
        .map((change) => ({ ...change })),
      openSessionStartedAt: this.#openSession(profile.playerId, at)?.occurredAt,
      depositedMinor: this.#sum(profile.playerId, "deposit", period.start, at),
      wageredMinor: this.#sum(profile.playerId, "wager", period.start, at),
      lostMinor: this.#sum(profile.playerId, "loss", period.start, at),
      periodStartsAt: period.start.toISOString(),
      periodEndsAt: period.end.toISOString(),
    };
  }

  profile(playerId: string): PlayerProtectionProfile | undefined {
    const value = this.#profiles.get(playerId.trim());
    return value ? cloneProfile(value) : undefined;
  }

  #profile(playerId: string): PlayerProtectionProfile {
    const value = this.#profiles.get(regulatoryText(playerId, "player id"));
    if (!value)
      throw new RegulatoryValidationError(
        "player protection profile does not exist",
      );
    return value;
  }
  #changeProfile(
    playerId: string,
    expectedVersion: number,
    change: (profile: PlayerProtectionProfile) => PlayerProtectionProfile,
  ): PlayerProtectionProfile {
    const current = this.#profile(playerId);
    if (current.version !== expectedVersion)
      throw new RegulatoryConflictError(
        "player protection profile version does not match",
      );
    const changed = validateProfile({
      ...change(current),
      version: current.version + 1,
    });
    this.#profiles.set(changed.playerId, changed);
    return cloneProfile(changed);
  }
  #applyLimit(
    profile: PlayerProtectionProfile,
    change: ProtectionLimitChange,
    expectedVersion: number,
  ): void {
    const parsed = parseLimit(change.requestedValue);
    this.#changeProfile(profile.playerId, expectedVersion, (value) =>
      change.kind === "deposit"
        ? {
            ...value,
            depositLimitMinor: parsed.amount,
            depositLimitPeriod: parsed.period,
          }
        : change.kind === "loss"
          ? {
              ...value,
              lossLimitMinor: parsed.amount,
              lossLimitPeriod: parsed.period,
            }
          : change.kind === "wager"
            ? {
                ...value,
                wagerLimitMinor: parsed.amount,
                wagerLimitPeriod: parsed.period,
              }
            : change.kind === "session"
              ? { ...value, sessionLimitMinutes: parsed.minutes }
              : { ...value, realityCheckMinutes: parsed.minutes },
    );
  }
  #sum(
    playerId: string,
    kind: PlayActivity["kind"],
    from: Date,
    to: Date,
  ): bigint {
    return [...this.#activities.values()]
      .filter(
        (value) =>
          value.playerId === playerId &&
          value.kind === kind &&
          new Date(value.occurredAt) >= from &&
          new Date(value.occurredAt) <= to,
      )
      .reduce((sum, value) => sum + (value.amountMinor ?? 0n), 0n);
  }
  #latest(
    playerId: string,
    kind: PlayActivity["kind"],
    at: Date,
  ): PlayActivity | undefined {
    return [...this.#activities.values()]
      .filter(
        (value) =>
          value.playerId === playerId &&
          value.kind === kind &&
          new Date(value.occurredAt) <= at,
      )
      .sort((left, right) =>
        right.occurredAt.localeCompare(left.occurredAt),
      )[0];
  }
  #openSession(playerId: string, at: Date): PlayActivity | undefined {
    const activities = [...this.#activities.values()]
      .filter(
        (value) =>
          value.playerId === playerId &&
          ["session_start", "session_end"].includes(value.kind) &&
          new Date(value.occurredAt) <= at,
      )
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    return activities[0]?.kind === "session_start" ? activities[0] : undefined;
  }
  #refreshExclusions(at: Date): void {
    for (const value of this.#exclusions.values()) {
      const status =
        value.status === "revoked"
          ? "revoked"
          : new Date(value.startsAt) > at
            ? "scheduled"
            : value.endsAt && new Date(value.endsAt) <= at
              ? "expired"
              : "active";
      if (status !== value.status)
        this.#exclusions.set(value.id, {
          ...value,
          status,
          version: value.version + 1,
        });
    }
  }
}

function validateProfile(
  value: PlayerProtectionProfile,
): PlayerProtectionProfile {
  for (const amount of [
    value.depositLimitMinor,
    value.lossLimitMinor,
    value.wagerLimitMinor,
  ])
    if (amount !== undefined && (typeof amount !== "bigint" || amount < 0n))
      throw new RegulatoryValidationError(
        "protection limits cannot be negative",
      );
  for (const minutes of [value.sessionLimitMinutes, value.realityCheckMinutes])
    if (
      minutes !== undefined &&
      (!Number.isSafeInteger(minutes) || minutes < 1)
    )
      throw new RegulatoryValidationError(
        "time limits must be positive minutes",
      );
  if (
    (value.depositLimitMinor === undefined) !==
    (value.depositLimitPeriod === undefined)
  )
    throw new RegulatoryValidationError(
      "deposit limit amount and period must be supplied together",
    );
  if (
    (value.lossLimitMinor === undefined) !==
    (value.lossLimitPeriod === undefined)
  )
    throw new RegulatoryValidationError(
      "loss limit amount and period must be supplied together",
    );
  if (
    (value.wagerLimitMinor === undefined) !==
    (value.wagerLimitPeriod === undefined)
  )
    throw new RegulatoryValidationError(
      "wager limit amount and period must be supplied together",
    );
  return {
    ...value,
    playerId: regulatoryText(value.playerId, "player id"),
    currency: regulatoryCurrency(value.currency),
    productBlocks: [
      ...new Set(
        value.productBlocks.map((product) =>
          regulatoryText(product, "product").toLowerCase(),
        ),
      ),
    ].sort(),
  };
}

function validateActivity(value: PlayActivity): PlayActivity {
  if (
    value.amountMinor !== undefined &&
    (typeof value.amountMinor !== "bigint" || value.amountMinor < 0n)
  )
    throw new RegulatoryValidationError("play amount cannot be negative");
  if (
    ["deposit", "wager", "win", "loss"].includes(value.kind) &&
    value.amountMinor === undefined
  )
    throw new RegulatoryValidationError(
      "financial play activity requires an amount",
    );
  return {
    ...value,
    id: regulatoryText(value.id, "activity id"),
    playerId: regulatoryText(value.playerId, "player id"),
    currency: value.currency ? regulatoryCurrency(value.currency) : undefined,
    product: value.product?.trim().toLowerCase(),
    occurredAt: regulatoryDate(value.occurredAt, "activity time").toISOString(),
  };
}
function normalizeLimit(
  kind: ProtectionLimitChange["kind"],
  value: bigint | number | undefined,
  period?: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (kind === "session" || kind === "reality_check") {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RegulatoryValidationError(
        "time limit must be positive minutes",
      );
    return `minutes:${value}`;
  }
  if (typeof value !== "bigint" || value < 0n)
    throw new RegulatoryValidationError(
      "financial limit must be a non-negative bigint",
    );
  if (!period || !["day", "week", "month"].includes(period))
    throw new RegulatoryValidationError("financial limit requires a period");
  return `${period}:${value}`;
}
function parseLimit(value?: string): {
  amount?: bigint;
  period?: "day" | "week" | "month";
  minutes?: number;
} {
  if (!value) return {};
  const [kind, amount] = value.split(":");
  if (kind === "minutes") return { minutes: Number(amount) };
  return { amount: BigInt(amount), period: kind as "day" | "week" | "month" };
}
function readLimit(
  profile: PlayerProtectionProfile,
  kind: ProtectionLimitChange["kind"],
): string | undefined {
  if (kind === "deposit")
    return profile.depositLimitMinor === undefined
      ? undefined
      : `${profile.depositLimitPeriod}:${profile.depositLimitMinor}`;
  if (kind === "loss")
    return profile.lossLimitMinor === undefined
      ? undefined
      : `${profile.lossLimitPeriod}:${profile.lossLimitMinor}`;
  if (kind === "wager")
    return profile.wagerLimitMinor === undefined
      ? undefined
      : `${profile.wagerLimitPeriod}:${profile.wagerLimitMinor}`;
  if (kind === "session")
    return profile.sessionLimitMinutes === undefined
      ? undefined
      : `minutes:${profile.sessionLimitMinutes}`;
  return profile.realityCheckMinutes === undefined
    ? undefined
    : `minutes:${profile.realityCheckMinutes}`;
}
function compareLimit(left: string, right: string): number {
  const a = parseLimit(left);
  const b = parseLimit(right);
  return Number(
    (a.amount ?? BigInt(a.minutes ?? 0)) - (b.amount ?? BigInt(b.minutes ?? 0)),
  );
}
function periodWindow(
  at: Date,
  period: "day" | "week" | "month",
): { start: Date; end: Date } {
  const start = new Date(at);
  start.setUTCHours(0, 0, 0, 0);
  if (period === "week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === "month") start.setUTCDate(1);
  const end = new Date(start);
  if (period === "day") end.setUTCDate(end.getUTCDate() + 1);
  if (period === "week") end.setUTCDate(end.getUTCDate() + 7);
  if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}
function remaining(
  limit: bigint | undefined,
  used: bigint,
): bigint | undefined {
  return limit === undefined ? undefined : limit > used ? limit - used : 0n;
}
function activityIdentity(value: PlayActivity): string {
  return JSON.stringify({
    ...value,
    amountMinor: value.amountMinor?.toString(),
  });
}
function cloneProfile(value: PlayerProtectionProfile): PlayerProtectionProfile {
  return { ...value, productBlocks: [...value.productBlocks] };
}
function cloneExclusion(value: ExclusionPeriod): ExclusionPeriod {
  return { ...value, products: [...value.products] };
}
