import assert from "node:assert/strict";
import test from "node:test";

import { BetPresetStore } from "../lib/player/bet-presets.ts";
import { GameReportService, PlayerFeatureConflictError } from "../lib/player/game-reports.ts";
import { GameHighlightStore } from "../lib/player/highlights.ts";

test("game reports deduplicate active reports for one player round", () => {
  const service = new GameReportService();
  const first = service.open("p", "slots", "round", "fairness_concern", "Outcome looked wrong");
  const retry = service.open("p", "slots", "round", "fairness_concern", "Outcome looked wrong");
  assert.deepEqual(retry, first);
});

test("game reports preserve conversation through investigation", () => {
  const service = new GameReportService();
  let report = service.open("p", "blackjack", "round", "incorrect_outcome", "Dealer result is wrong");
  report = service.addMessage(report.id, report.version, "player", "p", "Please inspect the final hand", ["screenshot-1"]);
  report = service.assign(report.id, report.version, "support-1");
  report = service.investigate(report.id, report.version);
  report = service.addMessage(report.id, report.version, "operator", "support-1", "The signed event log was checked");
  report = service.close(report.id, report.version, "Outcome matched the committed deck", true);
  assert.equal(report.status, "dismissed");
  assert.equal(report.messages.length, 2);
  assert.throws(() => service.addMessage(report.id, report.version, "player", "p", "again"), PlayerFeatureConflictError);
});

test("closed reports allow a new report for the same round", () => {
  const service = new GameReportService();
  let report = service.open("p", "slots", "r", "technical_issue", "Frozen game");
  report = service.assign(report.id, report.version, "op");
  service.close(report.id, report.version, "Refunded affected stake");
  const next = service.open("p", "slots", "r", "other", "Follow-up question");
  assert.notEqual(next.id, report.id);
});

test("highlights are idempotent per player game round", () => {
  const store = new GameHighlightStore();
  const input = {
    playerId: "p",
    gameId: "slots",
    roundId: "r",
    title: "Big win",
    occurredAt: new Date(),
    tags: ["Win", "win", "jackpot"],
    metrics: { multiplier: 25 },
    visibility: "private",
  };
  const first = store.save(input);
  const retry = store.save(input);
  assert.deepEqual(retry, first);
  assert.deepEqual(first.tags, ["jackpot", "win"]);
});

test("public highlights receive revocable share codes", () => {
  const store = new GameHighlightStore();
  let highlight = store.save({
    playerId: "p",
    gameId: "roulette",
    roundId: "r",
    title: "Lucky number",
    occurredAt: new Date(),
    tags: [],
    metrics: { payout: 3600 },
    visibility: "private",
  });
  highlight = store.setVisibility(highlight.id, highlight.version, "public");
  assert.equal(store.getShared(highlight.shareCode).id, highlight.id);
  const code = highlight.shareCode;
  highlight = store.setVisibility(highlight.id, highlight.version, "private");
  assert.equal(store.getShared(code), undefined);
});

test("highlight listing supports game and tag filters", () => {
  const store = new GameHighlightStore();
  store.save({ playerId: "p", gameId: "slots", roundId: "1", title: "One", occurredAt: new Date("2026-01-01"), tags: ["win"], metrics: {}, visibility: "private" });
  store.save({ playerId: "p", gameId: "dice", roundId: "2", title: "Two", occurredAt: new Date("2026-01-02"), tags: ["streak"], metrics: {}, visibility: "private" });
  assert.deepEqual(store.list("p", { gameId: "slots" }).map((item) => item.title), ["One"]);
  assert.deepEqual(store.list("p", { tag: "streak" }).map((item) => item.title), ["Two"]);
});

test("bet presets enforce unique names within each game", () => {
  const store = new BetPresetStore();
  store.create({ playerId: "p", game: "dice", name: "Safe", stakeMinor: 100n, currency: "chip", configuration: { target: 7 } });
  assert.throws(() => store.create({ playerId: "p", game: "dice", name: "safe", stakeMinor: 200n, currency: "CHIP", configuration: { target: 9 } }), PlayerFeatureConflictError);
  store.create({ playerId: "p", game: "roulette", name: "Safe", stakeMinor: 100n, currency: "CHIP", configuration: { color: "red" } });
  assert.equal(store.list("p").length, 2);
});

test("making a preset default clears the previous default", () => {
  const store = new BetPresetStore();
  const first = store.create({ playerId: "p", game: "dice", name: "One", stakeMinor: 100n, currency: "CHIP", configuration: { target: 7 }, isDefault: true });
  let second = store.create({ playerId: "p", game: "dice", name: "Two", stakeMinor: 200n, currency: "CHIP", configuration: { target: 8 } });
  second = store.makeDefault(second.id, second.version);
  const values = store.list("p", "dice");
  assert.equal(values[0].id, second.id);
  assert.equal(values.filter((item) => item.isDefault).length, 1);
  assert.equal(values.find((item) => item.id === first.id).isDefault, false);
});

test("using presets tracks popularity and rejects cross-player access", () => {
  const store = new BetPresetStore();
  const preset = store.create({ playerId: "p", game: "slots", name: "Fast", stakeMinor: 10n, currency: "CHIP", configuration: { lines: 10 } });
  assert.equal(store.use(preset.id, "p").useCount, 1);
  assert.throws(() => store.use(preset.id, "other"));
});

