import { createHash } from "node:crypto";

import {
  RegulatoryConflictError,
  RegulatoryValidationError,
  regulatoryDate,
  regulatoryText,
} from "./types.ts";

export interface RetentionPolicy {
  id: string;
  jurisdiction: string;
  recordType: string;
  retainDays: number;
  archiveAfterDays?: number;
  action: "delete" | "anonymize" | "review";
  legalBasis: string;
  effectiveFrom: string;
  effectiveTo?: string;
  version: number;
}

export interface RetainedRecord {
  id: string;
  recordType: string;
  jurisdiction: string;
  playerId?: string;
  createdAt: string;
  lastUsedAt?: string;
  checksum: string;
  location: string;
  status: "active" | "archived" | "pending_disposition" | "disposed";
  disposedAt?: string;
  disposition?: RetentionPolicy["action"];
  version: number;
}

export interface LegalHold {
  id: string;
  name: string;
  reason: string;
  recordIds: readonly string[];
  playerIds: readonly string[];
  recordTypes: readonly string[];
  startsAt: string;
  endsAt?: string;
  releasedAt?: string;
  createdBy: string;
  version: number;
}

export interface DispositionCandidate {
  record: RetainedRecord;
  policy: RetentionPolicy;
  eligibleAt: string;
  held: boolean;
  holdIds: readonly string[];
}

export interface DispositionReceipt {
  id: string;
  recordId: string;
  policyId: string;
  action: RetentionPolicy["action"];
  checksumBefore: string;
  completedAt: string;
  completedBy: string;
}

export class RetentionService {
  readonly #policies = new Map<string, RetentionPolicy[]>();
  readonly #records = new Map<string, RetainedRecord>();
  readonly #holds = new Map<string, LegalHold>();
  readonly #receipts = new Map<string, DispositionReceipt>();

  addPolicy(input: Omit<RetentionPolicy, "version">): RetentionPolicy {
    const key = `${input.jurisdiction.trim().toUpperCase()}:${input.recordType.trim().toLowerCase()}`;
    const versions = this.#policies.get(key) ?? [];
    const policy = validatePolicy({
      ...input,
      version: (versions.at(-1)?.version ?? 0) + 1,
    });
    const previous = versions.at(-1);
    if (
      previous &&
      new Date(policy.effectiveFrom) <= new Date(previous.effectiveFrom)
    )
      throw new RegulatoryConflictError(
        "retention policy effective date must move forward",
      );
    versions.push(policy);
    this.#policies.set(key, versions);
    return { ...policy };
  }

  register(input: Omit<RetainedRecord, "status" | "version">): RetainedRecord {
    const id = regulatoryText(input.id, "retained record id");
    const existing = this.#records.get(id);
    const normalized: RetainedRecord = {
      ...input,
      id,
      recordType: regulatoryText(input.recordType, "record type").toLowerCase(),
      jurisdiction: regulatoryText(
        input.jurisdiction,
        "jurisdiction",
      ).toUpperCase(),
      playerId: input.playerId?.trim(),
      createdAt: regulatoryDate(
        input.createdAt,
        "record creation time",
      ).toISOString(),
      lastUsedAt: input.lastUsedAt
        ? regulatoryDate(input.lastUsedAt, "record use time").toISOString()
        : undefined,
      checksum: validateChecksum(input.checksum),
      location: regulatoryText(input.location, "record location"),
      status: "active",
      version: 1,
    };
    if (existing) {
      if (recordIdentity(existing) !== recordIdentity(normalized))
        throw new RegulatoryConflictError("retained record id is already used");
      return { ...existing };
    }
    this.#records.set(id, normalized);
    return { ...normalized };
  }

