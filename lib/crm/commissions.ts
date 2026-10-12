import { randomUUID } from "node:crypto";

import type { PartnerRegistry } from "./partners.ts";
import {
  type CommissionEvent,
  type CommissionItem,
  type PartnerPayment,
  CrmConflictError,
  CrmValidationError,
  crmCurrency,
  crmDate,
  crmText,
} from "./types.ts";

export class CommissionService {
  readonly #events = new Map<string, CommissionEvent>();
  readonly #items = new Map<string, CommissionItem>();
  readonly #payments = new Map<string, PartnerPayment>();
  readonly #sourceReferences = new Map<string, string>();
  readonly partners: PartnerRegistry;

  constructor(partners: PartnerRegistry) {
    this.partners = partners;
  }

  record(value: CommissionEvent): CommissionEvent {
    const event = validateEvent(value);
    const campaign = this.partners.campaign(event.campaignId);
    if (!campaign || campaign.partnerId !== event.partnerId) throw new CrmValidationError("commission campaign does not belong to partner");
    const sourceKey = `${event.partnerId}:${event.sourceReference}`;
    const existingId = this.#sourceReferences.get(sourceKey);
    if (existingId) {
      const existing = this.#events.get(existingId)!;
      if (eventFingerprint(existing) !== eventFingerprint(event)) throw new CrmConflictError("commission source reference contains different data");
      return cloneEvent(existing);
    }
    this.#events.set(event.id, event); this.#sourceReferences.set(sourceKey, event.id); return cloneEvent(event);
  }

