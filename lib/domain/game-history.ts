import type { VerificationResult } from "../security/fairness-verifier.ts";
import { isWheelOutcome, wheelOutcomeLabel } from "./wheel-outcomes.ts";
import type { WheelOutcome } from "./wheel-outcomes.ts";

export type GameKind = "dice" | "wheel";

interface BaseHistoryRecord {
  id: string;
  game: GameKind;
  playedAt: string;
  seed: string;
  hash: string;
}

export interface DiceHistoryRecord extends BaseHistoryRecord {
  game: "dice";
  dice1: number;
  dice2: number;
  total: number;
}

export interface WheelHistoryRecord extends BaseHistoryRecord {
  game: "wheel";
  outcomeIndex: number;
  outcome: WheelOutcome;
}

export type GameHistoryRecord = DiceHistoryRecord | WheelHistoryRecord;

export interface HistorySummary {
  totalGames: number;
  diceRolls: number;
  wheelSpins: number;
  verifiedGames: number;
  tokenPrizes: number;
  boosterPrizes: number;
}

export interface HistoryPage {
  records: GameHistoryRecord[];
  summary: HistorySummary;
  nextBefore: string | null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const candidate = object(value);
  if (candidate && typeof candidate.toHexString === "function") {
    try {
      return String((candidate.toHexString as () => string)());
    } catch {
      return null;
    }
  }
  if (value && typeof value.toString === "function") {
    const text = String(value);
    return text && text !== "[object Object]" ? text : null;
  }
  return null;
}

function isoDate(value: unknown): string | null {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function proofFields(document: Record<string, unknown>): {
  id: string;
  playedAt: string;
  seed: string;
  hash: string;
} | null {
  const id = identifier(document._id ?? document.id);
  const playedAt = isoDate(document.createdAt ?? document.playedAt);
  const seed = typeof document.seed === "string" ? document.seed : "";
  const hash = typeof document.hash === "string" ? document.hash : "";
  if (!id || !playedAt || !seed || !hash) return null;
  return { id, playedAt, seed, hash };
}

export function diceHistoryFromDocument(value: unknown): DiceHistoryRecord | null {
  const document = object(value);
  if (!document) return null;
  const proof = proofFields(document);
  const dice1 = Number(document.dice1);
  const dice2 = Number(document.dice2);
  if (
    !proof ||
    !Number.isInteger(dice1) ||
    !Number.isInteger(dice2) ||
    dice1 < 1 ||
    dice1 > 6 ||
    dice2 < 1 ||
    dice2 > 6
  ) {
    return null;
  }
  return { ...proof, game: "dice", dice1, dice2, total: dice1 + dice2 };
}

export function wheelHistoryFromDocument(value: unknown): WheelHistoryRecord | null {
  const document = object(value);
  if (!document) return null;
  const proof = proofFields(document);
  const outcomeIndex = Number(document.outcomeIndex);
  if (!proof || !Number.isSafeInteger(outcomeIndex) || !isWheelOutcome(document.outcome)) {
    return null;
  }
  return { ...proof, game: "wheel", outcomeIndex, outcome: document.outcome };
}

export function sortHistory(records: readonly GameHistoryRecord[]): GameHistoryRecord[] {
  return [...records].sort((left, right) => {
    const byDate = Date.parse(right.playedAt) - Date.parse(left.playedAt);
    return byDate || right.id.localeCompare(left.id);
  });
}

export function summarizeHistory(
  records: readonly GameHistoryRecord[],
  verification: ReadonlyMap<string, VerificationResult> = new Map(),
): HistorySummary {
  const summary: HistorySummary = {
    totalGames: records.length,
    diceRolls: 0,
    wheelSpins: 0,
    verifiedGames: 0,
    tokenPrizes: 0,
    boosterPrizes: 0,
  };

  for (const record of records) {
    if (record.game === "dice") summary.diceRolls += 1;
    if (record.game === "wheel") {
      summary.wheelSpins += 1;
      if (record.outcome.type === "token") summary.tokenPrizes += record.outcome.value;
      if (record.outcome.type === "booster") summary.boosterPrizes += 1;
    }
    if (verification.get(record.id)?.valid) summary.verifiedGames += 1;
  }
  return summary;
}

export function gameHistoryLabel(record: GameHistoryRecord): string {
  if (record.game === "dice") {
    return `Dice ${record.dice1} + ${record.dice2} = ${record.total}`;
  }
  return `Wheel: ${wheelOutcomeLabel(record.outcome)}`;
}

export function parseHistoryLimit(value: unknown, fallback = 20): number {
  if (value === null || value === undefined || value === "") return fallback;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError("limit must be a whole number from 1 to 50");
  }
  return limit;
}

export function parseGameFilter(value: unknown): GameKind | "all" {
  if (value === null || value === undefined || value === "" || value === "all") return "all";
  if (value === "dice" || value === "wheel") return value;
  throw new RangeError("game must be 'dice', 'wheel', or 'all'");
}

export function parseBefore(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new RangeError("before must be an ISO-8601 date");
  return date;
}
