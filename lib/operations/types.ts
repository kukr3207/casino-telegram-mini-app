export type IncidentSeverity = "sev1" | "sev2" | "sev3" | "sev4";
export type IncidentStatus =
  | "declared"
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved"
  | "closed";

export interface OperationalIncident {
  id: string;
  title: string;
  summary: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  commanderId: string;
  serviceIds: readonly string[];
  channel?: string;
  declaredAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  updates: readonly IncidentUpdate[];
  actionItems: readonly IncidentAction[];
  version: number;
}

export interface IncidentUpdate {
  id: string;
  status: IncidentStatus;
  message: string;
  authorId: string;
  customerVisible: boolean;
  createdAt: string;
}

export interface IncidentAction {
  id: string;
  title: string;
  ownerId: string;
  dueAt?: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  completedAt?: string;
  createdAt: string;
}

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  defaultVariant: string;
  variants: Readonly<Record<string, unknown>>;
  rules: readonly FlagRule[];
  tags: readonly string[];
  expiresAt?: string;
  ownerId: string;
  version: number;
}

export interface FlagRule {
  id: string;
  priority: number;
  enabled: boolean;
  conditions: readonly FlagCondition[];
  allocation: Readonly<Record<string, number>>;
}

export interface FlagCondition {
  attribute: string;
  operator:
    | "equals"
    | "not_equals"
    | "in"
    | "not_in"
    | "contains"
    | "starts_with"
    | "ends_with"
    | "greater_than"
    | "less_than"
    | "matches";
  value: unknown;
}

export interface FlagContext {
  subjectId: string;
  attributes: Readonly<Record<string, unknown>>;
}

export interface FlagEvaluation {
  key: string;
  variant: string;
  value: unknown;
  reason: "disabled" | "default" | "rule" | "expired";
  ruleId?: string;
  version: number;
}

export interface DurableJob<T = unknown> {
  id: string;
  type: string;
  payload: T;
  queue: string;
  priority: number;
  status:
    | "scheduled"
    | "ready"
    | "running"
    | "succeeded"
    | "failed"
    | "dead_letter"
    | "cancelled";
  scheduledAt: string;
  attempts: number;
  maximumAttempts: number;
  timeoutSeconds: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  result?: unknown;
  error?: string;
  completedAt?: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RetryPolicy {
  initialDelaySeconds: number;
  maximumDelaySeconds: number;
  multiplier: number;
  jitter: number;
}

export interface AuditEvent {
  sequence: number;
  id: string;
  actorId: string;
  actorType: "player" | "operator" | "service" | "system";
  action: string;
  resourceType: string;
  resourceId: string;
  occurredAt: string;
  correlationId?: string;
  causationId?: string;
  ipAddress?: string;
  userAgent?: string;
  before?: unknown;
  after?: unknown;
  metadata: Readonly<Record<string, string>>;
  previousHash: string;
  hash: string;
}

export interface WebhookSubscription {
  id: string;
  ownerId: string;
  url: string;
  events: readonly string[];
  secret: string;
  enabled: boolean;
  description?: string;
  failureCount: number;
  disabledAt?: string;
  createdAt: string;
  version: number;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  body: string;
  signature: string;
  status:
    | "pending"
    | "delivering"
    | "delivered"
    | "retrying"
    | "failed"
    | "cancelled";
  attempts: number;
  nextAttemptAt: string;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  deliveredAt?: string;
  createdAt: string;
  version: number;
}

export class OperationsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationsValidationError";
  }
}

export class OperationsConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationsConflictError";
  }
}

export function operationsText(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new OperationsValidationError(`${field} is required`);
  return value.trim();
}

export function operationsDate(value: string | Date, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new OperationsValidationError(`${field} is invalid`);
  return date;
}
