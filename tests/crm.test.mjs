import assert from "node:assert/strict";
import test from "node:test";

import { AttributionService } from "../lib/crm/attribution.ts";
import { CommissionService } from "../lib/crm/commissions.ts";
import { JourneyService } from "../lib/crm/journeys.ts";
import { PartnerRegistry } from "../lib/crm/partners.ts";
import { VipService } from "../lib/crm/vip.ts";

function partnerRegistry() {
  const registry = new PartnerRegistry();
  let partner = registry.createPartner({
    id: "partner",
    name: "Publisher",
    legalName: "Publisher Ltd",
    status: "pending",
    countries: ["GB"],
    blockedCountries: [],
    currencies: ["USD"],
    trackingDomains: ["publisher.example"],
    paymentCurrency: "USD",
    createdAt: "2026-01-01T00:00:00Z",
    version: 1,
  });
  partner = registry.transitionPartner(
    partner.id,
    partner.version,
    "active",
    "manager",
    new Date("2026-01-02"),
  );
  const campaign = registry.createCampaign({
    id: "campaign",
    partnerId: partner.id,
    name: "Welcome",
    code: "WELCOME",
    model: "hybrid",
    startsAt: "2026-01-01T00:00:00Z",
    countries: ["GB"],
    channels: ["content"],
    landingPage: "https://casino.example/welcome",
    cpaMinor: 5_000n,
    revenueShareBasisPoints: 2_500,
    negativeCarryover: false,
    minimumQualifyingDepositMinor: 1_000n,
    minimumQualifyingWagerMinor: 5_000n,
    qualificationDays: 30,
    enabled: true,
    version: 1,
  });
  return { registry, partner, campaign };
}

test("partner campaign lookup enforces dates and country", () => {
  const { registry } = partnerRegistry();
  assert.equal(
    registry.campaignByCode("welcome", "GB", new Date("2026-01-10")).id,
    "campaign",
  );
  assert.equal(
    registry.campaignByCode("welcome", "US", new Date("2026-01-10")),
    undefined,
  );
});

test("suspending a partner disables active campaigns", () => {
  const { registry, partner, campaign } = partnerRegistry();
  registry.transitionPartner(
    partner.id,
    partner.version,
    "suspended",
    "manager",
  );
  assert.equal(registry.campaign(campaign.id).enabled, false);
});

test("attribution joins anonymous touches to a player and locks on deposit", () => {
  const { registry, partner, campaign } = partnerRegistry();
  const service = new AttributionService(registry, {
    windowDays: 30,
    model: "last_touch",
    lockAfterFirstDeposit: true,
    allowedChannels: ["content"],
    blockedReferrers: ["spam.example"],
  });
  service.record({
    id: "click",
    anonymousId: "browser",
    campaignId: campaign.id,
    partnerId: partner.id,
    kind: "click",
    channel: "content",
    country: "GB",
    occurredAt: "2026-01-03T00:00:00Z",
    metadata: {},
  });
  const attribution = service.identify(
    "browser",
    "player",
    new Date("2026-01-04"),
  );
  assert.equal(attribution.partnerId, partner.id);
  const locked = service.lock("player", {
    id: "deposit",
    playerId: "player",
    anonymousId: "browser",
    campaignId: campaign.id,
    partnerId: partner.id,
    kind: "deposit",
    channel: "content",
    country: "GB",
    occurredAt: "2026-01-05T00:00:00Z",
    metadata: {},
  });
  assert.equal(locked.locked, true);
});

test("attribution rejects blocked referral sources", () => {
  const { registry, partner, campaign } = partnerRegistry();
  const service = new AttributionService(registry, {
    windowDays: 30,
    model: "last_touch",
    lockAfterFirstDeposit: true,
    allowedChannels: ["content"],
    blockedReferrers: ["spam.example"],
  });
  assert.throws(() =>
    service.record({
      id: "bad",
      anonymousId: "browser",
      campaignId: campaign.id,
      partnerId: partner.id,
      kind: "click",
      channel: "content",
      referrer: "https://spam.example/post",
      occurredAt: "2026-01-03T00:00:00Z",
      metadata: {},
    }),
  );
});

