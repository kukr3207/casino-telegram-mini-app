export interface PlaySession {
  id: string;
  playerId: string;
  startedAt: string;
  lastActivityAt: string;
  endedAt?: string;
  wagered: bigint;
  won: bigint;
  rounds: number;
  realityChecks: string[];
}

function date(value: string | Date): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError("session time is invalid");
  return parsed;
}

export class SessionTracker {
  readonly #sessions = new Map<string, PlaySession>();

  start(id: string, playerId: string, at: string | Date): PlaySession {
    if (!id.trim() || !playerId.trim()) throw new RangeError("session and player ids cannot be blank");
    const timestamp = date(at).toISOString();
    const value: PlaySession = {
      id: id.trim(), playerId: playerId.trim(), startedAt: timestamp, lastActivityAt: timestamp,
      wagered: 0n, won: 0n, rounds: 0, realityChecks: [],
    };
    const existing = this.#sessions.get(value.id);
    if (existing) return existing;
    if ([...this.#sessions.values()].some((session) => session.playerId === value.playerId && !session.endedAt)) {
      throw new Error("player already has an active session");
    }
    this.#sessions.set(value.id, value);
    return value;
  }

  recordRound(id: string, stake: bigint, payout: bigint, at: string | Date): PlaySession {
    const session = this.get(id);
    if (session.endedAt) throw new Error("play session has ended");
    if (stake <= 0n || payout < 0n) throw new RangeError("round stake and payout are invalid");
    const activity = date(at);
    if (activity < new Date(session.lastActivityAt)) throw new RangeError("session activity cannot move backward");
    const changed = {
      ...session, lastActivityAt: activity.toISOString(), wagered: session.wagered + stake,
      won: session.won + payout, rounds: session.rounds + 1,
    };
    this.#sessions.set(id, changed);
    return changed;
  }

  realityCheck(id: string, at: string | Date, intervalMinutes = 60): { due: boolean; elapsedMinutes: number; net: bigint } {
    const session = this.get(id);
    const timestamp = date(at);
    const elapsedMinutes = Math.floor((timestamp.getTime() - new Date(session.startedAt).getTime()) / 60000);
    const last = session.realityChecks.at(-1) ?? session.startedAt;
    const due = timestamp.getTime() - new Date(last).getTime() >= intervalMinutes * 60000;
    if (due) {
      session.realityChecks.push(timestamp.toISOString());
      session.lastActivityAt = timestamp.toISOString();
    }
    return { due, elapsedMinutes, net: session.won - session.wagered };
  }

  end(id: string, at: string | Date): PlaySession {
    const session = this.get(id);
    if (session.endedAt) return session;
    const ended = date(at);
    if (ended < new Date(session.lastActivityAt)) throw new RangeError("session end cannot precede activity");
    const changed = { ...session, endedAt: ended.toISOString(), lastActivityAt: ended.toISOString() };
    this.#sessions.set(id, changed);
    return changed;
  }

  get(id: string): PlaySession {
    const session = this.#sessions.get(id);
    if (!session) throw new Error("play session was not found");
    return session;
  }
}
