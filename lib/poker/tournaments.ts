import {
  type BlindLevel,
  type PokerTournament,
  type TournamentEntry,
  PokerConflictError,
  PokerValidationError,
  pokerDate,
  pokerText,
} from "./types.ts";

export interface TournamentLedgerEntry {
  sequence: number;
  tournamentId: string;
  playerId: string;
  kind: "buy_in" | "fee" | "refund" | "prize";
  amountMinor: bigint;
  reference: string;
  occurredAt: string;
}

export interface TournamentPayout {
  playerId: string;
  finishingPosition: number;
  amountMinor: bigint;
  basisPoints: number;
}

export class PokerTournamentService {
  readonly #tournaments = new Map<string, PokerTournament>();
  readonly #entries = new Map<string, TournamentEntry[]>();
  readonly #ledger: TournamentLedgerEntry[] = [];
  readonly #references = new Map<string, TournamentLedgerEntry>();

  create(value: PokerTournament): PokerTournament {
    const tournament = validateTournament(value);
    if (this.#tournaments.has(tournament.id)) throw new PokerConflictError("tournament id already exists");
    this.#tournaments.set(tournament.id, tournament);
    this.#entries.set(tournament.id, []);
    return cloneTournament(tournament);
  }

  transition(
    tournamentId: string,
    expectedVersion: number,
    status: PokerTournament["status"],
  ): PokerTournament {
    const tournament = this.requireTournament(tournamentId);
    if (tournament.version !== expectedVersion) throw new PokerConflictError("tournament version does not match");
    const allowed: Readonly<Record<PokerTournament["status"], readonly PokerTournament["status"][]>> = {
      scheduled: ["registering", "cancelled"],
      registering: ["running", "cancelled"],
      running: ["paused", "finished", "cancelled"],
      paused: ["running", "cancelled"],
      finished: [],
      cancelled: [],
    };
    if (status !== tournament.status && !allowed[tournament.status].includes(status)) {
      throw new PokerConflictError(`cannot move tournament from ${tournament.status} to ${status}`);
    }
    const changed = { ...tournament, status, version: tournament.version + 1 };
    this.#tournaments.set(changed.id, changed);
    if (status === "cancelled") this.refundOpenEntries(changed, new Date());
    return cloneTournament(changed);
  }

  register(
    tournamentId: string,
    playerId: string,
    reference: string,
    at = new Date(),
  ): TournamentEntry {
    const tournament = this.requireTournament(tournamentId);
    const id = pokerText(playerId, "player id");
    const key = pokerText(reference, "registration reference");
    const previous = this.#references.get(key);
    if (previous) {
      if (previous.tournamentId !== tournament.id || previous.playerId !== id) {
        throw new PokerConflictError("registration reference was already used");
      }
      const entryNumber = this.#entries.get(tournament.id)!.filter((entry) => entry.playerId === id).length;
      return cloneEntry(this.#entries.get(tournament.id)!.find((entry) => entry.playerId === id && entry.entryNumber === entryNumber)!);
    }
    const registeredAt = pokerDate(at, "registration time");
    if (!['scheduled', 'registering'].includes(tournament.status)) {
      throw new PokerConflictError("tournament registration is closed");
    }
    if (registeredAt >= new Date(tournament.lateRegistrationEndsAt)) {
      throw new PokerConflictError("late registration window ended");
    }
    const entries = this.#entries.get(tournament.id)!;
    if (entries.length >= tournament.maximumEntries) throw new PokerConflictError("tournament is full");
    const priorEntries = entries.filter((entry) => entry.playerId === id);
    if (priorEntries.length > tournament.reentryLimit) throw new PokerConflictError("player reentry limit reached");
    if (priorEntries.some((entry) => !['eliminated', 'refunded'].includes(entry.status))) {
      throw new PokerConflictError("player already has an active entry");
    }
    const entry: TournamentEntry = {
      tournamentId: tournament.id,
      playerId: id,
      entryNumber: priorEntries.length + 1,
      registeredAt: registeredAt.toISOString(),
      stackMinor: tournament.startingStackMinor,
      status: tournament.status === "scheduled" ? "registered" : "playing",
    };
    entries.push(entry);
    this.record(tournament.id, id, "buy_in", tournament.buyInMinor, key, registeredAt);
    if (tournament.feeMinor > 0n) this.record(tournament.id, id, "fee", tournament.feeMinor, `${key}:fee`, registeredAt);
    return cloneEntry(entry);
  }

  eliminate(
    tournamentId: string,
    playerId: string,
    entryNumber: number,
    at = new Date(),
  ): TournamentEntry {
    const tournament = this.requireTournament(tournamentId);
    if (tournament.status !== "running") throw new PokerConflictError("tournament is not running");
    const entries = this.#entries.get(tournament.id)!;
    const index = entries.findIndex((entry) => entry.playerId === playerId && entry.entryNumber === entryNumber);
    if (index < 0) throw new PokerValidationError("tournament entry does not exist");
    const current = entries[index];
    if (current.status === "eliminated") return cloneEntry(current);
    if (current.status !== "playing") throw new PokerConflictError("entry is not playing");
    const active = entries.filter((entry) => ['registered', 'playing'].includes(entry.status));
    const changed: TournamentEntry = {
      ...current,
      status: "eliminated",
      stackMinor: 0n,
      finishingPosition: active.length,
      eliminatedAt: pokerDate(at, "elimination time").toISOString(),
    };
    entries[index] = changed;
    return cloneEntry(changed);
  }

  updateStack(
    tournamentId: string,
    playerId: string,
    entryNumber: number,
    stackMinor: bigint,
  ): TournamentEntry {
    if (stackMinor < 0n) throw new PokerValidationError("tournament stack cannot be negative");
    const entries = this.#entries.get(tournamentId);
    if (!entries) throw new PokerValidationError("tournament does not exist");
    const index = entries.findIndex((entry) => entry.playerId === playerId && entry.entryNumber === entryNumber);
    if (index < 0) throw new PokerValidationError("tournament entry does not exist");
    const current = entries[index];
    if (current.status !== "playing") throw new PokerConflictError("entry is not playing");
    entries[index] = { ...current, stackMinor };
    return cloneEntry(entries[index]);
  }

  finish(tournamentId: string, winnerPlayerId: string, at = new Date()): readonly TournamentPayout[] {
    const tournament = this.requireTournament(tournamentId);
    if (tournament.status !== "running") throw new PokerConflictError("tournament is not running");
    const entries = this.#entries.get(tournament.id)!;
    const winnerIndex = entries.findIndex((entry) => entry.playerId === winnerPlayerId && entry.status === "playing");
    if (winnerIndex < 0) throw new PokerValidationError("winner does not have a live entry");
    entries[winnerIndex] = { ...entries[winnerIndex], status: "eliminated", finishingPosition: 1, eliminatedAt: at.toISOString() };
    const ordered = [...entries]
      .filter((entry) => entry.finishingPosition !== undefined)
      .sort((left, right) => left.finishingPosition! - right.finishingPosition!);
    const prizePool = tournament.buyInMinor * BigInt(entries.length);
    const payouts: TournamentPayout[] = [];
    for (let index = 0; index < tournament.prizesBasisPoints.length && index < ordered.length; index += 1) {
      const entry = ordered[index];
      const basisPoints = tournament.prizesBasisPoints[index];
      const amountMinor = (prizePool * BigInt(basisPoints)) / 10_000n;
      entry.status = "paid";
      entry.prizeMinor = amountMinor;
      payouts.push({ playerId: entry.playerId, finishingPosition: entry.finishingPosition!, amountMinor, basisPoints });
      this.record(tournament.id, entry.playerId, "prize", amountMinor, `${tournament.id}:prize:${entry.finishingPosition}`, at);
    }
    this.#tournaments.set(tournament.id, { ...tournament, status: "finished", version: tournament.version + 1 });
    return payouts;
  }

  blindLevel(tournamentId: string, at = new Date()): BlindLevel {
    const tournament = this.requireTournament(tournamentId);
    const elapsedMinutes = Math.max(0, Math.floor((at.getTime() - new Date(tournament.startsAt).getTime()) / 60_000));
    let cursor = 0;
    for (const level of tournament.blindLevels) {
      cursor += level.durationMinutes;
      if (elapsedMinutes < cursor) return { ...level };
    }
    return { ...tournament.blindLevels.at(-1)! };
  }

  entries(tournamentId: string): readonly TournamentEntry[] {
    return (this.#entries.get(tournamentId.trim()) ?? []).map(cloneEntry);
  }

  ledger(tournamentId: string): readonly TournamentLedgerEntry[] {
    return this.#ledger.filter((entry) => entry.tournamentId === tournamentId).map((entry) => ({ ...entry }));
  }

  private refundOpenEntries(tournament: PokerTournament, at: Date): void {
    for (const entry of this.#entries.get(tournament.id) ?? []) {
      if (!['registered', 'playing'].includes(entry.status)) continue;
      entry.status = "refunded";
      const amount = tournament.buyInMinor + tournament.feeMinor;
      this.record(tournament.id, entry.playerId, "refund", amount, `${tournament.id}:refund:${entry.playerId}:${entry.entryNumber}`, at);
    }
  }

  private record(tournamentId: string, playerId: string, kind: TournamentLedgerEntry["kind"], amountMinor: bigint, reference: string, at: Date): void {
    const existing = this.#references.get(reference);
    if (existing) {
      if (existing.tournamentId !== tournamentId || existing.playerId !== playerId || existing.kind !== kind || existing.amountMinor !== amountMinor) {
        throw new PokerConflictError("ledger reference contains different data");
      }
      return;
    }
    const entry = { sequence: this.#ledger.length + 1, tournamentId, playerId, kind, amountMinor, reference, occurredAt: at.toISOString() };
    this.#ledger.push(entry);
    this.#references.set(reference, entry);
  }

  private requireTournament(tournamentId: string): PokerTournament {
    const value = this.#tournaments.get(pokerText(tournamentId, "tournament id"));
    if (!value) throw new PokerValidationError("tournament does not exist");
    return value;
  }
}

function validateTournament(value: PokerTournament): PokerTournament {
  const id = pokerText(value.id, "tournament id");
  const name = pokerText(value.name, "tournament name");
  const currency = pokerText(value.currency, "currency").toUpperCase();
  if (value.buyInMinor <= 0n || value.feeMinor < 0n || value.startingStackMinor <= 0n) throw new PokerValidationError("tournament amounts are invalid");
  if (!Number.isSafeInteger(value.maximumEntries) || value.maximumEntries < 2) throw new PokerValidationError("maximum entries is invalid");
  if (!Number.isSafeInteger(value.reentryLimit) || value.reentryLimit < 0) throw new PokerValidationError("reentry limit is invalid");
  const startsAt = pokerDate(value.startsAt, "tournament start");
  const lateRegistrationEndsAt = pokerDate(value.lateRegistrationEndsAt, "late registration end");
  if (lateRegistrationEndsAt < startsAt) throw new PokerValidationError("late registration cannot end before start");
  if (value.blindLevels.length === 0) throw new PokerValidationError("blind schedule cannot be empty");
  value.blindLevels.forEach((level, index) => {
    if (level.level !== index + 1 || level.durationMinutes < 1 || level.smallBlindMinor <= 0n || level.bigBlindMinor < level.smallBlindMinor || level.anteMinor < 0n) {
      throw new PokerValidationError("blind schedule is invalid");
    }
  });
  if (value.prizesBasisPoints.length === 0 || value.prizesBasisPoints.some((share) => !Number.isSafeInteger(share) || share <= 0)) {
    throw new PokerValidationError("prize schedule is invalid");
  }
  if (value.prizesBasisPoints.reduce((sum, share) => sum + share, 0) !== 10_000) throw new PokerValidationError("prize schedule must total 100 percent");
  return { ...value, id, name, currency, startsAt: startsAt.toISOString(), lateRegistrationEndsAt: lateRegistrationEndsAt.toISOString(), blindLevels: value.blindLevels.map((level) => ({ ...level })), prizesBasisPoints: [...value.prizesBasisPoints] };
}

function cloneTournament(value: PokerTournament): PokerTournament {
  return { ...value, blindLevels: value.blindLevels.map((level) => ({ ...level })), prizesBasisPoints: [...value.prizesBasisPoints] };
}

function cloneEntry(value: TournamentEntry): TournamentEntry {
  return { ...value };
}
