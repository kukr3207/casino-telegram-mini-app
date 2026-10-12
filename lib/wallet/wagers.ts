import { createHash } from "node:crypto";

import { positiveUnits } from "./money.ts";
import { WalletLedger, type LedgerEntry } from "./ledger.ts";

export type WagerState = "reserved" | "settled" | "voided";

export interface Wager {
  id: string;
  playerId: string;
  game: string;
  roundId: string;
  stake: bigint;
  potentialPayout: bigint;
  asset: string;
  state: WagerState;
  reservedAt: string;
  settledAt?: string;
  payout?: bigint;
  result?: string;
}

export interface WagerAccounts {
  player: string;
  escrow: string;
  house: string;
}

function id(value: string, name: string): string {
  if (!value.trim()) throw new RangeError(`${name} cannot be blank`);
  return value.trim();
}

function iso(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError("wager time is invalid");
  return parsed.toISOString();
}

export class WagerService {
  readonly #ledger: WalletLedger;
  readonly #wagers = new Map<string, Wager>();
  readonly #rounds = new Map<string, string>();

  constructor(ledger: WalletLedger) {
    this.#ledger = ledger;
  }

  reserve(input: {
    wagerId: string;
    playerId: string;
    game: string;
    roundId: string;
    stake: bigint | number | string;
    potentialPayout: bigint | number | string;
    accounts: WagerAccounts;
    at: string | Date;
  }): Wager {
    const wagerId = id(input.wagerId, "wager id");
    const playerId = id(input.playerId, "player id");
    const game = id(input.game, "game");
    const roundId = id(input.roundId, "round id");
    const stake = positiveUnits(input.stake, "stake");
    const potentialPayout = positiveUnits(input.potentialPayout, "potential payout");
    if (potentialPayout < stake) throw new RangeError("potential payout cannot be below the stake");
    const player = this.#ledger.account(input.accounts.player);
    const escrow = this.#ledger.account(input.accounts.escrow);
    const house = this.#ledger.account(input.accounts.house);
    if (player.ownerId !== playerId || player.kind !== "player") throw new RangeError("player account does not belong to the wager player");
    if (escrow.kind !== "escrow" || house.kind !== "house") throw new RangeError("wager accounts have incorrect kinds");
    if (new Set([player.asset, escrow.asset, house.asset]).size !== 1) throw new RangeError("wager accounts must use one asset");
    const roundKey = `${playerId}:${game}:${roundId}`;
    const priorId = this.#rounds.get(roundKey);
    if (priorId) {
      const prior = this.#wagers.get(priorId)!;
      if (prior.id === wagerId && prior.stake === stake && prior.potentialPayout === potentialPayout) return prior;
      throw new Error("player round already has a different wager");
    }
    const reserveCapacity = potentialPayout - stake;
    this.#ledger.post({
      id: `wager:${wagerId}:reserve`,
      reference: `wager-reserve:${wagerId}`,
      kind: "wager_reserve",
      occurredAt: input.at,
      postings: [
        { accountId: player.id, direction: "debit" as const, units: stake },
        { accountId: house.id, direction: "debit" as const, units: reserveCapacity },
        { accountId: escrow.id, direction: "credit" as const, units: potentialPayout },
      ].filter((posting) => posting.units > 0n),
      metadata: { wagerId, playerId, game, roundId },
    });
    const wager: Wager = {
      id: wagerId,
      playerId,
      game,
      roundId,
      stake,
      potentialPayout,
      asset: player.asset,
      state: "reserved",
      reservedAt: iso(input.at),
    };
    this.#wagers.set(wagerId, wager);
    this.#rounds.set(roundKey, wagerId);
    return wager;
  }

  settle(input: {
    wagerId: string;
    payout: bigint | number | string;
    result: string;
    accounts: WagerAccounts;
    at: string | Date;
  }): Wager {
    const wager = this.get(input.wagerId);
    const payout = positiveUnits(input.payout, "payout");
    if (wager.state !== "reserved") {
      if (wager.state === "settled" && wager.payout === payout && wager.result === input.result.trim()) return wager;
      throw new Error("wager is no longer reserved");
    }
    if (payout > wager.potentialPayout) throw new RangeError("payout exceeds reserved capacity");
    const remainder = wager.potentialPayout - payout;
    this.#ledger.post({
      id: `wager:${wager.id}:settle`,
      reference: `wager-settle:${wager.id}`,
      kind: "wager_settlement",
      occurredAt: input.at,
      postings: [
        { accountId: input.accounts.escrow, direction: "debit" as const, units: wager.potentialPayout },
        { accountId: input.accounts.player, direction: "credit" as const, units: payout },
        { accountId: input.accounts.house, direction: "credit" as const, units: remainder },
      ].filter((posting) => posting.units > 0n),
      metadata: { wagerId: wager.id, result: input.result.trim() },
    });
    const settled: Wager = { ...wager, state: "settled", payout, result: input.result.trim(), settledAt: iso(input.at) };
    this.#wagers.set(wager.id, settled);
    return settled;
  }

  void(input: { wagerId: string; accounts: WagerAccounts; at: string | Date; reason: string }): Wager {
    const wager = this.get(input.wagerId);
    if (wager.state !== "reserved") {
      if (wager.state === "voided") return wager;
      throw new Error("settled wager cannot be voided");
    }
    const houseReserve = wager.potentialPayout - wager.stake;
    this.#ledger.post({
      id: `wager:${wager.id}:void`,
      reference: `wager-void:${wager.id}`,
      kind: "wager_void",
      occurredAt: input.at,
      postings: [
        { accountId: input.accounts.escrow, direction: "debit" as const, units: wager.potentialPayout },
        { accountId: input.accounts.player, direction: "credit" as const, units: wager.stake },
        { accountId: input.accounts.house, direction: "credit" as const, units: houseReserve },
      ].filter((posting) => posting.units > 0n),
      metadata: { wagerId: wager.id, reason: id(input.reason, "void reason") },
    });
    const voided: Wager = { ...wager, state: "voided", result: input.reason.trim(), settledAt: iso(input.at), payout: wager.stake };
    this.#wagers.set(wager.id, voided);
    return voided;
  }

  get(wagerId: string): Wager {
    const wager = this.#wagers.get(wagerId);
    if (!wager) throw new Error("wager was not found");
    return wager;
  }

  forPlayer(playerId: string): readonly Wager[] {
    return [...this.#wagers.values()]
      .filter((wager) => wager.playerId === playerId)
      .sort((left, right) => right.reservedAt.localeCompare(left.reservedAt) || right.id.localeCompare(left.id));
  }
}
