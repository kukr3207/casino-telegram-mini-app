import { randomUUID } from "node:crypto";
import { IdentityConflictError, IdentityValidationError, requiredText, validDate } from "./profiles.ts";

export type ConsentPurpose = "terms" | "privacy" | "age_confirmation" | "marketing" | "personalization" | "analytics";

export interface ConsentRecord {
  id: string;
  playerId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  policyVersion: string;
  recordedAt: Date;
  source: "telegram" | "web" | "operator" | "migration";
  ipAddress?: string;
  userAgent?: string;
  supersedes?: string;
}

export interface RecordConsent {
  playerId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  policyVersion: string;
  recordedAt?: Date;
  source: ConsentRecord["source"];
  ipAddress?: string;
  userAgent?: string;
}

const REQUIRED_PURPOSES = new Set<ConsentPurpose>(["terms", "privacy", "age_confirmation"]);

export class ConsentLedger {
  private readonly records: ConsentRecord[] = [];

  record(input: RecordConsent): ConsentRecord {
    const normalized = normalizeInput(input);
    const previous = this.current(normalized.playerId, normalized.purpose);
    if (
      previous
      && previous.granted === normalized.granted
      && previous.policyVersion === normalized.policyVersion
    ) {
      return cloneConsent(previous);
    }
    if (previous && normalized.recordedAt < previous.recordedAt) {
      throw new IdentityConflictError("consent cannot be recorded before the current decision");
    }
    if (REQUIRED_PURPOSES.has(normalized.purpose) && !normalized.granted && !previous?.granted) {
      throw new IdentityValidationError("required consent was never granted");
    }
    const record: ConsentRecord = {
      id: randomUUID(),
      ...normalized,
      supersedes: previous?.id,
    };
    this.records.push(record);
    return cloneConsent(record);
  }

  current(playerId: string, purpose: ConsentPurpose): ConsentRecord | undefined {
    const normalizedPlayerId = playerId.trim();
    const record = [...this.records].reverse().find(
      (item) => item.playerId === normalizedPlayerId && item.purpose === purpose,
    );
    return record ? cloneConsent(record) : undefined;
  }

  hasCurrentConsent(playerId: string, purpose: ConsentPurpose, policyVersion?: string): boolean {
    const current = this.current(playerId, purpose);
    return Boolean(current?.granted && (!policyVersion || current.policyVersion === policyVersion));
  }

  requireGameplayConsent(playerId: string, versions: Readonly<Partial<Record<ConsentPurpose, string>>> = {}): void {
    const missing = [...REQUIRED_PURPOSES].filter(
      (purpose) => !this.hasCurrentConsent(playerId, purpose, versions[purpose]),
    );
    if (missing.length > 0) throw new IdentityValidationError(`missing required consent: ${missing.join(", ")}`);
  }

  history(playerId: string): readonly ConsentRecord[] {
    return this.records
      .filter((record) => record.playerId === playerId.trim())
      .sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime())
      .map(cloneConsent);
  }
}

function normalizeInput(input: RecordConsent): Omit<ConsentRecord, "id" | "supersedes"> {
  const allowed: ConsentPurpose[] = ["terms", "privacy", "age_confirmation", "marketing", "personalization", "analytics"];
  if (!allowed.includes(input.purpose)) throw new IdentityValidationError("consent purpose is invalid");
  const sources: ConsentRecord["source"][] = ["telegram", "web", "operator", "migration"];
  if (!sources.includes(input.source)) throw new IdentityValidationError("consent source is invalid");
  return {
    playerId: requiredText(input.playerId, "player id", 128),
    purpose: input.purpose,
    granted: input.granted,
    policyVersion: requiredText(input.policyVersion, "policy version", 64),
    recordedAt: input.recordedAt ? validDate(input.recordedAt, "consent time") : new Date(),
    source: input.source,
    ipAddress: input.ipAddress?.trim() || undefined,
    userAgent: input.userAgent?.trim().slice(0, 500) || undefined,
  };
}

function cloneConsent(record: ConsentRecord): ConsentRecord {
  return { ...record, recordedAt: new Date(record.recordedAt) };
}

