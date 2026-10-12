import assert from "node:assert/strict";
import test from "node:test";

import { OperationalAuditLog } from "../lib/operations/operationalAudit.ts";
import { FeatureFlagService } from "../lib/operations/featureFlags.ts";
import { IncidentManagementService } from "../lib/operations/incidents.ts";
import { DurableJobQueue } from "../lib/operations/jobs.ts";
import { WebhookService } from "../lib/operations/webhooks.ts";

function auditInput(id, overrides = {}) {
  return {
    id,
    actorId: "operator-1",
    actorType: "operator",
    action: "player.updated",
    resourceType: "player",
    resourceId: "player-1",
    occurredAt: "2026-08-01T10:00:00Z",
    correlationId: "request-1",
    before: { status: "pending" },
    after: { status: "verified" },
    metadata: { reason: "reviewed" },
    ...overrides,
  };
}

test("audit events form a verifiable hash chain", () => {
  const log = new OperationalAuditLog();
  const first = log.append(auditInput("event-1"));
  const second = log.append(
    auditInput("event-2", {
      action: "player.enabled",
      occurredAt: "2026-08-01T10:01:00Z",
    }),
  );
  assert.equal(first.sequence, 1);
  assert.equal(second.previousHash, first.hash);
  assert.deepEqual(log.verify(), {
    valid: true,
    checked: 2,
    firstSequence: 1,
    lastSequence: 2,
  });
  assert.equal(log.resourceHistory("player", "player-1").length, 2);
});

test("audit append is idempotent and conflicting identities are atomic", () => {
  const log = new OperationalAuditLog();
  assert.equal(log.append(auditInput("event-1")).sequence, 1);
  assert.equal(log.append(auditInput("event-1")).sequence, 1);
  assert.throws(
    () => log.append(auditInput("event-1", { resourceId: "player-2" })),
    /different data/,
  );
  assert.throws(
    () =>
      log.appendMany([
        auditInput("event-2"),
        auditInput("event-2", { action: "other" }),
      ]),
    /reuses an id/,
  );
  assert.equal(log.size, 1);
});

function createFlag(service) {
  return service.create(
    {
      key: "casino.new-lobby",
      description: "Progressive lobby rollout",
      enabled: true,
      defaultVariant: "control",
      variants: {
        control: { layout: "classic" },
        treatment: { layout: "compact" },
      },
      rules: [
        {
          id: "gb-rollout",
          priority: 10,
          enabled: true,
          conditions: [
            { attribute: "country", operator: "equals", value: "GB" },
          ],
          allocation: { control: 5000, treatment: 5000 },
        },
      ],
      tags: ["lobby", "experiment"],
      ownerId: "growth-team",
    },
    "operator-1",
    "Initial rollout",
    new Date("2026-08-01T00:00:00Z"),
  );
}

test("feature flags evaluate deterministic allocations within matching rules", () => {
  const service = new FeatureFlagService();
  const flag = createFlag(service);
  const first = service.evaluate(flag.key, {
    subjectId: "player-1",
    attributes: { country: "GB" },
  });
  const again = service.evaluate(flag.key, {
    subjectId: "player-1",
    attributes: { country: "GB" },
  });
  assert.equal(first.reason, "rule");
  assert.equal(first.variant, again.variant);
  assert.deepEqual(
    first.value,
    service.evaluate(flag.key, {
      subjectId: "player-1",
      attributes: { country: "GB" },
    }).value,
  );
  assert.equal(
    service.evaluate(flag.key, {
      subjectId: "player-2",
      attributes: { country: "US" },
    }).reason,
    "default",
  );
});

test("feature flags support optimistic updates, history, expiration, and rollback", () => {
  const service = new FeatureFlagService();
  let flag = createFlag(service);
  flag = service.update(
    flag.key,
    { expiresAt: "2026-09-01T00:00:00Z" },
    flag.version,
    "operator-2",
    "Time box experiment",
  );
  assert.equal(
    service.evaluate(
      flag.key,
      { subjectId: "player-1", attributes: { country: "GB" } },
      new Date("2026-09-02T00:00:00Z"),
    ).reason,
    "expired",
  );
  assert.throws(
    () => service.disable(flag.key, 1, "operator-1", "stale"),
    /version/,
  );
  flag = service.rollback(
    flag.key,
    1,
    flag.version,
    "operator-3",
    "Restore first version",
  );
  assert.equal(flag.expiresAt, undefined);
  assert.equal(service.history(flag.key).length, 3);
});

