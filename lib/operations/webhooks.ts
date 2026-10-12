import { createHmac, createHash, timingSafeEqual } from "node:crypto";

import {
  type WebhookDelivery,
  type WebhookSubscription,
  OperationsConflictError,
  OperationsValidationError,
  operationsText,
} from "./types.ts";

export interface WebhookEvent {
  id: string;
  type: string;
  occurredAt: string;
  data: unknown;
  metadata?: Readonly<Record<string, string>>;
}

export interface DeliveryAttemptResult {
  status: number;
  body?: string;
  retryAfterSeconds?: number;
}

export interface DeliveryRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
  timeoutMs: number;
}

export class WebhookService {
  readonly #subscriptions = new Map<string, WebhookSubscription>();
  readonly #deliveries = new Map<string, WebhookDelivery>();
  readonly #eventDeliveries = new Map<string, string[]>();

  subscribe(
    input: Omit<
      WebhookSubscription,
      "failureCount" | "disabledAt" | "createdAt" | "version"
    >,
    at = new Date(),
  ): WebhookSubscription {
    const value = validateSubscription({
      ...input,
      failureCount: 0,
      createdAt: at.toISOString(),
      version: 1,
    });
    if (this.#subscriptions.has(value.id))
      throw new OperationsConflictError("webhook subscription already exists");
    this.#subscriptions.set(value.id, value);
    return cloneSubscription(value);
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        WebhookSubscription,
        "url" | "events" | "secret" | "enabled" | "description"
      >
    >,
    expectedVersion: number,
  ): WebhookSubscription {
    const current = this.#requiredSubscription(id);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError(
        "webhook subscription version does not match",
      );
    const changed = validateSubscription({
      ...current,
      ...patch,
      id: current.id,
      ownerId: current.ownerId,
      failureCount: patch.enabled ? 0 : current.failureCount,
      disabledAt: patch.enabled ? undefined : current.disabledAt,
      version: current.version + 1,
    });
    this.#subscriptions.set(changed.id, changed);
    return cloneSubscription(changed);
  }

  rotateSecret(
    id: string,
    secret: string,
    expectedVersion: number,
  ): WebhookSubscription {
    return this.update(
      id,
      { secret: operationsText(secret, "webhook secret") },
      expectedVersion,
    );
  }

  publish(
    eventInput: WebhookEvent,
    at = new Date(),
  ): readonly WebhookDelivery[] {
    const event = validateEvent(eventInput);
    const existingIds = this.#eventDeliveries.get(event.id);
    if (existingIds) {
      const existing = existingIds
        .map((id) => this.#deliveries.get(id))
        .filter((value): value is WebhookDelivery => value !== undefined);
      if (
        existing.some(
          (delivery) =>
            delivery.eventType !== event.type ||
            delivery.body !== eventBody(event),
        )
      )
        throw new OperationsConflictError(
          "webhook event id is already used for different data",
        );
      return existing.map(cloneDelivery);
    }
    const deliveries: WebhookDelivery[] = [];
    for (const subscription of this.#subscriptions.values()) {
      if (
        !subscription.enabled ||
        !matchesEvent(subscription.events, event.type)
      )
        continue;
      const body = eventBody(event);
      const id = `delivery_${createHash("sha256").update(`${subscription.id}\u0000${event.id}`).digest("hex").slice(0, 24)}`;
      const delivery: WebhookDelivery = {
        id,
        subscriptionId: subscription.id,
        eventId: event.id,
        eventType: event.type,
        body,
        signature: sign(body, subscription.secret),
        status: "pending",
        attempts: 0,
        nextAttemptAt: at.toISOString(),
        createdAt: at.toISOString(),
        version: 1,
      };
      this.#deliveries.set(delivery.id, delivery);
      deliveries.push(cloneDelivery(delivery));
    }
    this.#eventDeliveries.set(
      event.id,
      deliveries.map((delivery) => delivery.id),
    );
    return deliveries;
  }

  claim(
    workerId: string,
    limit = 10,
    at = new Date(),
  ): readonly { delivery: WebhookDelivery; request: DeliveryRequest }[] {
    operationsText(workerId, "webhook worker id");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new OperationsValidationError("webhook claim limit is invalid");
    return [...this.#deliveries.values()]
      .filter(
        (delivery) =>
          ["pending", "retrying"].includes(delivery.status) &&
          new Date(delivery.nextAttemptAt) <= at,
      )
      .sort(
        (left, right) =>
          left.nextAttemptAt.localeCompare(right.nextAttemptAt) ||
          left.createdAt.localeCompare(right.createdAt),
      )
      .slice(0, limit)
      .map((delivery) => {
        const subscription = this.#requiredSubscription(
          delivery.subscriptionId,
        );
        const changed: WebhookDelivery = {
          ...delivery,
          status: "delivering",
          attempts: delivery.attempts + 1,
          version: delivery.version + 1,
        };
        this.#deliveries.set(changed.id, changed);
        return {
          delivery: cloneDelivery(changed),
          request: {
            url: subscription.url,
            headers: {
              "content-type": "application/json",
              "user-agent": "Casino-Webhook/1.0",
              "x-webhook-id": changed.id,
              "x-webhook-event": changed.eventType,
              "x-webhook-signature": changed.signature,
            },
            body: changed.body,
            timeoutMs: 10_000,
          },
        };
      });
  }

