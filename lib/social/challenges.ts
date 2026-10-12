export interface DiceChallenge {
  id: string;
  creatorId: string;
  opponentId: string;
  stake: bigint;
  bestOf: number;
  createdAt: string;
  expiresAt: string;
  state: "pending" | "active" | "completed" | "declined" | "expired" | "cancelled";
  rounds: readonly ChallengeRound[];
  winnerId?: string;
}

export interface ChallengeRound {
  round: number;
  creatorTotal: number;
  opponentTotal: number;
  winnerId: string | null;
  proofIds: readonly [string, string];
}

export class ChallengeService {
  readonly #challenges = new Map<string, DiceChallenge>();

  create(input: {
    id: string;
    creatorId: string;
    opponentId: string;
    stake: bigint;
    bestOf: number;
    at: string | Date;
    expiresAfterMinutes?: number;
  }): DiceChallenge {
    if (!input.id.trim() || !input.creatorId.trim() || !input.opponentId.trim()) throw new RangeError("challenge fields cannot be blank");
    if (input.creatorId === input.opponentId) throw new RangeError("challenge players must differ");
    if (input.stake <= 0n) throw new RangeError("challenge stake must be positive");
    if (!Number.isSafeInteger(input.bestOf) || input.bestOf < 1 || input.bestOf > 9 || input.bestOf % 2 === 0) {
      throw new RangeError("challenge best-of must be an odd number from 1 to 9");
    }
    const created = new Date(input.at);
    const minutes = input.expiresAfterMinutes ?? 60;
    const value: DiceChallenge = {
      id: input.id.trim(), creatorId: input.creatorId.trim(), opponentId: input.opponentId.trim(),
      stake: input.stake, bestOf: input.bestOf, createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + minutes * 60000).toISOString(), state: "pending", rounds: [],
    };
    if (this.#challenges.has(value.id)) throw new Error("challenge id already exists");
    this.#challenges.set(value.id, value);
    return value;
  }

  accept(id: string, opponentId: string, at: string | Date): DiceChallenge {
    const value = this.get(id);
    if (value.opponentId !== opponentId || value.state !== "pending") throw new Error("challenge cannot be accepted");
    if (new Date(at) >= new Date(value.expiresAt)) {
      const expired = { ...value, state: "expired" as const };
      this.#challenges.set(id, expired);
      return expired;
    }
    const active = { ...value, state: "active" as const };
    this.#challenges.set(id, active);
    return active;
  }

  record(id: string, creatorTotal: number, opponentTotal: number, proofIds: readonly [string, string]): DiceChallenge {
    const value = this.get(id);
    if (value.state !== "active") throw new Error("challenge is not active");
    for (const total of [creatorTotal, opponentTotal]) {
      if (!Number.isSafeInteger(total) || total < 2 || total > 12) throw new RangeError("dice challenge total must be from 2 to 12");
    }
    if (!proofIds[0] || !proofIds[1]) throw new RangeError("challenge round requires both proof ids");
    const winnerId = creatorTotal === opponentTotal ? null : creatorTotal > opponentTotal ? value.creatorId : value.opponentId;
    const round = { round: value.rounds.length + 1, creatorTotal, opponentTotal, winnerId, proofIds };
    const rounds = [...value.rounds, round];
    const winsNeeded = Math.floor(value.bestOf / 2) + 1;
    const creatorWins = rounds.filter((item) => item.winnerId === value.creatorId).length;
    const opponentWins = rounds.filter((item) => item.winnerId === value.opponentId).length;
    const winner = creatorWins >= winsNeeded ? value.creatorId : opponentWins >= winsNeeded ? value.opponentId : undefined;
    const changed = { ...value, rounds, ...(winner ? { state: "completed" as const, winnerId: winner } : {}) };
    this.#challenges.set(id, changed);
    return changed;
  }

  get(id: string): DiceChallenge {
    const value = this.#challenges.get(id);
    if (!value) throw new Error("challenge was not found");
    return value;
  }
}
