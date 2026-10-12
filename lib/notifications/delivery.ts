import { randomUUID } from "node:crypto";
import type {
  DeliveryAttempt,
  NotificationChannel,
  NotificationDelivery,
  NotificationRequest,
} from "./types.ts";
import { NotificationValidationError, cloneDelivery, cloneNotification } from "./types.ts";
import { NotificationPreferenceStore } from "./preferences.ts";

export interface ChannelProvider {
  readonly channel: NotificationChannel;
  send(notification: NotificationRequest): Promise<{ providerMessageId: string }>;
}

export interface DeliveryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maximumDelayMs: number;
}

interface QueueEntry {
  request: NotificationRequest;
  delivery: NotificationDelivery;
}

const DEFAULT_POLICY: DeliveryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maximumDelayMs: 60_000,
};

export class NotificationDeliveryQueue {
  private readonly entries = new Map<string, QueueEntry>();
  private readonly providers = new Map<NotificationChannel, ChannelProvider>();
  private readonly policy: DeliveryPolicy;
  private readonly preferences: NotificationPreferenceStore;

  constructor(
    preferences: NotificationPreferenceStore,
    providers: readonly ChannelProvider[],
    policy: Partial<DeliveryPolicy> = {},
  ) {
    this.preferences = preferences;
    this.policy = validatePolicy({ ...DEFAULT_POLICY, ...policy });
    for (const provider of providers) {
      if (this.providers.has(provider.channel)) {
        throw new NotificationValidationError(`duplicate provider for ${provider.channel}`);
      }
      this.providers.set(provider.channel, provider);
    }
  }

  enqueue(request: NotificationRequest, at = new Date()): readonly NotificationDelivery[] {
    const allowed = this.preferences.allowedChannels(
      request.playerId,
      request.category,
      request.priority,
      request.channels,
      at,
    );
    const deliveries: NotificationDelivery[] = [];
    for (const channel of request.channels) {
      const existing = [...this.entries.values()].find(
        (entry) => entry.request.id === request.id && entry.delivery.channel === channel,
      );
      if (existing) {
        deliveries.push(cloneDelivery(existing.delivery));
        continue;
      }
      const status = allowed.includes(channel) ? "queued" : "suppressed";
      const delivery: NotificationDelivery = {
        id: randomUUID(),
        notificationId: request.id,
        playerId: request.playerId,
        channel,
        status,
        nextAttemptAt: status === "queued" ? new Date(at) : undefined,
        attempts: [],
        createdAt: new Date(at),
        updatedAt: new Date(at),
      };
      this.entries.set(delivery.id, { request: cloneNotification(request), delivery });
      deliveries.push(cloneDelivery(delivery));
    }
    return deliveries;
  }

  async drain(at = new Date(), limit = 100): Promise<readonly NotificationDelivery[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new NotificationValidationError("delivery drain limit is invalid");
    }
    const due = [...this.entries.values()]
      .filter((entry) => entry.delivery.status === "queued" && entry.delivery.nextAttemptAt! <= at)
      .sort((left, right) => left.delivery.nextAttemptAt!.getTime() - right.delivery.nextAttemptAt!.getTime())
      .slice(0, limit);
    const completed: NotificationDelivery[] = [];
    for (const entry of due) completed.push(await this.deliver(entry, at));
    return completed;
  }

  get(deliveryId: string): NotificationDelivery | undefined {
    const entry = this.entries.get(deliveryId.trim());
    return entry ? cloneDelivery(entry.delivery) : undefined;
  }

  listDeadLetters(): readonly NotificationDelivery[] {
    return [...this.entries.values()]
      .filter((entry) => entry.delivery.status === "dead_letter")
      .map((entry) => cloneDelivery(entry.delivery));
  }

  replay(deliveryId: string, at = new Date()): NotificationDelivery {
    const entry = this.entries.get(deliveryId.trim());
    if (!entry || entry.delivery.status !== "dead_letter") {
      throw new NotificationValidationError("dead-letter delivery does not exist");
    }
    entry.delivery = {
      ...entry.delivery,
      status: "queued",
      nextAttemptAt: new Date(at),
      updatedAt: new Date(at),
    };
    return cloneDelivery(entry.delivery);
  }

  private async deliver(entry: QueueEntry, at: Date): Promise<NotificationDelivery> {
    const provider = this.providers.get(entry.delivery.channel);
    const attemptNumber = entry.delivery.attempts.length + 1;
    if (!provider) {
      return this.recordFailure(entry, at, attemptNumber, "channel provider is not configured");
    }
    entry.delivery = { ...entry.delivery, status: "sending", updatedAt: new Date(at) };
    try {
      const result = await provider.send(cloneNotification(entry.request));
      const attempt: DeliveryAttempt = {
        attempt: attemptNumber,
        startedAt: new Date(at),
        completedAt: new Date(at),
        outcome: "delivered",
        providerMessageId: result.providerMessageId,
      };
      entry.delivery = {
        ...entry.delivery,
        status: "delivered",
        nextAttemptAt: undefined,
        attempts: [...entry.delivery.attempts, attempt],
        updatedAt: new Date(at),
      };
      return cloneDelivery(entry.delivery);
    } catch (error) {
      return this.recordFailure(entry, at, attemptNumber, error instanceof Error ? error.message : String(error));
    }
  }

  private recordFailure(entry: QueueEntry, at: Date, attemptNumber: number, error: string): NotificationDelivery {
    const attempt: DeliveryAttempt = {
      attempt: attemptNumber,
      startedAt: new Date(at),
      completedAt: new Date(at),
      outcome: "failed",
      error,
    };
    const exhausted = attemptNumber >= this.policy.maxAttempts;
    const delay = Math.min(this.policy.maximumDelayMs, this.policy.baseDelayMs * 2 ** (attemptNumber - 1));
    entry.delivery = {
      ...entry.delivery,
      status: exhausted ? "dead_letter" : "queued",
      nextAttemptAt: exhausted ? undefined : new Date(at.getTime() + delay),
      attempts: [...entry.delivery.attempts, attempt],
      updatedAt: new Date(at),
    };
    return cloneDelivery(entry.delivery);
  }
}

function validatePolicy(policy: DeliveryPolicy): DeliveryPolicy {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new NotificationValidationError(`${name} must be a positive integer`);
    }
  }
  if (policy.maximumDelayMs < policy.baseDelayMs) {
    throw new NotificationValidationError("maximum delay cannot be less than base delay");
  }
  return { ...policy };
}
