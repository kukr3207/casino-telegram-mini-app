export interface LoyaltyTier {
  id: string;
  minimumPoints: bigint;
  cashbackBps: number;
  dailyGift: bigint;
  priority: number;
}

export interface LoyaltyAccount {
  playerId: string;
  points: bigint;
  lifetimePoints: bigint;
  tierId: string;
  updatedAt: string;
}

export interface PointEvent {
  id: string;
  playerId: string;
  points: bigint;
  reason: string;
  occurredAt: string;
}

export class LoyaltyService {
  readonly #tiers: LoyaltyTier[];
  readonly #accounts = new Map<string, LoyaltyAccount>();
  readonly #events = new Map<string, PointEvent>();

  constructor(tiers: readonly LoyaltyTier[]) {
    if (!tiers.length || new Set(tiers.map((tier) => tier.id)).size !== tiers.length) throw new RangeError("loyalty tiers must be unique and non-empty");
    for (const tier of tiers) {
      if (!tier.id.trim() || tier.minimumPoints < 0n || tier.dailyGift < 0n || tier.cashbackBps < 0 || tier.cashbackBps > 10000) {
        throw new RangeError("loyalty tier is invalid");
      }
    }
    this.#tiers = [...tiers].sort((left, right) => Number(left.minimumPoints - right.minimumPoints) || left.priority - right.priority);
    if (this.#tiers[0].minimumPoints !== 0n) throw new RangeError("first loyalty tier must start at zero points");
  }

  account(playerId: string, at = new Date()): LoyaltyAccount {
    let value = this.#accounts.get(playerId);
    if (!value) {
      value = { playerId, points: 0n, lifetimePoints: 0n, tierId: this.#tiers[0].id, updatedAt: at.toISOString() };
      this.#accounts.set(playerId, value);
    }
    return value;
  }

  award(event: PointEvent): LoyaltyAccount {
    if (!event.id.trim() || !event.playerId.trim() || !event.reason.trim() || event.points <= 0n) throw new RangeError("loyalty point event is invalid");
    const existing = this.#events.get(event.id);
    if (existing) {
      if (existing.playerId === event.playerId && existing.points === event.points && existing.reason === event.reason) return this.account(event.playerId);
      throw new Error("loyalty event id already exists");
    }
    const before = this.account(event.playerId, new Date(event.occurredAt));
    const points = before.points + event.points;
    const tier = this.tierFor(points);
    const changed = {
      ...before, points, lifetimePoints: before.lifetimePoints + event.points,
      tierId: tier.id, updatedAt: new Date(event.occurredAt).toISOString(),
    };
    this.#events.set(event.id, event);
    this.#accounts.set(event.playerId, changed);
    return changed;
  }

  redeem(playerId: string, points: bigint, at: string | Date): LoyaltyAccount {
    if (points <= 0n) throw new RangeError("redeemed points must be positive");
    const before = this.account(playerId);
    if (points > before.points) throw new RangeError("insufficient loyalty points");
    const remaining = before.points - points;
    const changed = { ...before, points: remaining, tierId: this.tierFor(remaining).id, updatedAt: new Date(at).toISOString() };
    this.#accounts.set(playerId, changed);
    return changed;
  }

  cashback(playerId: string, netLoss: bigint): bigint {
    if (netLoss < 0n) throw new RangeError("net loss cannot be negative");
    const tier = this.#tiers.find((value) => value.id === this.account(playerId).tierId)!;
    return netLoss * BigInt(tier.cashbackBps) / 10000n;
  }

  tierFor(points: bigint): LoyaltyTier {
    return [...this.#tiers].reverse().find((tier) => points >= tier.minimumPoints)!;
  }
}
