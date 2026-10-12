import assert from "node:assert/strict";
import test from "node:test";

import { RegulatoryCaseService } from "../lib/regulatory/cases.ts";
import { TransactionMonitoringService } from "../lib/regulatory/monitoring.ts";
import { JurisdictionPolicyService } from "../lib/regulatory/policies.ts";
import { RegulatoryReportingService } from "../lib/regulatory/reports.ts";
import { ResponsiblePlayService } from "../lib/regulatory/responsiblePlay.ts";
import { RetentionService } from "../lib/regulatory/retention.ts";
import { RegulatoryScreeningService } from "../lib/regulatory/screening.ts";

function policy(overrides = {}) {
  return {
    code: "GB",
    name: "Great Britain",
    regulator: "UKGC",
    legalAge: 18,
    currencies: ["GBP"],
    allowedProducts: ["slots", "sportsbook"],
    blockedProducts: [],
    depositMethods: ["card", "bank"],
    maximumDailyDepositMinor: 100_000n,
    maximumMonthlyDepositMinor: 500_000n,
    maximumStakeMinor: 10_000n,
    maximumWinMinor: 1_000_000n,
    coolingOffHours: 24,
    selfExclusionMinimumDays: 180,
    identityVerificationRequired: true,
    sourceOfFundsThresholdMinor: 250_000n,
    enhancedDueDiligenceThresholdMinor: 400_000n,
    suspiciousActivityThresholdMinor: 200_000n,
    taxBasisPoints: 1500,
    taxFreeWinMinor: 10_000n,
    dataRetentionDays: 1825,
    marketingConsentRequired: true,
    realityCheckMinutes: 60,
    effectiveFrom: "2026-01-01T00:00:00Z",
    version: 1,
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    playerId: "player-1",
    country: "GB",
    jurisdiction: "GB",
    dateOfBirth: "1990-05-10",
    citizenships: ["GB"],
    occupations: ["engineer"],
    risk: "low",
    pep: false,
    sanctionsMatch: false,
    adverseMedia: false,
    identityStatus: "verified",
    sourceOfFundsStatus: "not_required",
    enhancedDueDiligenceStatus: "not_required",
    restrictions: [],
    version: 0,
    ...overrides,
  };
}

function monitoringTransaction(id, amountMinor, occurredAt, overrides = {}) {
  return {
    id,
    playerId: "player-1",
    kind: "deposit",
    currency: "GBP",
    amountMinor,
    method: "card",
    country: "GB",
    occurredAt,
    sourceReference: `gateway-${id}`,
    ...overrides,
  };
}

test("jurisdiction policy decisions apply identity, product, currency, payment, and deposit controls", () => {
  const service = new JurisdictionPolicyService();
  service.addPolicy(policy({ currencies: ["gbp", "EUR"] }));
  const stored = service.upsertProfile(profile(), 0);
  assert.equal(stored.version, 1);
  const accepted = service.decide("player-1", {
    product: "slots",
    currency: "GBP",
    kind: "deposit",
    amountMinor: 25_000n,
    paymentMethod: "card",
    occurredAt: new Date("2026-05-01T12:00:00Z"),
    dailyDepositedMinor: 50_000n,
    monthlyDepositedMinor: 100_000n,
  });
  assert.equal(accepted.allowed, true);
  const refused = service.decide("player-1", {
    product: "roulette",
    currency: "USD",
    kind: "deposit",
    amountMinor: 60_000n,
    paymentMethod: "crypto",
    occurredAt: new Date("2026-05-01T12:00:00Z"),
    dailyDepositedMinor: 50_000n,
    monthlyDepositedMinor: 100_000n,
  });
  assert.equal(refused.allowed, false);
  assert.deepEqual(refused.reasons, [
    "product_not_allowed",
    "currency_not_allowed",
    "payment_method_not_allowed",
    "daily_deposit_limit",
  ]);
});

