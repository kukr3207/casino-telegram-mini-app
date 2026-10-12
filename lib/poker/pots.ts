import {
  compareHands,
  evaluateBest,
  type Card,
  type EvaluatedHand,
} from "./cards.ts";
import {
  type HandSettlement,
  type PokerHand,
  type PokerPlayer,
  type PotAward,
  type SidePot,
  PokerConflictError,
  PokerValidationError,
} from "./types.ts";

export function buildSidePots(
  commitments: Readonly<Record<string, bigint>>,
  foldedPlayerIds: readonly string[],
): readonly SidePot[] {
  const folded = new Set(foldedPlayerIds);
  const entries = Object.entries(commitments)
    .filter(([, amount]) => amount > 0n)
    .sort((left, right) =>
      left[1] === right[1]
        ? left[0].localeCompare(right[0])
        : left[1] < right[1]
          ? -1
          : 1,
    );
  if (entries.length === 0) return [];
  const levels = [...new Set(entries.map(([, amount]) => amount))].sort(
    (left, right) => (left < right ? -1 : 1),
  );
  const pots: SidePot[] = [];
  let previous = 0n;
  for (const level of levels) {
    const contributors = entries
      .filter(([, amount]) => amount >= level)
      .map(([playerId]) => playerId);
    const eligible = contributors.filter((playerId) => !folded.has(playerId));
    const amount = (level - previous) * BigInt(contributors.length);
    if (amount > 0n) {
      pots.push({
        amountMinor: amount,
        capMinor: level,
        eligiblePlayerIds: eligible,
        contributorPlayerIds: contributors,
      });
    }
    previous = level;
  }
  return pots;
}

export function settlePokerHand(input: {
  hand: PokerHand;
  players: readonly PokerPlayer[];
  communityCards: readonly Card[];
  rakeBasisPoints: number;
  rakeCapMinor: bigint;
  settledAt: Date;
}): HandSettlement {
  if (input.hand.stage !== "showdown" && input.hand.stage !== "complete") {
    throw new PokerConflictError("hand is not ready for settlement");
  }
  if (input.communityCards.length !== 5) {
    throw new PokerValidationError("showdown requires five community cards");
  }
  if (
    !Number.isSafeInteger(input.rakeBasisPoints) ||
    input.rakeBasisPoints < 0 ||
    input.rakeBasisPoints > 1_000
  ) {
    throw new PokerValidationError("rake rate is invalid");
  }
  if (input.rakeCapMinor < 0n)
    throw new PokerValidationError("rake cap is invalid");
  const folded = input.players
    .filter((player) => ["folded", "left"].includes(player.status))
    .map((player) => player.playerId);
  const pots = buildSidePots(input.hand.commitments, folded);
  const totalPotMinor = pots.reduce(
    (total, pot) => total + pot.amountMinor,
    0n,
  );
  const calculatedRake =
    (totalPotMinor * BigInt(input.rakeBasisPoints)) / 10_000n;
  const rakeMinor =
    calculatedRake > input.rakeCapMinor ? input.rakeCapMinor : calculatedRake;
  const rakeByPot = allocateProportionally(
    rakeMinor,
    pots.map((pot) => pot.amountMinor),
  );
  const awards: PotAward[] = [];
  for (let index = 0; index < pots.length; index += 1) {
    const pot = pots[index];
    if (pot.eligiblePlayerIds.length === 0) continue;
    const evaluated = pot.eligiblePlayerIds.map((playerId) => ({
      playerId,
      hand: playerHand(input.hand, playerId, input.communityCards),
    }));
    const best = evaluated.reduce((current, candidate) =>
      compareHands(candidate.hand, current.hand) > 0 ? candidate : current,
    );
    const winners = evaluated
      .filter((candidate) => compareHands(candidate.hand, best.hand) === 0)
      .sort(
        (left, right) =>
          playerSeat(input.players, left.playerId) -
          playerSeat(input.players, right.playerId),
      );
    const distributable = pot.amountMinor - rakeByPot[index];
    const share = distributable / BigInt(winners.length);
    let remainder = distributable % BigInt(winners.length);
    for (const winner of winners) {
      const oddChip = remainder > 0n ? 1n : 0n;
      remainder -= oddChip;
      awards.push({
        potIndex: index,
        playerId: winner.playerId,
        amountMinor: share + oddChip,
        hand: winner.hand,
      });
    }
  }
  const finalStacks: Record<string, bigint> = {};
  for (const player of input.players) {
    const won = awards
      .filter((award) => award.playerId === player.playerId)
      .reduce((total, award) => total + award.amountMinor, 0n);
    finalStacks[player.playerId] = player.stackMinor + won;
  }
  return {
    handId: input.hand.id,
    totalPotMinor,
    rakeMinor,
    awards,
    finalStacks,
    settledAt: input.settledAt.toISOString(),
  };
}

function playerHand(
  hand: PokerHand,
  playerId: string,
  board: readonly Card[],
): EvaluatedHand {
  const hole = hand.holeCards[playerId];
  if (!hole)
    throw new PokerValidationError(
      "hole cards are missing for showdown player",
    );
  return evaluateBest([...hole, ...board]);
}

function playerSeat(players: readonly PokerPlayer[], playerId: string): number {
  const player = players.find((candidate) => candidate.playerId === playerId);
  if (!player) throw new PokerValidationError("showdown player is not seated");
  return player.seat;
}

function allocateProportionally(
  amount: bigint,
  weights: readonly bigint[],
): bigint[] {
  if (amount === 0n) return weights.map(() => 0n);
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total <= 0n) return weights.map(() => 0n);
  const allocations = weights.map((weight) => (amount * weight) / total);
  let remainder = amount - allocations.reduce((sum, value) => sum + value, 0n);
  for (
    let index = 0;
    remainder > 0n && index < allocations.length;
    index += 1
  ) {
    allocations[index] += 1n;
    remainder -= 1n;
  }
  return allocations;
}

export function uncalledBetReturn(
  commitments: Readonly<Record<string, bigint>>,
): { playerId: string; amountMinor: bigint } | null {
  const values = Object.entries(commitments).sort((left, right) =>
    left[1] > right[1] ? -1 : 1,
  );
  if (values.length < 2 || values[0][1] <= values[1][1]) return null;
  return {
    playerId: values[0][0],
    amountMinor: values[0][1] - values[1][1],
  };
}

export function potTotal(
  commitments: Readonly<Record<string, bigint>>,
): bigint {
  return Object.values(commitments).reduce(
    (total, amount) => total + amount,
    0n,
  );
}