  touch(recordId: string, at: Date, expectedVersion: number): RetainedRecord {
    return this.#changeRecord(recordId, expectedVersion, (record) => {
      if (record.status === "disposed")
        throw new RegulatoryConflictError("disposed records cannot be touched");
      if (at < new Date(record.createdAt))
        throw new RegulatoryValidationError(
          "record use cannot predate creation",
        );
      return { ...record, lastUsedAt: at.toISOString() };
    });
  }

  archive(
    recordId: string,
    location: string,
    expectedVersion: number,
  ): RetainedRecord {
    return this.#changeRecord(recordId, expectedVersion, (record) => {
      if (record.status !== "active")
        throw new RegulatoryConflictError(
          "only active records can be archived",
        );
      return {
        ...record,
        status: "archived",
        location: regulatoryText(location, "archive location"),
      };
    });
  }

  createHold(input: Omit<LegalHold, "version" | "releasedAt">): LegalHold {
    const id = regulatoryText(input.id, "legal hold id");
    if (this.#holds.has(id))
      throw new RegulatoryConflictError("legal hold already exists");
    const startsAt = regulatoryDate(input.startsAt, "hold start");
    const endsAt = input.endsAt
      ? regulatoryDate(input.endsAt, "hold end")
      : undefined;
    if (endsAt && endsAt <= startsAt)
      throw new RegulatoryValidationError("legal hold end must follow start");
    const value: LegalHold = {
      ...input,
      id,
      name: regulatoryText(input.name, "hold name"),
      reason: regulatoryText(input.reason, "hold reason"),
      recordIds: unique(input.recordIds),
      playerIds: unique(input.playerIds),
      recordTypes: unique(input.recordTypes).map((item) => item.toLowerCase()),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt?.toISOString(),
      createdBy: regulatoryText(input.createdBy, "hold creator"),
      version: 1,
    };
    if (
      !value.recordIds.length &&
      !value.playerIds.length &&
      !value.recordTypes.length
    )
      throw new RegulatoryValidationError("legal hold must select records");
    this.#holds.set(id, value);
    return cloneHold(value);
  }

  releaseHold(
    id: string,
    actorId: string,
    expectedVersion: number,
    at = new Date(),
  ): LegalHold {
    const current = this.#holds.get(regulatoryText(id, "legal hold id"));
    if (!current)
      throw new RegulatoryValidationError("legal hold does not exist");
    if (current.version !== expectedVersion)
      throw new RegulatoryConflictError("legal hold version does not match");
    if (current.releasedAt)
      throw new RegulatoryConflictError("legal hold is already released");
    regulatoryText(actorId, "hold releaser");
    const changed = {
      ...current,
      releasedAt: at.toISOString(),
      version: current.version + 1,
    };
    this.#holds.set(changed.id, changed);
    return cloneHold(changed);
  }

  candidates(at = new Date()): readonly DispositionCandidate[] {
    const results: DispositionCandidate[] = [];
    for (const record of this.#records.values()) {
      if (record.status === "disposed") continue;
      const policy = this.#policy(record.jurisdiction, record.recordType, at);
      if (!policy) continue;
      const basis = new Date(record.lastUsedAt ?? record.createdAt);
      const eligibleAt = new Date(
        basis.getTime() + policy.retainDays * 86_400_000,
      );
      if (eligibleAt > at) continue;
      const holdIds = this.#activeHoldsFor(record, at).map((hold) => hold.id);
      results.push({
        record: { ...record },
        policy: { ...policy },
        eligibleAt: eligibleAt.toISOString(),
        held: holdIds.length > 0,
        holdIds,
      });
    }
    return results.sort(
      (left, right) =>
        left.eligibleAt.localeCompare(right.eligibleAt) ||
        left.record.id.localeCompare(right.record.id),
    );
  }

  markForDisposition(
    recordId: string,
    expectedVersion: number,
    at = new Date(),
  ): RetainedRecord {
    const candidate = this.candidates(at).find(
      (item) => item.record.id === recordId,
    );
    if (!candidate)
      throw new RegulatoryValidationError(
        "record is not eligible for disposition",
      );
    if (candidate.held)
      throw new RegulatoryConflictError("record is protected by a legal hold");
    return this.#changeRecord(recordId, expectedVersion, (record) => ({
      ...record,
      status: "pending_disposition",
    }));
  }

  completeDisposition(
    recordId: string,
    actorId: string,
    expectedVersion: number,
    at = new Date(),
  ): DispositionReceipt {
    const record = this.#records.get(regulatoryText(recordId, "record id"));
    if (!record)
      throw new RegulatoryValidationError("retained record does not exist");
    if (record.version !== expectedVersion)
      throw new RegulatoryConflictError(
        "retained record version does not match",
      );
    if (record.status !== "pending_disposition")
      throw new RegulatoryConflictError("record is not pending disposition");
    if (this.#activeHoldsFor(record, at).length)
      throw new RegulatoryConflictError("record is protected by a legal hold");
    const policy = this.#policy(record.jurisdiction, record.recordType, at);
    if (!policy)
      throw new RegulatoryValidationError("no retention policy applies");
    const completedBy = regulatoryText(actorId, "disposition actor");
    const fingerprint = createHash("sha256")
      .update(
        `${record.id}\u0000${policy.id}\u0000${record.checksum}\u0000${at.toISOString()}`,
      )
      .digest("hex");
    const receipt: DispositionReceipt = {
      id: `dispose_${fingerprint.slice(0, 24)}`,
      recordId: record.id,
      policyId: policy.id,
      action: policy.action,
      checksumBefore: record.checksum,
      completedAt: at.toISOString(),
      completedBy,
    };
    const changed: RetainedRecord = {
      ...record,
      status: "disposed",
      disposedAt: at.toISOString(),
      disposition: policy.action,
      location: policy.action === "delete" ? "deleted" : record.location,
      version: record.version + 1,
    };
    this.#records.set(changed.id, changed);
    this.#receipts.set(receipt.id, receipt);
    return { ...receipt };
  }

  records(
    filters: {
      playerId?: string;
      recordType?: string;
      status?: RetainedRecord["status"];
    } = {},
  ): readonly RetainedRecord[] {
    return [...this.#records.values()]
      .filter(
        (record) => !filters.playerId || record.playerId === filters.playerId,
      )
      .filter(
        (record) =>
          !filters.recordType ||
          record.recordType === filters.recordType.toLowerCase(),
      )
      .filter((record) => !filters.status || record.status === filters.status)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => ({ ...record }));
  }

  receipts(): readonly DispositionReceipt[] {
    return [...this.#receipts.values()]
      .sort((left, right) => left.completedAt.localeCompare(right.completedAt))
      .map((receipt) => ({ ...receipt }));
  }

  #policy(
    jurisdiction: string,
    recordType: string,
    at: Date,
  ): RetentionPolicy | undefined {
    const values =
      this.#policies.get(
        `${jurisdiction.toUpperCase()}:${recordType.toLowerCase()}`,
      ) ?? [];
    return [...values]
      .reverse()
      .find(
        (policy) =>
          new Date(policy.effectiveFrom) <= at &&
          (!policy.effectiveTo || new Date(policy.effectiveTo) > at),
      );
  }

  #activeHoldsFor(record: RetainedRecord, at: Date): LegalHold[] {
    return [...this.#holds.values()]
      .filter(
        (hold) =>
          !hold.releasedAt &&
          new Date(hold.startsAt) <= at &&
          (!hold.endsAt || new Date(hold.endsAt) > at),
      )
      .filter(
        (hold) =>
          hold.recordIds.includes(record.id) ||
          (record.playerId !== undefined &&
            hold.playerIds.includes(record.playerId)) ||
          hold.recordTypes.includes(record.recordType),
      );
  }

  #changeRecord(
    id: string,
    expectedVersion: number,
    change: (record: RetainedRecord) => RetainedRecord,
  ): RetainedRecord {
    const current = this.#records.get(regulatoryText(id, "record id"));
    if (!current)
      throw new RegulatoryValidationError("retained record does not exist");
    if (current.version !== expectedVersion)
      throw new RegulatoryConflictError(
        "retained record version does not match",
      );
    const changed = { ...change(current), version: current.version + 1 };
    this.#records.set(changed.id, changed);
    return { ...changed };
  }
}

