export type GameLifecycle = "draft" | "certification" | "scheduled" | "live" | "suspended" | "retired";
export type ReleaseStatus = "draft" | "approved" | "scheduled" | "deploying" | "completed" | "failed" | "rolled_back";
export type FlagValue = string | number | boolean;

export interface GameDefinition {
  id: string;
  slug: string;
  name: string;
  provider: string;
  category: "slots" | "table" | "live_dealer" | "dice" | "instant" | "sportsbook" | "poker";
  lifecycle: GameLifecycle;
  currencies: readonly string[];
  countries: readonly string[];
  blockedCountries: readonly string[];
  devices: readonly ("mobile" | "desktop" | "tablet")[];
  tags: readonly string[];
  themes: readonly string[];
  minimumStakeMinor: bigint;
  maximumStakeMinor: bigint;
  theoreticalReturnBasisPoints: number;
  volatility: "low" | "medium" | "high" | "extreme";
  jackpotEligible: boolean;
  demoAvailable: boolean;
  launchedAt?: string;
  retiredAt?: string;
  metadata: Readonly<Record<string, string>>;
  version: number;
}

export interface GameCertification {
  id: string;
  gameId: string;
  jurisdiction: string;
  laboratory: string;
  certificateNumber: string;
  issuedAt: string;
  expiresAt?: string;
  status: "valid" | "expired" | "revoked";
  documents: readonly string[];
}

export interface GameTranslation {
  gameId: string;
  locale: string;
  name: string;
  description: string;
  instructions: readonly string[];
  responsiblePlayNotice?: string;
  version: number;
}

export interface RuntimeFlag {
  key: string;
  description: string;
  valueType: "boolean" | "number" | "string";
  defaultValue: FlagValue;
  environments: Readonly<Record<string, FlagValue>>;
  rules: readonly TargetingRule[];
  owner: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TargetingRule {
  id: string;
  priority: number;
  enabled: boolean;
  conditions: readonly TargetingCondition[];
  value: FlagValue;
  rolloutBasisPoints?: number;
}

export interface TargetingCondition {
  attribute: string;
  operator: "equals" | "not_equals" | "in" | "not_in" | "starts_with" | "ends_with" | "greater_than" | "less_than";
  values: readonly string[];
}

export interface EvaluationContext {
  subjectId: string;
  environment: string;
  attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface FlagEvaluation {
  key: string;
  value: FlagValue;
  source: "default" | "environment" | "rule";
  ruleId?: string;
  version: number;
}

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  status: "draft" | "running" | "paused" | "completed" | "cancelled";
  startsAt: string;
  endsAt: string;
  allocationBasisPoints: number;
  eligibility: readonly TargetingCondition[];
  variants: readonly ExperimentVariant[];
  metrics: readonly ExperimentMetric[];
  exclusionGroup?: string;
  version: number;
}

export interface ExperimentVariant {
  id: string;
  name: string;
  weightBasisPoints: number;
  configuration: Readonly<Record<string, FlagValue>>;
}

export interface ExperimentMetric {
  key: string;
  direction: "increase" | "decrease";
  kind: "conversion" | "count" | "sum" | "average";
  minimumSampleSize: number;
}

export interface ExperimentAssignment {
  experimentId: string;
  subjectId: string;
  variantId: string;
  assignedAt: string;
  fingerprint: string;
}

export interface ExperimentObservation {
  id: string;
  experimentId: string;
  subjectId: string;
  metricKey: string;
  value: number;
  occurredAt: string;
}

export interface ReleasePlan {
  id: string;
  name: string;
  environment: string;
  status: ReleaseStatus;
  changes: readonly ReleaseChange[];
  checks: readonly ReleaseCheck[];
  requestedBy: string;
  approvedBy?: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  rollbackOf?: string;
  failureReason?: string;
  version: number;
}

export interface ReleaseChange {
  kind: "game" | "flag" | "experiment" | "content";
  resourceId: string;
  fromVersion?: number;
  toVersion: number;
}

export interface ReleaseCheck {
  id: string;
  name: string;
  required: boolean;
  status: "pending" | "passed" | "failed" | "waived";
  details?: string;
  completedAt?: string;
  completedBy?: string;
}

export interface MaintenanceWindow {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  services: readonly string[];
  countries?: readonly string[];
  messageByLocale: Readonly<Record<string, string>>;
  status: "scheduled" | "active" | "completed" | "cancelled";
  createdBy: string;
  version: number;
}

export class LiveOpsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveOpsValidationError";
  }
}

export class LiveOpsConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveOpsConflictError";
  }
}

export function liveOpsText(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new LiveOpsValidationError(`${field} is required`);
  return value.trim();
}

export function liveOpsDate(value: string | Date, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new LiveOpsValidationError(`${field} is invalid`);
  return date;
}
