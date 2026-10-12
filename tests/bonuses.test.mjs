import assert from "node:assert/strict";
import test from "node:test";

import { BonusCampaignRegistry, BonusConflictError } from "../lib/bonuses/campaigns.ts";
import { FreeSpinService } from "../lib/bonuses/free-spins.ts";
import { BonusGrantService } from "../lib/bonuses/grants.ts";

function campaign(registry, overrides = {}) {
  return registry.create({
    id: "welcome",
    name: "Welcome match",
    kind: "deposit_match",
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: new Date("2026-02-01T00:00:00Z"),
    claimStartsAt: new Date("2026-01-01T00:00:00Z"),
    claimEndsAt: new Date("2026-01-20T00:00:00Z"),
    currencies: ["USD"],
    countries: ["US"],
    playerSegments: ["new"],
    minimumDepositMinor: 1_000n,
    maximumBonusMinor: 5_000n,
    matchBasisPoints: 10_000,
    wageringMultiplier: 2,
    eligibleGames: ["slots", "roulette"],
    budgetMinor: 10_000n,
    perPlayerClaims: 1,
    enabled: true,
    ...overrides,
  });
}

test("campaign availability respects window, country, segment, and currency", () => {
  const registry = new BonusCampaignRegistry();
  campaign(registry);
  assert.equal(registry.available({ country: "US", segments: ["new"] }, "USD", new Date("2026-01-10")).length, 1);
  assert.equal(registry.available({ country: "GB", segments: ["new"] }, "USD", new Date("2026-01-10")).length, 0);
  assert.equal(registry.available({ country: "US", segments: ["old"] }, "USD", new Date("2026-01-10")).length, 0);
});

test("eligibility returns all failed conditions", () => {
  const registry = new BonusCampaignRegistry();
  const value = campaign(registry);
  const result = registry.checkEligibility(value.id, {
    country: "GB",
    segments: ["old"],
    currency: "EUR",
    depositMinor: 10n,
    claimedCount: 1,
    at: new Date("2026-01-10"),
  });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["currency_not_supported", "country_not_eligible", "segment_not_eligible", "minimum_deposit_not_met", "claim_limit_reached"]);
});

test("deposit-match grants cap awards and deduplicate source references", () => {
  const registry = new BonusCampaignRegistry();
  const value = campaign(registry);
  const service = new BonusGrantService();
  const first = service.grant(value, {
    playerId: "p",
    currency: "USD",
    depositMinor: 10_000n,
    sourceReference: "deposit-1",
  }, new Date("2026-01-10"));
  const replay = service.grant(value, {
    playerId: "p",
    currency: "USD",
    depositMinor: 10_000n,
    sourceReference: "deposit-1",
  }, new Date("2026-01-10"));
  assert.deepEqual(replay, first);
  assert.equal(first.grantedMinor, 5_000n);
  assert.equal(first.wageringRequiredMinor, 10_000n);
});

test("campaign budgets reject grants atomically", () => {
  const registry = new BonusCampaignRegistry();
  const value = campaign(registry, { budgetMinor: 5_000n });
  const service = new BonusGrantService();
  service.grant(value, { playerId: "one", currency: "USD", depositMinor: 5_000n, sourceReference: "one" }, new Date("2026-01-10"));
  assert.throws(() => service.grant(value, { playerId: "two", currency: "USD", depositMinor: 1_000n, sourceReference: "two" }, new Date("2026-01-10")), BonusConflictError);
  assert.equal(service.campaignCommitted(value.id), 5_000n);
});

test("eligible wagers complete requirements and release remaining bonus", () => {
  const registry = new BonusCampaignRegistry();
  const value = campaign(registry);
  const service = new BonusGrantService();
  let grant = service.grant(value, { playerId: "p", currency: "USD", depositMinor: 2_000n, sourceReference: "d" }, new Date("2026-01-10"));
  let progress = service.contribute(grant.id, grant.version, "slots", 2_000n, 10_000, new Date("2026-01-11"));
  assert.equal(progress.grant.status, "active");
  progress = service.contribute(grant.id, progress.grant.version, "roulette", 2_000n, 10_000, new Date("2026-01-11"));
  assert.equal(progress.grant.status, "completed");
  assert.equal(progress.releasedMinor, 2_000n);
});

test("free spins reserve and settle exactly once", () => {
  const service = new FreeSpinService();
  let pack = service.grant({
    playerId: "p",
    campaignId: "c",
    game: "slots",
    spinValueMinor: 100n,
    currency: "CHIP",
    totalSpins: 2,
    grantedAt: new Date("2026-01-01"),
    expiresAt: new Date("2026-01-10"),
  });
  const reserved = service.reserve(pack.id, pack.version, "round-1", new Date("2026-01-02"));
  const retry = service.reserve(pack.id, reserved.pack.version, "round-1", new Date("2026-01-02"));
  assert.equal(retry.reservation.id, reserved.reservation.id);
  const settled = service.settle(reserved.reservation.id, 250n, new Date("2026-01-02"));
  const settledRetry = service.settle(reserved.reservation.id, 250n, new Date("2026-01-02"));
  assert.equal(settledRetry.pack.winningsMinor, settled.pack.winningsMinor);
  assert.equal(settled.pack.winningsMinor, 250n);
});

test("cancelled free-spin reservations restore inventory", () => {
  const service = new FreeSpinService();
  let pack = service.grant({
    playerId: "p",
    campaignId: "c",
    game: "slots",
    spinValueMinor: 100n,
    currency: "CHIP",
    totalSpins: 1,
    grantedAt: new Date("2026-01-01"),
    expiresAt: new Date("2026-01-10"),
  });
  const reserved = service.reserve(pack.id, pack.version, "round", new Date("2026-01-02"));
  const cancelled = service.cancel(reserved.reservation.id);
  assert.equal(cancelled.pack.remainingSpins, 1);
  assert.equal(cancelled.pack.reservedSpins, 0);
});

