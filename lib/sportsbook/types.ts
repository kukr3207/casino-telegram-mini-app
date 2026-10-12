export type Sport =
  | "american_football"
  | "baseball"
  | "basketball"
  | "boxing"
  | "cricket"
  | "esports"
  | "football"
  | "golf"
  | "ice_hockey"
  | "mma"
  | "rugby"
  | "tennis";

export type EventStatus =
  | "scheduled"
  | "live"
  | "suspended"
  | "finished"
  | "cancelled"
  | "abandoned";

export type MarketStatus =
  | "open"
  | "suspended"
  | "closed"
  | "settled"
  | "voided";

export type SelectionResult =
  | "pending"
  | "won"
  | "lost"
  | "void"
  | "half_won"
  | "half_lost";

export type BetStatus =
  | "pending"
  | "accepted"
  | "partially_settled"
  | "won"
  | "lost"
  | "voided"
  | "cashed_out"
  | "rejected";

export type BetKind = "single" | "accumulator" | "system";

export type MarketKind =
  | "moneyline"
  | "spread"
  | "total"
  | "both_score"
  | "correct_score"
  | "draw_no_bet"
  | "first_scorer"
  | "player_prop"
  | "set_betting"
  | "outright";

export type SettlementRule =
  | "standard"
  | "dead_heat"
  | "push_void"
  | "asian_quarter"
  | "retirement_void";

export interface Participant {
  id: string;
  name: string;
  role: "home" | "away" | "competitor" | "team" | "player";
  country?: string;
  seed?: number;
}

export interface SportEvent {
  id: string;
  sport: Sport;
  competitionId: string;
  season?: string;
  name: string;
  startsAt: string;
  expectedEndsAt?: string;
  status: EventStatus;
  participants: readonly Participant[];
  venue?: string;
  country?: string;
  liveClock?: string;
  livePeriod?: string;
  sourceRevision: number;
  version: number;
}

export interface Price {
  numerator: bigint;
  denominator: bigint;
}

export interface Selection {
  id: string;
  marketId: string;
  name: string;
  participantId?: string;
  line?: string;
  price: Price;
  status: "active" | "suspended" | "removed";
  result: SelectionResult;
  probabilityBasisPoints?: number;
  version: number;
}

export interface BettingMarket {
  id: string;
  eventId: string;
  kind: MarketKind;
  name: string;
  period: string;
  line?: string;
  settlementRule: SettlementRule;
  status: MarketStatus;
  inPlay: boolean;
  cashOutEnabled: boolean;
  selections: readonly Selection[];
  sequence: number;
  version: number;
}

export interface BetLeg {
  eventId: string;
  marketId: string;
  selectionId: string;
  acceptedPrice: Price;
  currentPrice?: Price;
  result: SelectionResult;
  settledAt?: string;
}

export interface Bet {
  id: string;
  playerId: string;
  kind: BetKind;
  currency: string;
  stakeMinor: bigint;
  potentialReturnMinor: bigint;
  acceptedReturnMinor: bigint;
  legs: readonly BetLeg[];
  systemSize?: number;
  status: BetStatus;
  requestId: string;
  placedAt: string;
  acceptedAt?: string;
  settledAt?: string;
  cashOutMinor?: bigint;
  rejectionReason?: string;
  version: number;
}

export interface BetQuote {
  id: string;
  playerId: string;
  currency: string;
  stakeMinor: bigint;
  legs: readonly BetLeg[];
  kind: BetKind;
  systemSize?: number;
  potentialReturnMinor: bigint;
  expiresAt: string;
  fingerprint: string;
}

export interface EventResult {
  eventId: string;
  status: "official" | "provisional" | "corrected" | "void";
  scores: Readonly<Record<string, number>>;
  facts: Readonly<Record<string, string | number | boolean>>;
  source: string;
  sourceRevision: number;
  recordedAt: string;
}

export interface BetPayout {
  betId: string;
  stakeMinor: bigint;
  grossReturnMinor: bigint;
  taxableWinMinor: bigint;
  taxMinor: bigint;
  netReturnMinor: bigint;
  result: BetStatus;
  settledAt: string;
}

export interface LimitDecision {
  accepted: boolean;
  maximumStakeMinor: bigint;
  reasons: readonly string[];
  manualReview: boolean;
}

export interface Exposure {
  key: string;
  eventId: string;
  marketId?: string;
  selectionId?: string;
  currency: string;
  liabilityMinor: bigint;
  stakeMinor: bigint;
  betCount: number;
}

export interface CashOutQuote {
  id: string;
  betId: string;
  playerId: string;
  currency: string;
  amountMinor: bigint;
  fairValueMinor: bigint;
  marginBasisPoints: number;
  createdAt: string;
  expiresAt: string;
  fingerprint: string;
  status: "open" | "accepted" | "expired" | "withdrawn";
}

export class SportsbookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SportsbookValidationError";
  }
}

export class SportsbookConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SportsbookConflictError";
  }
}

export function requiredText(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SportsbookValidationError(`${field} is required`);
  }
  return value.trim();
}

export function normalizedCurrency(value: string): string {
  const currency = requiredText(value, "currency").toUpperCase();
  if (!/^[A-Z][A-Z0-9]{2,7}$/.test(currency)) {
    throw new SportsbookValidationError("currency is invalid");
  }
  return currency;
}

export function parsedDate(value: string | Date, field: string): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new SportsbookValidationError(`${field} is invalid`);
  }
  return date;
}

export function positiveMinor(value: bigint, field: string): bigint {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new SportsbookValidationError(`${field} must be positive`);
  }
  return value;
}

export function validatePrice(value: Price): Price {
  if (typeof value.numerator !== "bigint" || typeof value.denominator !== "bigint") {
    throw new SportsbookValidationError("price components must be integers");
  }
  if (value.numerator <= value.denominator || value.denominator <= 0n) {
    throw new SportsbookValidationError("decimal price must be greater than one");
  }
  const divisor = greatestCommonDivisor(value.numerator, value.denominator);
  return {
    numerator: value.numerator / divisor,
    denominator: value.denominator / divisor,
  };
}

export function decimalPrice(value: Price): number {
  const price = validatePrice(value);
  return Number(price.numerator) / Number(price.denominator);
}

export function multiplyPrice(left: Price, right: Price): Price {
  return validatePrice({
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator,
  });
}

export function returnForStake(stakeMinor: bigint, price: Price): bigint {
  positiveMinor(stakeMinor, "stake");
  const normalized = validatePrice(price);
  return (stakeMinor * normalized.numerator) / normalized.denominator;
}

export function impliedProbabilityBasisPoints(price: Price): number {
  const normalized = validatePrice(price);
  return Number((10_000n * normalized.denominator) / normalized.numerator);
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1n;
}
