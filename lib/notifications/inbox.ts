import { createHash, randomUUID } from "node:crypto";
import type { NotificationRequest, NotificationPriority } from "./types.ts";
import { NotificationValidationError, cloneNotification, requiredText } from "./types.ts";

export interface InboxItem {
  id: string;
  playerId: string;
  notification: NotificationRequest;
  readAt?: Date;
  archivedAt?: Date;
  createdAt: Date;
}

export interface InboxPage {
  items: readonly InboxItem[];
  nextCursor?: string;
  unreadCount: number;
}

export class NotificationInbox {
  private readonly items = new Map<string, InboxItem>();
  private readonly deduplication = new Map<string, string>();

  add(notification: NotificationRequest): InboxItem {
    const normalized = validateNotification(notification);
    const dedupeKey = normalized.deduplicationKey
      ? `${normalized.playerId}:${normalized.deduplicationKey}`
      : undefined;
    if (dedupeKey) {
      const existingId = this.deduplication.get(dedupeKey);
      if (existingId) return cloneItem(this.items.get(existingId)!);
    }
    const item: InboxItem = {
      id: randomUUID(),
      playerId: normalized.playerId,
      notification: normalized,
      createdAt: new Date(normalized.createdAt),
    };
    this.items.set(item.id, item);
    if (dedupeKey) this.deduplication.set(dedupeKey, item.id);
    return cloneItem(item);
  }

  list(
    playerId: string,
    options: { limit?: number; cursor?: string; unreadOnly?: boolean; includeArchived?: boolean; at?: Date } = {},
  ): InboxPage {
    const normalizedPlayerId = requiredText(playerId, "player id", 128);
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new NotificationValidationError("inbox limit must be between 1 and 100");
    }
    const at = options.at ?? new Date();
    let values = [...this.items.values()].filter((item) => item.playerId === normalizedPlayerId);
    values = values.filter((item) => !item.notification.expiresAt || item.notification.expiresAt > at);
    if (!options.includeArchived) values = values.filter((item) => !item.archivedAt);
    if (options.unreadOnly) values = values.filter((item) => !item.readAt);
    values.sort(compareInboxItems);
    const start = options.cursor ? decodeCursor(options.cursor, normalizedPlayerId, values) : 0;
    const pageItems = values.slice(start, start + limit);
    const nextCursor = start + limit < values.length
      ? encodeCursor(normalizedPlayerId, pageItems[pageItems.length - 1])
      : undefined;
    const unreadCount = values.filter((item) => !item.readAt).length;
    return { items: pageItems.map(cloneItem), nextCursor, unreadCount };
  }

  markRead(playerId: string, itemIds: readonly string[], at = new Date()): readonly InboxItem[] {
    return this.updateMany(playerId, itemIds, (item) => ({ ...item, readAt: item.readAt ?? at }));
  }

  archive(playerId: string, itemIds: readonly string[], at = new Date()): readonly InboxItem[] {
    return this.updateMany(playerId, itemIds, (item) => ({ ...item, archivedAt: item.archivedAt ?? at }));
  }

  get(playerId: string, itemId: string): InboxItem | undefined {
    const item = this.items.get(itemId.trim());
    return item?.playerId === playerId.trim() ? cloneItem(item) : undefined;
  }

  private updateMany(playerId: string, itemIds: readonly string[], change: (item: InboxItem) => InboxItem): readonly InboxItem[] {
    const normalizedPlayerId = requiredText(playerId, "player id", 128);
    const unique = [...new Set(itemIds.map((id) => requiredText(id, "inbox item id", 128)))];
    const found = unique.map((id) => this.items.get(id));
    if (found.some((item) => !item || item.playerId !== normalizedPlayerId)) {
      throw new NotificationValidationError("one or more inbox items do not exist");
    }
    return found.map((item) => {
      const updated = change(item!);
      this.items.set(updated.id, updated);
      return cloneItem(updated);
    });
  }
}

function validateNotification(notification: NotificationRequest): NotificationRequest {
  const id = requiredText(notification.id, "notification id", 128);
  const playerId = requiredText(notification.playerId, "player id", 128);
  const text = requiredText(notification.content?.text, "notification text", 10_000);
  const createdAt = new Date(notification.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new NotificationValidationError("notification time is invalid");
  const expiresAt = notification.expiresAt ? new Date(notification.expiresAt) : undefined;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= createdAt)) {
    throw new NotificationValidationError("notification expiry must follow creation");
  }
  if (notification.channels.length === 0) throw new NotificationValidationError("at least one channel is required");
  return cloneNotification({
    ...notification,
    id,
    playerId,
    content: { ...notification.content, text },
    createdAt,
    expiresAt,
  });
}

function compareInboxItems(left: InboxItem, right: InboxItem): number {
  const priority: Record<NotificationPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
  return priority[right.notification.priority] - priority[left.notification.priority]
    || right.createdAt.getTime() - left.createdAt.getTime()
    || left.id.localeCompare(right.id);
}

function encodeCursor(playerId: string, item: InboxItem): string {
  const payload = `${playerId}|${item.id}|${item.createdAt.toISOString()}`;
  const checksum = createHash("sha256").update(payload).digest("hex").slice(0, 12);
  return Buffer.from(`${payload}|${checksum}`).toString("base64url");
}

function decodeCursor(cursor: string, playerId: string, items: readonly InboxItem[]): number {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new NotificationValidationError("inbox cursor is invalid");
  }
  const parts = decoded.split("|");
  if (parts.length !== 4 || parts[0] !== playerId) throw new NotificationValidationError("inbox cursor is invalid");
  const payload = parts.slice(0, 3).join("|");
  const checksum = createHash("sha256").update(payload).digest("hex").slice(0, 12);
  if (checksum !== parts[3]) throw new NotificationValidationError("inbox cursor is invalid");
  const index = items.findIndex((item) => item.id === parts[1]);
  if (index < 0) throw new NotificationValidationError("inbox cursor is stale");
  return index + 1;
}

function cloneItem(item: InboxItem): InboxItem {
  return {
    ...item,
    notification: cloneNotification(item.notification),
    createdAt: new Date(item.createdAt),
    readAt: item.readAt ? new Date(item.readAt) : undefined,
    archivedAt: item.archivedAt ? new Date(item.archivedAt) : undefined,
  };
}