test("jurisdiction policies are versioned by effective date and profiles use optimistic concurrency", () => {
  const service = new JurisdictionPolicyService();
  service.addPolicy(policy());
  service.addPolicy(
    policy({
      version: 2,
      maximumStakeMinor: 5_000n,
      effectiveFrom: "2027-01-01T00:00:00Z",
    }),
  );
  assert.equal(
    service.policy("GB", new Date("2026-06-01T00:00:00Z")).version,
    1,
  );
  assert.equal(
    service.policy("GB", new Date("2027-06-01T00:00:00Z")).version,
    2,
  );
  service.upsertProfile(profile(), 0);
  assert.throws(
    () => service.upsertProfile(profile({ risk: "medium" }), 0),
    /version/,
  );
});

test("jurisdiction tax applies the free allowance before basis points", () => {
  const service = new JurisdictionPolicyService();
  service.addPolicy(policy());
  service.upsertProfile(profile(), 0);
  assert.equal(
    service.tax("player-1", 110_000n, new Date("2026-03-01T00:00:00Z")),
    15_000n,
  );
  assert.equal(
    service.tax("player-1", 5_000n, new Date("2026-03-01T00:00:00Z")),
    0n,
  );
});

test("transaction monitoring creates deterministic alerts over rolling windows", () => {
  const service = new TransactionMonitoringService();
  service.addRule({
    id: "rapid-deposits",
    name: "Rapid deposits",
    enabled: true,
    kinds: ["deposit"],
    windowMinutes: 60,
    minimumCount: 3,
    minimumTotalMinor: 100_000n,
    score: 45,
    severity: "high",
    reason: "rapid_deposit_activity",
  });
  assert.equal(
    service.ingest(
      monitoringTransaction("tx-1", 30_000n, "2026-04-01T10:00:00Z"),
    ).alerts.length,
    0,
  );
  assert.equal(
    service.ingest(
      monitoringTransaction("tx-2", 30_000n, "2026-04-01T10:15:00Z"),
    ).alerts.length,
    0,
  );
  const result = service.ingest(
    monitoringTransaction("tx-3", 50_000n, "2026-04-01T10:30:00Z"),
  );
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].score, 45);
  assert.deepEqual(result.alerts[0].transactionIds, ["tx-1", "tx-2", "tx-3"]);
  assert.equal(service.summary("player-1").risk, "medium");
});

test("transaction ingestion is idempotent but rejects changed source data", () => {
  const service = new TransactionMonitoringService();
  const transaction = monitoringTransaction(
    "tx-1",
    50_000n,
    "2026-04-01T10:00:00Z",
  );
  assert.equal(service.ingest(transaction).duplicate, false);
  assert.equal(service.ingest({ ...transaction }).duplicate, true);
  assert.throws(
    () => service.ingest({ ...transaction, amountMinor: 60_000n }),
    /different data/,
  );
  assert.throws(
    () =>
      service.ingest(
        monitoringTransaction("tx-2", 50_000n, "2026-04-01T11:00:00Z", {
          sourceReference: transaction.sourceReference,
        }),
      ),
    /source reference/,
  );
});

test("monitoring analysts acknowledge, escalate, and close alerts with version checks", () => {
  const service = new TransactionMonitoringService();
  service.addRule({
    id: "large",
    name: "Large deposit",
    enabled: true,
    kinds: ["deposit"],
    windowMinutes: 1,
    minimumSingleMinor: 100_000n,
    score: 90,
    severity: "critical",
    reason: "large_deposit",
  });
  const alert = service.ingest(
    monitoringTransaction("tx-1", 150_000n, "2026-04-01T10:00:00Z"),
  ).alerts[0];
  const acknowledged = service.acknowledge(alert.id, "analyst-1", 1);
  assert.equal(acknowledged.status, "acknowledged");
  const escalated = service.escalate(alert.id, "manager-1", 2);
  assert.equal(escalated.status, "escalated");
  assert.throws(() => service.close(alert.id, "manager-1", 2), /version/);
  assert.equal(service.close(alert.id, "manager-1", 3).status, "closed");
});

