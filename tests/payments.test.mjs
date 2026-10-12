import assert from "node:assert/strict";
import test from "node:test";

import { DepositService } from "../lib/payments/deposits.ts";
import {
  AnonymousNetworkRule,
  CountryBlockRule,
  InMemoryRiskContext,
  LargeWithdrawalRule,
  PaymentRiskEngine,
  SharedPaymentMethodRule,
  VelocityRule,
} from "../lib/payments/risk.ts";
import { PaymentConflictError, PaymentValidationError } from "../lib/payments/types.ts";
import { HmacWebhookVerifier, WebhookInbox } from "../lib/payments/webhooks.ts";
import { InMemoryWithdrawalFunds, WithdrawalService } from "../lib/payments/withdrawals.ts";

class MutableClock {
  constructor(value) { this.value = new Date(value); }
  now() { return new Date(this.value); }
  advance(ms) { this.value = new Date(this.value.getTime() + ms); }
}

const baseDeposit = {
  id: "deposit-1",
  player: { playerId: "player-1", country: "IN" },
  amount: { currency: "USD", minor: 2_500n },
  provider: "stripe",
  externalId: "pi-1",
  idempotencyKey: "deposit-request-1",
  paymentMethodFingerprint: "card-one",
};

test("deposit retries return the original decision without duplicating activity", () => {
  const clock = new MutableClock("2026-01-01T00:00:00Z");
  const context = new InMemoryRiskContext();
  const service = new DepositService(new PaymentRiskEngine(), context, clock);
  const first = service.create(baseDeposit);
  clock.advance(1_000);
  const retry = service.create({ ...baseDeposit });
  assert.equal(first.replayed, false);
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.payment, first.payment);
  assert.equal(service.listForPlayer("player-1").length, 1);
  assert.equal(context.recentPayments("player-1", new Date(0)).length, 1);
});

test("a changed deposit cannot reuse an idempotency key", () => {
  const service = new DepositService(new PaymentRiskEngine(), new InMemoryRiskContext());
  service.create(baseDeposit);
  assert.throws(
    () => service.create({ ...baseDeposit, amount: { currency: "USD", minor: 2_501n } }),
    PaymentConflictError,
  );
});

test("deposit state transitions are validated and idempotent", () => {
  const service = new DepositService(new PaymentRiskEngine(), new InMemoryRiskContext());
  service.create(baseDeposit);
  assert.equal(service.authorize("deposit-1").status, "authorized");
  assert.equal(service.authorize("deposit-1").events.length, 2);
  assert.equal(service.settle("deposit-1").status, "settled");
  assert.equal(service.refund("deposit-1", "player dispute").status, "refunded");
  assert.throws(() => service.settle("deposit-1"), PaymentConflictError);
});

test("blocked countries deny deposits", () => {
  const context = new InMemoryRiskContext();
  context.blockCountry("XZ");
  const service = new DepositService(new PaymentRiskEngine(), context);
  const result = service.create({ ...baseDeposit, player: { playerId: "p", country: "XZ" } });
  assert.equal(result.risk.decision, "deny");
  assert.equal(result.payment.status, "failed");
  assert.equal(result.risk.score, 100);
});

test("shared payment methods route deposits to review", () => {
  const context = new InMemoryRiskContext();
  context.record({
    player: { playerId: "other" },
    amount: { currency: "USD", minor: 100n },
    direction: "deposit",
    paymentMethodFingerprint: "shared-card",
    occurredAt: new Date(),
  });
  const service = new DepositService(new PaymentRiskEngine(), context);
  const result = service.create({ ...baseDeposit, paymentMethodFingerprint: "shared-card" });
  assert.equal(result.risk.decision, "review");
  assert.equal(result.payment.status, "requires_review");
});

test("payment velocity is assessed in a bounded time window", () => {
  const context = new InMemoryRiskContext();
  const now = new Date("2026-01-01T00:10:00Z");
  for (let index = 0; index < 4; index += 1) {
    context.record({
      player: { playerId: "fast-player" },
      amount: { currency: "USD", minor: 100n },
      direction: "deposit",
      occurredAt: new Date(now.getTime() - index * 1_000),
    });
  }
  const engine = new PaymentRiskEngine();
  const result = engine.assess({
    player: { playerId: "fast-player" },
    amount: { currency: "USD", minor: 100n },
    direction: "deposit",
    occurredAt: now,
  }, context);
  assert.equal(result.decision, "review");
  assert.equal(result.signals[0].code, "payment_velocity");
});

