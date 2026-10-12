import { uniformInteger } from "../fairness/seed-chain.ts";

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
  deck: number;
}

export const SUITS: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
export const RANKS: readonly Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

export function createShoe(decks = 6): Card[] {
  if (!Number.isSafeInteger(decks) || decks < 1 || decks > 8) throw new RangeError("shoe decks must be from 1 to 8");
  const cards: Card[] = [];
  for (let deck = 1; deck <= decks; deck += 1) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ suit, rank, deck });
  }
  return cards;
}

export function shuffleShoe(
  cards: readonly Card[],
  serverSeed: string,
  clientSeed: string,
  nonce: bigint | number | string,
): Card[] {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = uniformInteger(serverSeed, clientSeed, nonce, index + 1, result.length - 1 - index);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function cardCode(card: Card): string {
  const suit = { clubs: "C", diamonds: "D", hearts: "H", spades: "S" }[card.suit];
  return `${card.rank}${suit}`;
}

export function parseCard(value: string, deck = 1): Card {
  const suitCode = value.slice(-1).toUpperCase();
  const rank = value.slice(0, -1).toUpperCase() as Rank;
  const suit = ({ C: "clubs", D: "diamonds", H: "hearts", S: "spades" } as const)[suitCode as "C"];
  if (!suit || !RANKS.includes(rank)) throw new RangeError("card code is invalid");
  if (!Number.isSafeInteger(deck) || deck < 1 || deck > 8) throw new RangeError("card deck is invalid");
  return { suit, rank, deck };
}

export function blackjackValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === "A") {
      total += 11;
      aces += 1;
    } else if (["J", "Q", "K"].includes(card.rank)) total += 10;
    else total += Number(card.rank);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && blackjackValue(cards).total === 21;
}
