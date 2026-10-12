import { randomUUID } from "node:crypto";
import { BonusConflictError, BonusValidationError, required, validDate } from "./campaigns.ts";

export interface FreeSpinPack {
  id: string;
  playerId: string;
  campaignId: string;
  game: string;
  spinValueMinor: bigint;
  currency: string;
  totalSpins: number;
  remainingSpins: number;
  reservedSpins: number;
  winningsMinor: bigint;
  grantedAt: Date;
  expiresAt: Date;
  status: "active" | "completed" | "expired" | "cancelled";
  version: number;
}

export interface FreeSpinReservation {
  id: string;
  packId: string;
  roundId: string;
  reservedAt: Date;
  settledAt?: Date;
  cancelledAt?: Date;
  winningsMinor?: bigint;
}

export class FreeSpinService {
  private readonly packs = new Map<string, FreeSpinPack>();
  private readonly reservations = new Map<string, FreeSpinReservation>();
  private readonly rounds = new Map<string, string>();

  grant(input: Omit<FreeSpinPack, "id" | "remainingSpins" | "reservedSpins" | "winningsMinor" | "status" | "version">): FreeSpinPack {
    if (!Number.isInteger(input.totalSpins) || input.totalSpins < 1) throw new BonusValidationError("free-spin count must be positive");
    if (input.spinValueMinor <= 0n) throw new BonusValidationError("free-spin value must be positive");
    const grantedAt = validDate(input.grantedAt, "free-spin grant time");
    const expiresAt = validDate(input.expiresAt, "free-spin expiry");
    if (expiresAt <= grantedAt) throw new BonusValidationError("free-spin expiry must follow its grant");
    const pack: FreeSpinPack = {
      ...input,
      id: randomUUID(),
      playerId: required(input.playerId, "player id"),
      campaignId: required(input.campaignId, "campaign id"),
      game: required(input.game, "game").toLowerCase(),
      currency: required(input.currency, "currency").toUpperCase(),
      grantedAt,
      expiresAt,
      remainingSpins: input.totalSpins,
      reservedSpins: 0,
      winningsMinor: 0n,
      status: "active",
      version: 1,
    };
    this.packs.set(pack.id, pack);
    return clonePack(pack);
  }

  reserve(packId: string, expectedVersion: number, roundId: string, at = new Date()): { pack: FreeSpinPack; reservation: FreeSpinReservation } {
    const current = this.requireVersion(packId, expectedVersion);
    const normalizedRoundId = required(roundId, "round id");
    const existingId = this.rounds.get(normalizedRoundId);
    if (existingId) {
      const reservation = this.reservations.get(existingId)!;
      if (reservation.packId !== current.id) throw new BonusConflictError("round already reserved another free-spin pack");
      return { pack: clonePack(current), reservation: cloneReservation(reservation) };
    }
    const now = validDate(at, "spin reservation time");
    if (current.status !== "active" || current.expiresAt <= now) throw new BonusConflictError("free-spin pack is not active");
    if (current.remainingSpins <= 0) throw new BonusConflictError("free-spin pack is exhausted");
    const reservation: FreeSpinReservation = {
      id: randomUUID(),
      packId: current.id,
      roundId: normalizedRoundId,
      reservedAt: now,
    };
    const updated = {
      ...current,
      remainingSpins: current.remainingSpins - 1,
      reservedSpins: current.reservedSpins + 1,
      version: current.version + 1,
    };
    this.packs.set(updated.id, updated);
    this.reservations.set(reservation.id, reservation);
    this.rounds.set(normalizedRoundId, reservation.id);
    return { pack: clonePack(updated), reservation: cloneReservation(reservation) };
  }

