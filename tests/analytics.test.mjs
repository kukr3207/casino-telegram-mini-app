import assert from "node:assert/strict";
import test from "node:test";

import { calculateFunnel, calculateRetention } from "../lib/analytics/cohorts.ts";
import { AnalyticsEventStore, AnalyticsValidationError } from "../lib/analytics/events.ts";
import { MetricEngine } from "../lib/analytics/metrics.ts";
import { evaluateResponsiblePlayRisk } from "../lib/analytics/responsible-play.ts";

function setup() {
  const store = new AnalyticsEventStore();
  store.registerSchema({ name: "game.played", version: 1, requiredProperties: { game: "string", wager: "number" }, allowAdditionalProperties: false });
  store.registerSchema({ name: "account.created", version: 1, requiredProperties: {}, allowAdditionalProperties: false });
  store.registerSchema({ name: "session.started", version: 1, requiredProperties: {}, allowAdditionalProperties: false });
  return store;
}

test("analytics events validate registered schemas", () => {
  const store = setup();
  assert.throws(() => store.append({ name: "game.played", playerId: "p", occurredAt: new Date(), properties: { game: "slots" }, context: {}, schemaVersion: 1 }), AnalyticsValidationError);
  assert.throws(() => store.append({ name: "unknown", playerId: "p", occurredAt: new Date(), properties: {}, context: {}, schemaVersion: 1 }), AnalyticsValidationError);
});

test("analytics appends are content-idempotent", () => {
  const store = setup();
  const input = { name: "game.played", playerId: "p", occurredAt: new Date("2026-01-01"), receivedAt: new Date("2026-01-01"), properties: { game: "slots", wager: 100 }, context: { country: "US" }, schemaVersion: 1 };
  const first = store.append(input);
  const retry = store.append(input);
  assert.equal(retry.id, first.id);
  assert.equal(store.query().length, 1);
});

test("metric engine aggregates dimensions and unique players", () => {
  const store = setup();
  for (const [playerId, game, wager] of [["one", "slots", 100], ["two", "slots", 200], ["one", "dice", 50]]) {
    store.append({ name: "game.played", playerId, occurredAt: new Date(`2026-01-01T00:00:0${wager / 50}Z`), receivedAt: new Date("2026-01-02"), properties: { game, wager }, context: {}, schemaVersion: 1 });
  }
  const engine = new MetricEngine();
  engine.register({ id: "wager", eventName: "game.played", aggregation: "sum", property: "wager", dimensions: ["game"] });
  engine.register({ id: "players", eventName: "game.played", aggregation: "unique_players" });
  const wagers = engine.calculate("wager", store.query(), new Date("2026-01-01"), new Date("2026-01-02"));
  assert.deepEqual(wagers.map((point) => [point.dimensions.game, point.value]), [["dice", 50], ["slots", 300]]);
  assert.equal(engine.calculate("players", store.query(), new Date("2026-01-01"), new Date("2026-01-02"))[0].value, 2);
});

test("retention cohorts use each player's first acquisition", () => {
  const store = setup();
  store.append({ name: "account.created", playerId: "one", occurredAt: new Date("2026-01-01"), receivedAt: new Date("2026-01-10"), properties: {}, context: {}, schemaVersion: 1 });
  store.append({ name: "account.created", playerId: "two", occurredAt: new Date("2026-01-01"), receivedAt: new Date("2026-01-10"), properties: {}, context: {}, schemaVersion: 1 });
  store.append({ name: "session.started", playerId: "one", occurredAt: new Date("2026-01-02"), receivedAt: new Date("2026-01-10"), properties: {}, context: {}, schemaVersion: 1 });
  const rows = calculateRetention(store.query(), { id: "retention", entryEvent: "account.created", returnEvent: "session.started", periodDays: 1, periods: 3 }, new Date("2026-01-01"), new Date("2026-01-10"));
  assert.equal(rows[0].acquiredPlayers, 2);
  assert.deepEqual(rows[0].retainedByPeriod, [0, 1, 0]);
  assert.equal(rows[0].retentionRates[1], 0.5);
});

test("funnels require ordered steps per player", () => {
  const events = [
    { id: "1", name: "view", playerId: "one", occurredAt: new Date("2026-01-01T00:00:00Z"), receivedAt: new Date(), properties: {}, context: {}, schemaVersion: 1 },
    { id: "2", name: "deposit", playerId: "one", occurredAt: new Date("2026-01-01T00:01:00Z"), receivedAt: new Date(), properties: {}, context: {}, schemaVersion: 1 },
    { id: "3", name: "play", playerId: "one", occurredAt: new Date("2026-01-01T00:02:00Z"), receivedAt: new Date(), properties: {}, context: {}, schemaVersion: 1 },
    { id: "4", name: "view", playerId: "two", occurredAt: new Date("2026-01-01T00:00:00Z"), receivedAt: new Date(), properties: {}, context: {}, schemaVersion: 1 },
  ];
  const funnel = calculateFunnel(events, [{ eventName: "view" }, { eventName: "deposit" }, { eventName: "play" }], new Date("2026-01-01"), new Date("2026-01-02"));
  assert.deepEqual(funnel.map((step) => step.reachedPlayers), [2, 1, 1]);
  assert.equal(funnel[1].conversionFromStart, 0.5);
});

test("responsible-play trends combine independent risk indicators", () => {
  const history = [];
  for (let index = 0; index < 14; index += 1) {
    const recent = index >= 7;
    history.push({
      playerId: "p",
      date: `2026-01-${String(index + 1).padStart(2, "0")}`,
      depositsMinor: recent ? 1_000n : 500n,
      withdrawalsMinor: 0n,
      wagersMinor: recent ? 4_000n : 1_000n,
      winsMinor: recent ? 500n : 900n,
      sessionMinutes: recent ? 240 : 30,
      sessions: recent ? 4 : 1,
      lateNightMinutes: recent ? 60 : 0,
      limitChanges: recent && index % 2 === 0 ? 1 : 0,
      cancelledWithdrawals: recent && index % 2 === 0 ? 1 : 0,
    });
  }
  const trend = evaluateResponsiblePlayRisk(history);
  assert.equal(trend.level, "critical");
  assert.ok(trend.indicators.some((item) => item.code === "rapid_wager_growth"));
  assert.ok(trend.indicators.some((item) => item.code === "extended_play"));
});

