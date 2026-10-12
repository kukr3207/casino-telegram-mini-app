import assert from "node:assert/strict";
import test from "node:test";

import { ChartOfAccounts } from "../lib/accounting/chart.ts";
import {
  AccountingPeriods,
  FxRateBook,
  GeneralLedger,
} from "../lib/accounting/journal.ts";
import { AccountingReconciliationService } from "../lib/accounting/reconciliation.ts";
import { FinancialReports } from "../lib/accounting/reports.ts";
import { RevenueRecognitionService } from "../lib/accounting/revenue.ts";

function setup() {
  const chart = new ChartOfAccounts();
  const cash = chart.create({
    id: "cash",
    code: "1000",
    name: "Cash",
    type: "asset",
    currency: "USD",
    tags: ["liquid"],
    active: true,
  });
  const deferred = chart.create({
    id: "deferred",
    code: "2000",
    name: "Deferred revenue",
    type: "liability",
    currency: "USD",
    tags: ["player"],
    active: true,
  });
  const equity = chart.create({
    id: "equity",
    code: "3000",
    name: "Share capital",
    type: "equity",
    currency: "USD",
    tags: [],
    active: true,
  });
  const revenue = chart.create({
    id: "revenue",
    code: "4000",
    name: "Gaming revenue",
    type: "revenue",
    currency: "USD",
    tags: ["gaming"],
    active: true,
  });
  const expense = chart.create({
    id: "expense",
    code: "5000",
    name: "Payment fees",
    type: "expense",
    currency: "USD",
    tags: ["payments"],
    active: true,
  });
  const rates = new FxRateBook();
  const periods = new AccountingPeriods();
  periods.add({
    id: "2026-01",
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-02-01T00:00:00Z",
    status: "open",
    version: 1,
  });
  const ledger = new GeneralLedger(chart, rates, periods, "USD");
  return {
    chart,
    cash,
    deferred,
    equity,
    revenue,
    expense,
    rates,
    periods,
    ledger,
  };
}

test("chart of accounts enforces unique codes and parent types", () => {
  const { chart, cash } = setup();
  const bank = chart.create({
    id: "bank",
    code: "1010",
    name: "Bank",
    type: "asset",
    currency: "USD",
    parentId: cash.id,
    tags: ["liquid"],
    active: true,
  });
  assert.equal(chart.descendants(cash.id)[0].id, bank.id);
  assert.throws(() =>
    chart.create({
      id: "duplicate",
      code: "1010",
      name: "Other",
      type: "asset",
      tags: [],
      active: true,
    }),
  );
  assert.throws(() =>
    chart.create({
      id: "bad-child",
      code: "4010",
      name: "Bad",
      type: "revenue",
      parentId: cash.id,
      tags: [],
      active: true,
    }),
  );
});

test("FX rate book converts direct and inverse pairs", () => {
  const { rates } = setup();
  rates.add({
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    numerator: 11n,
    denominator: 10n,
    observedAt: "2026-01-01T00:00:00Z",
    source: "daily-close",
  });
  assert.equal(
    rates.convert(1_000n, "EUR", "USD", new Date("2026-01-10T00:00:00Z")),
    1_100n,
  );
  assert.equal(
    rates.convert(1_100n, "USD", "EUR", new Date("2026-01-10T00:00:00Z")),
    1_000n,
  );
});

test("general ledger rejects an unbalanced journal", () => {
  const { ledger, cash, revenue } = setup();
  assert.throws(() =>
    ledger.draft({
      reference: "unbalanced",
      source: "test",
      description: "Bad entry",
      effectiveAt: "2026-01-10T00:00:00Z",
      lines: [
        {
          accountId: cash.id,
          side: "debit",
          amountMinor: 100n,
          currency: "USD",
          baseAmountMinor: 0n,
          dimensions: {},
        },
        {
          accountId: revenue.id,
          side: "credit",
          amountMinor: 90n,
          currency: "USD",
          baseAmountMinor: 0n,
          dimensions: {},
        },
      ],
      metadata: {},
    }),
  );
});

test("posted journals create balanced immutable postings", () => {
  const { ledger, cash, revenue } = setup();
  const draft = ledger.draft({
    reference: "round:1",
    source: "gaming",
    description: "Recognize game revenue",
    effectiveAt: "2026-01-10T00:00:00Z",
    lines: [
      {
        accountId: cash.id,
        side: "debit",
        amountMinor: 500n,
        currency: "USD",
        baseAmountMinor: 0n,
        dimensions: { game: "slots" },
      },
      {
        accountId: revenue.id,
        side: "credit",
        amountMinor: 500n,
        currency: "USD",
        baseAmountMinor: 0n,
        dimensions: { game: "slots" },
      },
    ],
    metadata: { roundId: "1" },
  });
  const posted = ledger.post(
    draft.id,
    draft.version,
    new Date("2026-01-10T00:00:01Z"),
  );
  assert.equal(posted.status, "posted");
  assert.equal(ledger.postings().length, 2);
  const trial = ledger.trialBalance(
    new Date("2026-01-01"),
    new Date("2026-02-01"),
  );
  assert.equal(
    trial.reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0n),
    0n,
  );
});

