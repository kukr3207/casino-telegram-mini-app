import { randomUUID } from "node:crypto";

import { shuffledDeck, type Card } from "./cards.ts";
import {
  type HandStage,
  type PlayerAction,
  type PokerAction,
  type PokerHand,
  type PokerPlayer,
  type PokerTable,
  PokerConflictError,
  PokerValidationError,
  pokerAmount,
  pokerDate,
  pokerText,
} from "./types.ts";

const tableTransitions: Readonly<Record<PokerTable["status"], readonly PokerTable["status"][]>> = {
  waiting: ["running", "paused", "closed"],
  running: ["paused", "closed"],
  paused: ["waiting", "running", "closed"],
  closed: [],
};

export class PokerTableService {
  readonly #tables = new Map<string, PokerTable>();
  readonly #hands = new Map<string, PokerHand>();
  readonly #activeHandByTable = new Map<string, string>();
  readonly #requests = new Map<string, PokerAction>();
  readonly #decks = new Map<string, readonly Card[]>();

  create(value: Omit<PokerTable, "players" | "handNumber" | "version">): PokerTable {
    const table = validateTable({ ...value, players: [], handNumber: 0, version: 1 });
    if (this.#tables.has(table.id)) throw new PokerConflictError("table id already exists");
    this.#tables.set(table.id, table);
    return cloneTable(table);
  }

  transition(tableId: string, expectedVersion: number, status: PokerTable["status"]): PokerTable {
    const table = this.requireTable(tableId);
    this.assertVersion(table, expectedVersion);
    if (status === table.status) return cloneTable(table);
    if (!tableTransitions[table.status].includes(status)) {
      throw new PokerConflictError(`cannot move table from ${table.status} to ${status}`);
    }
    if (status === "closed" && this.#activeHandByTable.has(table.id)) {
      throw new PokerConflictError("cannot close a table during a hand");
    }
    return this.saveTable({ ...table, status });
  }

  join(
    tableId: string,
    expectedVersion: number,
    input: {
      playerId: string;
      displayName: string;
      seat: number;
      buyInMinor: bigint;
      timeBankSeconds?: number;
      joinedAt?: Date;
    },
  ): PokerTable {
    const table = this.requireTable(tableId);
    this.assertVersion(table, expectedVersion);
    if (table.status === "closed") throw new PokerConflictError("table is closed");
    const playerId = pokerText(input.playerId, "player id");
    if (table.players.some((player) => player.playerId === playerId)) {
      throw new PokerConflictError("player already joined the table");
    }
    if (!Number.isSafeInteger(input.seat) || input.seat < 1 || input.seat > table.maximumPlayers) {
      throw new PokerValidationError("seat is invalid");
    }
    if (table.players.some((player) => player.seat === input.seat && player.status !== "left")) {
      throw new PokerConflictError("seat is occupied");
    }
    if (input.buyInMinor < table.minimumBuyInMinor || input.buyInMinor > table.maximumBuyInMinor) {
      throw new PokerValidationError("buy in is outside table limits");
    }
    const player: PokerPlayer = {
      playerId,
      displayName: pokerText(input.displayName, "display name"),
      seat: input.seat,
      stackMinor: input.buyInMinor,
      status: "active",
      joinedAt: (input.joinedAt ?? new Date()).toISOString(),
      timeBankSeconds: input.timeBankSeconds ?? 30,
    };
    return this.saveTable({ ...table, players: [...table.players, player].sort((a, b) => a.seat - b.seat) });
  }

  leave(tableId: string, expectedVersion: number, playerId: string): PokerTable {
    const table = this.requireTable(tableId);
    this.assertVersion(table, expectedVersion);
    const player = table.players.find((candidate) => candidate.playerId === playerId);
    if (!player) throw new PokerValidationError("player is not seated");
    if (this.#activeHandByTable.has(tableId) && player.status === "active") {
      throw new PokerConflictError("active player cannot leave during a hand");
    }
    const players = table.players.map((candidate) =>
      candidate.playerId === playerId ? { ...candidate, status: "left" as const } : candidate);
    return this.saveTable({ ...table, players });
  }

  startHand(
    tableId: string,
    expectedVersion: number,
    serverSeed: string,
    clientSeed: string,
    startedAt = new Date(),
  ): { table: PokerTable; hand: PokerHand } {
    const table = this.requireTable(tableId);
    this.assertVersion(table, expectedVersion);
    if (!['waiting', 'running'].includes(table.status)) throw new PokerConflictError("table is not running");
    if (this.#activeHandByTable.has(tableId)) throw new PokerConflictError("table already has an active hand");
    const active = table.players.filter((player) => player.status === "active" && player.stackMinor > 0n);
    if (active.length < table.minimumPlayers) throw new PokerConflictError("not enough active players");
    const buttonSeat = nextOccupiedSeat(active, table.buttonSeat ?? 0);
    const smallBlindSeat = active.length === 2 ? buttonSeat : nextOccupiedSeat(active, buttonSeat);
    const bigBlindSeat = nextOccupiedSeat(active, smallBlindSeat);
    const deck = shuffledDeck(serverSeed, clientSeed, table.handNumber + 1);
    let cursor = 0;
    const holeCards: Record<string, readonly Card[]> = {};
    const holeCount = table.variant === "omaha" ? 4 : 2;
    for (let round = 0; round < holeCount; round += 1) {
      for (const player of active.sort((a, b) => a.seat - b.seat)) {
        holeCards[player.playerId] = [...(holeCards[player.playerId] ?? []), deck.cards[cursor]];
        cursor += 1;
      }
    }
    const commitments: Record<string, bigint> = {};
    const streetCommitments: Record<string, bigint> = {};
    for (const player of active) {
      const ante = minimum(player.stackMinor, table.anteMinor);
      commitments[player.playerId] = ante;
      streetCommitments[player.playerId] = ante;
    }
    postForcedBet(active, commitments, streetCommitments, smallBlindSeat, table.smallBlindMinor);
    postForcedBet(active, commitments, streetCommitments, bigBlindSeat, table.bigBlindMinor);
    const hand: PokerHand = {
      id: randomUUID(),
      tableId,
      handNumber: table.handNumber + 1,
      stage: "preflop",
      buttonSeat,
      smallBlindSeat,
      bigBlindSeat,
      actingSeat: nextActingSeat(active, bigBlindSeat),
      communityCards: [],
      holeCards,
      commitments,
      streetCommitments,
      currentBetMinor: maximum(Object.values(streetCommitments)),
      minimumRaiseMinor: table.bigBlindMinor,
      actions: [],
      deckCommitment: deck.commitment,
      deckCursor: cursor,
      startedAt: pokerDate(startedAt, "hand start").toISOString(),
      version: 1,
    };
    this.#hands.set(hand.id, hand);
    this.#decks.set(hand.id, deck.cards);
    this.#activeHandByTable.set(tableId, hand.id);
    const changed = this.saveTable({ ...table, status: "running", buttonSeat, handNumber: hand.handNumber });
    return { table: changed, hand: cloneHand(hand) };
  }

  act(input: {
    handId: string;
    expectedVersion: number;
    requestId: string;
    playerId: string;
    action: PlayerAction;
    amountMinor?: bigint;
    occurredAt?: Date;
  }): PokerHand {
    const hand = this.requireHand(input.handId);
    if (hand.version !== input.expectedVersion) throw new PokerConflictError("hand version does not match");
    const requestId = pokerText(input.requestId, "request id");
    const previous = this.#requests.get(requestId);
    if (previous) {
      if (previous.handId !== hand.id || previous.playerId !== input.playerId || previous.action !== input.action) {
        throw new PokerConflictError("request id was already used for another action");
      }
      return cloneHand(hand);
    }
    const table = this.requireTable(hand.tableId);
    const player = table.players.find((candidate) => candidate.playerId === input.playerId);
    if (!player || player.seat !== hand.actingSeat) throw new PokerConflictError("player is not next to act");
    if (player.status !== "active") throw new PokerConflictError("player cannot act");
    const streetCommitted = hand.streetCommitments[player.playerId] ?? 0n;
    const totalCommitted = hand.commitments[player.playerId] ?? 0n;
    const available = player.stackMinor - totalCommitted;
    const toCall = hand.currentBetMinor > streetCommitted ? hand.currentBetMinor - streetCommitted : 0n;
    const requestedAmount = input.amountMinor ?? 0n;
    const contribution = actionContribution(input.action, requestedAmount, toCall, streetCommitted, hand, available);
    const totalStreet = streetCommitted + contribution;
    const total = totalCommitted + contribution;
    const action: PokerAction = {
      id: requestId,
      handId: hand.id,
      playerId: player.playerId,
      seat: player.seat,
      action: contribution === available && input.action !== "fold" ? "all_in" : input.action,
      amountMinor: contribution,
      totalStreetCommitmentMinor: totalStreet,
      occurredAt: (input.occurredAt ?? new Date()).toISOString(),
      sequence: hand.actions.length + 1,
    };
    let players = table.players.map((candidate) => {
      if (candidate.playerId !== player.playerId) return candidate;
      return {
        ...candidate,
        status: input.action === "fold" ? "folded" as const : total >= candidate.stackMinor ? "all_in" as const : candidate.status,
        lastActionAt: action.occurredAt,
      };
    });
    let changed: PokerHand = {
      ...hand,
      commitments: { ...hand.commitments, [player.playerId]: total },
      streetCommitments: { ...hand.streetCommitments, [player.playerId]: totalStreet },
      currentBetMinor: totalStreet > hand.currentBetMinor ? totalStreet : hand.currentBetMinor,
      minimumRaiseMinor: totalStreet > hand.currentBetMinor ? totalStreet - hand.currentBetMinor : hand.minimumRaiseMinor,
      actions: [...hand.actions, action],
      version: hand.version + 1,
    };
    const remaining = players.filter((candidate) => !["folded", "left"].includes(candidate.status));
    if (remaining.length === 1) {
      changed = { ...changed, stage: "complete", actingSeat: undefined, completedAt: action.occurredAt };
    } else if (streetComplete(changed, players)) {
      changed = this.advanceStreet(changed, players);
    } else {
      changed = { ...changed, actingSeat: nextActingSeat(players, player.seat) };
    }
    this.#hands.set(changed.id, changed);
    this.#requests.set(requestId, action);
    this.#tables.set(table.id, { ...table, players, version: table.version + 1 });
    return cloneHand(changed);
  }

  hand(handId: string): PokerHand | undefined {
    const value = this.#hands.get(handId.trim());
    return value ? cloneHand(value) : undefined;
  }

  table(tableId: string): PokerTable | undefined {
    const value = this.#tables.get(tableId.trim());
    return value ? cloneTable(value) : undefined;
  }

  private advanceStreet(hand: PokerHand, players: readonly PokerPlayer[]): PokerHand {
    const nextStage: Readonly<Record<HandStage, HandStage>> = {
      preflop: "flop",
      flop: "turn",
      turn: "river",
      river: "showdown",
      showdown: "complete",
      complete: "complete",
    };
    const stage = nextStage[hand.stage];
    if (stage === "showdown") return { ...hand, stage, actingSeat: undefined, streetCommitments: {}, currentBetMinor: 0n };
    const deck = this.#decks.get(hand.id)!;
    let cursor = hand.deckCursor + 1;
    const count = stage === "flop" ? 3 : 1;
    const communityCards = [...hand.communityCards, ...deck.slice(cursor, cursor + count)];
    cursor += count;
    return {
      ...hand,
      stage,
      communityCards,
      deckCursor: cursor,
      streetCommitments: Object.fromEntries(players.map((player) => [player.playerId, 0n])),
      currentBetMinor: 0n,
      actingSeat: nextActingSeat(players, hand.buttonSeat),
    };
  }

  private requireTable(tableId: string): PokerTable {
    const value = this.#tables.get(pokerText(tableId, "table id"));
    if (!value) throw new PokerValidationError("table does not exist");
    return value;
  }

  private requireHand(handId: string): PokerHand {
    const value = this.#hands.get(pokerText(handId, "hand id"));
    if (!value) throw new PokerValidationError("hand does not exist");
    return value;
  }

  private assertVersion(table: PokerTable, expectedVersion: number): void {
    if (table.version !== expectedVersion) throw new PokerConflictError("table version does not match");
  }

  private saveTable(value: PokerTable): PokerTable {
    const changed = { ...value, version: value.version + 1 };
    this.#tables.set(changed.id, changed);
    return cloneTable(changed);
  }
}

function validateTable(value: PokerTable): PokerTable {
  const id = pokerText(value.id, "table id");
  const name = pokerText(value.name, "table name");
  const currency = pokerText(value.currency, "currency").toUpperCase();
  pokerAmount(value.minimumBuyInMinor, "minimum buy in");
  pokerAmount(value.maximumBuyInMinor, "maximum buy in");
  pokerAmount(value.smallBlindMinor, "small blind");
  pokerAmount(value.bigBlindMinor, "big blind");
  pokerAmount(value.anteMinor, "ante", true);
  if (value.maximumBuyInMinor < value.minimumBuyInMinor) throw new PokerValidationError("buy in limits are invalid");
  if (value.bigBlindMinor < value.smallBlindMinor) throw new PokerValidationError("blind levels are invalid");
  if (!Number.isSafeInteger(value.minimumPlayers) || value.minimumPlayers < 2) throw new PokerValidationError("minimum players is invalid");
  if (!Number.isSafeInteger(value.maximumPlayers) || value.maximumPlayers < value.minimumPlayers || value.maximumPlayers > 10) {
    throw new PokerValidationError("maximum players is invalid");
  }
  if (!Number.isSafeInteger(value.rakeBasisPoints) || value.rakeBasisPoints < 0 || value.rakeBasisPoints > 1_000) {
    throw new PokerValidationError("rake is invalid");
  }
  return { ...value, id, name, currency, players: value.players.map((player) => ({ ...player })) };
}

function actionContribution(
  action: PlayerAction,
  requested: bigint,
  toCall: bigint,
  streetCommitted: bigint,
  hand: PokerHand,
  available: bigint,
): bigint {
  if (action === "fold" || action === "check") {
    if (action === "check" && toCall > 0n) throw new PokerConflictError("cannot check facing a bet");
    return 0n;
  }
  if (action === "call") return minimum(toCall, available);
  if (action === "all_in") return available;
  if (requested <= 0n) throw new PokerValidationError("bet or raise amount must be positive");
  const target = requested;
  if (action === "bet" && hand.currentBetMinor > 0n) throw new PokerConflictError("cannot bet after a bet was made");
  if (action === "raise" && hand.currentBetMinor === 0n) throw new PokerConflictError("cannot raise before a bet");
  const contribution = target - streetCommitted;
  if (contribution <= toCall) throw new PokerConflictError("raise must exceed the call amount");
  if (contribution > available) throw new PokerConflictError("action exceeds player stack");
  if (target - hand.currentBetMinor < hand.minimumRaiseMinor && contribution !== available) {
    throw new PokerConflictError("raise is below the minimum");
  }
  return contribution;
}

function streetComplete(hand: PokerHand, players: readonly PokerPlayer[]): boolean {
  const eligible = players.filter((player) => player.status === "active");
  if (eligible.length === 0) return true;
  const acted = new Set(hand.actions.filter((action) => action.sequence > lastStreetStart(hand)).map((action) => action.playerId));
  return eligible.every((player) => acted.has(player.playerId)
    && (hand.streetCommitments[player.playerId] ?? 0n) === hand.currentBetMinor);
}

function lastStreetStart(hand: PokerHand): number {
  if (hand.stage === "preflop") return 0;
  const stagesSeen = hand.communityCards.length === 3 ? 1 : hand.communityCards.length === 4 ? 2 : 3;
  return Math.max(0, hand.actions.length - stagesSeen * 10);
}

function postForcedBet(
  players: readonly PokerPlayer[],
  commitments: Record<string, bigint>,
  street: Record<string, bigint>,
  seat: number,
  amount: bigint,
): void {
  const player = players.find((candidate) => candidate.seat === seat)!;
  const posted = minimum(amount, player.stackMinor - commitments[player.playerId]);
  commitments[player.playerId] += posted;
  street[player.playerId] += posted;
}

function nextOccupiedSeat(players: readonly PokerPlayer[], afterSeat: number): number {
  const seats = players.filter((player) => !["left", "folded"].includes(player.status)).map((player) => player.seat).sort((a, b) => a - b);
  return seats.find((seat) => seat > afterSeat) ?? seats[0];
}

function nextActingSeat(players: readonly PokerPlayer[], afterSeat: number): number | undefined {
  const active = players.filter((player) => player.status === "active");
  return active.length ? nextOccupiedSeat(active, afterSeat) : undefined;
}

function maximum(values: readonly bigint[]): bigint {
  return values.reduce((result, value) => value > result ? value : result, 0n);
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function cloneTable(value: PokerTable): PokerTable {
  return { ...value, players: value.players.map((player) => ({ ...player })) };
}

function cloneHand(value: PokerHand): PokerHand {
  return {
    ...value,
    communityCards: value.communityCards.map((card) => ({ ...card })),
    holeCards: Object.fromEntries(Object.entries(value.holeCards).map(([id, cards]) => [id, cards.map((card) => ({ ...card }))])),
    commitments: { ...value.commitments },
    streetCommitments: { ...value.streetCommitments },
    actions: value.actions.map((action) => ({ ...action })),
  };
}
