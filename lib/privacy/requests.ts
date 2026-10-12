import { createHash, randomUUID } from "node:crypto";
import type { ConsentRecord } from "../identity/consent.ts";
import type { PlayerProfile } from "../identity/profiles.ts";
import { IdentityConflictError, IdentityValidationError, requiredText, validDate } from "../identity/profiles.ts";

export type PrivacyRequestType = "access" | "portability" | "correction" | "erasure";
export type PrivacyRequestStatus = "submitted" | "identity_pending" | "processing" | "blocked" | "completed" | "rejected";

export interface PrivacyRequest {
  id: string;
  playerId: string;
  type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  submittedAt: Date;
  dueAt: Date;
  verifiedAt?: Date;
  completedAt?: Date;
  reason?: string;
  version: number;
}

export interface RetentionHold {
  id: string;
  playerId: string;
  reason: string;
  categories: readonly string[];
  beginsAt: Date;
  expiresAt?: Date;
  releasedAt?: Date;
}

export interface PortablePlayerData {
  generatedAt: string;
  profile: Omit<PlayerProfile, "telegramId"> & { telegramId: string };
  consentHistory: readonly ConsentRecord[];
  activity: Readonly<Record<string, readonly unknown[]>>;
  checksum: string;
}

export class PrivacyRequestService {
  private readonly requests = new Map<string, PrivacyRequest>();
  private readonly holds = new Map<string, RetentionHold>();

  submit(playerId: string, type: PrivacyRequestType, at = new Date(), responseDays = 30): PrivacyRequest {
    const normalizedPlayerId = requiredText(playerId, "player id", 128);
    const types: PrivacyRequestType[] = ["access", "portability", "correction", "erasure"];
    if (!types.includes(type)) throw new IdentityValidationError("privacy request type is invalid");
    if (!Number.isInteger(responseDays) || responseDays < 1 || responseDays > 90) {
      throw new IdentityValidationError("privacy response period is invalid");
    }
    const now = validDate(at, "request time");
    const active = [...this.requests.values()].find(
      (request) => request.playerId === normalizedPlayerId
        && request.type === type
        && !["completed", "rejected"].includes(request.status),
    );
    if (active) return cloneRequest(active);
    const request: PrivacyRequest = {
      id: randomUUID(),
      playerId: normalizedPlayerId,
      type,
      status: "identity_pending",
      submittedAt: now,
      dueAt: new Date(now.getTime() + responseDays * 24 * 60 * 60 * 1_000),
      version: 1,
    };
    this.requests.set(request.id, request);
    return cloneRequest(request);
  }

  verifyIdentity(requestId: string, expectedVersion: number, at = new Date()): PrivacyRequest {
    return this.transition(requestId, expectedVersion, ["identity_pending"], "processing", at);
  }

  block(requestId: string, expectedVersion: number, reason: string, at = new Date()): PrivacyRequest {
    return this.transition(requestId, expectedVersion, ["processing"], "blocked", at, requiredText(reason, "block reason", 500));
  }

  resume(requestId: string, expectedVersion: number, at = new Date()): PrivacyRequest {
    return this.transition(requestId, expectedVersion, ["blocked"], "processing", at);
  }

  complete(requestId: string, expectedVersion: number, at = new Date()): PrivacyRequest {
    const request = this.requireVersion(requestId, expectedVersion);
    if (request.status !== "processing") throw new IdentityConflictError("privacy request is not processing");
    if (request.type === "erasure" && this.activeHolds(request.playerId, at).length > 0) {
      throw new IdentityConflictError("erasure is blocked by an active retention hold");
    }
    return this.save({
      ...request,
      status: "completed",
      completedAt: validDate(at, "completion time"),
      reason: undefined,
      version: request.version + 1,
    });
  }

  reject(requestId: string, expectedVersion: number, reason: string, at = new Date()): PrivacyRequest {
    const request = this.requireVersion(requestId, expectedVersion);
    if (["completed", "rejected"].includes(request.status)) throw new IdentityConflictError("privacy request is already closed");
    return this.save({
      ...request,
      status: "rejected",
      completedAt: validDate(at, "rejection time"),
      reason: requiredText(reason, "rejection reason", 500),
      version: request.version + 1,
    });
  }

