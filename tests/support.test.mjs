import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeBase } from "../lib/support/knowledge-base.ts";
import { SupportServiceLevels, WeeklyBusinessCalendar } from "../lib/support/service-levels.ts";
import { SupportConflictError, SupportTicketService } from "../lib/support/tickets.ts";

test("support tickets keep public and internal conversations", () => {
  const service = new SupportTicketService();
  let ticket = service.open("p", "payments", "Missing deposit", "My deposit is missing", { references: ["deposit-1"] });
  ticket = service.assign(ticket.id, ticket.version, "payments", "agent");
  ticket = service.addMessage(ticket.id, ticket.version, "agent", "agent", "Provider check started", { internal: true });
  assert.equal(ticket.status, "open");
  ticket = service.addMessage(ticket.id, ticket.version, "agent", "agent", "We are checking this now");
  assert.equal(ticket.status, "waiting_on_player");
  assert.ok(ticket.firstResponseAt);
  assert.equal(ticket.messages.length, 3);
});

test("tickets require assignment before resolution and can reopen", () => {
  const service = new SupportTicketService();
  let ticket = service.open("p", "game", "Frozen round", "The game froze");
  assert.throws(() => service.resolve(ticket.id, ticket.version, "done"), SupportConflictError);
  ticket = service.assign(ticket.id, ticket.version, "games");
  ticket = service.resolve(ticket.id, ticket.version, "Stake refunded");
  assert.equal(ticket.status, "resolved");
  ticket = service.reopen(ticket.id, ticket.version, "I cannot see the refund");
  assert.equal(ticket.status, "waiting_on_team");
  assert.equal(ticket.resolution, undefined);
});

test("ticket queues prioritize urgent oldest work", () => {
  const service = new SupportTicketService();
  service.open("normal", "x", "Normal", "Message", { priority: "normal", at: new Date("2026-01-01") });
  service.open("urgent", "x", "Urgent", "Message", { priority: "urgent", at: new Date("2026-01-02") });
  assert.deepEqual(service.list().map((ticket) => ticket.playerId), ["urgent", "normal"]);
});

test("business calendar carries targets across nights and weekends", () => {
  const calendar = new WeeklyBusinessCalendar(9, 17);
  const friday = new Date("2026-01-02T16:00:00Z");
  assert.equal(calendar.addBusinessMilliseconds(friday, 2 * 60 * 60 * 1_000).toISOString(), "2026-01-05T10:00:00.000Z");
});

test("service levels report response and resolution breaches independently", () => {
  const service = new SupportTicketService();
  const ticket = service.open("p", "x", "Subject", "Message", { priority: "high", at: new Date("2026-01-05T09:00:00Z") });
  const levels = new SupportServiceLevels();
  levels.configure({ priority: "high", firstResponseMs: 60 * 60 * 1_000, resolutionMs: 4 * 60 * 60 * 1_000, businessHoursOnly: true });
  const state = levels.evaluate(ticket, new Date("2026-01-05T11:00:00Z"));
  assert.equal(state.firstResponseBreached, true);
  assert.equal(state.resolutionBreached, false);
});

test("knowledge articles support locale fallback and ranked search", () => {
  const base = new KnowledgeBase();
  let deposit = base.create({
    slug: "missing-deposit",
    title: "Find a missing deposit",
    summary: "Steps to trace a delayed deposit",
    body: "Open the wallet and check the provider reference.",
    locale: "en",
    category: "payments",
    tags: ["deposit", "wallet"],
  });
  deposit = base.publish(deposit.id, deposit.version);
  let games = base.create({
    slug: "fair-games",
    title: "Verify a fair game",
    summary: "Use the fairness verifier",
    body: "Compare the server seed commitment after a round.",
    locale: "en",
    category: "games",
    tags: ["fairness"],
  });
  base.publish(games.id, games.version);
  assert.equal(base.find("missing-deposit", "en-IN").id, deposit.id);
  assert.equal(base.search("deposit wallet", "en")[0].id, deposit.id);
});

