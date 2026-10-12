export interface ChipGift {
  id: string;
  senderId: string;
  recipientId: string;
  units: bigint;
  message: string;
  sentAt: string;
  expiresAt: string;
  state: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  resolvedAt?: string;
}

export class GiftService {
  readonly #gifts = new Map<string, ChipGift>();

  send(input: {
    id: string;
    senderId: string;
    recipientId: string;
    units: bigint;
    message?: string;
    at: string | Date;
    expiresAfterHours?: number;
  }): ChipGift {
    if (!input.id.trim() || !input.senderId.trim() || !input.recipientId.trim()) throw new RangeError("gift fields cannot be blank");
    if (input.senderId === input.recipientId) throw new RangeError("player cannot gift themselves");
    if (input.units <= 0n) throw new RangeError("gift units must be positive");
    const hours = input.expiresAfterHours ?? 72;
    if (!Number.isSafeInteger(hours) || hours < 1 || hours > 720) throw new RangeError("gift expiry hours are invalid");
    const sentAt = new Date(input.at);
    const gift: ChipGift = {
      id: input.id.trim(), senderId: input.senderId.trim(), recipientId: input.recipientId.trim(),
      units: input.units, message: input.message?.trim().slice(0, 160) ?? "",
      sentAt: sentAt.toISOString(), expiresAt: new Date(sentAt.getTime() + hours * 3600000).toISOString(),
      state: "pending",
    };
    const existing = this.#gifts.get(gift.id);
    if (existing) {
      if (existing.senderId === gift.senderId && existing.recipientId === gift.recipientId && existing.units === gift.units) return existing;
      throw new Error("gift id already exists");
    }
    this.#gifts.set(gift.id, gift);
    return gift;
  }

  resolve(id: string, recipientId: string, accept: boolean, at: string | Date): ChipGift {
    const gift = this.get(id);
    const timestamp = new Date(at);
    if (gift.recipientId !== recipientId) throw new Error("gift does not belong to this recipient");
    if (gift.state !== "pending") return gift;
    if (timestamp >= new Date(gift.expiresAt)) {
      const expired = { ...gift, state: "expired" as const, resolvedAt: timestamp.toISOString() };
      this.#gifts.set(id, expired);
      return expired;
    }
    const changed = { ...gift, state: (accept ? "accepted" : "declined") as ChipGift["state"], resolvedAt: timestamp.toISOString() };
    this.#gifts.set(id, changed);
    return changed;
  }

  cancel(id: string, senderId: string, at: string | Date): ChipGift {
    const gift = this.get(id);
    if (gift.senderId !== senderId || gift.state !== "pending") throw new Error("gift cannot be cancelled");
    const changed = { ...gift, state: "cancelled" as const, resolvedAt: new Date(at).toISOString() };
    this.#gifts.set(id, changed);
    return changed;
  }

  inbox(playerId: string): readonly ChipGift[] {
    return [...this.#gifts.values()]
      .filter((gift) => gift.recipientId === playerId)
      .sort((left, right) => right.sentAt.localeCompare(left.sentAt));
  }

  get(id: string): ChipGift {
    const gift = this.#gifts.get(id);
    if (!gift) throw new Error("gift was not found");
    return gift;
  }
}
