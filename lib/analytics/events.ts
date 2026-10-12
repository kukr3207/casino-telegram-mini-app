import { createHash, randomUUID } from "node:crypto";

export interface AnalyticsEvent {
  id: string;
  name: string;
  playerId?: string;
  sessionId?: string;
  occurredAt: Date;
  receivedAt: Date;
  properties: Readonly<Record<string, string | number | boolean | null>>;
  context: Readonly<Record<string, string>>;
  schemaVersion: number;
}

export interface EventSchema {
  name: string;
  version: number;
  requiredProperties: Readonly<Record<string, "string" | "number" | "boolean">>;
  optionalProperties?: Readonly<Record<string, "string" | "number" | "boolean">>;
  allowAdditionalProperties: boolean;
}

export class AnalyticsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsValidationError";
  }
}

export class AnalyticsEventStore {
  private readonly events = new Map<string, AnalyticsEvent>();
  private readonly fingerprints = new Map<string, string>();
  private readonly schemas = new Map<string, EventSchema>();

  registerSchema(schema: EventSchema): EventSchema {
    const normalized = normalizeSchema(schema);
    const key = schemaKey(normalized.name, normalized.version);
    const existing = this.schemas.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
      throw new AnalyticsValidationError("event schema version already has another definition");
    }
    this.schemas.set(key, normalized);
    return cloneSchema(normalized);
  }

  append(input: Omit<AnalyticsEvent, "id" | "receivedAt"> & { id?: string; receivedAt?: Date }): AnalyticsEvent {
    const normalized = normalizeEvent(input);
    const schema = this.schemas.get(schemaKey(normalized.name, normalized.schemaVersion));
    if (!schema) throw new AnalyticsValidationError("event schema is not registered");
    validateProperties(normalized.properties, schema);
    const fingerprint = eventFingerprint(normalized);
    const existingId = this.fingerprints.get(fingerprint);
    if (existingId) return cloneEvent(this.events.get(existingId)!);
    const id = input.id ? required(input.id, "event id") : randomUUID();
    if (this.events.has(id)) throw new AnalyticsValidationError("event id already exists with other content");
    const event: AnalyticsEvent = { ...normalized, id };
    this.events.set(event.id, event);
    this.fingerprints.set(fingerprint, event.id);
    return cloneEvent(event);
  }

  appendBatch(inputs: readonly (Omit<AnalyticsEvent, "id" | "receivedAt"> & { id?: string; receivedAt?: Date })[]): readonly AnalyticsEvent[] {
    const staged = inputs.map((input) => {
      const normalized = normalizeEvent(input);
      const schema = this.schemas.get(schemaKey(normalized.name, normalized.schemaVersion));
      if (!schema) throw new AnalyticsValidationError(`event schema is not registered: ${normalized.name}`);
      validateProperties(normalized.properties, schema);
      return { input, normalized, fingerprint: eventFingerprint(normalized) };
    });
    const batchFingerprints = new Set<string>();
    for (const item of staged) {
      if (batchFingerprints.has(item.fingerprint)) throw new AnalyticsValidationError("analytics batch contains a duplicate event");
      batchFingerprints.add(item.fingerprint);
    }
    return staged.map((item) => this.append(item.input));
  }

  query(options: {
    name?: string;
    playerId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  } = {}): readonly AnalyticsEvent[] {
    const limit = options.limit ?? 1_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new AnalyticsValidationError("event query limit is invalid");
    return [...this.events.values()]
      .filter((event) => !options.name || event.name === options.name)
      .filter((event) => !options.playerId || event.playerId === options.playerId)
      .filter((event) => !options.from || event.occurredAt >= options.from)
      .filter((event) => !options.to || event.occurredAt < options.to)
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(cloneEvent);
  }
}

function normalizeSchema(schema: EventSchema): EventSchema {
  if (!Number.isInteger(schema.version) || schema.version < 1) throw new AnalyticsValidationError("schema version must be positive");
  return {
    name: required(schema.name, "schema name"),
    version: schema.version,
    requiredProperties: { ...schema.requiredProperties },
    optionalProperties: schema.optionalProperties ? { ...schema.optionalProperties } : undefined,
    allowAdditionalProperties: schema.allowAdditionalProperties,
  };
}

function normalizeEvent(input: Omit<AnalyticsEvent, "id" | "receivedAt"> & { id?: string; receivedAt?: Date }): Omit<AnalyticsEvent, "id"> {
  const occurredAt = validDate(input.occurredAt, "event time");
  const receivedAt = validDate(input.receivedAt ?? new Date(), "receipt time");
  if (occurredAt.getTime() > receivedAt.getTime() + 5 * 60 * 1_000) {
    throw new AnalyticsValidationError("event occurs too far in the future");
  }
  if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
    throw new AnalyticsValidationError("event schema version must be positive");
  }
  return {
    name: required(input.name, "event name"),
    playerId: input.playerId?.trim() || undefined,
    sessionId: input.sessionId?.trim() || undefined,
    occurredAt,
    receivedAt,
    properties: { ...input.properties },
    context: { ...input.context },
    schemaVersion: input.schemaVersion,
  };
}

function validateProperties(properties: AnalyticsEvent["properties"], schema: EventSchema): void {
  const expected = { ...schema.requiredProperties, ...(schema.optionalProperties ?? {}) };
  for (const [name, type] of Object.entries(schema.requiredProperties)) {
    if (!(name in properties)) throw new AnalyticsValidationError(`missing required event property: ${name}`);
    if (typeof properties[name] !== type) throw new AnalyticsValidationError(`event property ${name} must be ${type}`);
  }
  for (const [name, value] of Object.entries(properties)) {
    if (value === null) continue;
    const type = expected[name];
    if (!type && !schema.allowAdditionalProperties) throw new AnalyticsValidationError(`unexpected event property: ${name}`);
    if (type && typeof value !== type) throw new AnalyticsValidationError(`event property ${name} must be ${type}`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new AnalyticsValidationError(`event property ${name} is not finite`);
  }
}

function eventFingerprint(event: Omit<AnalyticsEvent, "id">): string {
  return createHash("sha256").update(JSON.stringify({
    name: event.name,
    playerId: event.playerId,
    sessionId: event.sessionId,
    occurredAt: event.occurredAt.toISOString(),
    properties: Object.entries(event.properties).sort(([left], [right]) => left.localeCompare(right)),
    schemaVersion: event.schemaVersion,
  })).digest("hex");
}

function schemaKey(name: string, version: number): string {
  return `${name}:${version}`;
}

function required(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AnalyticsValidationError(`${field} is required`);
  return value.trim();
}

function validDate(value: Date, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AnalyticsValidationError(`${field} is invalid`);
  return date;
}

function cloneSchema(value: EventSchema): EventSchema {
  return {
    ...value,
    requiredProperties: { ...value.requiredProperties },
    optionalProperties: value.optionalProperties ? { ...value.optionalProperties } : undefined,
  };
}

function cloneEvent(value: AnalyticsEvent): AnalyticsEvent {
  return {
    ...value,
    occurredAt: new Date(value.occurredAt),
    receivedAt: new Date(value.receivedAt),
    properties: { ...value.properties },
    context: { ...value.context },
  };
}

