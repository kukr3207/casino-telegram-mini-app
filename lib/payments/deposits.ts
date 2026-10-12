import { createHash, randomUUID } from "node:crypto";
import type {
  PaymentAmount,
  PaymentClock,
  PaymentEvent,
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

export interface CreateDepositRequest {
  id?: string;
  player: PaymentParty;
  amount: PaymentAmount;
  provider: PaymentProvider;
  externalId: string;
  idempotencyKey: string;
  paymentMethodFingerprint?: string;
  ipAddress?: string;
  deviceId?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface DepositDecision {
  payment: PaymentRecord;
  risk: RiskAssessment;
  replayed: boolean;
}

interface StoredDeposit {
  fingerprint: string;
  payment: PaymentRecord;
  risk: RiskAssessment;
}

export class DepositService {
  private readonly byId = new Map<string, StoredDeposit>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private readonly byExternalId = new Map<string, string>();
  private readonly riskEngine: PaymentRiskEngine;
  private readonly riskContext: InMemoryRiskContext;
  private readonly clock: PaymentClock;

  constructor(
    riskEngine: PaymentRiskEngine,
    riskContext: InMemoryRiskContext,
    clock: PaymentClock = systemPaymentClock,
  ) {
    this.riskEngine = riskEngine;
    this.riskContext = riskContext;
    this.clock = clock;
  }

  create(request: CreateDepositRequest): DepositDecision {
    const normalized = normalizeRequest(request);
    const fingerprint = requestFingerprint(normalized);
    const existingId = this.byIdempotencyKey.get(normalized.idempotencyKey);
    if (existingId) {
      const existing = this.byId.get(existingId)!;
      if (existing.fingerprint !== fingerprint) {
        throw new PaymentConflictError("idempotency key was reused with a different deposit");
      }
      return cloneDecision(existing, true);
    }
    const providerKey = `${normalized.provider}:${normalized.externalId}`;
    if (this.byExternalId.has(providerKey)) {
      throw new PaymentConflictError("provider deposit already exists");
    }

    const now = this.clock.now();
    const riskInput = {
      player: normalized.player,
      amount: normalized.amount,
      direction: "deposit" as const,
      paymentMethodFingerprint: normalized.paymentMethodFingerprint,
      ipAddress: normalized.ipAddress,
      deviceId: normalized.deviceId,
      occurredAt: now,
    };
    const risk = this.riskEngine.assess(riskInput, this.riskContext);
    const status = risk.decision === "allow"
      ? "pending"
      : risk.decision === "review"
        ? "requires_review"
        : "failed";
    const payment: PaymentRecord = {
      id: normalized.id,
      direction: "deposit",
      party: normalized.player,
      amount: normalized.amount,
      provider: {
        provider: normalized.provider,
        externalId: normalized.externalId,
        idempotencyKey: normalized.idempotencyKey,
      },
      status,
      createdAt: now,
      updatedAt: now,
      events: [createEvent(normalized.id, "deposit.created", status, now, risk)],
      metadata: normalized.metadata,
    };
    const stored: StoredDeposit = { fingerprint, payment, risk };
    this.byId.set(payment.id, stored);
    this.byIdempotencyKey.set(normalized.idempotencyKey, payment.id);
    this.byExternalId.set(providerKey, payment.id);
    this.riskContext.record(riskInput);
    return cloneDecision(stored, false);
  }

  authorize(paymentId: string, source: "provider" | "operator" = "provider"): PaymentRecord {
    return this.transition(paymentId, ["pending", "requires_review"], "authorized", "deposit.authorized", source);
  }

  settle(paymentId: string): PaymentRecord {
    return this.transition(paymentId, ["authorized"], "settled", "deposit.settled", "provider");
  }

  fail(paymentId: string, reason: string): PaymentRecord {
    const normalizedReason = normalizePaymentId(reason, "failure reason");
    return this.transition(
      paymentId,
      ["pending", "requires_review", "authorized"],
      "failed",
      "deposit.failed",
      "provider",
      normalizedReason,
    );
  }

  refund(paymentId: string, reason: string): PaymentRecord {
    return this.transition(
      paymentId,
      ["settled"],
      "refunded",
      "deposit.refunded",
      "operator",
      normalizePaymentId(reason, "refund reason"),
    );
  }

  get(paymentId: string): PaymentRecord | undefined {
    const stored = this.byId.get(paymentId.trim());
    return stored ? clonePayment(stored.payment) : undefined;
  }

  listForPlayer(playerId: string): readonly PaymentRecord[] {
    const normalized = normalizePaymentId(playerId, "player id");
    return [...this.byId.values()]
      .map((stored) => stored.payment)
      .filter((payment) => payment.party.playerId === normalized)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map(clonePayment);
  }

  private transition(
    paymentId: string,
    allowed: readonly PaymentRecord["status"][],
    status: PaymentRecord["status"],
    type: string,
    source: PaymentEvent["source"],
    reason?: string,
  ): PaymentRecord {
    const normalized = normalizePaymentId(paymentId);
    const stored = this.byId.get(normalized);
    if (!stored) {
      throw new PaymentValidationError("deposit does not exist");
    }
    if (!allowed.includes(stored.payment.status)) {
      if (stored.payment.status === status) {
        return clonePayment(stored.payment);
      }
      throw new PaymentConflictError(`cannot move deposit from ${stored.payment.status} to ${status}`);
    }
    const now = this.clock.now();
    stored.payment = {
      ...stored.payment,
      status,
      updatedAt: now,
      events: [
        ...stored.payment.events,
        {
          id: randomUUID(),
          paymentId: normalized,
          type,
          status,
          occurredAt: now,
          source,
          reason,
          metadata: {},
        },
      ],
    };
    return clonePayment(stored.payment);
  }
}

function normalizeRequest(request: CreateDepositRequest): Required<Omit<CreateDepositRequest, "paymentMethodFingerprint" | "ipAddress" | "deviceId">> & Pick<CreateDepositRequest, "paymentMethodFingerprint" | "ipAddress" | "deviceId"> {
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
    externalId: normalizePaymentId(request.externalId, "external id"),
    idempotencyKey: normalizePaymentId(request.idempotencyKey, "idempotency key"),
    metadata: { ...(request.metadata ?? {}) },
  };
}

function requestFingerprint(request: ReturnType<typeof normalizeRequest>): string {
  const stable = JSON.stringify({
    playerId: request.player.playerId,
    amount: request.amount.minor.toString(),
    currency: request.amount.currency,
    provider: request.provider,
    externalId: request.externalId,
    paymentMethodFingerprint: request.paymentMethodFingerprint,
    metadata: Object.entries(request.metadata).sort(([left], [right]) => left.localeCompare(right)),
  });
  return createHash("sha256").update(stable).digest("hex");
}

function createEvent(
  paymentId: string,
  type: string,
  status: PaymentRecord["status"],
  occurredAt: Date,
  risk: RiskAssessment,
): PaymentEvent {
  return {
    id: randomUUID(),
    paymentId,
    type,
    status,
    occurredAt,
    source: "player",
    metadata: {
      riskScore: String(risk.score),
      riskDecision: risk.decision,
    },
  };
}

function cloneDecision(stored: StoredDeposit, replayed: boolean): DepositDecision {
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
