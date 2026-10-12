import { createHash, randomUUID } from "node:crypto";
import type {
  PaymentAmount,
  PaymentClock,
  PaymentParty,
  PaymentProvider,
  PaymentRecord,
} from "./types.ts";
import {
  PaymentConflictError,
  PaymentValidationError,
  clonePayment,
  normalizePaymentId,
  systemPaymentClock,
  validatePaymentAmount,
} from "./types.ts";
import type { RiskAssessment } from "./risk.ts";
import { InMemoryRiskContext, PaymentRiskEngine } from "./risk.ts";

export interface WithdrawalFunds {
  available(playerId: string, currency: string): bigint;
  reserve(playerId: string, paymentId: string, amount: PaymentAmount): void;
  release(playerId: string, paymentId: string): void;
  consume(playerId: string, paymentId: string): void;
}

export interface CreateWithdrawalRequest {
  id?: string;
  player: PaymentParty;
  amount: PaymentAmount;
  provider: PaymentProvider;
  destination: string;
  idempotencyKey: string;
  paymentMethodFingerprint?: string;
  ipAddress?: string;
  deviceId?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface WithdrawalDecision {
  payment: PaymentRecord;
  risk: RiskAssessment;
  replayed: boolean;
}

interface StoredWithdrawal {
  fingerprint: string;
  payment: PaymentRecord;
  risk: RiskAssessment;
}

interface Reservation {
  playerId: string;
  currency: string;
  minor: bigint;
}

export class InMemoryWithdrawalFunds implements WithdrawalFunds {
  private readonly balances = new Map<string, bigint>();
  private readonly reservations = new Map<string, Reservation>();

  setBalance(playerId: string, currency: string, minor: bigint): void {
    if (minor < 0n) throw new PaymentValidationError("balance cannot be negative");
    this.balances.set(`${playerId}:${currency}`, minor);
  }

  available(playerId: string, currency: string): bigint {
    const key = `${playerId}:${currency}`;
    const reserved = [...this.reservations.values()]
      .filter((item) => item.playerId === playerId && item.currency === currency)
      .reduce((sum, item) => sum + item.minor, 0n);
    return (this.balances.get(key) ?? 0n) - reserved;
  }

  reserve(playerId: string, paymentId: string, amount: PaymentAmount): void {
    const existing = this.reservations.get(paymentId);
    if (existing) {
      if (existing.playerId === playerId && existing.currency === amount.currency && existing.minor === amount.minor) return;
      throw new PaymentConflictError("withdrawal reservation conflicts with existing funds hold");
    }
    if (this.available(playerId, amount.currency) < amount.minor) {
      throw new PaymentConflictError("insufficient available balance");
    }
    this.reservations.set(paymentId, { playerId, currency: amount.currency, minor: amount.minor });
  }

  release(playerId: string, paymentId: string): void {
    const reservation = this.reservations.get(paymentId);
    if (!reservation) return;
    if (reservation.playerId !== playerId) throw new PaymentConflictError("reservation owner mismatch");
    this.reservations.delete(paymentId);
  }

  consume(playerId: string, paymentId: string): void {
    const reservation = this.reservations.get(paymentId);
    if (!reservation || reservation.playerId !== playerId) {
      throw new PaymentConflictError("withdrawal reservation does not exist");
    }
    const key = `${reservation.playerId}:${reservation.currency}`;
    const balance = this.balances.get(key) ?? 0n;
    if (balance < reservation.minor) throw new PaymentConflictError("reserved balance was reduced");
    this.balances.set(key, balance - reservation.minor);
    this.reservations.delete(paymentId);
  }
}

export class WithdrawalService {
  private readonly byId = new Map<string, StoredWithdrawal>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private readonly funds: WithdrawalFunds;
  private readonly riskEngine: PaymentRiskEngine;
  private readonly riskContext: InMemoryRiskContext;
  private readonly clock: PaymentClock;