  settle(reservationId: string, winningsMinor: bigint, at = new Date()): { pack: FreeSpinPack; reservation: FreeSpinReservation } {
    const reservation = this.reservations.get(required(reservationId, "reservation id"));
    if (!reservation) throw new BonusValidationError("free-spin reservation does not exist");
    if (reservation.settledAt) return { pack: clonePack(this.packs.get(reservation.packId)!), reservation: cloneReservation(reservation) };
    if (reservation.cancelledAt) throw new BonusConflictError("free-spin reservation was cancelled");
    if (winningsMinor < 0n) throw new BonusValidationError("free-spin winnings cannot be negative");
    const current = this.packs.get(reservation.packId)!;
    const settledAt = validDate(at, "spin settlement time");
    const completed = current.remainingSpins === 0 && current.reservedSpins === 1;
    const updated: FreeSpinPack = {
      ...current,
      reservedSpins: current.reservedSpins - 1,
      winningsMinor: current.winningsMinor + winningsMinor,
      status: completed ? "completed" : current.status,
      version: current.version + 1,
    };
    const settled = { ...reservation, settledAt, winningsMinor };
    this.packs.set(updated.id, updated);
    this.reservations.set(settled.id, settled);
    return { pack: clonePack(updated), reservation: cloneReservation(settled) };
  }

  cancel(reservationId: string, at = new Date()): { pack: FreeSpinPack; reservation: FreeSpinReservation } {
    const reservation = this.reservations.get(required(reservationId, "reservation id"));
    if (!reservation) throw new BonusValidationError("free-spin reservation does not exist");
    if (reservation.cancelledAt) return { pack: clonePack(this.packs.get(reservation.packId)!), reservation: cloneReservation(reservation) };
    if (reservation.settledAt) throw new BonusConflictError("settled free spin cannot be cancelled");
    const current = this.packs.get(reservation.packId)!;
    const cancelled = { ...reservation, cancelledAt: validDate(at, "spin cancellation time") };
    const updated = {
      ...current,
      remainingSpins: current.remainingSpins + 1,
      reservedSpins: current.reservedSpins - 1,
      version: current.version + 1,
    };
    this.packs.set(updated.id, updated);
    this.reservations.set(cancelled.id, cancelled);
    return { pack: clonePack(updated), reservation: cloneReservation(cancelled) };
  }

  expire(packId: string, expectedVersion: number, at = new Date()): FreeSpinPack {
    const current = this.requireVersion(packId, expectedVersion);
    const now = validDate(at, "free-spin expiry time");
    if (now < current.expiresAt) throw new BonusConflictError("free-spin pack has not expired");
    if (current.reservedSpins > 0) throw new BonusConflictError("free-spin pack has unsettled reservations");
    const updated: FreeSpinPack = { ...current, status: "expired", remainingSpins: 0, version: current.version + 1 };
    this.packs.set(updated.id, updated);
    return clonePack(updated);
  }

  activeForPlayer(playerId: string, game?: string, at = new Date()): readonly FreeSpinPack[] {
    return [...this.packs.values()]
      .filter((pack) => pack.playerId === playerId.trim() && pack.status === "active" && pack.expiresAt > at)
      .filter((pack) => !game || pack.game === game.toLowerCase())
      .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime())
      .map(clonePack);
  }

  private requireVersion(packId: string, expectedVersion: number): FreeSpinPack {
    const current = this.packs.get(required(packId, "free-spin pack id"));
    if (!current) throw new BonusValidationError("free-spin pack does not exist");
    if (current.version !== expectedVersion) throw new BonusConflictError("free-spin pack version does not match");
    return current;
  }
}

function clonePack(value: FreeSpinPack): FreeSpinPack {
  return { ...value, grantedAt: new Date(value.grantedAt), expiresAt: new Date(value.expiresAt) };
}

function cloneReservation(value: FreeSpinReservation): FreeSpinReservation {
  return {
    ...value,
    reservedAt: new Date(value.reservedAt),
    settledAt: value.settledAt ? new Date(value.settledAt) : undefined,
    cancelledAt: value.cancelledAt ? new Date(value.cancelledAt) : undefined,
  };
}

