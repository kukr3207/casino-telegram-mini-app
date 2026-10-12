import assert from "node:assert/strict";
import test from "node:test";

import { GameCatalog } from "../lib/liveops/catalog.ts";
import { ExperimentService } from "../lib/liveops/experiments.ts";
import { RuntimeFlagService } from "../lib/liveops/flags.ts";
import {
  MaintenanceScheduler,
  ReleaseService,
} from "../lib/liveops/releases.ts";

function game(overrides = {}) {
  return {
    id: "game",
    slug: "fair-slots",
    name: "Fair Slots",
    provider: "first-party",
    category: "slots",
    lifecycle: "draft",
    currencies: ["CHIP"],
    countries: ["GB", "IN"],
    blockedCountries: ["US"],
    devices: ["mobile", "desktop"],
    tags: ["featured"],
    themes: ["classic"],
    minimumStakeMinor: 10n,
    maximumStakeMinor: 10_000n,
    theoreticalReturnBasisPoints: 9_600,
    volatility: "medium",
    jackpotEligible: false,
    demoAvailable: true,
    metadata: {},
    version: 1,
    ...overrides,
  };
}

test("game catalog requires certification before launch", () => {
  const catalog = new GameCatalog();
  let value = catalog.create(game());
  value = catalog.transition(value.id, value.version, "certification");
  value = catalog.transition(value.id, value.version, "scheduled");
  assert.throws(() =>
    catalog.transition(value.id, value.version, "live", new Date("2026-01-01")),
  );
  catalog.certify({
    id: "certificate",
    gameId: value.id,
    jurisdiction: "GB",
    laboratory: "Lab",
    certificateNumber: "C-1",
    issuedAt: "2025-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
    status: "valid",
    documents: ["report.pdf"],
  });
  value = catalog.transition(
    value.id,
    value.version,
    "live",
    new Date("2026-01-01"),
  );
  assert.equal(value.lifecycle, "live");
});

test("game availability honors country, currency, and device", () => {
  const catalog = new GameCatalog();
  catalog.create(game());
  assert.equal(
    catalog.available({ country: "GB", currency: "CHIP", device: "mobile" })
      .length,
    1,
  );
  assert.equal(
    catalog.available({ country: "US", currency: "CHIP", device: "mobile" })
      .length,
    0,
  );
  assert.equal(
    catalog.available({ country: "GB", currency: "USD", device: "mobile" })
      .length,
    0,
  );
});

test("translations use an explicit fallback locale", () => {
  const catalog = new GameCatalog();
  catalog.create(game());
  catalog.translate({
    gameId: "game",
    locale: "en",
    name: "Fair Slots",
    description: "Verified slot game",
    instructions: ["Choose a stake", "Spin"],
    version: 1,
  });
  assert.equal(catalog.localized("game", "fr", "en").name, "Fair Slots");
});

function flag() {
  return {
    key: "games.newLobby",
    description: "New lobby layout",
    valueType: "boolean",
    defaultValue: false,
    environments: { staging: true },
    rules: [
      {
        id: "vip",
        priority: 1,
        enabled: true,
        conditions: [
          { attribute: "segment", operator: "equals", values: ["vip"] },
        ],
        value: true,
      },
    ],
    owner: "casino-platform",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    version: 1,
  };
}

test("runtime flags evaluate rules before environment defaults", () => {
  const service = new RuntimeFlagService();
  service.create(flag(), "owner");
  const vip = service.evaluate("games.newLobby", {
    subjectId: "player",
    environment: "production",
    attributes: { segment: "vip" },
  });
  const staging = service.evaluate("games.newLobby", {
    subjectId: "player",
    environment: "staging",
    attributes: { segment: "standard" },
  });
  const defaulted = service.evaluate("games.newLobby", {
    subjectId: "player",
    environment: "production",
    attributes: { segment: "standard" },
  });
  assert.equal(vip.value, true);
  assert.equal(vip.source, "rule");
  assert.equal(staging.value, true);
  assert.equal(defaulted.value, false);
});

function experiment() {
  return {
    id: "lobby-order",
    name: "Lobby ordering",
    hypothesis: "Personal ordering improves discovery",
    status: "running",
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-02-01T00:00:00Z",
    allocationBasisPoints: 10_000,
    eligibility: [{ attribute: "country", operator: "equals", values: ["GB"] }],
    variants: [
      {
        id: "control",
        name: "Control",
        weightBasisPoints: 5_000,
        configuration: { layout: "classic" },
      },
      {
        id: "personal",
        name: "Personal",
        weightBasisPoints: 5_000,
        configuration: { layout: "personal" },
      },
    ],
    metrics: [
      {
        key: "game_open",
        direction: "increase",
        kind: "conversion",
        minimumSampleSize: 10,
      },
    ],
    version: 1,
  };
}

test("experiment assignments are stable and observations are idempotent", () => {
  const service = new ExperimentService();
  service.create(experiment());
  const context = {
    subjectId: "player",
    environment: "production",
    attributes: { country: "GB" },
  };
  const first = service.assign("lobby-order", context, new Date("2026-01-10"));
  const retry = service.assign("lobby-order", context, new Date("2026-01-11"));
  assert.deepEqual(retry, first);
  const observation = {
    id: "event",
    experimentId: "lobby-order",
    subjectId: "player",
    metricKey: "game_open",
    value: 1,
    occurredAt: "2026-01-10T00:00:00Z",
  };
  service.observe(observation);
  service.observe(observation);
  assert.equal(
    service
      .results("lobby-order", "game_open")
      .reduce((sum, result) => sum + result.observations, 0),
    1,
  );
});

test("release approval requires checks and a second person", () => {
  const service = new ReleaseService();
  let release = service.create({
    id: "release",
    name: "Game launch",
    environment: "production",
    changes: [{ kind: "game", resourceId: "game", toVersion: 2 }],
    checks: [
      {
        id: "tests",
        name: "Automated tests",
        required: true,
        status: "pending",
      },
    ],
    requestedBy: "author",
  });
  assert.throws(() => service.approve(release.id, release.version, "reviewer"));
  release = service.completeCheck(release.id, release.version, "tests", {
    passed: true,
    actorId: "ci",
  });
  assert.throws(() => service.approve(release.id, release.version, "author"));
  release = service.approve(release.id, release.version, "reviewer");
  release = service.start(release.id, release.version, new Date("2026-01-01"));
  release = service.complete(
    release.id,
    release.version,
    new Date("2026-01-01T00:01:00Z"),
  );
  assert.equal(release.status, "completed");
  assert.equal(service.resourceVersion("production", "game", "game"), 2);
});

test("maintenance scheduler prevents overlapping service windows", () => {
  const service = new MaintenanceScheduler();
  service.schedule({
    id: "one",
    name: "Wallet maintenance",
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-01-01T01:00:00Z",
    services: ["wallet"],
    messageByLocale: { en: "Wallet unavailable" },
    status: "scheduled",
    createdBy: "operator",
    version: 1,
  });
  assert.throws(() =>
    service.schedule({
      id: "two",
      name: "Second maintenance",
      startsAt: "2026-01-01T00:30:00Z",
      endsAt: "2026-01-01T01:30:00Z",
      services: ["wallet"],
      messageByLocale: { en: "Wallet unavailable" },
      status: "scheduled",
      createdBy: "operator",
      version: 1,
    }),
  );
  assert.equal(
    service.activeFor("wallet", undefined, new Date("2026-01-01T00:30:00Z"))
      .length,
    1,
  );
});