function validatePolicy(value: RetentionPolicy): RetentionPolicy {
  if (!Number.isSafeInteger(value.retainDays) || value.retainDays < 1)
    throw new RegulatoryValidationError("retention days must be positive");
  if (
    value.archiveAfterDays !== undefined &&
    (!Number.isSafeInteger(value.archiveAfterDays) ||
      value.archiveAfterDays < 1 ||
      value.archiveAfterDays >= value.retainDays)
  )
    throw new RegulatoryValidationError(
      "archive days must be before retention expiry",
    );
  const effectiveFrom = regulatoryDate(
    value.effectiveFrom,
    "retention policy start",
  );
  const effectiveTo = value.effectiveTo
    ? regulatoryDate(value.effectiveTo, "retention policy end")
    : undefined;
  if (effectiveTo && effectiveTo <= effectiveFrom)
    throw new RegulatoryValidationError(
      "retention policy end must follow start",
    );
  return {
    ...value,
    id: regulatoryText(value.id, "retention policy id"),
    jurisdiction: regulatoryText(
      value.jurisdiction,
      "jurisdiction",
    ).toUpperCase(),
    recordType: regulatoryText(value.recordType, "record type").toLowerCase(),
    legalBasis: regulatoryText(value.legalBasis, "legal basis"),
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: effectiveTo?.toISOString(),
  };
}

function unique(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => regulatoryText(value, "selector"))),
  ].sort();
}
function validateChecksum(value: string): string {
  const checksum = regulatoryText(value, "checksum").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum))
    throw new RegulatoryValidationError("checksum must be SHA-256");
  return checksum;
}
function recordIdentity(value: RetainedRecord): string {
  return JSON.stringify({ ...value, version: undefined, status: undefined });
}
function cloneHold(value: LegalHold): LegalHold {
  return {
    ...value,
    recordIds: [...value.recordIds],
    playerIds: [...value.playerIds],
    recordTypes: [...value.recordTypes],
  };
}