test("hybrid commissions combine qualification and positive revenue share", () => {
  const { registry, partner, campaign } = partnerRegistry();
  const service = new CommissionService(registry);
  service.record({
    id: "qualify",
    playerId: "player",
    partnerId: partner.id,
    campaignId: campaign.id,
    kind: "qualification",
    currency: "USD",
    amountMinor: 0n,
    sourceReference: "qualification:player",
    occurredAt: "2026-01-10T00:00:00Z",
    metadata: {},
  });
  service.record({
    id: "revenue",
    playerId: "player",
    partnerId: partner.id,
    campaignId: campaign.id,
    kind: "net_revenue",
    currency: "USD",
    amountMinor: 20_000n,
    sourceReference: "revenue:player",
    occurredAt: "2026-01-20T00:00:00Z",
    metadata: {},
  });
  const item = service.calculate(partner.id, campaign.id, "player", "2026-01");
  assert.equal(item.commissionMinor, 10_000n);
});

test("partner payments require a second approver and settle items", () => {
  const { registry, partner, campaign } = partnerRegistry();
  const service = new CommissionService(registry);
  service.record({
    id: "qualify",
    playerId: "player",
    partnerId: partner.id,
    campaignId: campaign.id,
    kind: "qualification",
    currency: "USD",
    amountMinor: 0n,
    sourceReference: "qualification",
    occurredAt: "2026-01-10T00:00:00Z",
    metadata: {},
  });
  let item = service.calculate(partner.id, campaign.id, "player", "2026-01");
  item = service.approve(item.id, item.version);
  let payment = service.createPayment(partner.id, "2026-01", "requester");
  assert.throws(() =>
    service.approvePayment(payment.id, payment.version, "requester"),
  );
  payment = service.approvePayment(payment.id, payment.version, "controller");
  payment = service.markSent(payment.id, payment.version, "bank-1");
  payment = service.confirm(payment.id, payment.version);
  assert.equal(payment.status, "confirmed");
  assert.equal(service.items(partner.id)[0].status, "paid");
});

test("VIP cases track ownership interactions and resolution", () => {
  const service = new VipService();
  let profile = service.upsertProfile({
    playerId: "player",
    tier: "gold",
    hostId: "host",
    interests: ["poker"],
    restrictions: [],
    serviceNotes: "Prefers evening contact",
    status: "active",
    version: 0,
  });
  profile = service.assignHost(profile.playerId, profile.version, "new-host");
  let item = service.createCase({
    playerId: profile.playerId,
    hostId: profile.hostId,
    category: "service",
    priority: "high",
    subject: "Event invitation",
    description: "Invite player to event",
    dueAt: "2026-01-10T00:00:00Z",
  });
  item = service.addInteraction(item.id, item.version, {
    id: "note",
    kind: "call",
    actorId: "new-host",
    summary: "Player accepted",
    occurredAt: "2026-01-05T00:00:00Z",
    private: false,
  });
  item = service.transitionCase(
    item.id,
    item.version,
    "resolved",
    "Invitation confirmed",
  );
  assert.equal(item.status, "resolved");
  assert.equal(service.workload("new-host").length, 0);
});

function journey() {
  return {
    id: "welcome",
    name: "Welcome players",
    trigger: "registration",
    segmentConditions: { country: ["GB"] },
    steps: [
      {
        id: "hello",
        delayMinutes: 0,
        channel: "inbox",
        templateId: "welcome",
        stopOnEvents: ["self_excluded"],
      },
      {
        id: "help",
        delayMinutes: 60,
        channel: "inbox",
        templateId: "help",
        stopOnEvents: ["self_excluded", "deposited"],
      },
    ],
    enabled: true,
    version: 1,
  };
}

test("journeys schedule ordered steps and stop on player events", () => {
  const service = new JourneyService();
  service.create(journey());
  let enrollment = service.enroll(
    "welcome",
    "player",
    { country: "GB" },
    new Date("2026-01-01T00:00:00Z"),
  );
  assert.equal(service.due(new Date("2026-01-01T00:00:00Z")).length, 1);
  enrollment = service.completeStep(
    enrollment.id,
    enrollment.version,
    "hello",
    new Date("2026-01-01T00:00:00Z"),
  );
  assert.equal(enrollment.nextRunAt, "2026-01-01T01:00:00.000Z");
  const stopped = service.recordPlayerEvent("event", "player", "deposited");
  assert.equal(stopped[0].status, "stopped");
});
