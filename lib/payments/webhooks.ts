import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentConflictError, PaymentValidationError, normalizePaymentId } from "./types.ts";

export interface ProviderWebhook {
  provider: string;
  eventId: string;
  eventType: string;
  paymentId: string;
  occurredAt: Date;
  payload: Readonly<Record<string, unknown>>;
}

export interface WebhookHeaders {
  signature: string;
  timestamp: string;
}

export interface WebhookReceipt {
  eventId: string;
  receivedAt: Date;
  outcome: "processed" | "ignored";
  detail?: string;
}

export interface WebhookHandler {
  handle(event: ProviderWebhook): Promise<void> | void;
}

export class HmacWebhookVerifier {
  private readonly secret: string;
  private readonly toleranceMs: number;
  private readonly now: () => Date;

  constructor(
    secret: string,
    toleranceMs = 5 * 60 * 1000,
    now: () => Date = () => new Date(),
  ) {
    if (!secret) throw new PaymentValidationError("webhook secret is required");
    if (!Number.isInteger(toleranceMs) || toleranceMs <= 0) {
      throw new PaymentValidationError("webhook tolerance must be positive");
    }
    this.secret = secret;
    this.toleranceMs = toleranceMs;
    this.now = now;
  }

  sign(rawBody: string, timestamp: string): string {
    return createHmac("sha256", this.secret).update(`${timestamp}.${rawBody}`).digest("hex");
  }

  verify(rawBody: string, headers: WebhookHeaders): void {
    const timestampMs = Number(headers.timestamp);
    if (!Number.isFinite(timestampMs)) throw new PaymentValidationError("webhook timestamp is invalid");
    if (Math.abs(this.now().getTime() - timestampMs) > this.toleranceMs) {
      throw new PaymentValidationError("webhook timestamp is outside the allowed window");
    }
    const expected = Buffer.from(this.sign(rawBody, headers.timestamp), "hex");
    let actual: Buffer;
    try {
      actual = Buffer.from(headers.signature, "hex");
    } catch {
      throw new PaymentValidationError("webhook signature is invalid");
    }
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new PaymentValidationError("webhook signature does not match");
    }
  }
}

export class WebhookInbox {
  private readonly receipts = new Map<string, WebhookReceipt>();
  private readonly locks = new Map<string, Promise<WebhookReceipt>>();
  private readonly verifier: HmacWebhookVerifier;
  private readonly handler: WebhookHandler;
  private readonly now: () => Date;

  constructor(
    verifier: HmacWebhookVerifier,
    handler: WebhookHandler,
    now: () => Date = () => new Date(),
  ) {
    this.verifier = verifier;
    this.handler = handler;
    this.now = now;
  }

  async receive(rawBody: string, headers: WebhookHeaders): Promise<WebhookReceipt> {
    this.verifier.verify(rawBody, headers);
    const event = parseWebhook(rawBody);
    const key = `${event.provider}:${event.eventId}`;
    const receipt = this.receipts.get(key);
    if (receipt) return cloneReceipt(receipt);
    const inFlight = this.locks.get(key);
    if (inFlight) return cloneReceipt(await inFlight);

    const processing = this.process(key, event);
    this.locks.set(key, processing);
    try {
      return cloneReceipt(await processing);
    } finally {
      this.locks.delete(key);
    }
  }

  get(provider: string, eventId: string): WebhookReceipt | undefined {
    const receipt = this.receipts.get(`${provider.trim()}:${eventId.trim()}`);
    return receipt ? cloneReceipt(receipt) : undefined;
  }

  private async process(key: string, event: ProviderWebhook): Promise<WebhookReceipt> {
    try {
      await this.handler.handle(event);
      const receipt = {
        eventId: event.eventId,
        receivedAt: this.now(),
        outcome: "processed" as const,
      };
      this.receipts.set(key, receipt);
      return receipt;
    } catch (error) {
      if (error instanceof PaymentConflictError) {
        const receipt = {
          eventId: event.eventId,
          receivedAt: this.now(),
          outcome: "ignored" as const,
          detail: error.message,
        };
        this.receipts.set(key, receipt);
        return receipt;
      }
      throw error;
    }
  }
}

function parseWebhook(rawBody: string): ProviderWebhook {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new PaymentValidationError("webhook body is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentValidationError("webhook body must be an object");
  }
  const item = value as Record<string, unknown>;
  const occurredAt = new Date(String(item.occurredAt ?? ""));
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new PaymentValidationError("webhook occurrence time is invalid");
  }
  return {
    provider: normalizePaymentId(String(item.provider ?? ""), "provider"),
    eventId: normalizePaymentId(String(item.eventId ?? ""), "event id"),
    eventType: normalizePaymentId(String(item.eventType ?? ""), "event type"),
    paymentId: normalizePaymentId(String(item.paymentId ?? ""), "payment id"),
    occurredAt,
    payload: item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
      ? { ...(item.payload as Record<string, unknown>) }
      : {},
  };
}

function cloneReceipt(receipt: WebhookReceipt): WebhookReceipt {
  return { ...receipt, receivedAt: new Date(receipt.receivedAt) };
}
