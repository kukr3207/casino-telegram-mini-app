import { createHash } from "node:crypto";

import {
  type MonitoringAlert,
  type MonitoringRule,
  type MonitoringTransaction,
  RegulatoryConflictError,
  RegulatoryValidationError,
  regulatoryCurrency,
  regulatoryDate,
  regulatoryText,
} from "./types.ts";

export interface AlertSearch {
  playerId?: string;
  ruleId?: string;
  status?: MonitoringAlert["status"];
  minimumSeverity?: MonitoringAlert["severity"];
  assignedTo?: string;
  openedFrom?: Date;
  openedTo?: Date;
}

export interface PlayerMonitoringSummary {
  playerId: string;
  score: number;
  risk: "low" | "medium" | "high" | "critical";
  openAlerts: number;
  totalTransactions: number;
  totalInMinor: bigint;
  totalOutMinor: bigint;
  lastActivityAt?: string;
}

const severityRank: Record<MonitoringAlert["severity"], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export class TransactionMonitoringService {
  readonly #transactions = new Map<string, MonitoringTransaction>();
  readonly #sourceReferences = new Map<string, string>();
  readonly #rules = new Map<string, MonitoringRule>();
  readonly #alerts = new Map<string, MonitoringAlert>();
  readonly #alertFingerprints = new Map<string, string>();

  addRule(input: Omit<MonitoringRule, "version">): MonitoringRule {
    const rule = validateRule({ ...input, version: 1 });
    if (this.#rules.has(rule.id))
      throw new RegulatoryConflictError("monitoring rule already exists");
    this.#rules.set(rule.id, rule);
    return cloneRule(rule);
  }

  updateRule(
    id: string,
    patch: Partial<Omit<MonitoringRule, "id" | "version">>,
    expectedVersion: number,
  ): MonitoringRule {
    const current = this.#rules.get(regulatoryText(id, "rule id"));
    if (!current)
      throw new RegulatoryValidationError("monitoring rule does not exist");
    if (current.version !== expectedVersion)
      throw new RegulatoryConflictError(
        "monitoring rule version does not match",
      );
    const changed = validateRule({
      ...current,
      ...patch,
      id: current.id,
      version: current.version + 1,
    });
    this.#rules.set(changed.id, changed);
    return cloneRule(changed);
  }

  ingest(input: MonitoringTransaction): {
    transaction: MonitoringTransaction;
    alerts: readonly MonitoringAlert[];
    duplicate: boolean;
  } {
    const transaction = validateTransaction(input);
    const existing = this.#transactions.get(transaction.id);
    if (existing) {
      if (
        transactionFingerprint(existing) !== transactionFingerprint(transaction)
      )
        throw new RegulatoryConflictError(
          "transaction id is already used for different data",
        );
      return {
        transaction: cloneTransaction(existing),
        alerts: this.alertsForTransaction(existing.id),
        duplicate: true,
      };
    }
    const sourceOwner = this.#sourceReferences.get(transaction.sourceReference);
    if (sourceOwner && sourceOwner !== transaction.id)
      throw new RegulatoryConflictError("source reference is already used");
    this.#transactions.set(transaction.id, transaction);
    this.#sourceReferences.set(transaction.sourceReference, transaction.id);
    const alerts = this.#evaluate(transaction);
    return {
      transaction: cloneTransaction(transaction),
      alerts,
      duplicate: false,
    };
  }

  acknowledge(
    alertId: string,
    analystId: string,
    expectedVersion: number,
  ): MonitoringAlert {
    return this.#changeAlert(alertId, expectedVersion, (alert) => {
      if (alert.status !== "open")
        throw new RegulatoryConflictError(
          "only open alerts can be acknowledged",
        );
      return {
        ...alert,
        status: "acknowledged",
        assignedTo: regulatoryText(analystId, "analyst id"),
      };
    });
  }

  escalate(
    alertId: string,
    analystId: string,
    expectedVersion: number,
  ): MonitoringAlert {
    return this.#changeAlert(alertId, expectedVersion, (alert) => {
      if (["closed", "false_positive"].includes(alert.status))
        throw new RegulatoryConflictError("closed alerts cannot be escalated");
      return {
        ...alert,
        status: "escalated",
        assignedTo: regulatoryText(analystId, "analyst id"),
      };
    });
  }

  close(
    alertId: string,
    analystId: string,
    expectedVersion: number,
    falsePositive = false,
    at = new Date(),
  ): MonitoringAlert {
    return this.#changeAlert(alertId, expectedVersion, (alert) => {
      if (["closed", "false_positive"].includes(alert.status))
        throw new RegulatoryConflictError("alert is already closed");
      return {
        ...alert,
        status: falsePositive ? "false_positive" : "closed",
        assignedTo: regulatoryText(analystId, "analyst id"),
        closedAt: at.toISOString(),
      };
    });
  }

  alert(id: string): MonitoringAlert | undefined {
    const value = this.#alerts.get(id.trim());
    return value ? cloneAlert(value) : undefined;
  }

  search(filters: AlertSearch = {}): readonly MonitoringAlert[] {
    const minimum = filters.minimumSeverity
      ? severityRank[filters.minimumSeverity]
      : -1;
    return [...this.#alerts.values()]
      .filter(
        (alert) => !filters.playerId || alert.playerId === filters.playerId,
      )
      .filter((alert) => !filters.ruleId || alert.ruleId === filters.ruleId)
      .filter((alert) => !filters.status || alert.status === filters.status)
      .filter(
        (alert) =>
          !filters.assignedTo || alert.assignedTo === filters.assignedTo,
      )
      .filter((alert) => severityRank[alert.severity] >= minimum)
      .filter(
        (alert) =>
          !filters.openedFrom ||
          new Date(alert.createdAt) >= filters.openedFrom,
      )
      .filter(
        (alert) =>
          !filters.openedTo || new Date(alert.createdAt) < filters.openedTo,
      )
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.score - left.score,
      )
      .map(cloneAlert);
  }

  transactions(
    playerId: string,
    from?: Date,
    to?: Date,
  ): readonly MonitoringTransaction[] {
    const normalized = regulatoryText(playerId, "player id");
    return [...this.#transactions.values()]
      .filter((transaction) => transaction.playerId === normalized)
      .filter(
        (transaction) => !from || new Date(transaction.occurredAt) >= from,
      )
      .filter((transaction) => !to || new Date(transaction.occurredAt) < to)
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.id.localeCompare(right.id),
      )
      .map(cloneTransaction);
  }

  summary(playerId: string): PlayerMonitoringSummary {
    const transactions = this.transactions(playerId);
    const alerts = this.search({ playerId }).filter(
      (alert) => !["closed", "false_positive"].includes(alert.status),
    );
    const score = alerts.reduce((total, alert) => total + alert.score, 0);
    const inKinds = new Set<MonitoringTransaction["kind"]>([
      "deposit",
      "transfer_in",
      "win",
    ]);
    const outKinds = new Set<MonitoringTransaction["kind"]>([
      "withdrawal",
      "transfer_out",
      "wager",
    ]);
    return {
      playerId: regulatoryText(playerId, "player id"),
      score,
      risk:
        score >= 100
          ? "critical"
          : score >= 60
            ? "high"
            : score >= 25
              ? "medium"
              : "low",
      openAlerts: alerts.length,
      totalTransactions: transactions.length,
      totalInMinor: transactions
        .filter((item) => inKinds.has(item.kind))
        .reduce((total, item) => total + item.amountMinor, 0n),
      totalOutMinor: transactions
        .filter((item) => outKinds.has(item.kind))
        .reduce((total, item) => total + item.amountMinor, 0n),
      lastActivityAt: transactions.at(-1)?.occurredAt,
    };
  }

  alertsForTransaction(transactionId: string): readonly MonitoringAlert[] {
    return [...this.#alerts.values()]
      .filter((alert) => alert.transactionIds.includes(transactionId))
      .map(cloneAlert);
  }

  #evaluate(trigger: MonitoringTransaction): MonitoringAlert[] {
    const created: MonitoringAlert[] = [];
    for (const rule of this.#rules.values()) {
      if (
        !rule.enabled ||
        (rule.kinds.length > 0 && !rule.kinds.includes(trigger.kind))
      )
        continue;
      const end = new Date(trigger.occurredAt);
      const start = new Date(end.getTime() - rule.windowMinutes * 60_000);
      const window = [...this.#transactions.values()]
        .filter((item) => item.playerId === trigger.playerId)
        .filter(
          (item) => rule.kinds.length === 0 || rule.kinds.includes(item.kind),
        )
        .filter(
          (item) =>
            new Date(item.occurredAt) >= start &&
            new Date(item.occurredAt) <= end,
        )
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
      if (!ruleMatches(rule, window)) continue;
      const ids = window.map((item) => item.id);
      const fingerprint = createHash("sha256")
        .update(
          `${rule.id}\u0000${trigger.playerId}\u0000${ids.join("\u0000")}`,
        )
        .digest("hex");
      const existingId = this.#alertFingerprints.get(fingerprint);
      if (existingId) {
        const existing = this.#alerts.get(existingId);
        if (existing) created.push(cloneAlert(existing));
        continue;
      }
      const alert: MonitoringAlert = {
        id: `alert_${fingerprint.slice(0, 24)}`,
        ruleId: rule.id,
        playerId: trigger.playerId,
        severity: rule.severity,
        score: rule.score,
        reason: rule.reason,
        transactionIds: ids,
        windowStartsAt: start.toISOString(),
        windowEndsAt: end.toISOString(),
        status: "open",
        createdAt: end.toISOString(),
        version: 1,
      };
      this.#alerts.set(alert.id, alert);
      this.#alertFingerprints.set(fingerprint, alert.id);
      created.push(cloneAlert(alert));
    }
    return created;
  }

  #changeAlert(
    id: string,
    expectedVersion: number,
    change: (alert: MonitoringAlert) => MonitoringAlert,
  ): MonitoringAlert {
    const current = this.#alerts.get(regulatoryText(id, "alert id"));
    if (!current)
      throw new RegulatoryValidationError("monitoring alert does not exist");
    if (current.version !== expectedVersion)
      throw new RegulatoryConflictError(
        "monitoring alert version does not match",
      );
    const changed = { ...change(current), version: current.version + 1 };
    this.#alerts.set(changed.id, changed);
    return cloneAlert(changed);
  }
}

