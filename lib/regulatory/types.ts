export type RegulatoryCaseStatus =
  | "open"
  | "investigating"
  | "waiting"
  | "reported"
  | "closed"
  | "dismissed";
export type RegulatoryRisk = "low" | "medium" | "high" | "prohibited";

export interface JurisdictionPolicy {
  code: string;
  name: string;
  regulator: string;
  legalAge: number;
  currencies: readonly string[];
  allowedProducts: readonly string[];
  blockedProducts: readonly string[];
  depositMethods: readonly string[];
  maximumDailyDepositMinor?: bigint;
  maximumMonthlyDepositMinor?: bigint;
  maximumStakeMinor?: bigint;
  maximumWinMinor?: bigint;
  coolingOffHours: number;
  selfExclusionMinimumDays: number;
  identityVerificationRequired: boolean;
  sourceOfFundsThresholdMinor?: bigint;
  enhancedDueDiligenceThresholdMinor?: bigint;
  suspiciousActivityThresholdMinor?: bigint;
  taxBasisPoints: number;
  taxFreeWinMinor: bigint;
  dataRetentionDays: number;
  marketingConsentRequired: boolean;
  realityCheckMinutes?: number;
  effectiveFrom: string;
  effectiveTo?: string;
  version: number;
}

export interface PlayerRegulatoryProfile {
  playerId: string;
  country: string;
  jurisdiction: string;
  dateOfBirth?: string;
  citizenships: readonly string[];
  occupations: readonly string[];
  risk: RegulatoryRisk;
  pep: boolean;
  sanctionsMatch: boolean;
  adverseMedia: boolean;
  identityStatus: "missing" | "pending" | "verified" | "rejected" | "expired";
  sourceOfFundsStatus:
    | "not_required"
    | "required"
    | "pending"
    | "accepted"
    | "rejected";
  enhancedDueDiligenceStatus:
    | "not_required"
    | "required"
    | "pending"
    | "accepted"
    | "rejected";
  restrictions: readonly string[];
  reviewedAt?: string;
  nextReviewAt?: string;
  version: number;
}

export interface RegulatoryDecision {
  allowed: boolean;
  reasons: readonly string[];
  requirements: readonly string[];
  limits: {
    maximumDailyDepositMinor?: bigint;
    maximumMonthlyDepositMinor?: bigint;
    maximumStakeMinor?: bigint;
    maximumWinMinor?: bigint;
  };
  policyVersion: number;
}

export interface MonitoringTransaction {
  id: string;
  playerId: string;
  kind:
    | "deposit"
    | "withdrawal"
    | "wager"
    | "win"
    | "transfer_in"
    | "transfer_out"
    | "adjustment";
  currency: string;
  amountMinor: bigint;
  method?: string;
  counterparty?: string;
  country?: string;
  deviceId?: string;
  ipAddress?: string;
  occurredAt: string;
  sourceReference: string;
}

export interface MonitoringRule {
  id: string;
  name: string;
  enabled: boolean;
  kinds: readonly MonitoringTransaction["kind"][];
  windowMinutes: number;
  minimumCount?: number;
  minimumTotalMinor?: bigint;
  minimumSingleMinor?: bigint;
  distinctMethods?: number;
  distinctCounterparties?: number;
  countries?: readonly string[];
  score: number;
  severity: "info" | "low" | "medium" | "high" | "critical";
  reason: string;
  version: number;
}

export interface MonitoringAlert {
  id: string;
  ruleId: string;
  playerId: string;
  severity: MonitoringRule["severity"];
  score: number;
  reason: string;
  transactionIds: readonly string[];
  windowStartsAt: string;
  windowEndsAt: string;
  status: "open" | "acknowledged" | "escalated" | "closed" | "false_positive";
  assignedTo?: string;
  createdAt: string;
  closedAt?: string;
  version: number;
}

export interface RegulatoryCase {
  id: string;
  playerId: string;
  kind:
    | "aml"
    | "responsible_play"
    | "sanctions"
    | "complaint"
    | "licensing"
    | "data_protection";
  status: RegulatoryCaseStatus;
  priority: "low" | "normal" | "high" | "urgent";
  alertIds: readonly string[];
  ownerId?: string;
  subject: string;
  summary: string;
  openedAt: string;
  dueAt?: string;
  closedAt?: string;
  outcome?: string;
  notes: readonly CaseNote[];
  evidence: readonly CaseEvidence[];
  version: number;
}

export interface CaseNote {
  id: string;
  authorId: string;
  body: string;
  private: boolean;
  createdAt: string;
}

export interface CaseEvidence {
  id: string;
  kind:
    | "transaction"
    | "identity"
    | "communication"
    | "document"
    | "screening"
    | "system";
  reference: string;
  checksum: string;
  collectedBy: string;
  collectedAt: string;
}

export interface RegulatoryReport {
  id: string;
  jurisdiction: string;
  kind:
    | "suspicious_activity"
    | "large_transaction"
    | "player_funds"
    | "gaming_activity"
    | "self_exclusion"
    | "complaints";
  periodStartsAt: string;
  periodEndsAt: string;
  status:
    | "draft"
    | "validated"
    | "approved"
    | "submitted"
    | "accepted"
    | "rejected";
  caseIds: readonly string[];
  recordCount: number;
  totals: Readonly<Record<string, bigint>>;
  checksum: string;
  generatedAt: string;
  generatedBy: string;
  approvedBy?: string;
  submittedAt?: string;
  submissionReference?: string;
  rejectionReason?: string;
  version: number;
}

export interface RegulatoryRecord {
  type: string;
  reference: string;
  occurredAt: string;
  fields: Readonly<Record<string, string | number | boolean>>;
  amounts: Readonly<Record<string, bigint>>;
}

export class RegulatoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegulatoryValidationError";
  }
}

export class RegulatoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegulatoryConflictError";
  }
}

export function regulatoryText(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new RegulatoryValidationError(`${field} is required`);
  return value.trim();
}
export function regulatoryDate(value: string | Date, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new RegulatoryValidationError(`${field} is invalid`);
  return date;
}
export function regulatoryCurrency(value: string): string {
  const currency = regulatoryText(value, "currency").toUpperCase();
  if (!/^[A-Z][A-Z0-9]{2,7}$/.test(currency))
    throw new RegulatoryValidationError("currency is invalid");
  return currency;
}