  calculate(partnerId: string, campaignId: string, playerId: string, period: string): CommissionItem {
    const campaign = this.partners.campaign(campaignId); if (!campaign || campaign.partnerId !== partnerId) throw new CrmValidationError("campaign does not belong to partner");
    const id = `${partnerId}:${campaignId}:${playerId}:${period}`; const existing = this.#items.get(id); if (existing) return cloneItem(existing);
    const events = [...this.#events.values()].filter((event) => event.partnerId === partnerId && event.campaignId === campaignId && event.playerId === playerId && event.occurredAt.slice(0, 7) === period);
    const qualified = events.some((event) => event.kind === "qualification");
    const netRevenue = events.filter((event) => ['net_revenue', 'chargeback', 'adjustment'].includes(event.kind)).reduce((sum, event) => sum + event.amountMinor, 0n);
    let commissionMinor = 0n; let basisMinor = netRevenue;
    if ((campaign.model === "cpa" || campaign.model === "hybrid") && qualified) commissionMinor += campaign.cpaMinor ?? 0n;
    if (campaign.model === "revenue_share" || campaign.model === "hybrid") { const shareBase = campaign.negativeCarryover ? netRevenue : max(netRevenue, 0n); commissionMinor += (shareBase * BigInt(campaign.revenueShareBasisPoints ?? 0)) / 10_000n; }
    const item: CommissionItem = { id, partnerId, campaignId, playerId, period, currency: this.partners.partner(partnerId)!.paymentCurrency, model: campaign.model, basisMinor, commissionMinor, status: commissionMinor < 0n ? "held" : "pending", eventIds: events.map((event) => event.id), holdReason: commissionMinor < 0n ? "negative_commission" : undefined, version: 1 };
    this.#items.set(id, item); return cloneItem(item);
  }

  hold(itemId: string, expectedVersion: number, reason: string): CommissionItem { return this.changeItem(itemId, expectedVersion, { status: "held", holdReason: crmText(reason, "hold reason") }); }
  approve(itemId: string, expectedVersion: number, at = new Date()): CommissionItem { const item = this.requireItem(itemId); if (item.status !== "pending" && item.status !== "held") throw new CrmConflictError("commission item cannot be approved"); return this.changeItem(itemId, expectedVersion, { status: "approved", holdReason: undefined, approvedAt: at.toISOString() }); }
  reverse(itemId: string, expectedVersion: number, reason: string): CommissionItem { const item = this.requireItem(itemId); if (item.status === "paid") throw new CrmConflictError("paid commission requires payment reversal"); return this.changeItem(itemId, expectedVersion, { status: "reversed", holdReason: crmText(reason, "reversal reason") }); }

  createPayment(partnerId: string, period: string, requestedBy: string, at = new Date()): PartnerPayment {
    const partner = this.partners.partner(partnerId); if (!partner || partner.status !== "active") throw new CrmConflictError("partner is not active");
    const items = [...this.#items.values()].filter((item) => item.partnerId === partnerId && item.period === period && item.status === "approved"); if (!items.length) throw new CrmConflictError("no approved commissions are payable");
    if (!items.every((item) => item.currency === partner.paymentCurrency)) throw new CrmValidationError("commission currency does not match partner payment currency");
    const payment: PartnerPayment = { id: randomUUID(), partnerId, period, currency: partner.paymentCurrency, amountMinor: items.reduce((sum, item) => sum + item.commissionMinor, 0n), itemIds: items.map((item) => item.id), status: "draft", requestedBy: crmText(requestedBy, "payment requester"), createdAt: at.toISOString(), version: 1 };
    this.#payments.set(payment.id, payment); return clonePayment(payment);
  }

  approvePayment(paymentId: string, expectedVersion: number, approverId: string): PartnerPayment { const payment = this.requirePayment(paymentId); if (payment.version !== expectedVersion) throw new CrmConflictError("payment version does not match"); if (payment.requestedBy === approverId) throw new CrmConflictError("payment requester cannot approve payment"); if (payment.status !== "draft") throw new CrmConflictError("payment cannot be approved"); return this.savePayment({ ...payment, status: "approved", approvedBy: crmText(approverId, "payment approver") }); }
  markSent(paymentId: string, expectedVersion: number, providerReference: string): PartnerPayment { const payment = this.requirePayment(paymentId); if (payment.version !== expectedVersion || payment.status !== "approved") throw new CrmConflictError("payment cannot be sent"); return this.savePayment({ ...payment, status: "sent", providerReference: crmText(providerReference, "provider reference") }); }
  confirm(paymentId: string, expectedVersion: number, at = new Date()): PartnerPayment { const payment = this.requirePayment(paymentId); if (payment.version !== expectedVersion || payment.status !== "sent") throw new CrmConflictError("payment cannot be confirmed"); for (const itemId of payment.itemIds) { const item = this.#items.get(itemId)!; this.#items.set(itemId, { ...item, status: "paid", paidAt: at.toISOString(), paymentReference: payment.providerReference, version: item.version + 1 }); } return this.savePayment({ ...payment, status: "confirmed", completedAt: at.toISOString() }); }

  items(partnerId: string, period?: string): readonly CommissionItem[] { return [...this.#items.values()].filter((item) => item.partnerId === partnerId && (!period || item.period === period)).map(cloneItem); }
  payment(paymentId: string): PartnerPayment | undefined { const value = this.#payments.get(paymentId.trim()); return value ? clonePayment(value) : undefined; }
  private changeItem(id: string, expectedVersion: number, changes: Partial<CommissionItem>): CommissionItem { const item = this.requireItem(id); if (item.version !== expectedVersion) throw new CrmConflictError("commission version does not match"); const changed = { ...item, ...changes, id: item.id, version: item.version + 1 }; this.#items.set(id, changed); return cloneItem(changed); }
  private requireItem(id: string): CommissionItem { const value = this.#items.get(crmText(id, "commission item id")); if (!value) throw new CrmValidationError("commission item does not exist"); return value; }
  private requirePayment(id: string): PartnerPayment { const value = this.#payments.get(crmText(id, "payment id")); if (!value) throw new CrmValidationError("partner payment does not exist"); return value; }
  private savePayment(value: PartnerPayment): PartnerPayment { const changed = { ...value, version: value.version + 1 }; this.#payments.set(changed.id, changed); return clonePayment(changed); }
}

function validateEvent(value: CommissionEvent): CommissionEvent { if (value.amountMinor === 0n && value.kind !== "qualification") throw new CrmValidationError("commission event amount cannot be zero"); return { ...value, id: crmText(value.id, "event id"), playerId: crmText(value.playerId, "player id"), partnerId: crmText(value.partnerId, "partner id"), campaignId: crmText(value.campaignId, "campaign id"), currency: crmCurrency(value.currency), sourceReference: crmText(value.sourceReference, "source reference"), occurredAt: crmDate(value.occurredAt, "event time").toISOString(), metadata: { ...value.metadata } }; }
function eventFingerprint(value: CommissionEvent): string { return JSON.stringify({ ...value, amountMinor: value.amountMinor.toString() }); }
function max(left: bigint, right: bigint): bigint { return left > right ? left : right; }
function cloneEvent(value: CommissionEvent): CommissionEvent { return { ...value, metadata: { ...value.metadata } }; }
function cloneItem(value: CommissionItem): CommissionItem { return { ...value, eventIds: [...value.eventIds] }; }
function clonePayment(value: PartnerPayment): PartnerPayment { return { ...value, itemIds: [...value.itemIds] }; }