test("regulatory cases preserve notes, evidence, workflow, and workload", () => {
  const service = new RegulatoryCaseService();
  let value = service.create({
    id: "case-1",
    playerId: "player-1",
    kind: "aml",
    priority: "urgent",
    subject: "Unusual deposits",
    summary: "Review payment pattern",
    ownerId: "analyst-1",
    openedAt: new Date("2026-05-01T00:00:00Z"),
    dueAt: new Date("2026-05-02T00:00:00Z"),
  });
  value = service.transition(value.id, "investigating", value.version);
  value = service.addNote(
    value.id,
    {
      id: "note-1",
      authorId: "analyst-1",
      body: "Requested bank statement",
      private: true,
      createdAt: "2026-05-01T01:00:00Z",
    },
    value.version,
  );
  value = service.addEvidence(
    value.id,
    {
      id: "evidence-1",
      kind: "transaction",
      reference: "tx-1",
      checksum: "a".repeat(64),
      collectedBy: "analyst-1",
      collectedAt: "2026-05-01T02:00:00Z",
    },
    value.version,
  );
  value = service.transition(value.id, "reported", value.version);
  value = service.transition(value.id, "closed", value.version, {
    outcome: "SAR filed",
    at: new Date("2026-05-03T00:00:00Z"),
  });
  assert.equal(value.status, "closed");
  assert.equal(value.notes.length, 1);
  assert.equal(value.evidence.length, 1);
  assert.equal(service.search({ includeClosed: true }).length, 1);
});

test("case workflow rejects reporting without evidence and stale updates", () => {
  const service = new RegulatoryCaseService();
  let value = service.create({
    id: "case-1",
    playerId: "player-1",
    kind: "aml",
    priority: "normal",
    subject: "Review",
    summary: "Review account",
  });
  value = service.transition(value.id, "investigating", value.version);
  assert.throws(
    () => service.transition(value.id, "reported", value.version),
    /evidence/,
  );
  assert.throws(() => service.assign(value.id, "analyst-1", 1), /version/);
});

