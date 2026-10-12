import assert from "node:assert/strict";
import test from "node:test";

import { AdminAccessControl, AdminConflictError } from "../lib/admin/access.ts";
import { AdministrativeApprovals } from "../lib/admin/approvals.ts";

test("active memberships combine permissions from several roles", () => {
  const access = new AdminAccessControl();
  const support = access.createRole("Support", ["players.read", "support.respond"]);
  const payments = access.createRole("Payments", ["payments.read", "payments.refund"]);
  let membership = access.invite("operator", [support.id, payments.id], "owner");
  assert.deepEqual(access.permissionsFor("operator"), []);
  membership = access.activate(membership.id, membership.version);
  assert.deepEqual(access.permissionsFor("operator"), ["payments.read", "payments.refund", "players.read", "support.respond"]);
  access.authorize("operator", "payments.refund");
});

test("suspended and expired memberships lose authorization", () => {
  const access = new AdminAccessControl();
  const role = access.createRole("Fraud", ["fraud.investigate"]);
  let membership = access.invite("operator", [role.id], "owner", {
    at: new Date("2025-12-01"),
    expiresAt: new Date("2026-02-01"),
  });
  membership = access.activate(membership.id, membership.version, new Date("2026-01-01"));
  membership = access.suspend(membership.id, membership.version);
  assert.throws(() => access.authorize("operator", "fraud.investigate"), AdminConflictError);
  membership = access.restore(membership.id, membership.version);
  assert.deepEqual(access.permissionsFor("operator", new Date("2026-03-01")), []);
});

test("approval requester cannot approve their own action", () => {
  const approvals = new AdministrativeApprovals();
  approvals.configure({ action: "refund", requiredApprovals: 1, distinctTeams: false, expiresAfterMs: 60_000 });
  const request = approvals.request("refund", "payment", "p", "requester", "support", { amount: 100 });
  assert.throws(() => approvals.decide(request.id, request.version, "requester", "support", "approve"), AdminConflictError);
});

test("two-person approvals can require distinct teams", () => {
  const approvals = new AdministrativeApprovals();
  approvals.configure({ action: "large_refund", requiredApprovals: 2, distinctTeams: true, expiresAfterMs: 60_000 });
  let request = approvals.request("large_refund", "payment", "p", "requester", "support", { amount: 100_000 });
  request = approvals.decide(request.id, request.version, "one", "finance", "approve");
  assert.equal(request.status, "pending");
  request = approvals.decide(request.id, request.version, "two", "risk", "approve");
  assert.equal(request.status, "approved");
});

test("rejections close approvals immediately and free the resource", () => {
  const approvals = new AdministrativeApprovals();
  approvals.configure({ action: "bonus", requiredApprovals: 2, distinctTeams: false, expiresAfterMs: 60_000 });
  let request = approvals.request("bonus", "campaign", "c", "owner", "marketing", {});
  request = approvals.decide(request.id, request.version, "reviewer", "finance", "reject", "budget exceeded");
  assert.equal(request.status, "rejected");
  const replacement = approvals.request("bonus", "campaign", "c", "owner", "marketing", {});
  assert.notEqual(replacement.id, request.id);
});

test("expired approvals cannot be decided", () => {
  const approvals = new AdministrativeApprovals();
  approvals.configure({ action: "setting", requiredApprovals: 1, distinctTeams: false, expiresAfterMs: 1_000 });
  let request = approvals.request("setting", "configuration", "limits", "owner", "ops", {}, new Date("2026-01-01T00:00:00Z"));
  request = approvals.decide(request.id, request.version, "other", "risk", "approve", undefined, new Date("2026-01-01T00:00:02Z"));
  assert.equal(request.status, "expired");
});