  addHold(
    playerId: string,
    reason: string,
    categories: readonly string[],
    options: { at?: Date; expiresAt?: Date } = {},
  ): RetentionHold {
    const beginsAt = options.at ? validDate(options.at, "hold time") : new Date();
    const expiresAt = options.expiresAt ? validDate(options.expiresAt, "hold expiry") : undefined;
    if (expiresAt && expiresAt <= beginsAt) throw new IdentityValidationError("hold expiry must follow its start");
    const normalizedCategories = [...new Set(categories.map((value) => requiredText(value, "retention category", 100)))];
    if (normalizedCategories.length === 0) throw new IdentityValidationError("retention hold needs at least one category");
    const hold: RetentionHold = {
      id: randomUUID(),
      playerId: requiredText(playerId, "player id", 128),
      reason: requiredText(reason, "hold reason", 500),
      categories: normalizedCategories,
      beginsAt,
      expiresAt,
    };
    this.holds.set(hold.id, hold);
    return cloneHold(hold);
  }

  releaseHold(holdId: string, at = new Date()): RetentionHold {
    const hold = this.holds.get(requiredText(holdId, "hold id", 128));
    if (!hold) throw new IdentityValidationError("retention hold does not exist");
    if (!hold.releasedAt) {
      const updated = { ...hold, releasedAt: validDate(at, "hold release time") };
      this.holds.set(updated.id, updated);
      return cloneHold(updated);
    }
    return cloneHold(hold);
  }

  activeHolds(playerId: string, at = new Date()): readonly RetentionHold[] {
    return [...this.holds.values()]
      .filter((hold) => hold.playerId === playerId.trim())
      .filter((hold) => !hold.releasedAt && (!hold.expiresAt || hold.expiresAt > at))
      .map(cloneHold);
  }

  get(requestId: string): PrivacyRequest | undefined {
    const request = this.requests.get(requestId.trim());
    return request ? cloneRequest(request) : undefined;
  }

  overdue(at = new Date()): readonly PrivacyRequest[] {
    return [...this.requests.values()]
      .filter((request) => !["completed", "rejected"].includes(request.status) && request.dueAt < at)
      .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())
      .map(cloneRequest);
  }

  private transition(
    requestId: string,
    expectedVersion: number,
    allowed: readonly PrivacyRequestStatus[],
    status: PrivacyRequestStatus,
    at: Date,
    reason?: string,
  ): PrivacyRequest {
    const request = this.requireVersion(requestId, expectedVersion);
    if (!allowed.includes(request.status)) throw new IdentityConflictError(`cannot move privacy request from ${request.status} to ${status}`);
    return this.save({
      ...request,
      status,
      verifiedAt: status === "processing" && !request.verifiedAt ? validDate(at, "verification time") : request.verifiedAt,
      reason,
      version: request.version + 1,
    });
  }

  private requireVersion(requestId: string, expectedVersion: number): PrivacyRequest {
    const request = this.requests.get(requiredText(requestId, "request id", 128));
    if (!request) throw new IdentityValidationError("privacy request does not exist");
    if (request.version !== expectedVersion) throw new IdentityConflictError("privacy request version does not match");
    return request;
  }

  private save(request: PrivacyRequest): PrivacyRequest {
    this.requests.set(request.id, request);
    return cloneRequest(request);
  }
}

export function buildPortableData(
  profile: PlayerProfile,
  consentHistory: readonly ConsentRecord[],
  activity: Readonly<Record<string, readonly unknown[]>>,
  at = new Date(),
): PortablePlayerData {
  const base = {
    generatedAt: validDate(at, "export time").toISOString(),
    profile: serializeProfile(profile),
    consentHistory: consentHistory.map((record) => ({ ...record, recordedAt: new Date(record.recordedAt) })),
    activity: Object.fromEntries(Object.entries(activity).map(([key, values]) => [key, [...values]])),
  };
  const canonical = JSON.stringify(base, (_key, value) => value instanceof Date ? value.toISOString() : value);
  return { ...base, checksum: createHash("sha256").update(canonical).digest("hex") };
}

function serializeProfile(profile: PlayerProfile): PortablePlayerData["profile"] {
  return {
    ...profile,
    address: profile.address ? { ...profile.address } : undefined,
    createdAt: new Date(profile.createdAt),
    updatedAt: new Date(profile.updatedAt),
  };
}

function cloneRequest(request: PrivacyRequest): PrivacyRequest {
  return {
    ...request,
    submittedAt: new Date(request.submittedAt),
    dueAt: new Date(request.dueAt),
    verifiedAt: request.verifiedAt ? new Date(request.verifiedAt) : undefined,
    completedAt: request.completedAt ? new Date(request.completedAt) : undefined,
  };
}

function cloneHold(hold: RetentionHold): RetentionHold {
  return {
    ...hold,
    categories: [...hold.categories],
    beginsAt: new Date(hold.beginsAt),
    expiresAt: hold.expiresAt ? new Date(hold.expiresAt) : undefined,
    releasedAt: hold.releasedAt ? new Date(hold.releasedAt) : undefined,
  };
}

