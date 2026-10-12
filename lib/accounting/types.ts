export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense";
export type NormalBalance = "debit" | "credit";
export type JournalStatus = "draft" | "posted" | "reversed";
export type LedgerSide = "debit" | "credit";

export interface LedgerAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  currency?: string;
  parentId?: string;
  tags: readonly string[];
  active: boolean;
  createdAt: string;
  version: number;
}

export interface JournalLine {
  accountId: string;
  side: LedgerSide;
  amountMinor: bigint;
  currency: string;
  baseAmountMinor: bigint;
  description?: string;
  dimensions: Readonly<Record<string, string>>;
}

export interface JournalEntry {
  id: string;
  reference: string;
  source: string;
  description: string;
  effectiveAt: string;
  postedAt?: string;
  status: JournalStatus;
  lines: readonly JournalLine[];
  reversalOf?: string;
  reversedBy?: string;
  metadata: Readonly<Record<string, string>>;
  version: number;
}

export interface LedgerPosting {
  sequence: number;
  journalId: string;
  journalReference: string;
  accountId: string;
  side: LedgerSide;
  amountMinor: bigint;
  currency: string;
  baseAmountMinor: bigint;
  effectiveAt: string;
  postedAt: string;
  dimensions: Readonly<Record<string, string>>;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debitMinor: bigint;
  creditMinor: bigint;
  balanceMinor: bigint;
}

export interface FxRate {
  baseCurrency: string;
  quoteCurrency: string;
  numerator: bigint;
  denominator: bigint;
  observedAt: string;
  source: string;
}

export interface RevenueContract {
  id: string;
  playerId?: string;
  kind:
    | "wager"
    | "tournament_fee"
    | "subscription"
    | "advertising"
    | "affiliate";
  currency: string;
  considerationMinor: bigint;
  startsAt: string;
  endsAt: string;
  recognition: "point_in_time" | "straight_line" | "usage";
  performanceUnits?: number;
  fulfilledUnits: number;
  recognizedMinor: bigint;
  deferredMinor: bigint;
  status: "active" | "completed" | "cancelled";
  version: number;
}

export interface RevenueRecognition {
  id: string;
  contractId: string;
  period: string;
  amountMinor: bigint;
  fulfilledUnits: number;
  recognizedAt: string;
  journalReference: string;
}

export interface ReconciliationSource {
  id: string;
  name: string;
  currency: string;
  expectedAccountId: string;
  toleranceMinor: bigint;
}

export interface ExternalTransaction {
  id: string;
  sourceId: string;
  reference: string;
  amountMinor: bigint;
  currency: string;
  occurredAt: string;
  description?: string;
}

export interface ReconciliationMatch {
  externalTransactionId: string;
  postingSequences: readonly number[];
  externalAmountMinor: bigint;
  ledgerAmountMinor: bigint;
  differenceMinor: bigint;
  status: "matched" | "within_tolerance" | "mismatch" | "missing_ledger";
  matchedAt: string;
}

export interface AccountingPeriod {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "open" | "soft_closed" | "closed";
  closedAt?: string;
  closedBy?: string;
  version: number;
}

export class AccountingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingValidationError";
  }
}

export class AccountingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingConflictError";
  }
}

export function accountingText(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new AccountingValidationError(`${field} is required`);
  return value.trim();
}

export function accountingCurrency(value: string): string {
  const currency = accountingText(value, "currency").toUpperCase();
  if (!/^[A-Z][A-Z0-9]{2,7}$/.test(currency))
    throw new AccountingValidationError("currency is invalid");
  return currency;
}

export function accountingDate(value: string | Date, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new AccountingValidationError(`${field} is invalid`);
  return date;
}

export function accountNormalBalance(type: AccountType): NormalBalance {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}