  constructor(
    funds: WithdrawalFunds,
    riskEngine: PaymentRiskEngine,
    riskContext: InMemoryRiskContext,
    clock: PaymentClock = systemPaymentClock,
  ) {
    this.funds = funds;
    this.riskEngine = riskEngine;
    this.riskContext = riskContext;
    this.clock = clock;
  }

  create(request: CreateWithdrawalRequest): WithdrawalDecision {
    const normalized = normalizeRequest(request);
    const fingerprint = fingerprintRequest(normalized);
    const existingId = this.byIdempotencyKey.get(normalized.idempotencyKey);
    if (existingId) {
      const stored = this.byId.get(existingId)!;
      if (stored.fingerprint !== fingerprint) {
        throw new PaymentConflictError("idempotency key was reused with a different withdrawal");
      }
      return cloneDecision(stored, true);
    }
    const now = this.clock.now();
    const riskInput = {
      player: normalized.player,
      amount: normalized.amount,
      direction: "withdrawal" as const,
      paymentMethodFingerprint: normalized.paymentMethodFingerprint,
      ipAddress: normalized.ipAddress,
      deviceId: normalized.deviceId,
      occurredAt: now,
    };
    const risk = this.riskEngine.assess(riskInput, this.riskContext);
    if (risk.decision === "deny") {
      const payment = buildPayment(normalized, "failed", now, risk);
      const stored = { fingerprint, payment, risk };
      this.store(normalized.idempotencyKey, stored);
      this.riskContext.record(riskInput);
      return cloneDecision(stored, false);
    }
    this.funds.reserve(normalized.player.playerId, normalized.id, normalized.amount);
    const status = risk.decision === "review" ? "requires_review" : "pending";
    const payment = buildPayment(normalized, status, now, risk);
    const stored = { fingerprint, payment, risk };
    this.store(normalized.idempotencyKey, stored);
    this.riskContext.record(riskInput);
    return cloneDecision(stored, false);
  }

  approve(paymentId: string): PaymentRecord {
    return this.transition(paymentId, ["pending", "requires_review"], "authorized", "withdrawal.approved");
  }

  settle(paymentId: string): PaymentRecord {
    const stored = this.require(paymentId);
    if (stored.payment.status === "settled") return clonePayment(stored.payment);
    if (stored.payment.status !== "authorized") {
      throw new PaymentConflictError("only authorized withdrawals can settle");
    }
    this.funds.consume(stored.payment.party.playerId, stored.payment.id);
    return this.applyTransition(stored, "settled", "withdrawal.settled");
  }

  reject(paymentId: string, reason: string): PaymentRecord {
    const stored = this.require(paymentId);
    if (stored.payment.status === "failed") return clonePayment(stored.payment);
    if (!["pending", "requires_review", "authorized"].includes(stored.payment.status)) {
      throw new PaymentConflictError("withdrawal can no longer be rejected");
    }
    this.funds.release(stored.payment.party.playerId, stored.payment.id);
    return this.applyTransition(stored, "failed", "withdrawal.rejected", reason);
  }

  cancel(paymentId: string): PaymentRecord {
    const stored = this.require(paymentId);
    if (stored.payment.status === "cancelled") return clonePayment(stored.payment);
    if (!(["pending", "requires_review"] as string[]).includes(stored.payment.status)) {
      throw new PaymentConflictError("withdrawal can no longer be cancelled");
    }
    this.funds.release(stored.payment.party.playerId, stored.payment.id);
    return this.applyTransition(stored, "cancelled", "withdrawal.cancelled");
  }

  get(paymentId: string): PaymentRecord | undefined {
    const stored = this.byId.get(paymentId.trim());
    return stored ? clonePayment(stored.payment) : undefined;
  }

  private store(idempotencyKey: string, stored: StoredWithdrawal): void {
    this.byId.set(stored.payment.id, stored);
    this.byIdempotencyKey.set(idempotencyKey, stored.payment.id);
  }

