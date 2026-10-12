import type { Card, EvaluatedHand } from "./cards.ts";

export type PokerVariant = "holdem" | "omaha";
export type TableStatus = "waiting" | "running" | "paused" | "closed";
export type HandStage = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
export type PlayerAction = "fold" | "check" | "call" | "bet" | "raise" | "all_in";

export interface PokerPlayer {
  playerId: string;
  displayName: string;
  seat: number;
  stackMinor: bigint;
  status: "active" | "sitting_out" | "folded" | "all_in" | "left";
  joinedAt: string;
  lastActionAt?: string;
  timeBankSeconds: number;
}

export interface PokerTable {
  id: string;
  name: string;
  variant: PokerVariant;
  currency: string;
  minimumBuyInMinor: bigint;
  maximumBuyInMinor: bigint;
  smallBlindMinor: bigint;
  bigBlindMinor: bigint;
  anteMinor: bigint;
  minimumPlayers: number;
  maximumPlayers: number;
  actionTimeoutSeconds: number;
  rakeBasisPoints: number;
  rakeCapMinor: bigint;
  status: TableStatus;
  players: readonly PokerPlayer[];
  buttonSeat?: number;
  handNumber: number;
  version: number;
}

export interface PokerAction {
  id: string;
  handId: string;
  playerId: string;
  seat: number;
  action: PlayerAction;
  amountMinor: bigint;
  totalStreetCommitmentMinor: bigint;
  occurredAt: string;
  sequence: number;
}

export interface PokerHand {
  id: string;
  tableId: string;
  handNumber: number;
  stage: HandStage;
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  actingSeat?: number;
  communityCards: readonly Card[];
  holeCards: Readonly<Record<string, readonly Card[]>>;
  commitments: Readonly<Record<string, bigint>>;
  streetCommitments: Readonly<Record<string, bigint>>;
  currentBetMinor: bigint;
  minimumRaiseMinor: bigint;
  actions: readonly PokerAction[];
  deckCommitment: string;
  deckCursor: number;
  startedAt: string;
  completedAt?: string;
  version: number;
}

export interface SidePot {
  amountMinor: bigint;
  capMinor: bigint;
  eligiblePlayerIds: readonly string[];
  contributorPlayerIds: readonly string[];
}

export interface PotAward {
  potIndex: number;
  playerId: string;
  amountMinor: bigint;
  hand: EvaluatedHand;
}

export interface HandSettlement {
  handId: string;
  totalPotMinor: bigint;
  rakeMinor: bigint;
  awards: readonly PotAward[];
  finalStacks: Readonly<Record<string, bigint>>;
  settledAt: string;
}

export interface PokerTournament {
  id: string;
  name: string;
  currency: string;
  buyInMinor: bigint;
  feeMinor: bigint;
  startingStackMinor: bigint;
  maximumEntries: number;
  reentryLimit: number;
  lateRegistrationEndsAt: string;
  startsAt: string;
  blindLevels: readonly BlindLevel[];
  prizesBasisPoints: readonly number[];
  status: "scheduled" | "registering" | "running" | "paused" | "finished" | "cancelled";
  version: number;
}

export interface BlindLevel {
  level: number;
  durationMinutes: number;
  smallBlindMinor: bigint;
  bigBlindMinor: bigint;
  anteMinor: bigint;
}

export interface TournamentEntry {
  tournamentId: string;
  playerId: string;
  entryNumber: number;
  registeredAt: string;
  stackMinor: bigint;
  status: "registered" | "playing" | "eliminated" | "refunded" | "paid";
  finishingPosition?: number;
  eliminatedAt?: string;
  prizeMinor?: bigint;
}

export class PokerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PokerValidationError";
  }
}

export class PokerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PokerConflictError";
  }
}

export function pokerText(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PokerValidationError(`${field} is required`);
  return value.trim();
}

export function pokerDate(value: string | Date, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new PokerValidationError(`${field} is invalid`);
  return date;
}

export function pokerAmount(value: bigint, field: string, allowZero = false): bigint {
  if (typeof value !== "bigint" || (allowZero ? value < 0n : value <= 0n)) {
    throw new PokerValidationError(`${field} is invalid`);
  }
  return value;
}
