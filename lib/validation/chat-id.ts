export type TelegramChatId = number | string;

const DECIMAL_INTEGER = /^-?\d+$/;

export class InvalidChatIdError extends TypeError {
  constructor(message = "Invalid chatId format") {
    super(message);
    this.name = "InvalidChatIdError";
  }
}

/**
 * Telegram IDs are integers, but historical records in this application may
 * contain either their numeric or string representation. Normalize incoming
 * values while preserving identifiers that exceed JavaScript's safe range.
 */
export function parseChatId(value: unknown): TelegramChatId {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value === 0) {
      throw new InvalidChatIdError();
    }
    return value;
  }

  if (typeof value !== "string") {
    throw new InvalidChatIdError();
  }

  const normalized = value.trim();
  if (!normalized || !DECIMAL_INTEGER.test(normalized) || normalized === "0") {
    throw new InvalidChatIdError();
  }

  const numeric = Number(normalized);
  return Number.isSafeInteger(numeric) ? numeric : normalized;
}

/** Return both representations so older MongoDB documents remain readable. */
export function chatIdCandidates(value: unknown): TelegramChatId[] {
  const parsed = parseChatId(value);
  const candidates: TelegramChatId[] = [parsed];
  const alternate = typeof parsed === "number" ? String(parsed) : Number(parsed);

  if (
    (typeof alternate === "string" || Number.isSafeInteger(alternate)) &&
    !candidates.includes(alternate)
  ) {
    candidates.push(alternate);
  }

  return candidates;
}

export function chatIdFilter(value: unknown): {
  chatId: { $in: TelegramChatId[] };
} {
  return { chatId: { $in: chatIdCandidates(value) } };
}