test("job queues schedule, prioritize, lease, heartbeat, and complete work", () => {
  const queue = new DurableJobQueue();
  const now = new Date("2026-08-01T10:00:00Z");
  queue.enqueue(
    { id: "low", type: "email", payload: { to: "a@example.com" }, priority: 1 },
    now,
  );
  queue.enqueue(
    {
      id: "high",
      type: "email",
      payload: { to: "b@example.com" },
      priority: 10,
    },
    now,
  );
  const leased = queue.lease("default", "worker-1", 60, 2, now);
  assert.deepEqual(
    leased.map((job) => job.id),
    ["high", "low"],
  );
  const renewed = queue.heartbeat(
    "high",
    "worker-1",
    120,
    leased[0].version,
    new Date("2026-08-01T10:00:30Z"),
  );
  const done = queue.succeed(
    "high",
    "worker-1",
    { messageId: "m-1" },
    renewed.version,
    new Date("2026-08-01T10:01:00Z"),
  );
  assert.equal(done.status, "succeeded");
  assert.equal(queue.attempts("high")[0].outcome, "succeeded");
});

test("job retries use backoff and eventually enter the dead-letter queue", () => {
  const queue = new DurableJobQueue();
  queue.setRetryPolicy("settlement", {
    initialDelaySeconds: 10,
    maximumDelaySeconds: 60,
    multiplier: 2,
    jitter: 0,
  });
  const start = new Date("2026-08-01T10:00:00Z");
  const job = queue.enqueue(
    {
      id: "settle-1",
      type: "settlement",
      payload: { market: "m-1" },
      maximumAttempts: 2,
    },
    start,
  );
  let leased = queue.lease("default", "worker-1", 60, 1, start)[0];
  let failed = queue.fail(
    job.id,
    "worker-1",
    "provider timeout",
    leased.version,
    true,
    new Date("2026-08-01T10:00:05Z"),
  );
  assert.equal(failed.status, "scheduled");
  assert.equal(failed.scheduledAt, "2026-08-01T10:00:15.000Z");
  leased = queue.lease(
    "default",
    "worker-2",
    60,
    1,
    new Date("2026-08-01T10:00:15Z"),
  )[0];
  failed = queue.fail(
    job.id,
    "worker-2",
    "provider timeout",
    leased.version,
    true,
    new Date("2026-08-01T10:00:20Z"),
  );
  assert.equal(failed.status, "dead_letter");
  assert.equal(queue.statistics()[0].deadLetter, 1);
});

test("job enqueue is idempotent and changed payloads conflict", () => {
  const queue = new DurableJobQueue();
  const first = queue.enqueue({
    type: "email",
    payload: { recipient: "one" },
    idempotencyKey: "welcome:1",
  });
  assert.equal(
    queue.enqueue({
      type: "email",
      payload: { recipient: "one" },
      idempotencyKey: "welcome:1",
    }).id,
    first.id,
  );
  assert.throws(
    () =>
      queue.enqueue({
        type: "email",
        payload: { recipient: "two" },
        idempotencyKey: "welcome:1",
      }),
    /different data/,
  );
});

test("expired job leases are recovered without two workers owning the job", () => {
  const queue = new DurableJobQueue();
  const start = new Date("2026-08-01T10:00:00Z");
  queue.enqueue(
    { id: "job-1", type: "export", payload: {}, maximumAttempts: 2 },
    start,
  );
  const first = queue.lease("default", "worker-1", 30, 1, start)[0];
  assert.equal(
    queue.recoverExpiredLeases(new Date("2026-08-01T10:00:31Z"))[0].status,
    "ready",
  );
  const second = queue.lease(
    "default",
    "worker-2",
    30,
    1,
    new Date("2026-08-01T10:00:31Z"),
  )[0];
  assert.equal(second.attempts, 2);
  assert.throws(
    () =>
      queue.succeed(
        first.id,
        "worker-1",
        {},
        first.version,
        new Date("2026-08-01T10:00:32Z"),
      ),
    /version|another worker/,
  );
});

function declareIncident(service) {
  return service.declare({
    id: "inc-1",
    title: "Payments unavailable",
    summary: "Card authorizations are failing",
    severity: "sev1",
    commanderId: "commander-1",
    serviceIds: ["payments", "wallet"],
    channel: "#incident-payments",
    declaredAt: new Date("2026-08-01T10:00:00Z"),
  });
}

test("incident management records acknowledgement, status updates, actions, and closure", () => {
  const service = new IncidentManagementService();
  let incident = declareIncident(service);
  incident = service.acknowledge(
    incident.id,
    "commander-1",
    incident.version,
    new Date("2026-08-01T10:05:00Z"),
  );
  incident = service.update(
    incident.id,
    {
      id: "update-1",
      status: "investigating",
      message: "Payment provider is returning timeouts",
      authorId: "engineer-1",
      customerVisible: true,
      createdAt: "2026-08-01T10:10:00Z",
    },
    incident.version,
  );
  incident = service.addAction(
    incident.id,
    {
      id: "action-1",
      title: "Add secondary provider health alert",
      ownerId: "engineer-2",
      dueAt: "2026-08-10T00:00:00Z",
      createdAt: "2026-08-01T11:00:00Z",
    },
    incident.version,
  );
  incident = service.update(
    incident.id,
    {
      id: "update-2",
      status: "resolved",
      message: "Traffic moved to secondary provider",
      authorId: "engineer-1",
      customerVisible: true,
      createdAt: "2026-08-01T11:30:00Z",
    },
    incident.version,
  );
  assert.throws(
    () => service.close(incident.id, "commander-1", incident.version),
    /unfinished actions/,
  );
  incident = service.changeAction(
    incident.id,
    "action-1",
    "done",
    incident.version,
    new Date("2026-08-02T00:00:00Z"),
  );
  incident = service.close(
    incident.id,
    "commander-1",
    incident.version,
    new Date("2026-08-02T01:00:00Z"),
  );
  assert.equal(incident.status, "closed");
  assert.equal(service.customerTimeline(incident.id).length, 2);
  assert.equal(service.metrics().meanAcknowledgeMinutes, 5);
});