  complete(
    deliveryId: string,
    result: DeliveryAttemptResult,
    expectedVersion: number,
    at = new Date(),
  ): WebhookDelivery {
    const current = this.#requiredDelivery(deliveryId);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError(
        "webhook delivery version does not match",
      );
    if (current.status !== "delivering")
      throw new OperationsConflictError("webhook delivery is not in progress");
    if (
      !Number.isSafeInteger(result.status) ||
      result.status < 100 ||
      result.status > 599
    )
      throw new OperationsValidationError("webhook response status is invalid");
    const subscription = this.#requiredSubscription(current.subscriptionId);
    const successful = result.status >= 200 && result.status < 300;
    const permanent =
      result.status === 400 ||
      result.status === 401 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 410 ||
      result.status === 422;
    const exhausted = current.attempts >= 8;
    const retry = !successful && !permanent && !exhausted;
    const nextDelay =
      result.retryAfterSeconds ?? Math.min(3600, 2 ** current.attempts * 5);
    if (!Number.isFinite(nextDelay) || nextDelay < 0 || nextDelay > 86_400)
      throw new OperationsValidationError("webhook retry delay is invalid");
    const changed: WebhookDelivery = {
      ...current,
      status: successful ? "delivered" : retry ? "retrying" : "failed",
      nextAttemptAt: retry
        ? new Date(at.getTime() + nextDelay * 1000).toISOString()
        : current.nextAttemptAt,
      responseStatus: result.status,
      responseBody: truncate(result.body, 4096),
      error: successful ? undefined : `HTTP ${result.status}`,
      deliveredAt: successful ? at.toISOString() : undefined,
      version: current.version + 1,
    };
    this.#deliveries.set(changed.id, changed);
    this.#recordSubscriptionOutcome(
      subscription,
      successful,
      result.status,
      at,
    );
    return cloneDelivery(changed);
  }

  fail(
    deliveryId: string,
    error: string,
    expectedVersion: number,
    at = new Date(),
  ): WebhookDelivery {
    const current = this.#requiredDelivery(deliveryId);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError(
        "webhook delivery version does not match",
      );
    if (current.status !== "delivering")
      throw new OperationsConflictError("webhook delivery is not in progress");
    const subscription = this.#requiredSubscription(current.subscriptionId);
    const exhausted = current.attempts >= 8;
    const changed: WebhookDelivery = {
      ...current,
      status: exhausted ? "failed" : "retrying",
      nextAttemptAt: new Date(
        at.getTime() + Math.min(3600, 2 ** current.attempts * 5) * 1000,
      ).toISOString(),
      error: operationsText(error, "delivery error"),
      version: current.version + 1,
    };
    this.#deliveries.set(changed.id, changed);
    this.#recordSubscriptionOutcome(subscription, false, undefined, at);
    return cloneDelivery(changed);
  }

  replay(
    deliveryId: string,
    expectedVersion: number,
    at = new Date(),
  ): WebhookDelivery {
    const current = this.#requiredDelivery(deliveryId);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError(
        "webhook delivery version does not match",
      );
    if (!["failed", "cancelled"].includes(current.status))
      throw new OperationsConflictError(
        "only stopped webhook deliveries can be replayed",
      );
    const subscription = this.#requiredSubscription(current.subscriptionId);
    if (!subscription.enabled)
      throw new OperationsConflictError("webhook subscription is disabled");
    const changed: WebhookDelivery = {
      ...current,
      status: "pending",
      attempts: 0,
      nextAttemptAt: at.toISOString(),
      responseStatus: undefined,
      responseBody: undefined,
      error: undefined,
      deliveredAt: undefined,
      version: current.version + 1,
    };
    this.#deliveries.set(changed.id, changed);
    return cloneDelivery(changed);
  }

  cancel(deliveryId: string, expectedVersion: number): WebhookDelivery {
    const current = this.#requiredDelivery(deliveryId);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError(
        "webhook delivery version does not match",
      );
    if (["delivered", "failed", "cancelled"].includes(current.status))
      throw new OperationsConflictError(
        "completed webhook delivery cannot be cancelled",
      );
    const changed: WebhookDelivery = {
      ...current,
      status: "cancelled",
      version: current.version + 1,
    };
    this.#deliveries.set(changed.id, changed);
    return cloneDelivery(changed);
  }

  verify(body: string, signature: string, secret: string): boolean {
    const expected = Buffer.from(sign(body, secret));
    const actual = Buffer.from(signature);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  subscriptions(ownerId?: string): readonly WebhookSubscription[] {
    return [...this.#subscriptions.values()]
      .filter((value) => !ownerId || value.ownerId === ownerId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(cloneSubscription);
  }
  deliveries(
    filters: {
      subscriptionId?: string;
      eventId?: string;
      status?: WebhookDelivery["status"];
    } = {},
  ): readonly WebhookDelivery[] {
    return [...this.#deliveries.values()]
      .filter(
        (value) =>
          !filters.subscriptionId ||
          value.subscriptionId === filters.subscriptionId,
      )
      .filter((value) => !filters.eventId || value.eventId === filters.eventId)
      .filter((value) => !filters.status || value.status === filters.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(cloneDelivery);
  }

  #requiredSubscription(id: string): WebhookSubscription {
    const value = this.#subscriptions.get(
      operationsText(id, "webhook subscription id"),
    );
    if (!value)
      throw new OperationsValidationError(
        "webhook subscription does not exist",
      );
    return value;
  }
  #requiredDelivery(id: string): WebhookDelivery {
    const value = this.#deliveries.get(
      operationsText(id, "webhook delivery id"),
    );
    if (!value)
      throw new OperationsValidationError("webhook delivery does not exist");
    return value;
  }
  #recordSubscriptionOutcome(
    subscription: WebhookSubscription,
    successful: boolean,
    responseStatus: number | undefined,
    at: Date,
  ): void {
    const failureCount = successful ? 0 : subscription.failureCount + 1;
    const disable = responseStatus === 410 || failureCount >= 20;
    const changed = {
      ...subscription,
      enabled: disable ? false : subscription.enabled,
      failureCount,
      disabledAt: disable ? at.toISOString() : subscription.disabledAt,
      version: subscription.version + 1,
    };
    this.#subscriptions.set(changed.id, changed);
  }
}

