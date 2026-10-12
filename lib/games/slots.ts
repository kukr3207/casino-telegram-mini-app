import { uniformInteger } from "../fairness/seed-chain.ts";

export interface SlotSymbol {
  id: string;
  weight: number;
  payouts: Readonly<Record<number, number>>;
  wild?: boolean;
  scatter?: boolean;
}

export interface SlotConfiguration {
  id: string;
  reels: number;
  rows: number;
  paylines: readonly (readonly number[])[];
  symbols: readonly SlotSymbol[];
  scatterPayouts?: Readonly<Record<number, number>>;
  freeSpins?: Readonly<Record<number, number>>;
}

export interface PaylineWin {
  payline: number;
  symbol: string;
  count: number;
  multiplier: number;
  payout: bigint;
}

export interface SlotSpin {
  grid: readonly (readonly string[])[];
  paylineWins: readonly PaylineWin[];
  scatterCount: number;
  scatterPayout: bigint;
  totalPayout: bigint;
  freeSpinsAwarded: number;
}

export function validateSlotConfiguration(configuration: SlotConfiguration): SlotConfiguration {
  if (!configuration.id.trim()) throw new RangeError("slot configuration id cannot be blank");
  if (!Number.isSafeInteger(configuration.reels) || configuration.reels < 3 || configuration.reels > 10) throw new RangeError("slot reels must be from 3 to 10");
  if (!Number.isSafeInteger(configuration.rows) || configuration.rows < 1 || configuration.rows > 8) throw new RangeError("slot rows must be from 1 to 8");
  if (configuration.symbols.length < 2 || new Set(configuration.symbols.map((symbol) => symbol.id)).size !== configuration.symbols.length) {
    throw new RangeError("slot symbols must contain unique entries");
  }
  for (const symbol of configuration.symbols) {
    if (!symbol.id.trim() || !Number.isSafeInteger(symbol.weight) || symbol.weight <= 0) throw new RangeError("slot symbol id and weight are invalid");
    for (const [count, payout] of Object.entries(symbol.payouts)) {
      if (Number(count) < 2 || Number(count) > configuration.reels || !Number.isSafeInteger(payout) || payout < 0) throw new RangeError("slot symbol payout is invalid");
    }
  }
  for (const payline of configuration.paylines) {
    if (payline.length !== configuration.reels || payline.some((row) => !Number.isSafeInteger(row) || row < 0 || row >= configuration.rows)) {
      throw new RangeError("slot payline must select one row from each reel");
    }
  }
  return configuration;
}

function weightedSymbol(symbols: readonly SlotSymbol[], value: number): SlotSymbol {
  let cursor = value;
  for (const symbol of symbols) {
    if (cursor < symbol.weight) return symbol;
    cursor -= symbol.weight;
  }
  return symbols.at(-1)!;
}

function lineWin(symbols: readonly SlotSymbol[], stake: bigint, lineNumber: number): PaylineWin | null {
  const firstPaying = symbols.find((symbol) => !symbol.wild);
  if (!firstPaying) return null;
  let count = 0;
  for (const symbol of symbols) {
    if (symbol.id === firstPaying.id || symbol.wild) count += 1;
    else break;
  }
  const multiplier = firstPaying.payouts[count] ?? 0;
  if (!multiplier) return null;
  return { payline: lineNumber, symbol: firstPaying.id, count, multiplier, payout: stake * BigInt(multiplier) };
}

export function spinSlots(input: {
  configuration: SlotConfiguration;
  stakePerLine: bigint;
  serverSeed: string;
  clientSeed: string;
  nonce: bigint | number | string;
}): SlotSpin {
  const configuration = validateSlotConfiguration(input.configuration);
  if (input.stakePerLine <= 0n) throw new RangeError("slot stake per line must be positive");
  const totalWeight = configuration.symbols.reduce((total, symbol) => total + symbol.weight, 0);
  const grid: string[][] = [];
  let cursor = 0;
  for (let reel = 0; reel < configuration.reels; reel += 1) {
    const column: string[] = [];
    for (let row = 0; row < configuration.rows; row += 1) {
      column.push(weightedSymbol(configuration.symbols, uniformInteger(
        input.serverSeed, input.clientSeed, input.nonce, totalWeight, cursor++,
      )).id);
    }
    grid.push(column);
  }
  const symbolMap = new Map(configuration.symbols.map((symbol) => [symbol.id, symbol]));
  const paylineWins = configuration.paylines
    .map((payline, index) => lineWin(payline.map((row, reel) => symbolMap.get(grid[reel][row])!), input.stakePerLine, index))
    .filter((win): win is PaylineWin => win !== null);
  const scatters = configuration.symbols.filter((symbol) => symbol.scatter).map((symbol) => symbol.id);
  const scatterCount = grid.flat().filter((symbol) => scatters.includes(symbol)).length;
  const scatterMultiplier = configuration.scatterPayouts?.[scatterCount] ?? 0;
  const scatterPayout = input.stakePerLine * BigInt(configuration.paylines.length) * BigInt(scatterMultiplier);
  const freeSpinsAwarded = configuration.freeSpins?.[scatterCount] ?? 0;
  return {
    grid, paylineWins, scatterCount, scatterPayout,
    totalPayout: paylineWins.reduce((total, win) => total + win.payout, scatterPayout),
    freeSpinsAwarded,
  };
}

export function theoreticalReturn(configuration: SlotConfiguration): number {
  validateSlotConfiguration(configuration);
  const totalWeight = configuration.symbols.reduce((total, symbol) => total + symbol.weight, 0);
  let returnPerLine = 0;
  for (const paying of configuration.symbols.filter((symbol) => !symbol.scatter)) {
    const matchProbability = (paying.weight + configuration.symbols.filter((symbol) => symbol.wild && symbol.id !== paying.id).reduce((total, symbol) => total + symbol.weight, 0)) / totalWeight;
    for (const [countText, multiplier] of Object.entries(paying.payouts)) {
      const count = Number(countText);
      const exact = count === configuration.reels
        ? matchProbability ** count
        : matchProbability ** count * (1 - matchProbability);
      returnPerLine += exact * multiplier;
    }
  }
  return returnPerLine;
}
