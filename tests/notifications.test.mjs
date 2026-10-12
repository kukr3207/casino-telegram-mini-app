import assert from "node:assert/strict";
import test from "node:test";

import { NotificationDeliveryQueue } from "../lib/notifications/delivery.ts";
import { NotificationInbox } from "../lib/notifications/inbox.ts";
import { NotificationPreferenceStore } from "../lib/notifications/preferences.ts";
import { NotificationTemplateRegistry } from "../lib/notifications/templates.ts";
import { NotificationValidationError } from "../lib/notifications/types.ts";

function request(overrides = {}) {
  return {
    id: "notification-1",
    playerId: "player-1",
    category: "transactional",
    priority: "normal",
    channels: ["inbox", "telegram"],
    content: { text: "Your withdrawal was approved" },
    createdAt: new Date("2026-01-01T12:00:00Z"),
    ...overrides,
  };
}

test("notification templates render declared variables and locale fallback", () => {
  const registry = new NotificationTemplateRegistry();
  registry.register({
    id: "withdrawal-approved",
    category: "transactional",
    locale: "en",
    subject: "Withdrawal {{reference}} approved",
    text: "We approved {{amount}} for {{player}}.",
    requiredVariables: ["reference", "amount", "player"],
    version: 1,
  });
  const content = registry.render("withdrawal-approved", "en-IN", {
    reference: "W-1",
    amount: "$20.00",
    player: "Ada",
  });
  assert.equal(content.subject, "Withdrawal W-1 approved");
  assert.equal(content.text, "We approved $20.00 for Ada.");
});

test("templates reject missing variables and stale versions", () => {
  const registry = new NotificationTemplateRegistry();
  const template = {
    id: "security",
    category: "security",
    locale: "en",
    text: "New login from {{device}}",
    requiredVariables: ["device"],
    version: 2,
  };
  registry.register(template);
  assert.throws(() => registry.render("security", "en", {}), NotificationValidationError);
  assert.throws(() => registry.register({ ...template, version: 2 }), NotificationValidationError);
});

test("quiet hours keep normal messages in the inbox only", () => {
  const preferences = new NotificationPreferenceStore();
  preferences.save({
    playerId: "player-1",
    locale: "en",
    updatedAt: new Date(),
    quietHours: { startHour: 22, endHour: 7, timeZoneOffsetMinutes: 0 },
    categories: [{
      category: "transactional",
      enabled: true,
      channels: ["inbox", "telegram", "email"],
      minimumPriority: "low",
    }],
  });
  assert.deepEqual(
    preferences.allowedChannels("player-1", "transactional", "normal", ["telegram", "inbox"], new Date("2026-01-01T23:00:00Z")),
    ["inbox"],
  );
  assert.deepEqual(
    preferences.allowedChannels("player-1", "transactional", "urgent", ["telegram", "inbox"], new Date("2026-01-01T23:00:00Z")),
    ["telegram", "inbox"],
  );
});

test("mandatory safety messages cannot be opted out", () => {
  const preferences = new NotificationPreferenceStore();
  preferences.save({
    playerId: "player-1",
    locale: "en",
    updatedAt: new Date(),
    categories: [{ category: "security", enabled: false, channels: [], minimumPriority: "urgent" }],
  });
  assert.deepEqual(
    preferences.allowedChannels("player-1", "security", "normal", ["telegram"], new Date()),
    ["telegram"],
  );
});

test("inbox deduplicates notifications and maintains unread counts", () => {
  const inbox = new NotificationInbox();
  const first = inbox.add(request({ deduplicationKey: "withdrawal-1" }));
  const retry = inbox.add(request({ id: "retry", deduplicationKey: "withdrawal-1" }));
  assert.equal(retry.id, first.id);
  assert.equal(inbox.list("player-1").unreadCount, 1);
  inbox.markRead("player-1", [first.id]);
  assert.equal(inbox.list("player-1").unreadCount, 0);
});

test("inbox pagination is stable and cursor-bound to the player", () => {
  const inbox = new NotificationInbox();
  for (let index = 0; index < 5; index += 1) {
    inbox.add(request({
      id: `notification-${index}`,
      createdAt: new Date(`2026-01-01T12:00:0${index}Z`),
    }));
  }
  const first = inbox.list("player-1", { limit: 2 });
  const second = inbox.list("player-1", { limit: 2, cursor: first.nextCursor });
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 4);
  assert.throws(() => inbox.list("other", { cursor: first.nextCursor }), NotificationValidationError);
});

test("inbox bulk updates validate ownership before changing anything", () => {
  const inbox = new NotificationInbox();
  const item = inbox.add(request());
  assert.throws(() => inbox.markRead("other", [item.id]), NotificationValidationError);
  assert.equal(inbox.get("player-1", item.id).readAt, undefined);
});

test("delivery queue retries failures with exponential delay", async () => {
  const preferences = new NotificationPreferenceStore();
  let attempts = 0;
  const queue = new NotificationDeliveryQueue(preferences, [{
    channel: "telegram",
    async send() {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary outage");
      return { providerMessageId: "message-1" };
    },
  }], { maxAttempts: 4, baseDelayMs: 1_000, maximumDelayMs: 10_000 });
  const start = new Date("2026-01-01T00:00:00Z");
  const [delivery] = queue.enqueue(request({ channels: ["telegram"], createdAt: start }), start);
  let result = (await queue.drain(start))[0];
  assert.equal(result.status, "queued");
  assert.equal(result.nextAttemptAt.toISOString(), "2026-01-01T00:00:01.000Z");
  result = (await queue.drain(new Date("2026-01-01T00:00:01Z")))[0];
  assert.equal(result.nextAttemptAt.toISOString(), "2026-01-01T00:00:03.000Z");
  result = (await queue.drain(new Date("2026-01-01T00:00:03Z")))[0];
  assert.equal(result.status, "delivered");
  assert.equal(queue.get(delivery.id).attempts.length, 3);
});

test("delivery queue dead-letters exhausted notifications and supports replay", async () => {
  const preferences = new NotificationPreferenceStore();
  const queue = new NotificationDeliveryQueue(preferences, [{
    channel: "email",
    async send() { throw new Error("mailbox rejected"); },
  }], { maxAttempts: 2, baseDelayMs: 1, maximumDelayMs: 1 });
  const start = new Date("2026-01-01T00:00:00Z");
  const [delivery] = queue.enqueue(request({ channels: ["email"], createdAt: start }), start);
  await queue.drain(start);
  await queue.drain(new Date(start.getTime() + 1));
  assert.equal(queue.listDeadLetters().length, 1);
  assert.equal(queue.replay(delivery.id, new Date(start.getTime() + 2)).status, "queued");
});

test("suppressed deliveries never call providers", async () => {
  const preferences = new NotificationPreferenceStore();
  preferences.save({
    playerId: "player-1",
    locale: "en",
    updatedAt: new Date(),
    categories: [{ category: "marketing", enabled: false, channels: [], minimumPriority: "low" }],
  });
  let calls = 0;
  const queue = new NotificationDeliveryQueue(preferences, [{
    channel: "telegram",
    async send() { calls += 1; return { providerMessageId: "x" }; },
  }]);
  const [delivery] = queue.enqueue(request({ category: "marketing", channels: ["telegram"] }));
  assert.equal(delivery.status, "suppressed");
  assert.equal((await queue.drain()).length, 0);
  assert.equal(calls, 0);
});

