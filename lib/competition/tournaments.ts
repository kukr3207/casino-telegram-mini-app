export type TournamentMetric = "profit" | "wins" | "wagered" | "points";

export interface TournamentPrize {
  fromRank: number;
  toRank: number;
  kind: "chips" | "withdraw_tokens" | "badge";
  amount: bigint;
}

export interface Tournament {
  id: string;
  name: string;
  game: string | null;
  metric: TournamentMetric;
  startsAt: string;
  endsAt: string;
  entryFee: bigint;
  minimumRounds: number;
  maximumPlayers: number;
  prizes: readonly TournamentPrize[];
  status: "scheduled" | "open" | "running" | "settled" | "cancelled";
}

export interface TournamentEntry {
  tournamentId: string;
  playerId: string;
  joinedAt: string;
  score: bigint;
  rounds: number;
  wagered: bigint;
  won: bigint;
  lastPlayedAt: string | null;
}

export interface TournamentStanding extends TournamentEntry {
  rank: number;
  eligible: boolean;
  prize: TournamentPrize | null;
}

function parsedDate(value: string | Date, field: string): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${field} is invalid`);
  return parsed;
}

export function validateTournament(value: Tournament): Tournament {
  if (!value.id.trim() || !value.name.trim()) throw new RangeError("tournament id and name cannot be blank");
  const starts = parsedDate(value.startsAt, "tournament start");
  const ends = parsedDate(value.endsAt, "tournament end");
  if (ends <= starts) throw new RangeError("tournament end must follow start");
  if (value.entryFee < 0n || value.minimumRounds < 0 || value.maximumPlayers <= 1) throw new RangeError("tournament limits are invalid");
  const occupied = new Set<number>();
  for (const prize of value.prizes) {
    if (prize.fromRank < 1 || prize.toRank < prize.fromRank || prize.amount <= 0n) throw new RangeError("tournament prize is invalid");
    for (let rank = prize.fromRank; rank <= prize.toRank; rank += 1) {
      if (occupied.has(rank)) throw new RangeError("tournament prize ranks overlap");
      occupied.add(rank);
    }
  }
  return { ...value, startsAt: starts.toISOString(), endsAt: ends.toISOString() };
}

function score(metric: TournamentMetric, entry: TournamentEntry): bigint {
  if (metric === "profit") return entry.won - entry.wagered;
  if (metric === "wins" || metric === "points") return entry.score;
  return entry.wagered;
}

export class TournamentService {
  readonly #tournaments = new Map<string, Tournament>();
  readonly #entries = new Map<string, Map<string, TournamentEntry>>();
  readonly #events = new Set<string>();

  add(value: Tournament): void {
    const tournament = validateTournament(value);
    if (this.#tournaments.has(tournament.id)) throw new Error("tournament id already exists");
    this.#tournaments.set(tournament.id, tournament);
    this.#entries.set(tournament.id, new Map());
  }

  join(tournamentId: string, playerId: string, at: string | Date): TournamentEntry {
    const tournament = this.get(tournamentId);
    const timestamp = parsedDate(at, "join time");
    if (!["open", "scheduled"].includes(tournament.status) || timestamp >= new Date(tournament.endsAt)) throw new Error("tournament is not accepting entries");
    const entries = this.#entries.get(tournamentId)!;
    const existing = entries.get(playerId);
    if (existing) return existing;
    if (entries.size >= tournament.maximumPlayers) throw new Error("tournament is full");
    const entry = {
      tournamentId, playerId, joinedAt: timestamp.toISOString(), score: 0n,
      rounds: 0, wagered: 0n, won: 0n, lastPlayedAt: null,
    };
    entries.set(playerId, entry);
    return entry;
  }

  record(input: {
    eventId: string;
    tournamentId: string;
    playerId: string;
    game: string;
    stake: bigint;
    payout: bigint;
    points?: bigint;
    at: string | Date;
  }): TournamentEntry {
    if (this.#events.has(input.eventId)) return this.#entries.get(input.tournamentId)?.get(input.playerId) ?? this.join(input.tournamentId, input.playerId, input.at);
    const tournament = this.get(input.tournamentId);
    if (tournament.game && tournament.game !== input.game) throw new Error("game does not qualify for this tournament");
    const timestamp = parsedDate(input.at, "tournament event time");
    if (timestamp < new Date(tournament.startsAt) || timestamp >= new Date(tournament.endsAt)) throw new Error("event is outside the tournament window");
    if (input.stake <= 0n || input.payout < 0n) throw new RangeError("tournament round values are invalid");
    const before = this.#entries.get(input.tournamentId)!.get(input.playerId);
    if (!before) throw new Error("player did not join the tournament");
    const roundScore = tournament.metric === "wins" ? (input.payout > input.stake ? 1n : 0n) : (input.points ?? 0n);
    const changed = {
      ...before, rounds: before.rounds + 1, wagered: before.wagered + input.stake,
      won: before.won + input.payout, score: before.score + roundScore,
      lastPlayedAt: timestamp.toISOString(),
    };
    this.#entries.get(input.tournamentId)!.set(input.playerId, changed);
    this.#events.add(input.eventId);
    return changed;
  }

  standings(tournamentId: string): readonly TournamentStanding[] {
    const tournament = this.get(tournamentId);
    return [...this.#entries.get(tournamentId)!.values()]
      .sort((left, right) => {
        const difference = score(tournament.metric, right) - score(tournament.metric, left);
        if (difference > 0n) return 1;
        if (difference < 0n) return -1;
        return (left.lastPlayedAt ?? left.joinedAt).localeCompare(right.lastPlayedAt ?? right.joinedAt) || left.playerId.localeCompare(right.playerId);
      })
      .map((entry, index) => {
        const rank = index + 1;
        const eligible = entry.rounds >= tournament.minimumRounds;
        const prize = eligible ? tournament.prizes.find((value) => rank >= value.fromRank && rank <= value.toRank) ?? null : null;
        return { ...entry, rank, eligible, prize };
      });
  }

  get(id: string): Tournament {
    const value = this.#tournaments.get(id);
    if (!value) throw new Error("tournament was not found");
    return value;
  }
}
