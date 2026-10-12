import assert from "node:assert/strict";
import test from "node:test";

import { CampaignService } from "../lib/rewards/campaigns.ts";
import { LoyaltyService } from "../lib/rewards/loyalty.ts";
import { ChallengeService } from "../lib/social/challenges.ts";
import { ContactBook } from "../lib/social/contacts.ts";
import { GiftService } from "../lib/social/gifts.ts";

const NOW = new Date("2026-08-01T00:00:00.000Z");

test("campaign eligibility applies time, country, game, and stake rules", () => {
  const campaigns = new CampaignService();
  campaigns.add({
    id: "weekend", name: "Weekend Dice", startsAt: NOW.toISOString(),
    endsAt: new Date(NOW.getTime() + 86400000).toISOString(), budget: 1000n,
    perPlayerLimit: 1, status: "active",
    rules: [{ game: "dice", minimumStake: 100n, excludedCountries: ["XX"] }],
    rewards: [{ kind: "chips", amount: 50n, expiresAfterDays: 7 }],
  });
  const context = { playerId: "p", country: "US", joinedAt: "2020-01-01", game: "dice", stake: 100n };
  assert.equal(campaigns.eligible("weekend", context, NOW), true);
  assert.equal(campaigns.eligible("weekend", { ...context, stake: 99n }, NOW), false);
  assert.equal(campaigns.eligible("weekend", { ...context, country: "XX" }, NOW), false);
});

test("reward grants respect player limits, budgets, expiry, and idempotent claims", () => {
  const campaigns = new CampaignService();
  campaigns.add({
    id: "welcome", name: "Welcome", startsAt: NOW.toISOString(),
    endsAt: new Date(NOW.getTime() + 86400000).toISOString(), budget: 100n,
    perPlayerLimit: 1, status: "active", rules: [],
    rewards: [{ kind: "chips", amount: 100n, expiresAfterDays: 1 }],
  });
  const context = { playerId: "p", country: "US", joinedAt: NOW.toISOString() };
  const [grant] = campaigns.grant("welcome", context, NOW);
  const claimed = campaigns.claim(grant.id, new Date(NOW.getTime() + 1000));
  assert.equal(claimed.status, "claimed");
  assert.equal(campaigns.claim(grant.id, new Date(NOW.getTime() + 2000)), claimed);
  assert.equal(campaigns.eligible("welcome", context, NOW), false);
});

test("loyalty awards promote tiers and redemption can demote them", () => {
  const loyalty = new LoyaltyService([
    { id: "bronze", minimumPoints: 0n, cashbackBps: 0, dailyGift: 1n, priority: 1 },
    { id: "silver", minimumPoints: 100n, cashbackBps: 100, dailyGift: 5n, priority: 2 },
    { id: "gold", minimumPoints: 500n, cashbackBps: 250, dailyGift: 10n, priority: 3 },
  ]);
  const silver = loyalty.award({ id: "event", playerId: "p", points: 120n, reason: "play", occurredAt: NOW.toISOString() });
  assert.equal(silver.tierId, "silver");
  assert.equal(loyalty.cashback("p", 1000n), 10n);
  const bronze = loyalty.redeem("p", 100n, NOW);
  assert.equal(bronze.tierId, "bronze");
  assert.equal(bronze.lifetimePoints, 120n);
});

test("contact requests need recipient acceptance before interaction", () => {
  const contacts = new ContactBook();
  const pending = contacts.request("contact", "a", "b", NOW);
  assert.equal(pending.state, "pending");
  assert.equal(contacts.canInteract("a", "b"), false);
  contacts.respond("contact", "b", true, new Date(NOW.getTime() + 1000));
  assert.equal(contacts.canInteract("b", "a"), true);
  assert.equal(contacts.contacts("a").length, 1);
  contacts.block("contact", "a", new Date(NOW.getTime() + 2000));
  assert.equal(contacts.canInteract("a", "b"), false);
});

test("chip gifts can be accepted, declined, expired, or cancelled", () => {
  const gifts = new GiftService();
  const gift = gifts.send({ id: "gift", senderId: "a", recipientId: "b", units: 10n, at: NOW });
  assert.equal(gifts.resolve(gift.id, "b", true, new Date(NOW.getTime() + 1000)).state, "accepted");
  const expiring = gifts.send({ id: "late", senderId: "a", recipientId: "b", units: 5n, at: NOW, expiresAfterHours: 1 });
  assert.equal(gifts.resolve(expiring.id, "b", true, new Date(NOW.getTime() + 3600001)).state, "expired");
  const cancel = gifts.send({ id: "cancel", senderId: "a", recipientId: "b", units: 5n, at: NOW });
  assert.equal(gifts.cancel(cancel.id, "a", NOW).state, "cancelled");
  assert.equal(gifts.inbox("b").length, 3);
});

test("best-of dice challenges finish as soon as one player reaches majority", () => {
  const challenges = new ChallengeService();
  challenges.create({ id: "c", creatorId: "a", opponentId: "b", stake: 100n, bestOf: 3, at: NOW });
  challenges.accept("c", "b", NOW);
  let value = challenges.record("c", 12, 2, ["p1", "p2"]);
  assert.equal(value.state, "active");
  value = challenges.record("c", 10, 4, ["p3", "p4"]);
  assert.equal(value.state, "completed");
  assert.equal(value.winnerId, "a");
  assert.equal(value.rounds.length, 2);
});

test("tied challenge rounds do not count toward either majority", () => {
  const challenges = new ChallengeService();
  challenges.create({ id: "c", creatorId: "a", opponentId: "b", stake: 1n, bestOf: 1, at: NOW });
  challenges.accept("c", "b", NOW);
  const tied = challenges.record("c", 7, 7, ["p1", "p2"]);
  assert.equal(tied.state, "active");
  const finished = challenges.record("c", 8, 6, ["p3", "p4"]);
  assert.equal(finished.winnerId, "a");
});