test("custom risk rules compose into one capped score", () => {
  const policy = {
    reviewScore: 30,
    denyScore: 70,
    velocityWindowMs: 60_000,
    velocityCount: 1,
    largeAmountMinor: 500n,
  };
  const rules = [
    new CountryBlockRule(),
    new SharedPaymentMethodRule(),
    new VelocityRule(policy),
    new LargeWithdrawalRule(policy),
    new AnonymousNetworkRule(["10."]),
  ];
  const context = new InMemoryRiskContext();
  const engine = new PaymentRiskEngine(policy, rules);
  const result = engine.assess({
    player: { playerId: "p" },
    amount: { currency: "USD", minor: 900n },
    direction: "withdrawal",
    ipAddress: "10.1.2.3",
    occurredAt: new Date(),
  }, context);
  assert.equal(result.decision, "deny");
  assert.equal(result.score, 75);
});

test("withdrawals reserve funds and consume them only on settlement", () => {
  const funds = new InMemoryWithdrawalFunds();
  funds.setBalance("player-1", "USD", 10_000n);
  const service = new WithdrawalService(funds, new PaymentRiskEngine(), new InMemoryRiskContext());
  const result = service.create({
    id: "withdrawal-1",
    player: { playerId: "player-1" },
    amount: { currency: "USD", minor: 2_000n },
    provider: "bank",
    destination: "bank-account-1",
    idempotencyKey: "withdrawal-request-1",
  });
  assert.equal(result.payment.status, "pending");
  assert.equal(funds.available("player-1", "USD"), 8_000n);
  service.approve("withdrawal-1");
  service.settle("withdrawal-1");
  assert.equal(funds.available("player-1", "USD"), 8_000n);
});

test("cancelled withdrawals release held funds", () => {
  const funds = new InMemoryWithdrawalFunds();
  funds.setBalance("p", "CHIP", 500n);
  const service = new WithdrawalService(funds, new PaymentRiskEngine(), new InMemoryRiskContext());
  service.create({
    id: "w",
    player: { playerId: "p" },
    amount: { currency: "CHIP", minor: 300n },
    provider: "telegram",
    destination: "wallet",
    idempotencyKey: "key",
  });
  assert.equal(funds.available("p", "CHIP"), 200n);
  service.cancel("w");
  assert.equal(funds.available("p", "CHIP"), 500n);
});

test("withdrawals reject insufficient funds atomically", () => {
  const funds = new InMemoryWithdrawalFunds();
  funds.setBalance("p", "USD", 100n);
  const service = new WithdrawalService(funds, new PaymentRiskEngine(), new InMemoryRiskContext());
  assert.throws(() => service.create({
    player: { playerId: "p" },
    amount: { currency: "USD", minor: 200n },
    provider: "bank",
    destination: "bank",
    idempotencyKey: "key",
  }), PaymentConflictError);
  assert.equal(funds.available("p", "USD"), 100n);
});

test("webhooks verify signatures and process duplicate deliveries once", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const verifier = new HmacWebhookVerifier("secret", 60_000, () => now);
  let calls = 0;
  const inbox = new WebhookInbox(verifier, { handle: async () => { calls += 1; } }, () => now);
  const body = JSON.stringify({
    provider: "stripe",
    eventId: "evt-1",
    eventType: "deposit.settled",
    paymentId: "deposit-1",
    occurredAt: now.toISOString(),
    payload: { status: "settled" },
  });
  const timestamp = String(now.getTime());
  const headers = { signature: verifier.sign(body, timestamp), timestamp };
  const [first, retry] = await Promise.all([inbox.receive(body, headers), inbox.receive(body, headers)]);
  assert.equal(first.outcome, "processed");
  assert.deepEqual(retry, first);
  assert.equal(calls, 1);
});

test("webhooks reject stale or tampered deliveries", async () => {
  const now = new Date("2026-01-01T00:10:00Z");
  const verifier = new HmacWebhookVerifier("secret", 1_000, () => now);
  const inbox = new WebhookInbox(verifier, { handle() {} }, () => now);
  await assert.rejects(
    inbox.receive("{}", { signature: "deadbeef", timestamp: String(now.getTime() - 2_000) }),
    PaymentValidationError,
  );
});

test("payment validation rejects zero amounts and malformed risk policy", () => {
  const service = new DepositService(new PaymentRiskEngine(), new InMemoryRiskContext());
  assert.throws(() => service.create({
    ...baseDeposit,
    amount: { currency: "USD", minor: 0n },
  }), PaymentValidationError);
  assert.throws(() => new PaymentRiskEngine({ reviewScore: 90, denyScore: 80 }), PaymentValidationError);
});

