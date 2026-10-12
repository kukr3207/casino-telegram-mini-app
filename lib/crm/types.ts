export type PartnerStatus = "pending" | "active" | "suspended" | "terminated";
export type CommissionModel = "cpa" | "revenue_share" | "hybrid";
export type CommissionStatus = "pending" | "approved" | "held" | "paid" | "reversed";
export type VipCaseStatus = "open" | "in_progress" | "waiting_player" | "resolved" | "cancelled";

export interface AffiliatePartner {
  id: string;
  name: string;
  legalName: string;
  status: PartnerStatus;
  countries: readonly string[];
  blockedCountries: readonly string[];
  currencies: readonly string[];
  trackingDomains: readonly string[];
  paymentCurrency: string;
  taxIdentifier?: string;
  managerId?: string;
  createdAt: string;
  activatedAt?: string;
  terminatedAt?: string;
  version: number;
}

export interface AffiliateCampaign {
  id: string;
  partnerId: string;
  name: string;
  code: string;
  model: CommissionModel;
  startsAt: string;
  endsAt?: string;
  countries: readonly string[];
  channels: readonly string[];
  landingPage: string;
  cpaMinor?: bigint;
  revenueShareBasisPoints?: number;
  negativeCarryover: boolean;
  minimumQualifyingDepositMinor: bigint;
  minimumQualifyingWagerMinor: bigint;
  qualificationDays: number;
  enabled: boolean;
  version: number;
}

export interface AttributionTouch {
  id: string;
  playerId?: string;
  anonymousId: string;
  campaignId: string;
  partnerId: string;
  kind: "click" | "install" | "registration" | "deposit";
  channel: string;
  country?: string;
  referrer?: string;
  userAgent?: string;
  ipHash?: string;
  occurredAt: string;
  metadata: Readonly<Record<string, string>>;
}

export interface PlayerAttribution {
  playerId: string;
  partnerId: string;
  campaignId: string;
  firstTouchId: string;
  lastTouchId: string;
  attributedAt: string;
  expiresAt: string;
  locked: boolean;
  version: number;
}

export interface CommissionEvent {
  id: string;
  playerId: string;
  partnerId: string;
  campaignId: string;
  kind: "qualification" | "net_revenue" | "chargeback" | "adjustment";
  currency: string;
  amountMinor: bigint;
  sourceReference: string;
  occurredAt: string;
  metadata: Readonly<Record<string, string>>;
}

export interface CommissionItem {
  id: string;
  partnerId: string;
  campaignId: string;
  playerId: string;
  period: string;
  currency: string;
  model: CommissionModel;
  basisMinor: bigint;
  commissionMinor: bigint;
  status: CommissionStatus;
  eventIds: readonly string[];
  holdReason?: string;
  approvedAt?: string;
  paidAt?: string;
  paymentReference?: string;
  version: number;
}

export interface PartnerPayment {
  id: string;
  partnerId: string;
  period: string;
  currency: string;
  amountMinor: bigint;
  itemIds: readonly string[];
  status: "draft" | "approved" | "sent" | "confirmed" | "failed";
  requestedBy: string;
  approvedBy?: string;
  providerReference?: string;
  failureReason?: string;
  createdAt: string;
  completedAt?: string;
  version: number;
}

export interface VipProfile {
  playerId: string;
  tier: "none" | "silver" | "gold" | "platinum" | "invite_only";
  hostId?: string;
  preferredLanguage?: string;
  preferredChannel?: "telegram" | "email" | "phone" | "inbox";
  interests: readonly string[];
  restrictions: readonly string[];
  serviceNotes: string;
  reviewAt?: string;
  status: "prospect" | "active" | "paused" | "exited";
  version: number;
}

export interface VipCase {
  id: string;
  playerId: string;
  hostId?: string;
  category: "onboarding" | "service" | "retention" | "event" | "complaint" | "responsible_play";
  priority: "low" | "normal" | "high" | "urgent";
  status: VipCaseStatus;
  subject: string;
  description: string;
  dueAt?: string;
  createdAt: string;
  updatedAt: string;
  resolution?: string;
  interactions: readonly VipInteraction[];
  version: number;
}

export interface VipInteraction {
  id: string;
  kind: "note" | "call" | "message" | "meeting" | "gift";
  actorId: string;
  summary: string;
  occurredAt: string;
  private: boolean;
}

export interface JourneyDefinition {
  id: string;
  name: string;
  trigger: "registration" | "first_deposit" | "inactive" | "vip_change" | "manual";
  triggerDays?: number;
  segmentConditions: Readonly<Record<string, readonly string[]>>;
  steps: readonly JourneyStep[];
  enabled: boolean;
  version: number;
}

export interface JourneyStep {
  id: string;
  delayMinutes: number;
  channel: "telegram" | "email" | "inbox" | "task";
  templateId: string;
  stopOnEvents: readonly string[];
}

export interface JourneyEnrollment {
  id: string;
  journeyId: string;
  playerId: string;
  status: "active" | "completed" | "stopped" | "cancelled";
  enrolledAt: string;
  nextStepIndex: number;
  nextRunAt?: string;
  completedStepIds: readonly string[];
  stopReason?: string;
  version: number;
}

export class CrmValidationError extends Error {
  constructor(message: string) { super(message); this.name = "CrmValidationError"; }
}

export class CrmConflictError extends Error {
  constructor(message: string) { super(message); this.name = "CrmConflictError"; }
}

export function crmText(value: string, field: string): string { if (typeof value !== "string" || !value.trim()) throw new CrmValidationError(`${field} is required`); return value.trim(); }
export function crmDate(value: string | Date, field: string): Date { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new CrmValidationError(`${field} is invalid`); return date; }
export function crmCurrency(value: string): string { const currency = crmText(value, "currency").toUpperCase(); if (!/^[A-Z][A-Z0-9]{2,7}$/.test(currency)) throw new CrmValidationError("currency is invalid"); return currency; }
