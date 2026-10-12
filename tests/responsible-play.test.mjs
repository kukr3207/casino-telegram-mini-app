import assert from "node:assert/strict";
import test from "node:test";

import { ExclusionRegistry } from "../lib/responsible-play/exclusions.ts";
import { PlayerLimitService } from "../lib/responsible-play/limits.ts";
import { SessionTracker } from "../lib/responsible-play/sessions.ts";

const NOW = new Date("2026-07-06T10:00:00.000Z");

test("decreased player limits apply immediately", () => {
  const limits = new PlayerLimitService();
  limits.request({ id: "old", playerId: "p", kind: "deposit", period: "week", value: 1000n, at: NOW });
  const lower = limits.request({ id: "new", playerId: "p", kind: "deposit", period: "week", value: 500n, at: NOW });
  assert.equal(lower.status, "active");
  assert.equal(limits.active("p", "deposit", "week", NOW).id, "new");
});

test("increased player limits wait seven days before replacing the active limit", () => {
  const limits = new PlayerLimitService();
  limits.request({ id: "old", playerId: "p", kind: "wager", period: "day", value: 100n, at: NOW });
  const higher = limits.request({ id: "new", playerId: "p", kind: "wager", period: "day", value: 200n, at: NOW });
  assert.equal(higher.status, "scheduled");
  assert.equal(limits.active("p", "wager", "day", new Date(NOW.getTime() + 6 * 86400000)).id, "old");
  assert.equal(limits.activateScheduled(new Date(NOW.getTime() + 7 * 86400000))[0].id, "new");
});

test("limit usage is idempotent and evaluated inside UTC period boundaries", () => {
  const limits = new PlayerLimitService();
  limits.request({ id: "limit", playerId: "p", kind: "loss", period: "day", value: 100n, at: NOW });
  limits.record("p", "loss", 60n, NOW, "round-1");
  limits.record("p", "loss", 60n, NOW, "round-1");
  const usage = limits.check("p", "loss", "day", 41n, NOW);
  assert.deepEqual({ used: usage.used, remaining: usage.remaining, allowed: usage.allowed }, {
    used: 60n, remaining: 40n, allowed: false,
  });
});

test("self-exclusion checks scope and indefinite exclusions", () => {
  const registry = new ExclusionRegistry();
  registry.exclude({
    id: "self", playerId: "p", scope: "all", startsAt: NOW,
    reason: "player request", source: "player",
  });
  const check = registry.check("p", "casino", NOW);
  assert.equal(check.excluded, true);
  assert.equal(check.earliestEnd, null);
  assert.throws(() => registry.revoke("self", NOW), /operator/);
});

test("operator exclusion can be revoked without changing history", () => {
  const registry = new ExclusionRegistry();
  registry.exclude({
    id: "operator", playerId: "p", scope: "payments", startsAt: NOW,
    endsAt: new Date(NOW.getTime() + 86400000), reason: "review", source: "operator",
  });
  assert.equal(registry.check("p", "payments", NOW).excluded, true);
  registry.revoke("operator", new Date(NOW.getTime() + 1000));
  assert.equal(registry.check("p", "payments", new Date(NOW.getTime() + 2000)).excluded, false);
});

test("session tracker records rounds and presents reality checks", () => {
  const sessions = new SessionTracker();
  sessions.start("session", "p", NOW);
  sessions.recordRound("session", 100n, 150n, new Date(NOW.getTime() + 10 * 60000));
  sessions.recordRound("session", 100n, 0n, new Date(NOW.getTime() + 20 * 60000));
  assert.deepEqual(sessions.realityCheck("session", new Date(NOW.getTime() + 61 * 60000)), {
    due: true, elapsedMinutes: 61, net: -50n,
  });
  assert.equal(sessions.realityCheck("session", new Date(NOW.getTime() + 62 * 60000)).due, false);
  const ended = sessions.end("session", new Date(NOW.getTime() + 70 * 60000));
  assert.equal(ended.rounds, 2);
  assert.equal(ended.endedAt, "2026-07-06T11:10:00.000Z");
});

test("one player cannot open overlapping play sessions", () => {
  const sessions = new SessionTracker();
  sessions.start("one", "p", NOW);
  assert.throws(() => sessions.start("two", "p", NOW), /active session/);
});
