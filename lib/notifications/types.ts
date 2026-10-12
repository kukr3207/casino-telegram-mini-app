export type NotificationChannel = "telegram" | "email" | "push" | "inbox";
export type NotificationCategory = "security" | "transactional" | "responsible_play" | "game" | "social" | "marketing";
export type NotificationPriority = "low" | "normal" | "high" | "urgent";
export type DeliveryStatus = "queued" | "sending" | "delivered" | "failed" | "suppressed" | "dead_letter";

export interface NotificationContent {
  subject?: string;
  text: string;
  actionUrl?: string;
  data?: Readonly<Record<string, string>>;
}

export interface NotificationRequest {
  id: string;
  playerId: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  channels: readonly NotificationChannel[];
  content: NotificationContent;
  createdAt: Date;
  expiresAt?: Date;
  deduplicationKey?: string;
}

export interface DeliveryAttempt {
  attempt: number;
  startedAt: Date;
  completedAt: Date;
  outcome: "delivered" | "failed";
  providerMessageId?: string;
  error?: string;
}

export interface NotificationDelivery {
  id: string;
  notificationId: string;
  playerId: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  nextAttemptAt?: Date;
  attempts: readonly DeliveryAttempt[];
  createdAt: Date;
  updatedAt: Date;
}

export class NotificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationValidationError";
  }
}

export function requiredText(value: string, field: string, max = 512): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NotificationValidationError(`${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > max) throw new NotificationValidationError(`${field} is too long`);
  return normalized;
}

export function cloneNotification(request: NotificationRequest): NotificationRequest {
  return {
    ...request,
    channels: [...request.channels],
    content: { ...request.content, data: request.content.data ? { ...request.content.data } : undefined },
    createdAt: new Date(request.createdAt),
    expiresAt: request.expiresAt ? new Date(request.expiresAt) : undefined,
  };
}

export function cloneDelivery(delivery: NotificationDelivery): NotificationDelivery {
  return {
    ...delivery,
    createdAt: new Date(delivery.createdAt),
    updatedAt: new Date(delivery.updatedAt),
    nextAttemptAt: delivery.nextAttemptAt ? new Date(delivery.nextAttemptAt) : undefined,
    attempts: delivery.attempts.map((attempt) => ({
      ...attempt,
      startedAt: new Date(attempt.startedAt),
      completedAt: new Date(attempt.completedAt),
    })),
  };
}