test("incident state transitions and stale versions are rejected", () => {
  const service = new IncidentManagementService();
  const incident = declareIncident(service);
  assert.throws(
    () =>
      service.update(
        incident.id,
        {
          id: "bad",
          status: "closed",
          message: "Skip workflow",
          authorId: "commander-1",
          customerVisible: false,
          createdAt: "2026-08-01T10:10:00Z",
        },
        incident.version,
      ),
    /cannot move/,
  );
  const acknowledged = service.acknowledge(
    incident.id,
    "commander-1",
    incident.version,
  );
  assert.throws(
    () =>
      service.changeSeverity(
        incident.id,
        "sev2",
        "Improved",
        "commander-1",
        incident.version,
      ),
    /version/,
  );
  assert.equal(acknowledged.acknowledgedAt !== undefined, true);
});

function subscribe(service, overrides = {}) {
  return service.subscribe(
    {
      id: "subscription-1",
      ownerId: "merchant-1",
      url: "https://example.com/hooks/casino",
      events: ["wallet.*", "player.updated"],
      secret: "super-secret-webhook-key-123",
      enabled: true,
      description: "Merchant event integration",
      ...overrides,
    },
    new Date("2026-08-01T00:00:00Z"),
  );
}

test("webhook events fan out by exact and wildcard subscriptions with signed bodies", () => {
  const service = new WebhookService();
  subscribe(service);
  service.subscribe({
    id: "subscription-2",
    ownerId: "merchant-2",
    url: "https://merchant.example/hooks",
    events: ["player.updated"],
    secret: "another-secret-webhook-key-456",
    enabled: true,
  });
  const deliveries = service.publish({
    id: "event-1",
    type: "wallet.credited",
    occurredAt: "2026-08-01T10:00:00Z",
    data: { playerId: "player-1", amount: 1000 },
  });
  assert.equal(deliveries.length, 1);
  assert.equal(
    service.verify(
      deliveries[0].body,
      deliveries[0].signature,
      "super-secret-webhook-key-123",
    ),
    true,
  );
  assert.equal(
    service.publish({
      id: "event-1",
      type: "wallet.credited",
      occurredAt: "2026-08-01T10:00:00Z",
      data: { playerId: "player-1", amount: 1000 },
    }).length,
    1,
  );
});

test("webhook delivery retries temporary failures and records success", () => {
  const service = new WebhookService();
  subscribe(service);
  const created = service.publish(
    {
      id: "event-1",
      type: "wallet.credited",
      occurredAt: "2026-08-01T10:00:00Z",
      data: { amount: 1000 },
    },
    new Date("2026-08-01T10:00:00Z"),
  )[0];
  let claimed = service.claim(
    "worker-1",
    1,
    new Date("2026-08-01T10:00:00Z"),
  )[0];
  assert.equal(claimed.delivery.attempts, 1);
  let result = service.complete(
    created.id,
    { status: 503, body: "Unavailable", retryAfterSeconds: 30 },
    claimed.delivery.version,
    new Date("2026-08-01T10:00:01Z"),
  );
  assert.equal(result.status, "retrying");
  assert.equal(
    service.claim("worker-2", 1, new Date("2026-08-01T10:00:20Z")).length,
    0,
  );
  claimed = service.claim("worker-2", 1, new Date("2026-08-01T10:00:31Z"))[0];
  result = service.complete(
    created.id,
    { status: 204 },
    claimed.delivery.version,
    new Date("2026-08-01T10:00:32Z"),
  );
  assert.equal(result.status, "delivered");
  assert.equal(service.subscriptions()[0].failureCount, 0);
});

test("webhooks reject insecure endpoints and disable gone subscriptions", () => {
  const service = new WebhookService();
  assert.throws(
    () => subscribe(service, { url: "http://example.com/hook" }),
    /HTTPS/,
  );
  subscribe(service);
  const delivery = service.publish({
    id: "event-1",
    type: "player.updated",
    occurredAt: "2026-08-01T10:00:00Z",
    data: {},
  })[0];
  const claimed = service.claim("worker-1")[0];
  const failed = service.complete(
    delivery.id,
    { status: 410 },
    claimed.delivery.version,
  );
  assert.equal(failed.status, "failed");
  assert.equal(service.subscriptions()[0].enabled, false);
});
