import assert from "node:assert/strict";
import test from "node:test";

import { add, compare, formatMoney, money, multiply, parseMoney, subtract } from "../lib/wallet/money.ts";
import { WalletLedger } from "../lib/wallet/ledger.ts";
import { WagerService } from "../lib/wallet/wagers.ts";
import { VaultService } from "../lib/wallet/vaults.ts";

const NOW = new Date("2026-06-01T10:00:00.000Z");

function ledgerWithAccounts() {
  const ledger = new WalletLedger();
  const accounts = [
    { id: "player", ownerId: "p1", asset: "CHIP", kind: "player", allowNegative: false, status: "active" },
    { id: "house", ownerId: "casino", asset: "CHIP", kind: "house", allowNegative: true, status: "active" },
    { id: "escrow", ownerId: "casino", asset: "CHIP", kind: "escrow", allowNegative: false, status: "active" },
    { id: "vault", ownerId: "p1", asset: "CHIP", kind: "reserve", allowNegative: false, status: "active" },
    { id: "penalties", ownerId: "casino", asset: "CHIP", kind: "house", allowNegative: false, status: "active" },
  ];
  for (const account of accounts) ledger.openAccount({ ...account, createdAt: NOW });
  ledger.transfer({
    id: "opening", reference: "opening-player", fromAccount: "house", toAccount: "player",
    units: 1000n, kind: "opening_balance", occurredAt: NOW,
  });
  return ledger;
}

test("money arithmetic preserves asset and integer units", () => {
  const ten = money("chip", 10);
  const four = parseMoney({ asset: "CHIP", units: "4" });
  assert.deepEqual(add(ten, four), { asset: "CHIP", units: 14n });
  assert.deepEqual(subtract(ten, four), { asset: "CHIP", units: 6n });
  assert.deepEqual(multiply(ten, 3n, 2n), { asset: "CHIP", units: 15n });
  assert.equal(compare(ten, four), 1);
  assert.equal(formatMoney(ten), "10 CHIP");
  assert.throws(() => add(ten, money("STAR", 1)), /assets must match/);
});

test("double-entry ledger posts balanced transfers and preserves a hash chain", () => {
  const ledger = ledgerWithAccounts();
  const entry = ledger.transfer({
    id: "gift", reference: "gift-1", fromAccount: "player", toAccount: "house",
    units: 125n, kind: "chip_gift", occurredAt: new Date(NOW.getTime() + 1000),
  });
  assert.equal(ledger.balance("player"), 875n);
  assert.equal(ledger.balance("house"), -875n);
  assert.equal(entry.hash.length, 64);
  assert.equal(ledger.verifyChain(), true);
  assert.deepEqual(ledger.snapshot("player"), {
    accountId: "player", asset: "CHIP", balance: 875n, available: 875n,
    entryCount: 2, lastEntryId: "gift",
  });
});

test("ledger rejects unbalanced, duplicate-account, and overdrawing entries atomically", () => {
  const ledger = ledgerWithAccounts();
  assert.throws(() => ledger.post({
    id: "bad", reference: "bad", kind: "bad", occurredAt: NOW,
    postings: [
      { accountId: "player", direction: "debit", units: 10n },
      { accountId: "house", direction: "credit", units: 9n },
    ],
  }), /do not balance/);
  assert.throws(() => ledger.post({
    id: "duplicate", reference: "duplicate", kind: "bad", occurredAt: NOW,
    postings: [
      { accountId: "player", direction: "debit", units: 10n },
      { accountId: "player", direction: "credit", units: 10n },
    ],
  }), /once/);
  assert.throws(() => ledger.transfer({
    id: "overdraw", reference: "overdraw", fromAccount: "player", toAccount: "house",
    units: 1001n, kind: "bad", occurredAt: NOW,
  }), /overdraw/);
  assert.equal(ledger.balance("player"), 1000n);
});

test("entry references are idempotent but cannot hide changed data", () => {
  const ledger = ledgerWithAccounts();
  const input = {
    id: "gift", reference: "gift", fromAccount: "player", toAccount: "house",
    units: 10n, kind: "gift", occurredAt: NOW,
  };
  const first = ledger.transfer(input);
  assert.equal(ledger.transfer(input), first);
  assert.throws(() => ledger.transfer({ ...input, units: 11n }), /different data/);
  assert.equal(ledger.balance("player"), 990n);
});

test("wagers reserve the maximum exposure then settle unused escrow", () => {
  const ledger = ledgerWithAccounts();
  const wagers = new WagerService(ledger);
  const accounts = { player: "player", escrow: "escrow", house: "house" };
  const wager = wagers.reserve({
    wagerId: "w1", playerId: "p1", game: "dice", roundId: "r1",
    stake: 100n, potentialPayout: 500n, accounts, at: NOW,
  });
  assert.equal(wager.state, "reserved");
  assert.equal(ledger.balance("player"), 900n);
  assert.equal(ledger.balance("escrow"), 500n);
  const settled = wagers.settle({ wagerId: "w1", payout: 300n, result: "win", accounts, at: new Date(NOW.getTime() + 1000) });
  assert.equal(settled.payout, 300n);
  assert.equal(ledger.balance("player"), 1200n);
  assert.equal(ledger.balance("escrow"), 0n);
  assert.equal(wagers.settle({ wagerId: "w1", payout: 300n, result: "win", accounts, at: NOW }), settled);
});

test("voiding a wager returns the stake and house reserve", () => {
  const ledger = ledgerWithAccounts();
  const wagers = new WagerService(ledger);
  const accounts = { player: "player", escrow: "escrow", house: "house" };
  wagers.reserve({
    wagerId: "w1", playerId: "p1", game: "wheel", roundId: "r1",
    stake: 50n, potentialPayout: 250n, accounts, at: NOW,
  });
  const voided = wagers.void({ wagerId: "w1", accounts, at: NOW, reason: "round cancelled" });
  assert.equal(voided.state, "voided");
  assert.equal(ledger.balance("player"), 1000n);
  assert.equal(ledger.balance("escrow"), 0n);
});

test("chip vault enforces lock penalties and daily withdrawal limits", () => {
  const ledger = ledgerWithAccounts();
  const vaults = new VaultService(ledger);
  const vault = vaults.open({
    vaultId: "v1", playerId: "p1", sourceAccount: "player", vaultAccount: "vault",
    policy: { minimumDeposit: 100n, lockDays: 30, earlyWithdrawalPenaltyBps: 500, dailyWithdrawalLimit: 200n },
    deposit: 500n, at: NOW,
  });
  assert.equal(vault.deposited, 500n);
  const withdrawal = vaults.withdraw("v1", 100n, new Date(NOW.getTime() + 86400000), "penalties");
  assert.deepEqual({ gross: withdrawal.gross, penalty: withdrawal.penalty, net: withdrawal.net, early: withdrawal.early }, {
    gross: 100n, penalty: 5n, net: 95n, early: true,
  });
  assert.equal(ledger.balance("player"), 595n);
  assert.equal(ledger.balance("penalties"), 5n);
  assert.throws(() => vaults.withdraw("v1", 101n, new Date(NOW.getTime() + 86400000), "penalties"), /daily/);
});
