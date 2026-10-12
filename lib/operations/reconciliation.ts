export interface BalanceRecord {
  playerId: string;
  asset: string;
  ledgerBalance: bigint;
  storedBalance: bigint;
}

export interface RoundRecord {
  roundId: string;
  playerId: string;
  stake: bigint;
  payout: bigint;
  wagerEntry: boolean;
  settlementEntry: boolean;
  proofValid: boolean;
}

export interface ReconciliationIssue {
  type: "balance_mismatch" | "missing_wager" | "missing_settlement" | "invalid_proof";
  reference: string;
  playerId: string;
  expected?: string;
  actual?: string;
  severity: "warning" | "error";
}

export function reconcileBalances(records: readonly BalanceRecord[]): ReconciliationIssue[] {
  return records
    .filter((record) => record.ledgerBalance !== record.storedBalance)
    .map((record) => ({
      type: "balance_mismatch" as const,
      reference: `${record.playerId}:${record.asset}`,
      playerId: record.playerId,
      expected: record.ledgerBalance.toString(),
      actual: record.storedBalance.toString(),
      severity: "error" as const,
    }));
}

export function reconcileRounds(records: readonly RoundRecord[]): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  for (const record of records) {
    if (!record.wagerEntry) issues.push({
      type: "missing_wager", reference: record.roundId, playerId: record.playerId, severity: "error",
    });
    if (!record.settlementEntry) issues.push({
      type: "missing_settlement", reference: record.roundId, playerId: record.playerId, severity: "error",
    });
    if (!record.proofValid) issues.push({
      type: "invalid_proof", reference: record.roundId, playerId: record.playerId, severity: "warning",
    });
  }
  return issues;
}

export function summarizeIssues(issues: readonly ReconciliationIssue[]): Record<string, number> {
  const result: Record<string, number> = { total: issues.length, errors: 0, warnings: 0 };
  for (const issue of issues) {
    result[issue.type] = (result[issue.type] ?? 0) + 1;
    result[issue.severity === "error" ? "errors" : "warnings"] += 1;
  }
  return result;
}
