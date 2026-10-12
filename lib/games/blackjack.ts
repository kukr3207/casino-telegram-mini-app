import { blackjackValue, cardCode, createShoe, isBlackjack, shuffleShoe, type Card } from "./cards.ts";

export type HandState = "playing" | "stood" | "busted" | "blackjack" | "surrendered";
export type RoundState = "player_turn" | "dealer_turn" | "settled";

export interface BlackjackHand {
  id: string;
  cards: Card[];
  stake: bigint;
  state: HandState;
  doubled: boolean;
  splitFrom?: string;
}

export interface BlackjackRound {
  id: string;
  playerId: string;
  state: RoundState;
  hands: BlackjackHand[];
  dealer: Card[];
  shoe: Card[];
  cursor: number;
  activeHand: number;
  dealerHitsSoft17: boolean;
  createdAt: string;
}

export interface HandSettlement {
  handId: string;
  outcome: "win" | "lose" | "push" | "blackjack" | "surrender";
  stake: bigint;
  payout: bigint;
  playerTotal: number;
  dealerTotal: number;
}

function nextCard(round: BlackjackRound): Card {
  const card = round.shoe[round.cursor];
  if (!card) throw new Error("blackjack shoe is exhausted");
  round.cursor += 1;
  return card;
}

function evaluateHand(hand: BlackjackHand): void {
  const value = blackjackValue(hand.cards);
  if (value.total > 21) hand.state = "busted";
  else if (isBlackjack(hand.cards) && !hand.splitFrom) hand.state = "blackjack";
}

function advance(round: BlackjackRound): void {
  while (round.activeHand < round.hands.length && round.hands[round.activeHand].state !== "playing") {
    round.activeHand += 1;
  }
  if (round.activeHand >= round.hands.length) round.state = "dealer_turn";
}

export function startBlackjackRound(input: {
  roundId: string;
  playerId: string;
  stake: bigint;
  serverSeed: string;
  clientSeed: string;
  nonce: bigint | number | string;
  decks?: number;
  dealerHitsSoft17?: boolean;
  at: string | Date;
}): BlackjackRound {
  if (!input.roundId.trim() || !input.playerId.trim()) throw new RangeError("round and player ids cannot be blank");
  if (input.stake <= 0n) throw new RangeError("blackjack stake must be positive");
  const shoe = shuffleShoe(createShoe(input.decks ?? 6), input.serverSeed, input.clientSeed, input.nonce);
  const round: BlackjackRound = {
    id: input.roundId.trim(), playerId: input.playerId.trim(), state: "player_turn",
    hands: [{ id: `${input.roundId}:1`, cards: [], stake: input.stake, state: "playing", doubled: false }],
    dealer: [], shoe, cursor: 0, activeHand: 0,
    dealerHitsSoft17: Boolean(input.dealerHitsSoft17), createdAt: new Date(input.at).toISOString(),
  };
  round.hands[0].cards.push(nextCard(round));
  round.dealer.push(nextCard(round));
  round.hands[0].cards.push(nextCard(round));
  round.dealer.push(nextCard(round));
  evaluateHand(round.hands[0]);
  if (round.hands[0].state === "blackjack") round.state = "dealer_turn";
  return round;
}

export function hit(round: BlackjackRound): BlackjackRound {
  if (round.state !== "player_turn") throw new Error("blackjack round is not accepting player actions");
  const hand = round.hands[round.activeHand];
  if (!hand || hand.state !== "playing") throw new Error("blackjack hand is not active");
  hand.cards.push(nextCard(round));
  evaluateHand(hand);
  advance(round);
  return round;
}

export function stand(round: BlackjackRound): BlackjackRound {
  if (round.state !== "player_turn") throw new Error("blackjack round is not accepting player actions");
  round.hands[round.activeHand].state = "stood";
  advance(round);
  return round;
}

