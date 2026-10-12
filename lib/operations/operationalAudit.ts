import { createHash } from "node:crypto";

import {
  type AuditEvent,
  OperationsConflictError,
  OperationsValidationError,
  operationsDate,
  operationsText,
} from "./types.ts";

export interface AppendAuditEvent {
  id: string;
  actorId: string;
  actorType: AuditEvent["actorType"];
  action: string;
  resourceType: string;
  resourceId: string;
  occurredAt?: string | Date;
  correlationId?: string;
  causationId?: string;
  ipAddress?: string;
  userAgent?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Readonly<Record<string, string>>;
}

export interface AuditSearch {
  actorId?: string;
  actorType?: AuditEvent["actorType"];
  action?: string;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  from?: Date;
  to?: Date;
  afterSequence?: number;
  limit?: number;
}

export interface AuditVerification {
  valid: boolean;
  checked: number;
  firstSequence?: number;
  lastSequence?: number;
  brokenAt?: number;
  reason?: string;
}

const genesisHash = "0".repeat(64);

export class OperationalAuditLog {
  readonly #events: AuditEvent[] = [];
  readonly #ids = new Map<string, AuditEvent>();

  append(input: AppendAuditEvent): AuditEvent {
    const normalized = normalizeInput(input);
    const existing = this.#ids.get(normalized.id);
    if (existing) {
      if (auditIdentity(existing) !== inputIdentity(normalized))
        throw new OperationsConflictError(
          "audit event id is already used for different data",
        );
      return cloneEvent(existing);
    }
    const sequence = this.#events.length + 1;
    const previousHash = this.#events.at(-1)?.hash ?? genesisHash;
    const unsigned = {
      sequence,
      ...normalized,
      previousHash,
    };
    const event: AuditEvent = {
      ...unsigned,
      hash: hashEvent(unsigned),
    };
    this.#events.push(event);
    this.#ids.set(event.id, event);
    return cloneEvent(event);
  }

  appendMany(inputs: readonly AppendAuditEvent[]): readonly AuditEvent[] {
    const normalized = inputs.map(normalizeInput);
    const seen = new Map<string, string>();
    for (const value of normalized) {
      const identity = inputIdentity(value);
      const inBatch = seen.get(value.id);
      if (inBatch && inBatch !== identity)
        throw new OperationsConflictError(
          "audit batch reuses an id with different data",
        );
      seen.set(value.id, identity);
      const existing = this.#ids.get(value.id);
      if (existing && auditIdentity(existing) !== identity)
        throw new OperationsConflictError(
          "audit event id is already used for different data",
        );
    }
    return normalized.map((input) => this.append(input));
  }

  get(id: string): AuditEvent | undefined {
    const value = this.#ids.get(id.trim());
    return value ? cloneEvent(value) : undefined;
  }

  at(sequence: number): AuditEvent | undefined {
    if (!Number.isSafeInteger(sequence) || sequence < 1) return undefined;
    const value = this.#events[sequence - 1];
    return value ? cloneEvent(value) : undefined;
  }

  search(filters: AuditSearch = {}): readonly AuditEvent[] {
    const limit = filters.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
      throw new OperationsValidationError(
        "audit search limit must be between 1 and 10000",
      );
    return this.#events
      .filter((event) => !filters.actorId || event.actorId === filters.actorId)
      .filter(
        (event) => !filters.actorType || event.actorType === filters.actorType,
      )
      .filter((event) => !filters.action || event.action === filters.action)
      .filter(
        (event) =>
          !filters.resourceType || event.resourceType === filters.resourceType,
      )
      .filter(
        (event) =>
          !filters.resourceId || event.resourceId === filters.resourceId,
      )
      .filter(
        (event) =>
          !filters.correlationId ||
          event.correlationId === filters.correlationId,
      )
      .filter(
        (event) => !filters.from || new Date(event.occurredAt) >= filters.from,
      )
      .filter((event) => !filters.to || new Date(event.occurredAt) < filters.to)
      .filter(
        (event) =>
          !filters.afterSequence || event.sequence > filters.afterSequence,
      )
      .slice(0, limit)
      .map(cloneEvent);
  }