function validateRule(value: MonitoringRule): MonitoringRule {
  if (!Number.isSafeInteger(value.windowMinutes) || value.windowMinutes < 1)
    throw new RegulatoryValidationError("monitoring window must be positive");
  if (!Number.isSafeInteger(value.score) || value.score < 1)
    throw new RegulatoryValidationError("monitoring score must be positive");
  for (const threshold of [
    value.minimumCount,
    value.distinctMethods,
    value.distinctCounterparties,
  ])
    if (
      threshold !== undefined &&
      (!Number.isSafeInteger(threshold) || threshold < 1)
    )
      throw new RegulatoryValidationError(
        "rule thresholds must be positive integers",
      );
  if (value.minimumTotalMinor !== undefined && value.minimumTotalMinor < 0n)
    throw new RegulatoryValidationError("minimum total cannot be negative");
  if (value.minimumSingleMinor !== undefined && value.minimumSingleMinor < 0n)
    throw new RegulatoryValidationError(
      "minimum single amount cannot be negative",
    );
  return {
    ...value,
    id: regulatoryText(value.id, "rule id"),
    name: regulatoryText(value.name, "rule name"),
    reason: regulatoryText(value.reason, "rule reason"),
    kinds: [...new Set(value.kinds)],
    countries: value.countries
      ? [
          ...new Set(
            value.countries.map((country) => country.trim().toUpperCase()),
          ),
        ].sort()
      : undefined,
  };
}