export function doubleDown(round: BlackjackRound): BlackjackRound {
  if (round.state !== "player_turn") throw new Error("blackjack round is not accepting player actions");
  const hand = round.hands[round.activeHand];
  if (hand.cards.length !== 2 || hand.doubled) throw new Error("blackjack hand cannot double")
  hand.stake *= 2n;
  hand.doubled = true;
  hand.cards.push(nextCard(round));
  evaluateHand(hand);
  if (hand.state === "playing") hand.state = "stood";
  advance(round);
  return round;
}

export function split(round: BlackjackRound): BlackjackRound {
  if (round.state !== "player_turn") throw new Error("blackjack round is not accepting player actions");
  const hand = round.hands[round.activeHand];
  if (hand.cards.length !== 2 || hand.cards[0].rank !== hand.cards[1].rank || round.hands.length >= 4) {
    throw new Error("blackjack hand cannot split");
  }
  const secondCard = hand.cards.pop()!;
  const second: BlackjackHand = {
    id: `${round.id}:${round.hands.length + 1}`, cards: [secondCard], stake: hand.stake,
    state: "playing", doubled: false, splitFrom: hand.id,
  };
  hand.splitFrom = hand.id;
  hand.cards.push(nextCard(round));
  second.cards.push(nextCard(round));
  round.hands.splice(round.activeHand + 1, 0, second);
  return round;
}

export function surrender(round: BlackjackRound): BlackjackRound {
  if (round.state !== "player_turn") throw new Error("blackjack round is not accepting player actions");
  const hand = round.hands[round.activeHand];
  if (hand.cards.length !== 2 || round.hands.length !== 1) throw new Error("blackjack hand cannot surrender");
  hand.state = "surrendered";
  advance(round);
  return round;
}

export function settleBlackjack(round: BlackjackRound): HandSettlement[] {
  if (round.state === "player_turn") throw new Error("player actions are not complete");
  if (round.state === "settled") throw new Error("blackjack round is already settled");
  const activeHands = round.hands.some((hand) => !["busted", "surrendered"].includes(hand.state));
  if (activeHands) {
    while (true) {
      const value = blackjackValue(round.dealer);
      if (value.total > 21 || value.total > 17 || (value.total === 17 && (!value.soft || !round.dealerHitsSoft17))) break;
      round.dealer.push(nextCard(round));
    }
  }
  const dealer = blackjackValue(round.dealer);
  const dealerBlackjack = isBlackjack(round.dealer);
  const settlements = round.hands.map((hand): HandSettlement => {
    const player = blackjackValue(hand.cards);
    let outcome: HandSettlement["outcome"];
    let payout: bigint;
    if (hand.state === "surrendered") {
      outcome = "surrender";
      payout = hand.stake / 2n;
    } else if (hand.state === "busted") {
      outcome = "lose";
      payout = 0n;
    } else if (isBlackjack(hand.cards) && !hand.splitFrom && !dealerBlackjack) {
      outcome = "blackjack";
      payout = hand.stake * 5n / 2n;
    } else if (dealerBlackjack && !isBlackjack(hand.cards)) {
      outcome = "lose";
      payout = 0n;
    } else if (dealer.total > 21 || player.total > dealer.total) {
      outcome = "win";
      payout = hand.stake * 2n;
    } else if (player.total === dealer.total) {
      outcome = "push";
      payout = hand.stake;
    } else {
      outcome = "lose";
      payout = 0n;
    }
    return { handId: hand.id, outcome, stake: hand.stake, payout, playerTotal: player.total, dealerTotal: dealer.total };
  });
  round.state = "settled";
  return settlements;
}

export function publicBlackjackRound(round: BlackjackRound): Record<string, unknown> {
  return {
    id: round.id,
    playerId: round.playerId,
    state: round.state,
    hands: round.hands.map((hand) => ({
      id: hand.id, cards: hand.cards.map(cardCode), stake: hand.stake.toString(),
      state: hand.state, doubled: hand.doubled,
    })),
    dealer: round.dealer.map((card, index) => round.state === "player_turn" && index === 1 ? "hidden" : cardCode(card)),
    activeHand: round.activeHand,
  };
}