  resourceHistory(
    resourceType: string,
    resourceId: string,
  ): readonly AuditEvent[] {
    return this.search({
      resourceType: operationsText(resourceType, "resource type"),
      resourceId: operationsText(resourceId, "resource id"),
      limit: 10_000,
    });
  }

  correlation(correlationId: string): readonly AuditEvent[] {
    return this.search({
      correlationId: operationsText(correlationId, "correlation id"),
      limit: 10_000,
    });
  }

  verify(
    fromSequence = 1,
    toSequence = this.#events.length,
  ): AuditVerification {
    if (!Number.isSafeInteger(fromSequence) || fromSequence < 1)
      throw new OperationsValidationError(
        "verification start sequence is invalid",
      );
    if (!Number.isSafeInteger(toSequence) || toSequence < fromSequence)
      throw new OperationsValidationError(
        "verification end sequence is invalid",
      );
    const slice = this.#events.slice(fromSequence - 1, toSequence);
    let previousHash =
      fromSequence === 1 ? genesisHash : this.#events[fromSequence - 2]?.hash;
    if (!previousHash)
      return {
        valid: false,
        checked: 0,
        brokenAt: fromSequence,
        reason: "previous event is missing",
      };
    for (const event of slice) {
      if (event.previousHash !== previousHash)
        return {
          valid: false,
          checked: event.sequence - fromSequence,
          firstSequence: fromSequence,
          lastSequence: event.sequence - 1,
          brokenAt: event.sequence,
          reason: "previous hash does not match",
        };
      const { hash, ...unsigned } = event;
      if (hash !== hashEvent(unsigned))
        return {
          valid: false,
          checked: event.sequence - fromSequence,
          firstSequence: fromSequence,
          lastSequence: event.sequence - 1,
          brokenAt: event.sequence,
          reason: "event hash does not match",
        };
      previousHash = hash;
    }
    return {
      valid: true,
      checked: slice.length,
      firstSequence: slice[0]?.sequence,
      lastSequence: slice.at(-1)?.sequence,
    };
  }

  exportJsonLines(filters: AuditSearch = {}): string {
    return this.search({ ...filters, limit: filters.limit ?? 10_000 })
      .map((event) => JSON.stringify(event))
      .join("\n");
  }

  get size(): number {
    return this.#events.length;
  }
}

function normalizeInput(
  input: AppendAuditEvent,
): Omit<AuditEvent, "sequence" | "previousHash" | "hash"> {
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.metadata ?? {}))
    metadata[operationsText(key, "metadata key")] = operationsText(
      value,
      "metadata value",
    );
  return {
    id: operationsText(input.id, "audit event id"),
    actorId: operationsText(input.actorId, "actor id"),
    actorType: input.actorType,
    action: operationsText(input.action, "audit action"),
    resourceType: operationsText(input.resourceType, "resource type"),
    resourceId: operationsText(input.resourceId, "resource id"),
    occurredAt: operationsDate(
      input.occurredAt ?? new Date(),
      "audit event time",
    ).toISOString(),
    correlationId: input.correlationId?.trim(),
    causationId: input.causationId?.trim(),
    ipAddress: input.ipAddress?.trim(),
    userAgent: input.userAgent?.trim(),
    before: cloneJson(input.before),
    after: cloneJson(input.after),
    metadata,
  };
}

function hashEvent(value: Omit<AuditEvent, "hash">): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  try {
    return structuredClone(value);
  } catch {
    throw new OperationsValidationError("audit snapshots must be cloneable");
  }
}

function inputIdentity(
  value: Omit<AuditEvent, "sequence" | "previousHash" | "hash">,
): string {
  return stableStringify(value);
}
function auditIdentity(value: AuditEvent): string {
  const {
    sequence: _sequence,
    previousHash: _previousHash,
    hash: _hash,
    ...input
  } = value;
  return inputIdentity(input);
}
function cloneEvent(value: AuditEvent): AuditEvent {
  return {
    ...value,
    before: cloneJson(value.before),
    after: cloneJson(value.after),
    metadata: { ...value.metadata },
  };
}
