import assert from "node:assert/strict";
import test from "node:test";

import { ConsentLedger } from "../lib/identity/consent.ts";
import { IdentityConflictError, IdentityValidationError, PlayerProfileStore } from "../lib/identity/profiles.ts";
import { PlayerSessionStore } from "../lib/identity/sessions.ts";
import { PrivacyRequestService, buildPortableData } from "../lib/privacy/requests.ts";

function verifiedProfile(store) {
  let profile = store.create({
    id: "player-1",
    telegramId: "telegram-1",
    displayName: "Ada",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  profile = store.update(profile.id, profile.version, {
    legalName: "Ada Lovelace",
    dateOfBirth: "1990-01-01",
    email: "ADA@example.com",
    phone: "+441234567890",
    address: { line1: "1 Main Street", city: "London", postalCode: "SW1", country: "gb" },
    locale: "en-GB",
    timeZone: "Europe/London",
  });
  profile = store.beginVerification(profile.id, profile.version);
  return store.acceptVerification(profile.id, profile.version);
}

test("player profiles enforce unique Telegram identities and optimistic versions", () => {
  const store = new PlayerProfileStore();
  const profile = store.create({ telegramId: "100", displayName: "Player" });
  assert.throws(() => store.create({ telegramId: "100", displayName: "Other" }), IdentityConflictError);
  assert.throws(() => store.update(profile.id, 99, { displayName: "Changed" }), IdentityConflictError);
  assert.equal(store.findByTelegramId("100").id, profile.id);
});

test("verification requires identity details and follows an explicit review", () => {
  const store = new PlayerProfileStore();
  const profile = store.create({ id: "p", telegramId: "t", displayName: "P" });
  assert.throws(() => store.beginVerification(profile.id, profile.version), IdentityValidationError);
  const verified = verifiedProfile(new PlayerProfileStore());
  assert.equal(verified.verificationStatus, "verified");
  assert.equal(verified.address.country, "GB");
  assert.equal(verified.email, "ada@example.com");
});

test("changing verified legal identity sends a player back to review", () => {
  const store = new PlayerProfileStore();
  const verified = verifiedProfile(store);
  const changed = store.update(verified.id, verified.version, { legalName: "Ada Byron" });
  assert.equal(changed.verificationStatus, "pending");
  assert.match(changed.verificationReason, /changed/);
});

test("consent history supersedes previous decisions without rewriting history", () => {
  const ledger = new ConsentLedger();
  const first = ledger.record({
    playerId: "p",
    purpose: "marketing",
    granted: true,
    policyVersion: "1",
    source: "telegram",
    recordedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const second = ledger.record({
    playerId: "p",
    purpose: "marketing",
    granted: false,
    policyVersion: "1",
    source: "web",
    recordedAt: new Date("2026-01-02T00:00:00Z"),
  });
  assert.equal(second.supersedes, first.id);
  assert.equal(ledger.history("p").length, 2);
  assert.equal(ledger.hasCurrentConsent("p", "marketing"), false);
});

test("required gameplay consent checks policy versions", () => {
  const ledger = new ConsentLedger();
  for (const purpose of ["terms", "privacy", "age_confirmation"]) {
    ledger.record({ playerId: "p", purpose, granted: true, policyVersion: "2026-01", source: "telegram" });
  }
  ledger.requireGameplayConsent("p", { terms: "2026-01", privacy: "2026-01" });
  assert.throws(() => ledger.requireGameplayConsent("p", { terms: "2027-01" }), IdentityValidationError);
});

test("session tokens are verified, rotated, and individually revocable", () => {
  const sessions = new PlayerSessionStore();
  const created = sessions.create("p", "device", "127.0.0.1", "browser", {
    at: new Date("2026-01-01T00:00:00Z"),
    lifetimeMs: 10_000,
  });
  const authenticated = sessions.authenticate(created.session.id, created.token, new Date("2026-01-01T00:00:01Z"));
  assert.equal(authenticated.lastSeenAt.toISOString(), "2026-01-01T00:00:01.000Z");
  const rotated = sessions.rotate(created.session.id, created.token, new Date("2026-01-01T00:00:02Z"));
  assert.throws(() => sessions.authenticate(created.session.id, created.token, new Date("2026-01-01T00:00:03Z")), IdentityValidationError);
  sessions.revoke(created.session.id, "player signed out");
  assert.throws(() => sessions.authenticate(created.session.id, rotated.token), IdentityConflictError);
});

test("revoke-all can preserve the current session", () => {
  const sessions = new PlayerSessionStore();
  const first = sessions.create("p", "one", "1", "one");
  const second = sessions.create("p", "two", "2", "two");
  const third = sessions.create("p", "three", "3", "three");
  assert.equal(sessions.revokeAll("p", "security reset", second.session.id), 2);
  assert.deepEqual(sessions.activeForPlayer("p").map((session) => session.id), [second.session.id]);
  assert.notEqual(first.session.id, third.session.id);
});

test("privacy requests use optimistic transitions and response deadlines", () => {
  const service = new PrivacyRequestService();
  let request = service.submit("p", "access", new Date("2026-01-01T00:00:00Z"), 30);
  assert.equal(request.status, "identity_pending");
  assert.equal(request.dueAt.toISOString(), "2026-01-31T00:00:00.000Z");
  request = service.verifyIdentity(request.id, request.version);
  request = service.complete(request.id, request.version);
  assert.equal(request.status, "completed");
  assert.throws(() => service.complete(request.id, request.version), IdentityConflictError);
});

test("active retention holds block erasure until released", () => {
  const service = new PrivacyRequestService();
  let request = service.submit("p", "erasure");
  request = service.verifyIdentity(request.id, request.version);
  const hold = service.addHold("p", "open chargeback", ["payments", "ledger"]);
  assert.throws(() => service.complete(request.id, request.version), IdentityConflictError);
  service.releaseHold(hold.id);
  assert.equal(service.complete(request.id, request.version).status, "completed");
});

test("portable exports contain independently verifiable checksums", () => {
  const store = new PlayerProfileStore();
  const profile = store.create({ id: "p", telegramId: "t", displayName: "Player" });
  const ledger = new ConsentLedger();
  ledger.record({ playerId: "p", purpose: "marketing", granted: true, policyVersion: "1", source: "web" });
  const data = buildPortableData(profile, ledger.history("p"), { games: [{ id: "g" }] }, new Date("2026-01-01T00:00:00Z"));
  assert.equal(data.checksum.length, 64);
  assert.equal(data.profile.id, "p");
  assert.equal(data.activity.games.length, 1);
});

test("overdue privacy requests are returned in deadline order", () => {
  const service = new PrivacyRequestService();
  service.submit("first", "access", new Date("2026-01-01T00:00:00Z"), 5);
  service.submit("second", "portability", new Date("2026-01-01T00:00:00Z"), 2);
  assert.deepEqual(
    service.overdue(new Date("2026-02-01T00:00:00Z")).map((request) => request.playerId),
    ["second", "first"],
  );
});

