import assert from "node:assert/strict";
import test from "node:test";

import { BetRepository, BetService } from "../lib/sportsbook/bets.ts";
import { CashOutService } from "../lib/sportsbook/cashout.ts";
import { SportsbookCatalog } from "../lib/sportsbook/catalog.ts";
import { SportsbookRiskEngine } from "../lib/sportsbook/risk.ts";
import { SportsbookSettlementService } from "../lib/sportsbook/settlement.ts";
import {
  SportsbookConflictError,
  multiplyPrice,
  returnForStake,
} from "../lib/sportsbook/types.ts";

class Wallet {
  reservations = new Map();
  settlements = new Map();

  reserve(input) {
    if (this.reservations.has(input.reference))
      throw new Error("duplicate reservation");
    this.reservations.set(input.reference, input);
  }

  release(reference) {
    this.reservations.delete(reference);
  }

  settle(reference, amountMinor) {
    if (this.settlements.has(reference)) {
      assert.equal(this.settlements.get(reference), amountMinor);
      return;
    }
    this.settlements.set(reference, amountMinor);
  }
}

function event(id, sourceRevision = 1) {
  return {
    id,
    sport: "football",
    competitionId: "premier-league",
    name: `Home ${id} v Away ${id}`,
    startsAt: "2026-10-20T18:00:00.000Z",
    expectedEndsAt: "2026-10-20T20:00:00.000Z",
    status: "scheduled",
    participants: [
      { id: `${id}-home`, name: "Home", role: "home" },
      { id: `${id}-away`, name: "Away", role: "away" },
    ],
    sourceRevision,
    version: 0,
  };
}

function market(eventId, id, sequence = 1) {
  return {
    id,
    eventId,
    kind: "moneyline",
    name: "Match winner",
    period: "full_time",
    settlementRule: "standard",
    status: "open",
    inPlay: false,
    cashOutEnabled: true,
    selections: [
      {
        id: `${id}-home`,
        marketId: id,
        name: "Home",
        participantId: `${eventId}-home`,
        price: { numerator: 2n, denominator: 1n },
        status: "active",
        result: "pending",
        version: 1,
      },
      {
        id: `${id}-away`,
        marketId: id,
        name: "Away",
        participantId: `${eventId}-away`,
        price: { numerator: 5n, denominator: 2n },
        status: "active",
        result: "pending",
        version: 1,
      },
    ],
    sequence,
    version: 0,
  };
}

function acceptancePolicy() {
  return {
    quoteLifetimeMs: 30_000,
    minimumStakeMinor: 100n,
    maximumStakeMinor: 100_000n,
    maximumLegs: 12,
    maximumReturnMinor: 1_000_000n,
    allowedCurrencies: ["CHIP"],
    allowRelatedSelections: false,
    priceChangeToleranceBasisPoints: 100,
  };
}

function setup() {
  const catalog = new SportsbookCatalog();
  catalog.upsertEvent(event("event-1"));
  catalog.putMarket(market("event-1", "market-1"));
  const repository = new BetRepository();
  const wallet = new Wallet();
  const service = new BetService(
    catalog,
    repository,
    wallet,
    acceptancePolicy(),
  );
  return { catalog, repository, wallet, service };
}

test("sportsbook prices multiply and calculate integer returns", () => {
  const combined = multiplyPrice(
    { numerator: 2n, denominator: 1n },
    { numerator: 5n, denominator: 2n },
  );
  assert.deepEqual(combined, { numerator: 5n, denominator: 1n });
  assert.equal(returnForStake(1_000n, combined), 5_000n);
});

test("catalog applies source revisions idempotently", () => {
  const catalog = new SportsbookCatalog();
  const first = catalog.upsertEvent(event("e"));
  const replay = catalog.upsertEvent(event("e"));
  assert.deepEqual(replay, first);
  assert.throws(
    () => catalog.upsertEvent({ ...event("e"), name: "Different" }),
    SportsbookConflictError,
  );
  const changed = catalog.upsertEvent({ ...event("e", 2), name: "Corrected" });
  assert.equal(changed.version, 2);
  assert.equal(changed.name, "Corrected");
});

test("catalog closes all markets when an event finishes", () => {
  const catalog = new SportsbookCatalog();
  const created = catalog.upsertEvent(event("e"));
  catalog.putMarket(market("e", "m"));
  catalog.transitionEvent(created.id, created.version, "live");
  const live = catalog.event("e");
  catalog.transitionEvent(live.id, live.version, "finished");
  assert.equal(catalog.market("m").status, "closed");
  assert.equal(
    catalog
      .market("m")
      .selections.every((selection) => selection.status === "suspended"),
    true,
  );
});

test("bet quotes reserve a wallet balance only on acceptance", () => {
  const { service, wallet } = setup();
  const quote = service.quote(
    {
      playerId: "player",
      requestId: "request",
      currency: "chip",
      stakeMinor: 1_000n,
      kind: "single",
      selections: [{ marketId: "market-1", selectionId: "market-1-home" }],
    },
    new Date("2026-10-19T10:00:00Z"),
  );
  assert.equal(wallet.reservations.size, 0);
  const bet = service.accept(
    quote.id,
    "request",
    new Date("2026-10-19T10:00:01Z"),
  );
  assert.equal(bet.status, "accepted");
  assert.equal(bet.acceptedReturnMinor, 2_000n);
  assert.equal(wallet.reservations.size, 1);
});