  private require(paymentId: string): StoredWithdrawal {
    const stored = this.byId.get(normalizePaymentId(paymentId));
    if (!stored) throw new PaymentValidationError("withdrawal does not exist");
    return stored;
  }

  private transition(paymentId: string, allowed: readonly string[], status: PaymentRecord["status"], type: string): PaymentRecord {
    const stored = this.require(paymentId);
    if (stored.payment.status === status) return clonePayment(stored.payment);
    if (!allowed.includes(stored.payment.status)) {
      throw new PaymentConflictError(`cannot move withdrawal from ${stored.payment.status} to ${status}`);
    }
    return this.applyTransition(stored, status, type);
  }

  private applyTransition(stored: StoredWithdrawal, status: PaymentRecord["status"], type: string, reason?: string): PaymentRecord {
    const now = this.clock.now();
    stored.payment = {
      ...stored.payment,
      status,
      updatedAt: now,
      events: [...stored.payment.events, {
        id: randomUUID(),
        paymentId: stored.payment.id,
        type,
        status,
        occurredAt: now,
        source: status === "cancelled" ? "player" : "operator",
        reason,
        metadata: {},
      }],
    };
    return clonePayment(stored.payment);
  }
}

type NormalizedRequest = Required<Omit<CreateWithdrawalRequest, "paymentMethodFingerprint" | "ipAddress" | "deviceId">> & Pick<CreateWithdrawalRequest, "paymentMethodFingerprint" | "ipAddress" | "deviceId">;

function normalizeRequest(request: CreateWithdrawalRequest): NormalizedRequest {
  validatePaymentAmount(request.amount);
  const playerId = normalizePaymentId(request.player?.playerId, "player id");
  if (!["telegram", "stripe", "bank", "manual"].includes(request.provider)) {
    throw new PaymentValidationError("unsupported payment provider");
  }
  return {
    ...request,
    id: request.id ? normalizePaymentId(request.id) : randomUUID(),
    player: { ...request.player, playerId },
    amount: { ...request.amount },
    destination: normalizePaymentId(request.destination, "withdrawal destination"),
    idempotencyKey: normalizePaymentId(request.idempotencyKey, "idempotency key"),
    metadata: { ...(request.metadata ?? {}) },
  };
}

function fingerprintRequest(request: NormalizedRequest): string {
  return createHash("sha256").update(JSON.stringify({
    playerId: request.player.playerId,
    amount: request.amount.minor.toString(),
    currency: request.amount.currency,
    provider: request.provider,
    destination: request.destination,
    paymentMethodFingerprint: request.paymentMethodFingerprint,
    metadata: Object.entries(request.metadata).sort(([left], [right]) => left.localeCompare(right)),
  })).digest("hex");
}

function buildPayment(request: NormalizedRequest, status: PaymentRecord["status"], now: Date, risk: RiskAssessment): PaymentRecord {
  return {
    id: request.id,
    direction: "withdrawal",
    party: request.player,
    amount: request.amount,
    provider: {
      provider: request.provider,
      externalId: request.destination,
      idempotencyKey: request.idempotencyKey,
    },
    status,
    createdAt: now,
    updatedAt: now,
    events: [{
      id: randomUUID(),
      paymentId: request.id,
      type: "withdrawal.created",
      status,
      occurredAt: now,
      source: "player",
      metadata: { riskScore: String(risk.score), riskDecision: risk.decision },
    }],
    metadata: request.metadata,
  };
}

function cloneDecision(stored: StoredWithdrawal, replayed: boolean): WithdrawalDecision {
  return {
    payment: clonePayment(stored.payment),
    risk: {
      ...stored.risk,
      assessedAt: new Date(stored.risk.assessedAt),
      signals: stored.risk.signals.map((signal) => ({ ...signal })),
    },
    replayed,
  };
}
