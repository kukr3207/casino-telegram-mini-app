import { createHash, createHmac } from "node:crypto";

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export interface ShuffledDeck {
  cards: readonly Card[];
  commitment: string;
  nonce: number;
}

export const suits: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
export const ranks: readonly Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];

export function cardCode(card: Card): string {
  validateCard(card);
  const suitCode: Readonly<Record<Suit, string>> = {
    clubs: "c",
    diamonds: "d",
    hearts: "h",
    spades: "s",
  };
  return `${card.rank}${suitCode[card.suit]}`;
}

export function parseCard(value: string): Card {
  const code = value.trim();
  if (!/^[2-9TJQKA][cdhs]$/.test(code)) throw new RangeError("card code is invalid");
  const suitByCode: Readonly<Record<string, Suit>> = {
    c: "clubs",
    d: "diamonds",
    h: "hearts",
    s: "spades",
  };
  return {
    rank: code[0] as Rank,
    suit: suitByCode[code[1]],
  };
}

export function standardDeck(): readonly Card[] {
  return suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
}

export function shuffledDeck(serverSeed: string, clientSeed: string, nonce: number): ShuffledDeck {
  if (!serverSeed) throw new RangeError("server seed is required");
  if (!clientSeed) throw new RangeError("client seed is required");
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new RangeError("nonce is invalid");
  const cards = [...standardDeck()];
  let cursor = 0;
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const random = randomWord(serverSeed, clientSeed, nonce, cursor);
    cursor += 1;
    const selected = random % (index + 1);
    [cards[index], cards[selected]] = [cards[selected], cards[index]];
  }
  return {
    cards,
    commitment: createHash("sha256").update(serverSeed).digest("hex"),
    nonce,
  };
}

export function verifyShuffle(
  deck: ShuffledDeck,
  serverSeed: string,
  clientSeed: string,
): boolean {
  const expected = shuffledDeck(serverSeed, clientSeed, deck.nonce);
  if (expected.commitment !== deck.commitment) return false;
  return expected.cards.every((card, index) => cardCode(card) === cardCode(deck.cards[index]));
}

function randomWord(serverSeed: string, clientSeed: string, nonce: number, cursor: number): number {
  const digest = createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${nonce}:${cursor}`)
    .digest();
  return digest.readUInt32BE(0);
}

function validateCard(card: Card): void {
  if (!ranks.includes(card.rank) || !suits.includes(card.suit)) {
    throw new RangeError("card is invalid");
  }
}

export type HandCategory =
  | "high_card"
  | "one_pair"
  | "two_pair"
  | "three_of_a_kind"
  | "straight"
  | "flush"
  | "full_house"
  | "four_of_a_kind"
  | "straight_flush";

export interface EvaluatedHand {
  category: HandCategory;
  categoryRank: number;
  kickers: readonly number[];
  cards: readonly Card[];
  score: bigint;
  description: string;
}

const rankValue: Readonly<Record<Rank, number>> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const categoryRank: Readonly<Record<HandCategory, number>> = {
  high_card: 0,
  one_pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_of_a_kind: 7,
  straight_flush: 8,
};

export function evaluateFive(cards: readonly Card[]): EvaluatedHand {
  if (cards.length !== 5) throw new RangeError("five cards are required");
  assertUniqueCards(cards);
  const values = cards.map((card) => rankValue[card.rank]).sort((left, right) => right - left);
  const groups = groupedValues(values);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = straightHighCard(values);
  let category: HandCategory;
  let kickers: number[];
  if (flush && straightHigh) {
    category = "straight_flush";
    kickers = [straightHigh];
  } else if (groups[0].count === 4) {
    category = "four_of_a_kind";
    kickers = [groups[0].value, groups[1].value];
  } else if (groups[0].count === 3 && groups[1].count === 2) {
    category = "full_house";
    kickers = [groups[0].value, groups[1].value];
  } else if (flush) {
    category = "flush";
    kickers = values;
  } else if (straightHigh) {
    category = "straight";
    kickers = [straightHigh];
  } else if (groups[0].count === 3) {
    category = "three_of_a_kind";
    kickers = [groups[0].value, ...groups.slice(1).map((group) => group.value).sort((a, b) => b - a)];
  } else if (groups[0].count === 2 && groups[1].count === 2) {
    category = "two_pair";
    const pairs = groups.slice(0, 2).map((group) => group.value).sort((a, b) => b - a);
    kickers = [...pairs, groups[2].value];
  } else if (groups[0].count === 2) {
    category = "one_pair";
    kickers = [groups[0].value, ...groups.slice(1).map((group) => group.value).sort((a, b) => b - a)];
  } else {
    category = "high_card";
    kickers = values;
  }
  const rank = categoryRank[category];
  return {
    category,
    categoryRank: rank,
    kickers,
    cards: cards.map((card) => ({ ...card })),
    score: scoreHand(rank, kickers),
    description: describe(category, kickers),
  };
}

export function evaluateBest(cards: readonly Card[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) throw new RangeError("five to seven cards are required");
  assertUniqueCards(cards);
  const hands = combinations(cards, 5).map(evaluateFive);
  hands.sort((left, right) => left.score === right.score ? 0 : left.score > right.score ? -1 : 1);
  return hands[0];
}

export function compareHands(left: EvaluatedHand, right: EvaluatedHand): -1 | 0 | 1 {
  if (left.score === right.score) return 0;
  return left.score > right.score ? 1 : -1;
}

function assertUniqueCards(cards: readonly Card[]): void {
  const codes = cards.map(cardCode);
  if (new Set(codes).size !== codes.length) throw new RangeError("cards must be unique");
}

function groupedValues(values: readonly number[]): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || right.value - left.value);
}

function straightHighCard(values: readonly number[]): number | null {
  const unique = [...new Set(values)].sort((left, right) => right - left);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    const high = unique[index];
    if (unique.slice(index, index + 5).every((value, offset) => value === high - offset)) return high;
  }
  return null;
}

function scoreHand(rank: number, kickers: readonly number[]): bigint {
  let score = BigInt(rank);
  for (let index = 0; index < 5; index += 1) {
    score = score * 15n + BigInt(kickers[index] ?? 0);
  }
  return score;
}

function describe(category: HandCategory, kickers: readonly number[]): string {
  const label = category.replaceAll("_", " ");
  return `${label}, ${kickers.join("-")}`;
}

function combinations<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  const select = (start: number, current: T[]): void => {
    if (current.length === size) {
      output.push([...current]);
      return;
    }
    for (let index = start; index <= values.length - (size - current.length); index += 1) {
      current.push(values[index]);
      select(index + 1, current);
      current.pop();
    }
  };
  select(0, []);
  return output;
}
