export type PaymentCurrency = "CHIP" | "USD" | "EUR" | "GBP";

export type PaymentProvider = "telegram" | "stripe" | "bank" | "manual";

export type PaymentStatus =
  | "created"
  | "pending"
  | "requires_review"
  | "authorized"
  | "settled"
  | "failed"
  | "cancelled"
  | "refunded";

export interface PaymentAmount {
  currency: PaymentCurrency;
  minor: bigint;
}

export interface PaymentParty {
  playerId: string;
  country?: string;
  email?: string;
  providerCustomerId?: string;
}

export interface ProviderReference {
  provider: PaymentProvider;
  externalId: string;
  idempotencyKey: string;
}

export interface PaymentEvent {
  id: string;
  paymentId: string;
  type: string;
  status: PaymentStatus;
  occurredAt: Date;
  source: "player" | "provider" | "operator" | "system";
  reason?: string;
  metadata: Readonly<Record<string, string>>;
}

export interface PaymentRecord {
  id: string;
  direction: "deposit" | "withdrawal";
  party: PaymentParty;
  amount: PaymentAmount;
  provider: ProviderReference;
  status: PaymentStatus;
  createdAt: Date;
  updatedAt: Date;
  events: readonly PaymentEvent[];
  metadata: Readonly<Record<string, string>>;
}

export interface PaymentClock {
  now(): Date;
}

export const systemPaymentClock: PaymentClock = {
  now: () => new Date(),
};

export class PaymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentValidationError";
  }
}

export class PaymentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConflictError";
  }
}

export function validatePaymentAmount(amount: PaymentAmount): void {
  if (!amount || typeof amount !== "object") {
    throw new PaymentValidationError("payment amount is required");
  }
  if (!Number.isSafeInteger(Number(amount.minor)) || amount.minor <= 0n) {
    throw new PaymentValidationError("payment amount must be a positive safe integer");
  }
  if (!["CHIP", "USD", "EUR", "GBP"].includes(amount.currency)) {
    throw new PaymentValidationError("unsupported payment currency");
  }
}

export function normalizePaymentId(value: string, field = "payment id"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PaymentValidationError(`${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > 128) {
    throw new PaymentValidationError(`${field} is too long`);
  }
  return normalized;
}

export function clonePayment(record: PaymentRecord): PaymentRecord {
  return {
    ...record,
    party: { ...record.party },
    amount: { ...record.amount },
    provider: { ...record.provider },
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    events: record.events.map((event) => ({
      ...event,
      occurredAt: new Date(event.occurredAt),
      metadata: { ...event.metadata },
    })),
    metadata: { ...record.metadata },
  };
}