test("screening combines normalized name, birth date, country, and identifier matches", () => {
  const service = new RegulatoryScreeningService();
  const loaded = service.replaceList(
    [
      {
        id: "entry-1",
        source: "regulator",
        sourceVersion: "2026-01",
        category: "sanctions",
        names: ["José Álvarez"],
        countries: ["ES"],
        dateOfBirth: "1980-01-15",
        identifiers: { passport: "P123" },
        reason: "Asset freeze",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    "2026-01",
  );
  assert.equal(loaded.count, 1);
  const result = service.screen(
    {
      id: "subject-1",
      kind: "person",
      names: ["Jose Alvarez"],
      dateOfBirth: "1980-01-15",
      countries: ["ES"],
      identifiers: { passport: "p123" },
    },
    new Date("2026-05-01T00:00:00Z"),
  );
  assert.equal(result.disposition, "review");
  assert.equal(result.matches[0].score, 100);
  const reviewed = service.review(
    result.id,
    "confirmed",
    "analyst-1",
    "Passport confirmed",
    1,
  );
  assert.equal(reviewed.disposition, "confirmed");
});

function reportRecords() {
  return [
    {
      type: "deposit",
      reference: "tx-1",
      occurredAt: "2026-06-01T10:00:00Z",
      fields: { playerId: "player-1", method: "card" },
      amounts: { deposits: 10_000n },
    },
    {
      type: "withdrawal",
      reference: "tx-2",
      occurredAt: "2026-06-02T11:00:00Z",
      fields: { playerId: "player-1", method: "bank" },
      amounts: { withdrawals: 4_000n },
    },
  ];
}

test("regulatory reports require validation and independent dual approval", () => {
  const service = new RegulatoryReportingService();
  let report = service.generate({
    id: "report-1",
    jurisdiction: "GB",
    kind: "gaming_activity",
    periodStartsAt: new Date("2026-06-01T00:00:00Z"),
    periodEndsAt: new Date("2026-07-01T00:00:00Z"),
    caseIds: [],
    records: reportRecords(),
    generatedBy: "reporter-1",
    generatedAt: new Date("2026-07-02T00:00:00Z"),
  });
  assert.equal(report.totals.deposits, 10_000n);
  ({ report } = service.validate(report.id, report.version));
  assert.equal(report.status, "validated");
  report = service.approve(
    report.id,
    "compliance-1",
    "compliance",
    report.version,
  );
  assert.equal(report.status, "validated");
  report = service.approve(report.id, "director-1", "director", report.version);
  assert.equal(report.status, "approved");
  report = service.submit(report.id, "UKGC-123", report.version);
  assert.equal(service.accept(report.id, report.version).status, "accepted");
});

test("regulatory report validation finds duplicates and out-of-period rows", () => {
  const service = new RegulatoryReportingService();
  const records = [
    reportRecords()[0],
    { ...reportRecords()[0], occurredAt: "2025-01-01T00:00:00Z" },
  ];
  const report = service.generate({
    id: "bad-report",
    jurisdiction: "GB",
    kind: "large_transaction",
    periodStartsAt: new Date("2026-06-01T00:00:00Z"),
    periodEndsAt: new Date("2026-07-01T00:00:00Z"),
    caseIds: [],
    records,
    generatedBy: "reporter-1",
  });
  const validation = service.validate(report.id, report.version).validation;
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.duplicateReferences, ["tx-1"]);
});

test("report exports serialize bigint values for JSON and delimited files", () => {
  const service = new RegulatoryReportingService();
  service.generate({
    id: "report-1",
    jurisdiction: "GB",
    kind: "gaming_activity",
    periodStartsAt: new Date("2026-06-01T00:00:00Z"),
    periodEndsAt: new Date("2026-07-01T00:00:00Z"),
    caseIds: [],
    records: reportRecords(),
    generatedBy: "reporter-1",
  });
  const json = JSON.parse(service.exportJson("report-1"));
  assert.equal(json.report.totals.deposits, "10000");
  assert.match(service.exportDelimited("report-1"), /amount:deposits/);
});

test("retention policies find eligible records while legal holds prevent disposal", () => {
  const service = new RetentionService();
  service.addPolicy({
    id: "policy-1",
    jurisdiction: "GB",
    recordType: "identity",
    retainDays: 365,
    archiveAfterDays: 90,
    action: "delete",
    legalBasis: "AML regulation",
    effectiveFrom: "2025-01-01T00:00:00Z",
  });
  let record = service.register({
    id: "record-1",
    recordType: "identity",
    jurisdiction: "GB",
    playerId: "player-1",
    createdAt: "2025-01-01T00:00:00Z",
    checksum: "b".repeat(64),
    location: "hot/record-1",
  });
  service.createHold({
    id: "hold-1",
    name: "AML investigation",
    reason: "Open case",
    recordIds: [],
    playerIds: ["player-1"],
    recordTypes: [],
    startsAt: "2025-06-01T00:00:00Z",
    createdBy: "legal-1",
  });
  const candidate = service.candidates(new Date("2026-06-01T00:00:00Z"))[0];
  assert.equal(candidate.held, true);
  assert.throws(
    () =>
      service.markForDisposition(
        record.id,
        record.version,
        new Date("2026-06-01T00:00:00Z"),
      ),
    /legal hold/,
  );
  service.releaseHold("hold-1", "legal-2", 1, new Date("2026-06-02T00:00:00Z"));
  record = service.markForDisposition(
    record.id,
    record.version,
    new Date("2026-06-03T00:00:00Z"),
  );
  const receipt = service.completeDisposition(
    record.id,
    "privacy-1",
    record.version,
    new Date("2026-06-03T01:00:00Z"),
  );
  assert.equal(receipt.action, "delete");
  assert.equal(service.records({ status: "disposed" }).length, 1);
});

function protectionProfile(overrides = {}) {
  return {
    playerId: "player-1",
    currency: "GBP",
    depositLimitMinor: 100_000n,
    depositLimitPeriod: "day",
    lossLimitMinor: 50_000n,
    lossLimitPeriod: "week",
    wagerLimitMinor: 200_000n,
    wagerLimitPeriod: "day",
    sessionLimitMinutes: 120,
    realityCheckMinutes: 60,
    marketingBlocked: false,
    productBlocks: [],
    ...overrides,
  };
}

test("responsible-play limits apply activity totals in their configured period", () => {
  const service = new ResponsiblePlayService();
  service.setInitialProfile(protectionProfile());
  service.recordActivity({
    id: "deposit-1",
    playerId: "player-1",
    kind: "deposit",
    amountMinor: 80_000n,
    currency: "GBP",
    occurredAt: "2026-07-01T10:00:00Z",
  });
  const accepted = service.decide("player-1", {
    kind: "deposit",
    amountMinor: 20_000n,
    at: new Date("2026-07-01T12:00:00Z"),
  });
  assert.equal(accepted.allowed, true);
  assert.equal(accepted.remainingDepositMinor, 20_000n);
  const refused = service.decide("player-1", {
    kind: "deposit",
    amountMinor: 20_001n,
    at: new Date("2026-07-01T12:00:00Z"),
  });
  assert.equal(refused.allowed, false);
  assert.deepEqual(refused.reasons, ["deposit_limit"]);
});

test("limit reductions are immediate while increases wait through cooling off", () => {
  const service = new ResponsiblePlayService();
  service.setInitialProfile(protectionProfile());
  const decrease = service.requestLimit(
    { playerId: "player-1", kind: "deposit", value: 50_000n, period: "day" },
    new Date("2026-07-01T00:00:00Z"),
  );
  assert.equal(decrease.status, "active");
  assert.equal(service.profile("player-1").depositLimitMinor, 50_000n);
  const increase = service.requestLimit(
    { playerId: "player-1", kind: "deposit", value: 150_000n, period: "day" },
    new Date("2026-07-01T01:00:00Z"),
  );
  assert.equal(increase.status, "pending");
  assert.equal(
    service.activateDueChanges(new Date("2026-07-02T00:59:00Z")).length,
    0,
  );
  assert.equal(
    service.activateDueChanges(new Date("2026-07-02T01:00:00Z")).length,
    1,
  );
  assert.equal(service.profile("player-1").depositLimitMinor, 150_000n);
});

test("self-exclusion blocks matching products and cannot be revoked like an operator exclusion", () => {
  const service = new ResponsiblePlayService();
  service.setInitialProfile(protectionProfile());
  const exclusion = service.exclude(
    {
      playerId: "player-1",
      kind: "self_exclusion",
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: "2026-08-01T00:00:00Z",
      products: ["slots"],
      reason: "Player request",
      source: "account",
    },
    180,
    new Date("2026-01-01T00:00:00Z"),
  );
  assert.equal(
    service.decide("player-1", {
      kind: "wager",
      product: "slots",
      amountMinor: 100n,
      at: new Date("2026-02-01T00:00:00Z"),
    }).allowed,
    false,
  );
  assert.equal(
    service.decide("player-1", {
      kind: "wager",
      product: "sportsbook",
      amountMinor: 100n,
      at: new Date("2026-02-01T00:00:00Z"),
    }).allowed,
    true,
  );
  assert.throws(
    () =>
      service.revokeOperatorExclusion(
        exclusion.id,
        "operator-1",
        exclusion.version,
      ),
    /cannot be revoked/,
  );
});

test("sessions enforce duration and reality checks independently", () => {
  const service = new ResponsiblePlayService();
  service.setInitialProfile(
    protectionProfile({ sessionLimitMinutes: 120, realityCheckMinutes: 60 }),
  );
  service.recordActivity({
    id: "session-1",
    playerId: "player-1",
    kind: "session_start",
    occurredAt: "2026-07-01T10:00:00Z",
  });
  let decision = service.decide("player-1", {
    kind: "wager",
    amountMinor: 100n,
    at: new Date("2026-07-01T11:01:00Z"),
  });
  assert.equal(decision.realityCheckDue, true);
  assert.ok(decision.reasons.includes("reality_check_due"));
  service.recordActivity({
    id: "ack-1",
    playerId: "player-1",
    kind: "reality_check_acknowledged",
    occurredAt: "2026-07-01T11:02:00Z",
  });
  decision = service.decide("player-1", {
    kind: "wager",
    amountMinor: 100n,
    at: new Date("2026-07-01T12:00:00Z"),
  });
  assert.ok(decision.reasons.includes("session_limit"));
  assert.equal(decision.realityCheckDue, false);
});
