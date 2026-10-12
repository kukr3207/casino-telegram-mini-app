import { createHash } from "node:crypto";

export interface AuditEvent {
  sequence: number;
  id: string;
  actorId: string;
  actorType: "player" | "operator" | "system";
  action: string;
  subjectType: string;
  subjectId: string;
  occurredAt: string;
  details: Readonly<Record<string, string | number | boolean | null>>;
  previousHash: string;
  hash: string;
}

function canonical(event: Omit<AuditEvent, "hash">): string {
  return JSON.stringify({
    ...event,
    details: Object.fromEntries(Object.entries(event.details).sort(([left], [right]) => left.localeCompare(right))),
  });
}

export class AuditLog {
  readonly #events: AuditEvent[] = [];
  readonly #ids = new Map<string, AuditEvent>();

  append(input: Omit<AuditEvent, "sequence" | "previousHash" | "hash">): AuditEvent {
    if (!input.id.trim() || !input.actorId.trim() || !input.action.trim() || !input.subjectType.trim() || !input.subjectId.trim()) {
      throw new RangeError("audit event fields cannot be blank");
    }
    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new RangeError("audit event time is invalid");
    if (this.#events.length && occurredAt < new Date(this.#events.at(-1)!.occurredAt)) throw new RangeError("audit time cannot move backward");
    const existing = this.#ids.get(input.id);
    if (existing) {
      const comparable = { ...existing };
      delete (comparable as Partial<AuditEvent>).sequence;
      delete (comparable as Partial<AuditEvent>).previousHash;
      delete (comparable as Partial<AuditEvent>).hash;
      if (JSON.stringify(comparable) === JSON.stringify({ ...input, occurredAt: occurredAt.toISOString() })) return existing;
      throw new Error("audit event id already exists");
    }
    const unsigned = {
      ...input,
      occurredAt: occurredAt.toISOString(),
      sequence: this.#events.length + 1,
      previousHash: this.#events.at(-1)?.hash ?? "0".repeat(64),
    };
    const event = { ...unsigned, hash: createHash("sha256").update(canonical(unsigned)).digest("hex") };
    this.#events.push(event);
    this.#ids.set(event.id, event);
    return event;
  }

  query(filter: {
    actorId?: string;
    action?: string;
    subjectType?: string;
    subjectId?: string;
    afterSequence?: number;
    limit?: number;
  } = {}): readonly AuditEvent[] {
    const limit = filter.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new RangeError("audit query limit must be from 1 to 1000");
    return this.#events
      .filter((event) => !filter.actorId || event.actorId === filter.actorId)
      .filter((event) => !filter.action || event.action === filter.action)
      .filter((event) => !filter.subjectType || event.subjectType === filter.subjectType)
      .filter((event) => !filter.subjectId || event.subjectId === filter.subjectId)
      .filter((event) => !filter.afterSequence || event.sequence > filter.afterSequence)
      .slice(0, limit);
  }

  verify(): boolean {
    let previous = "0".repeat(64);
    for (const event of this.#events) {
      const { hash, ...unsigned } = event;
      if (event.previousHash !== previous) return false;
      if (createHash("sha256").update(canonical(unsigned)).digest("hex") !== hash) return false;
      previous = hash;
    }
    return true;
  }
}