test("request ids make accepted bets idempotent", () => {
  const { service, repository } = setup();
  const quote = service.quote(
    {
      playerId: "player",
      requestId: "same",
      currency: "CHIP",
      stakeMinor: 500n,
      kind: "single",
      selections: [{ marketId: "market-1", selectionId: "market-1-away" }],
    },
    new Date("2026-10-19T10:00:00Z"),
  );
  const first = service.accept(
    quote.id,
    "same",
    new Date("2026-10-19T10:00:01Z"),
  );
  const retry = service.accept(
    quote.id,
    "same",
    new Date("2026-10-19T10:00:02Z"),
  );
  assert.equal(retry.id, first.id);
  assert.equal(repository.forPlayer("player").length, 1);
});

test("risk engine enforces player and liability limits", () => {
  const risk = new SportsbookRiskEngine();
  risk.setLimits({
    currency: "CHIP",
    minimumStakeMinor: 100n,
    maximumStakeMinor: 10_000n,
    maximumBetReturnMinor: 100_000n,
    maximumPlayerOpenStakeMinor: 15_000n,
    maximumPlayerDailyStakeMinor: 20_000n,
    maximumEventLiabilityMinor: 100_000n,
    maximumMarketLiabilityMinor: 80_000n,
    maximumSelectionLiabilityMinor: 50_000n,
    reviewStakeMinor: 8_000n,
    reviewReturnMinor: 40_000n,
  });
  const decision = risk.decide({
    playerId: "player",
    currency: "CHIP",
    stakeMinor: 9_000n,
    potentialReturnMinor: 45_000n,
    legs: [
      {
        eventId: "event",
        marketId: "market",
        selectionId: "selection",
        acceptedPrice: { numerator: 5n, denominator: 1n },
        result: "pending",
      },
    ],
    sportByEvent: { event: "football" },
    competitionByEvent: { event: "league" },
    placedAt: new Date("2026-10-19T10:00:00Z"),
  });
  assert.equal(decision.accepted, true);
  assert.equal(decision.manualReview, true);
});

test("settlement pays a winning single exactly once", () => {
  const { service, repository, wallet } = setup();
  const quote = service.quote(
    {
      playerId: "player",
      requestId: "settle",
      currency: "CHIP",
      stakeMinor: 1_000n,
      kind: "single",
      selections: [{ marketId: "market-1", selectionId: "market-1-home" }],
    },
    new Date("2026-10-19T10:00:00Z"),
  );
  const bet = service.accept(
    quote.id,
    "settle",
    new Date("2026-10-19T10:00:01Z"),
  );
  const settlement = new SportsbookSettlementService(repository, wallet);
  const payouts = settlement.settleMarket({
    marketId: "market-1",
    eventId: "event-1",
    results: {
      "market-1-home": "won",
      "market-1-away": "lost",
    },
    source: "official-feed",
    sourceRevision: 1,
    settledAt: "2026-10-20T20:01:00Z",
  });
  assert.equal(payouts.length, 1);
  assert.equal(payouts[0].netReturnMinor, 2_000n);
  assert.equal(repository.get(bet.id).status, "won");
  assert.equal(wallet.settlements.get(`sportsbook:${bet.id}`), 2_000n);
  assert.equal(settlement.verifyAudit(), true);
});

test("cash out values the remaining probability and closes a bet", () => {
  const { service, repository, wallet } = setup();
  const quote = service.quote(
    {
      playerId: "player",
      requestId: "cashout",
      currency: "CHIP",
      stakeMinor: 1_000n,
      kind: "single",
      selections: [{ marketId: "market-1", selectionId: "market-1-home" }],
    },
    new Date("2026-10-19T10:00:00Z"),
  );
  const bet = service.accept(
    quote.id,
    "cashout",
    new Date("2026-10-19T10:00:01Z"),
  );
  const cashout = new CashOutService(repository, wallet, {
    enabled: true,
    minimumOfferMinor: 100n,
    maximumOfferMinor: 100_000n,
    preMatchMarginBasisPoints: 500,
    inPlayMarginBasisPoints: 1_000,
    quoteLifetimeMs: 10_000,
    disabledMarketIds: [],
  });
  const offer = cashout.quote({
    betId: bet.id,
    currentPrices: {
      "market-1-home": { numerator: 4n, denominator: 1n },
    },
    inPlay: false,
    at: new Date("2026-10-19T10:01:00Z"),
  });
  assert.equal(offer.fairValueMinor, 500n);
  assert.equal(offer.amountMinor, 475n);
  const accepted = cashout.accept(
    offer.id,
    "player",
    new Date("2026-10-19T10:01:01Z"),
  );
  assert.equal(accepted.bet.status, "cashed_out");
  assert.equal(wallet.settlements.get(`sportsbook:${bet.id}`), 475n);
});
