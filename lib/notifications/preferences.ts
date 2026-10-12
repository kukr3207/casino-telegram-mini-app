import type { NotificationCategory, NotificationChannel, NotificationPriority } from "./types.ts";
import { NotificationValidationError, requiredText } from "./types.ts";

export interface QuietHours {
  startHour: number;
  endHour: number;
  timeZoneOffsetMinutes: number;
}

export interface CategoryPreference {
  category: NotificationCategory;
  enabled: boolean;
  channels: readonly NotificationChannel[];
  minimumPriority: NotificationPriority;
}

export interface PlayerNotificationPreferences {
  playerId: string;
  categories: readonly CategoryPreference[];
  quietHours?: QuietHours;
  locale: string;
  updatedAt: Date;
}

const PRIORITY_ORDER: Readonly<Record<NotificationPriority, number>> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

const MANDATORY_CATEGORIES = new Set<NotificationCategory>(["security", "responsible_play"]);

export class NotificationPreferenceStore {
  private readonly preferences = new Map<string, PlayerNotificationPreferences>();

  save(preferences: PlayerNotificationPreferences): PlayerNotificationPreferences {
    const normalized = normalizePreferences(preferences);
    this.preferences.set(normalized.playerId, normalized);
    return clonePreferences(normalized);
  }

  get(playerId: string): PlayerNotificationPreferences {
    const normalized = requiredText(playerId, "player id", 128);
    const saved = this.preferences.get(normalized);
    return saved ? clonePreferences(saved) : defaultPreferences(normalized);
  }

  allowedChannels(
    playerId: string,
    category: NotificationCategory,
    priority: NotificationPriority,
    requested: readonly NotificationChannel[],
    at: Date,
  ): readonly NotificationChannel[] {
    const preferences = this.get(playerId);
    const categoryPreference = preferences.categories.find((item) => item.category === category);
    const mandatory = MANDATORY_CATEGORIES.has(category);
    if (categoryPreference && !categoryPreference.enabled && !mandatory) return [];
    if (categoryPreference && PRIORITY_ORDER[priority] < PRIORITY_ORDER[categoryPreference.minimumPriority] && !mandatory) {
      return [];
    }
    const optedChannels = new Set(categoryPreference?.channels ?? ["inbox", "telegram", "email", "push"]);
    let result = uniqueChannels(requested).filter((channel) => optedChannels.has(channel) || mandatory);
    if (preferences.quietHours && inQuietHours(at, preferences.quietHours) && priority !== "urgent") {
      result = result.filter((channel) => channel === "inbox");
    }
    return result;
  }
}

function normalizePreferences(preferences: PlayerNotificationPreferences): PlayerNotificationPreferences {
  const playerId = requiredText(preferences.playerId, "player id", 128);
  const locale = requiredText(preferences.locale, "locale", 16);
  const seen = new Set<NotificationCategory>();
  const categories = preferences.categories.map((item) => {
    if (seen.has(item.category)) throw new NotificationValidationError(`duplicate preference for ${item.category}`);
    seen.add(item.category);
    if (!(item.minimumPriority in PRIORITY_ORDER)) {
      throw new NotificationValidationError("minimum priority is invalid");
    }
    return { ...item, channels: uniqueChannels(item.channels) };
  });
  const quietHours = preferences.quietHours ? validateQuietHours(preferences.quietHours) : undefined;
  const updatedAt = new Date(preferences.updatedAt);
  if (!Number.isFinite(updatedAt.getTime())) throw new NotificationValidationError("preference update time is invalid");
  return { playerId, locale, categories, quietHours, updatedAt };
}

function validateQuietHours(value: QuietHours): QuietHours {
  if (!Number.isInteger(value.startHour) || value.startHour < 0 || value.startHour > 23) {
    throw new NotificationValidationError("quiet-hours start must be between 0 and 23");
  }
  if (!Number.isInteger(value.endHour) || value.endHour < 0 || value.endHour > 23) {
    throw new NotificationValidationError("quiet-hours end must be between 0 and 23");
  }
  if (!Number.isInteger(value.timeZoneOffsetMinutes) || Math.abs(value.timeZoneOffsetMinutes) > 14 * 60) {
    throw new NotificationValidationError("time-zone offset is invalid");
  }
  return { ...value };
}

function inQuietHours(at: Date, quietHours: QuietHours): boolean {
  const local = new Date(at.getTime() + quietHours.timeZoneOffsetMinutes * 60_000);
  const hour = local.getUTCHours();
  if (quietHours.startHour === quietHours.endHour) return true;
  if (quietHours.startHour < quietHours.endHour) {
    return hour >= quietHours.startHour && hour < quietHours.endHour;
  }
  return hour >= quietHours.startHour || hour < quietHours.endHour;
}

function uniqueChannels(channels: readonly NotificationChannel[]): NotificationChannel[] {
  const allowed: NotificationChannel[] = ["telegram", "email", "push", "inbox"];
  const unique: NotificationChannel[] = [];
  for (const channel of channels) {
    if (!allowed.includes(channel)) throw new NotificationValidationError(`unsupported channel: ${channel}`);
    if (!unique.includes(channel)) unique.push(channel);
  }
  return unique;
}

function defaultPreferences(playerId: string): PlayerNotificationPreferences {
  return {
    playerId,
    locale: "en",
    updatedAt: new Date(0),
    categories: [],
  };
}

function clonePreferences(value: PlayerNotificationPreferences): PlayerNotificationPreferences {
  return {
    ...value,
    categories: value.categories.map((item) => ({ ...item, channels: [...item.channels] })),
    quietHours: value.quietHours ? { ...value.quietHours } : undefined,
    updatedAt: new Date(value.updatedAt),
  };
}