test("journal references are idempotent but detect changed values", () => {
  const { ledger, cash, revenue } = setup();
  const input = {
    reference: "same",
    source: "gaming",
    description: "Same event",
    effectiveAt: "2026-01-10T00:00:00Z",
    lines: [
      {
        accountId: cash.id,
        side: "debit",
        amountMinor: 100n,
        currency: "USD",
        baseAmountMinor: 0n,
        dimensions: {},
      },
      {
        accountId: revenue.id,
        side: "credit",
        amountMinor: 100n,
        currency: "USD",
        baseAmountMinor: 0n,
        dimensions: {},
      },
    ],
    metadata: {},
  };
  const first = ledger.draft(input);
  const retry = ledger.draft(input);
  assert.equal(retry.id, first.id);
  assert.throws(() =>
    ledger.draft({
      ...input,
      lines: input.lines.map((line) => ({ ...line, amountMinor: 200n })),
    }),
  );
});

test("closed accounting periods reject later posting", () => {
  const { ledger, periods, cash, revenue } = setup();
  periods.close("2026-01", 1, "controller", true, new Date("2026-02-02"));
  const draft = ledger.draft({
    reference: "late",
    source: "test",
    description: "Late journal",
    effectiveAt: "2026-01-10T00:00:00Z",
    lines: [
      {
        accountId: cash.id,
        side: "debit",
        amountMinor: 100n,
        currency: "USD",
        baseAmountMinor: 0n,
        dimensions: {},
      },
      {
        accountId: revenue.id,
        side: "credit",
        amountMinor: 100n,
        currency: "USD",
        baseAmountMinor: 0n,
        dimensions: {},
      },
    ],
    metadata: {},
  });
  assert.throws(() => ledger.post(draft.id, draft.version));
});

test("usage revenue recognizes fulfilled performance units", () => {
  const { ledger, cash, deferred, revenue } = setup();
  const service = new RevenueRecognitionService(ledger, {
    cashAccountId: cash.id,
    deferredRevenueAccountId: deferred.id,
    revenueAccountId: revenue.id,
  });
  const contract = service.create(
    {
      id: "subscription",
      playerId: "player",
      kind: "subscription",
      currency: "USD",
      considerationMinor: 12_000n,
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: "2026-02-01T00:00:00Z",
      recognition: "usage",
      performanceUnits: 12,
      fulfilledUnits: 0,
      recognizedMinor: 0n,
      deferredMinor: 12_000n,
      status: "active",
      version: 1,
    },
    new Date("2026-01-01T00:00:00Z"),
  );
  const recognized = service.recognize(
    contract.id,
    "2026-01-10",
    3,
    new Date("2026-01-10T00:00:00Z"),
  );
  assert.equal(recognized.amountMinor, 3_000n);
  assert.equal(service.contract(contract.id).deferredMinor, 9_000n);
});

test("reconciliation matches provider transactions to journal references", () => {
  const { ledger, cash, revenue } = setup();
  const draft = ledger.draft({
    reference: "provider:deposit-1",
    source: "payments",
    description: "Provider deposit",
    effectiveAt: "2026-01-10T00:00:00Z",
    lines: [
      {
        accountId: cash.id,
        side: "debit",
        amountMinor: 1_000n,
        currency: "USD",
        baseAmountMinor: 0n,
        dimensions: {},
      },
      {
        accountId: revenue.id,
        side: "credit",
        amountMinor: 1_000n,
        currency: "USD",
        baseAmountMinor: 0n,
        dimensions: {},
      },
    ],
    metadata: {},
  });
  ledger.post(draft.id, draft.version);
  const reconciliation = new AccountingReconciliationService(ledger);
  reconciliation.registerSource({
    id: "provider",
    name: "Provider",
    currency: "USD",
    expectedAccountId: cash.id,
    toleranceMinor: 1n,
  });
  reconciliation.ingest({
    id: "external-1",
    sourceId: "provider",
    reference: "deposit-1",
    amountMinor: 1_000n,
    currency: "USD",
    occurredAt: "2026-01-10T00:00:00Z",
  });
  const run = reconciliation.run(
    "provider",
    new Date("2026-01-01"),
    new Date("2026-02-01"),
  );
  assert.equal(run.matchedCount, 1);
  assert.equal(run.exceptionCount, 0);
});

test("financial reports produce balanced statements", () => {
  const { ledger, chart, cash, equity } = setup();
  const draft = ledger.draft({
    reference: "capital",
    source: "corporate",
    description: "Initial capital",
    effectiveAt: "2026-01-01T00:00:00Z",
    lines: [
      {
        accountId: cash.id,
        side: "debit",
        amountMinor: 100_000n,
        currency: "USD",
        baseAmountMinor: 0n,
        dimensions: {},
      },
      {
        accountId: equity.id,
        side: "credit",
        amountMinor: 100_000n,
        currency: "USD",
        baseAmountMinor: 0n,
        dimensions: {},
      },
    ],
    metadata: {},
  });
  ledger.post(draft.id, draft.version);
  const report = new FinancialReports(ledger, chart).balanceSheet(
    new Date("2026-02-01"),
  );
  assert.equal(report.balanced, true);
  assert.equal(report.totalAssetsMinor, 100_000n);
});
