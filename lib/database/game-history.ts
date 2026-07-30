import type { Collection, Document, Filter } from "mongodb";

import {
  diceHistoryFromDocument,
  GameHistoryRecord,
  GameKind,
  HistoryPage,
  sortHistory,
  summarizeHistory,
  wheelHistoryFromDocument,
} from "../domain/game-history";
import type { WheelOutcome } from "../domain/wheel-outcomes";
import type { VerifiableDiceRoll, VerifiableSelection } from "../security/fair-random";
import { verifyDiceProof, verifyWheelProof } from "../security/fairness-verifier";
import { chatIdFilter, TelegramChatId } from "../validation/chat-id";
import { casinoDatabase } from "./mongo";

const DICE_COLLECTION = "dice-rolls";
const WHEEL_COLLECTION = "wheel-spins";

export interface HistoryQuery {
  limit: number;
  game: GameKind | "all";
  before?: Date;
}

interface DiceDocument extends Document {
  chatId: TelegramChatId;
  dice1: number;
  dice2: number;
  seed: string;
  hash: string;
  createdAt: Date;
}

interface WheelDocument extends Document {
  chatId: TelegramChatId;
  outcome: WheelOutcome;
  outcomeIndex: number;
  seed: string;
  hash: string;
  createdAt: Date;
}

let indexPromise: Promise<void> | undefined;

async function collections(): Promise<{
  dice: Collection<DiceDocument>;
  wheel: Collection<WheelDocument>;
}> {
  const database = await casinoDatabase();
  return {
    dice: database.collection<DiceDocument>(DICE_COLLECTION),
    wheel: database.collection<WheelDocument>(WHEEL_COLLECTION),
  };
}

async function ensureIndexes(): Promise<void> {
  if (!indexPromise) {
    indexPromise = (async () => {
      const { dice, wheel } = await collections();
      await Promise.all([
        dice.createIndex({ chatId: 1, createdAt: -1 }),
        wheel.createIndex({ chatId: 1, createdAt: -1 }),
      ]);
    })().catch((error: unknown) => {
      indexPromise = undefined;
      throw error;
    });
  }
  return indexPromise;
}

export async function recordDiceRoll(
  chatId: TelegramChatId,
  roll: VerifiableDiceRoll,
  createdAt: Date = new Date(),
): Promise<string> {
  await ensureIndexes();
  const { dice } = await collections();
  const result = await dice.insertOne({ chatId, ...roll, createdAt });
  return result.insertedId.toHexString();
}

export async function recordWheelSpin(
  chatId: TelegramChatId,
  selection: VerifiableSelection<WheelOutcome>,
  createdAt: Date = new Date(),
): Promise<string> {
  await ensureIndexes();
  const { wheel } = await collections();
  const result = await wheel.insertOne({ chatId, ...selection, createdAt });
  return result.insertedId.toHexString();
}

function historyFilter(chatId: unknown, before?: Date): Filter<Document> {
  return {
    ...chatIdFilter(chatId),
    ...(before ? { createdAt: { $lt: before } } : {}),
  };
}

async function diceHistory(chatId: unknown, query: HistoryQuery): Promise<GameHistoryRecord[]> {
  if (query.game === "wheel") return [];
  const { dice } = await collections();
  const documents = await dice
    .find(historyFilter(chatId, query.before) as Filter<DiceDocument>)
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit)
    .toArray();
  return documents
    .map(diceHistoryFromDocument)
    .filter((record): record is NonNullable<typeof record> => record !== null);
}

async function wheelHistory(chatId: unknown, query: HistoryQuery): Promise<GameHistoryRecord[]> {
  if (query.game === "dice") return [];
  const { wheel } = await collections();
  const documents = await wheel
    .find(historyFilter(chatId, query.before) as Filter<WheelDocument>)
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit)
    .toArray();
  return documents
    .map(wheelHistoryFromDocument)
    .filter((record): record is NonNullable<typeof record> => record !== null);
}

export async function listGameHistory(chatId: unknown, query: HistoryQuery): Promise<HistoryPage> {
  await ensureIndexes();
  const candidates = await Promise.all([
    diceHistory(chatId, query),
    wheelHistory(chatId, query),
  ]);
  const records = sortHistory(candidates.flat()).slice(0, query.limit);
  const verification = new Map(
    records.map((record) => {
      const result =
        record.game === "dice"
          ? verifyDiceProof(record)
          : verifyWheelProof(record);
      return [record.id, result] as const;
    }),
  );

  return {
    records,
    summary: summarizeHistory(records, verification),
    nextBefore:
      records.length === query.limit ? records[records.length - 1].playedAt : null,
  };
}