function validateTransaction(
  value: MonitoringTransaction,
): MonitoringTransaction {
  if (typeof value.amountMinor !== "bigint" || value.amountMinor < 0n)
    throw new RegulatoryValidationError(
      "transaction amount cannot be negative",
    );
  return {
    ...value,
    id: regulatoryText(value.id, "transaction id"),
    playerId: regulatoryText(value.playerId, "player id"),
    currency: regulatoryCurrency(value.currency),
    method: value.method?.trim(),
    counterparty: value.counterparty?.trim(),
    country: value.country?.trim().toUpperCase(),
    deviceId: value.deviceId?.trim(),
    ipAddress: value.ipAddress?.trim(),
    occurredAt: regulatoryDate(
      value.occurredAt,
      "transaction time",
    ).toISOString(),
    sourceReference: regulatoryText(value.sourceReference, "source reference"),
  };
}

function ruleMatches(
  rule: MonitoringRule,
  window: readonly MonitoringTransaction[],
): boolean {
  if (window.length === 0) return false;
  if (rule.minimumCount !== undefined && window.length < rule.minimumCount)
    return false;
  if (
    rule.minimumTotalMinor !== undefined &&
    window.reduce((sum, item) => sum + item.amountMinor, 0n) <
      rule.minimumTotalMinor
  )
    return false;
  if (
    rule.minimumSingleMinor !== undefined &&
    !window.some((item) => item.amountMinor >= rule.minimumSingleMinor!)
  )
    return false;
  if (
    rule.distinctMethods !== undefined &&
    new Set(window.map((item) => item.method).filter(Boolean)).size <
      rule.distinctMethods
  )
    return false;
  if (
    rule.distinctCounterparties !== undefined &&
    new Set(window.map((item) => item.counterparty).filter(Boolean)).size <
      rule.distinctCounterparties
  )
    return false;
  if (
    rule.countries?.length &&
    !window.some(
      (item) => item.country && rule.countries!.includes(item.country),
    )
  )
    return false;
  return true;
}

function transactionFingerprint(value: MonitoringTransaction): string {
  return JSON.stringify({
    ...value,
    amountMinor: value.amountMinor.toString(),
  });
}

function cloneRule(value: MonitoringRule): MonitoringRule {
  return {
    ...value,
    kinds: [...value.kinds],
    countries: value.countries ? [...value.countries] : undefined,
  };
}
function cloneTransaction(value: MonitoringTransaction): MonitoringTransaction {
  return { ...value };
}
function cloneAlert(value: MonitoringAlert): MonitoringAlert {
  return { ...value, transactionIds: [...value.transactionIds] };
}
