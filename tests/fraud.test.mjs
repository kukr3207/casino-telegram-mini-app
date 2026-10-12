import assert from "node:assert/strict";
import test from "node:test";

import { ChargebackConflictError, ChargebackService } from "../lib/fraud/chargebacks.ts";
import { FraudCaseConflictError, FraudCaseService } from "../lib/fraud/cases.ts";
import { DeviceGraph } from "../lib/fraud/device-graph.ts";
import { VelocityTracker } from "../lib/fraud/velocity.ts";

test("device graph explains links between player identities", () => {
  const graph = new DeviceGraph();
  const at = new Date("2026-01-01T00:00:00Z");
  graph.observe({ playerId: "one", deviceId: "device", ipAddress: "1.1.1.1", userAgent: "agent", paymentFingerprint: "card", observedAt: at });
  graph.observe({ playerId: "two", deviceId: "device", ipAddress: "2.2.2.2", userAgent: "other", observedAt: at });
  graph.observe({ playerId: "three", deviceId: "other", ipAddress: "1.1.1.1", userAgent: "agent", paymentFingerprint: "card", observedAt: at });
  const connections = graph.connections("one");
  assert.equal(connections[0].playerId, "three");
  assert.equal(connections[0].score, 100);
  assert.deepEqual(connections[0].reasons, ["matching_browser", "shared_ip", "shared_payment_method"]);
  assert.equal(connections[1].score, 60);
});

test("duplicate device observations are idempotent", () => {
  const graph = new DeviceGraph();
  const observation = { playerId: "p", deviceId: "d", ipAddress: "i", userAgent: "u", observedAt: new Date() };
  graph.observe(observation);
  graph.observe(observation);
  assert.deepEqual(graph.devicesForPlayer("p"), ["d"]);
  assert.deepEqual(graph.playersForDevice("d"), ["p"]);
});

test("velocity tracker enforces count and amount thresholds", () => {
  const tracker = new VelocityTracker();
  tracker.configure({ id: "deposits", kinds: ["deposit"], dimension: "player", windowMs: 60_000, maximumCount: 2, maximumAmountMinor: 1_000n, action: "review" });
  const at = new Date("2026-01-01T00:00:00Z");
  tracker.record({ id: "1", kind: "deposit", playerId: "p", occurredAt: at, amountMinor: 400n });
  tracker.record({ id: "2", kind: "deposit", playerId: "p", occurredAt: new Date(at.getTime() + 1), amountMinor: 400n });
  const breaches = tracker.record({ id: "3", kind: "deposit", playerId: "p", occurredAt: new Date(at.getTime() + 2), amountMinor: 400n });
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].count, 3);
  assert.equal(breaches[0].amountMinor, 1_200n);
});

test("velocity retries do not inflate counts", () => {
  const tracker = new VelocityTracker();
  tracker.configure({ id: "logins", kinds: ["login"], dimension: "ip", windowMs: 60_000, maximumCount: 1, action: "deny" });
  const event = { id: "one", kind: "login", playerId: "p", ipAddress: "1", occurredAt: new Date() };
  assert.equal(tracker.record(event).length, 0);
  assert.equal(tracker.record(event).length, 0);
});

test("fraud cases preserve evidence and require assignment before resolution", () => {
  const cases = new FraudCaseService();
  let fraudCase = cases.open("p", "Shared payment instrument", "high", ["payments"]);
  assert.throws(() => cases.resolve(fraudCase.id, fraudCase.version, "confirmed"), FraudCaseConflictError);
  fraudCase = cases.assign(fraudCase.id, fraudCase.version, "analyst");
  fraudCase = cases.addEvidence(fraudCase.id, fraudCase.version, {
    type: "payment",
    reference: "pay-1",
    summary: "same card used by three accounts",
    collectedAt: new Date(),
    collectedBy: "analyst",
    metadata: { matches: "3" },
  });
  fraudCase = cases.resolve(fraudCase.id, fraudCase.version, "confirmed account linkage");
  assert.equal(fraudCase.status, "resolved");
  assert.equal(fraudCase.evidence.length, 1);
});

test("fraud case list prioritizes critical work", () => {
  const cases = new FraudCaseService();
  cases.open("one", "Low", "low");
  cases.open("two", "Critical", "critical");
  assert.deepEqual(cases.list().map((item) => item.playerId), ["two", "one"]);
});

test("chargebacks deduplicate provider case identifiers", () => {
  const service = new ChargebackService();
  const input = {
    paymentId: "payment",
    playerId: "player",
    providerCaseId: "provider-case",
    amountMinor: 5_000n,
    currency: "usd",
    reasonCode: "fraud",
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    responseDueAt: new Date("2026-01-10T00:00:00Z"),
  };
  const first = service.receive(input);
  const replay = service.receive(input);
  assert.deepEqual(replay, first);
  assert.equal(service.exposure("USD"), 5_000n);
});

test("chargeback evidence must be present and submitted before resolution", () => {
  const service = new ChargebackService();
  let chargeback = service.receive({
    paymentId: "payment",
    playerId: "player",
    providerCaseId: "case",
    amountMinor: 1_000n,
    currency: "USD",
    reasonCode: "not_received",
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    responseDueAt: new Date("2026-01-10T00:00:00Z"),
  });
  assert.throws(() => service.submit(chargeback.id, chargeback.version, new Date("2026-01-02T00:00:00Z")), ChargebackConflictError);
  chargeback = service.addEvidence(chargeback.id, chargeback.version, "game_log", "signed game record");
  chargeback = service.submit(chargeback.id, chargeback.version, new Date("2026-01-02T00:00:00Z"));
  chargeback = service.resolve(chargeback.id, chargeback.version, "won");
  assert.equal(chargeback.status, "won");
  assert.equal(service.exposure("USD"), 0n);
});

