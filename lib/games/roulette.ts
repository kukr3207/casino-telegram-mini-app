import { uniformInteger } from "../fairness/seed-chain.ts";

export type RouletteColor = "red" | "black" | "green";
export type RouletteBetKind =
  | "straight" | "split" | "street" | "corner" | "six_line"
  | "dozen" | "column" | "red" | "black" | "odd" | "even" | "low" | "high";

export interface RouletteBet {
  id: string;
  kind: RouletteBetKind;
  selection: readonly number[];
  stake: bigint;
}

export interface RouletteResult {
  pocket: number;
  color: RouletteColor;
  parity: "odd" | "even" | "none";
  range: "low" | "high" | "none";
  winningBets: readonly { betId: string; payout: bigint; odds: number }[];
  totalStake: bigint;
  totalPayout: bigint;
}

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function rouletteColor(pocket: number): RouletteColor {
  if (!Number.isSafeInteger(pocket) || pocket < 0 || pocket > 36) throw new RangeError("roulette pocket must be from 0 to 36");
  return pocket === 0 ? "green" : RED.has(pocket) ? "red" : "black";
}

function expectedSize(kind: RouletteBetKind): number | null {
  return ({ straight: 1, split: 2, street: 3, corner: 4, six_line: 6 } as Partial<Record<RouletteBetKind, number>>)[kind] ?? null;
}

function canonicalSelection(kind: RouletteBetKind, selection: readonly number[]): number[] {
  const values = [...new Set(selection)].sort((left, right) => left - right);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 36)) throw new RangeError("roulette selection contains an invalid pocket");
  const size = expectedSize(kind);
  if (size !== null && values.length !== size) throw new RangeError(`${kind} bet requires ${size} pockets`);
  if (kind === "dozen" && (values.length !== 1 || ![1, 2, 3].includes(values[0]))) throw new RangeError("dozen selection must be 1, 2, or 3");
  if (kind === "column" && (values.length !== 1 || ![1, 2, 3].includes(values[0]))) throw new RangeError("column selection must be 1, 2, or 3");
  if (["red", "black", "odd", "even", "low", "high"].includes(kind) && values.length) throw new RangeError(`${kind} bet does not accept pockets`);
  return values;
}

export function validateRouletteBet(bet: RouletteBet): RouletteBet {
  if (!bet.id.trim()) throw new RangeError("roulette bet id cannot be blank");
  if (bet.stake <= 0n) throw new RangeError("roulette stake must be positive");
  const kinds = new Set<RouletteBetKind>([
    "straight", "split", "street", "corner", "six_line", "dozen", "column",
    "red", "black", "odd", "even", "low", "high",
  ]);
  if (!kinds.has(bet.kind)) throw new RangeError("roulette bet kind is not supported");
  return { ...bet, id: bet.id.trim(), selection: canonicalSelection(bet.kind, bet.selection) };
}

export function rouletteBetWins(bet: RouletteBet, pocket: number): boolean {
  const value = validateRouletteBet(bet);
  const color = rouletteColor(pocket);
  if (expectedSize(value.kind) !== null) return value.selection.includes(pocket);
  if (value.kind === "red" || value.kind === "black") return color === value.kind;
  if (pocket === 0) return false;
  if (value.kind === "odd" || value.kind === "even") return pocket % 2 === (value.kind === "odd" ? 1 : 0);
  if (value.kind === "low" || value.kind === "high") return value.kind === "low" ? pocket <= 18 : pocket >= 19;
  if (value.kind === "dozen") return Math.ceil(pocket / 12) === value.selection[0];
  if (value.kind === "column") return ((pocket - 1) % 3) + 1 === value.selection[0];
  return false;
}

export function rouletteOdds(kind: RouletteBetKind): number {
  return ({
    straight: 35, split: 17, street: 11, corner: 8, six_line: 5,
    dozen: 2, column: 2, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
  })[kind];
}

export function spinRoulette(input: {
  bets: readonly RouletteBet[];
  serverSeed: string;
  clientSeed: string;
  nonce: bigint | number | string;
}): RouletteResult {
  if (!input.bets.length) throw new RangeError("roulette spin requires at least one bet");
  const bets = input.bets.map(validateRouletteBet);
  if (new Set(bets.map((bet) => bet.id)).size !== bets.length) throw new RangeError("roulette bet ids must be unique");
  const pocket = uniformInteger(input.serverSeed, input.clientSeed, input.nonce, 37);
  const winningBets = bets
    .filter((bet) => rouletteBetWins(bet, pocket))
    .map((bet) => {
      const odds = rouletteOdds(bet.kind);
      return { betId: bet.id, odds, payout: bet.stake * BigInt(odds + 1) };
    });
  const totalStake = bets.reduce((total, bet) => total + bet.stake, 0n);
  const totalPayout = winningBets.reduce((total, bet) => total + bet.payout, 0n);
  return {
    pocket, color: rouletteColor(pocket),
    parity: pocket === 0 ? "none" : pocket % 2 ? "odd" : "even",
    range: pocket === 0 ? "none" : pocket <= 18 ? "low" : "high",
    winningBets, totalStake, totalPayout,
  };
}