function validateSubscription(value: WebhookSubscription): WebhookSubscription {
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new OperationsValidationError("webhook URL is invalid");
  }
  if (url.protocol !== "https:")
    throw new OperationsValidationError("webhook URL must use HTTPS");
  if (value.secret.length < 24)
    throw new OperationsValidationError(
      "webhook secret must contain at least 24 characters",
    );
  const events = [
    ...new Set(
      value.events.map((event) =>
        operationsText(event, "webhook event").toLowerCase(),
      ),
    ),
  ].sort();
  if (!events.length)
    throw new OperationsValidationError(
      "webhook subscription needs at least one event",
    );
  return {
    ...value,
    id: operationsText(value.id, "webhook subscription id"),
    ownerId: operationsText(value.ownerId, "webhook owner"),
    url: url.toString(),
    events,
    secret: value.secret,
    description: value.description?.trim(),
  };
}
function validateEvent(value: WebhookEvent): WebhookEvent {
  const metadata = Object.fromEntries(
    Object.entries(value.metadata ?? {}).map(([key, item]) => [
      operationsText(key, "event metadata key"),
      operationsText(item, "event metadata value"),
    ]),
  );
  try {
    return {
      ...value,
      id: operationsText(value.id, "webhook event id"),
      type: operationsText(value.type, "webhook event type").toLowerCase(),
      occurredAt: new Date(value.occurredAt).toISOString(),
      data: structuredClone(value.data),
      metadata,
    };
  } catch {
    throw new OperationsValidationError("webhook event data is invalid");
  }
}
function matchesEvent(patterns: readonly string[], type: string): boolean {
  return patterns.some(
    (pattern) =>
      pattern === "*" ||
      pattern === type ||
      (pattern.endsWith(".*") && type.startsWith(pattern.slice(0, -1))),
  );
}
function eventBody(value: WebhookEvent): string {
  return JSON.stringify(value);
}
function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}
function truncate(
  value: string | undefined,
  maximum: number,
): string | undefined {
  return value === undefined ? undefined : value.slice(0, maximum);
}
function cloneSubscription(value: WebhookSubscription): WebhookSubscription {
  return { ...value, events: [...value.events] };
}
function cloneDelivery(value: WebhookDelivery): WebhookDelivery {
  return { ...value };
}
