import type { GeneralLedger } from "./journal.ts";
import {
  type ExternalTransaction,
  type ReconciliationMatch,
  type ReconciliationSource,
  AccountingConflictError,
  AccountingValidationError,
  accountingCurrency,
  accountingDate,
  accountingText,
} from "./types.ts";

export interface ReconciliationRun {
  id: string;
  sourceId: string;
  startedAt: string;
  completedAt: string;
  transactionCount: number;
  matchedCount: number;
  exceptionCount: number;
  matches: readonly ReconciliationMatch[];
}

export class AccountingReconciliationService {
  readonly #sources = new Map<string, ReconciliationSource>();
  readonly #transactions = new Map<string, ExternalTransaction>();
  readonly #runs = new Map<string, ReconciliationRun>();
  readonly ledger: GeneralLedger;

  constructor(ledger: GeneralLedger) {
    this.ledger = ledger;
  }

  registerSource(value: ReconciliationSource): ReconciliationSource {
    const source = validateSource(value);
    const existing = this.#sources.get(source.id);
    if (
      existing &&
      JSON.stringify(existing, bigintReplacer) !==
        JSON.stringify(source, bigintReplacer)
    )
      throw new AccountingConflictError(
        "reconciliation source already exists with different data",
      );
    this.#sources.set(source.id, source);
    return { ...source };
  }

  ingest(value: ExternalTransaction): ExternalTransaction {
    const transaction = validateTransaction(value);
    const source = this.#sources.get(transaction.sourceId);
    if (!source)
      throw new AccountingValidationError(
        "reconciliation source does not exist",
      );
    if (source.currency !== transaction.currency)
      throw new AccountingValidationError(
        "transaction currency does not match source",
      );
    const existing = this.#transactions.get(transaction.id);
    if (
      existing &&
      JSON.stringify(existing, bigintReplacer) !==
        JSON.stringify(transaction, bigintReplacer)
    )
      throw new AccountingConflictError(
        "external transaction id contains different data",
      );
    this.#transactions.set(transaction.id, transaction);
    return { ...transaction };
  }

  run(
    sourceId: string,
    from: Date,
    to: Date,
    at = new Date(),
  ): ReconciliationRun {
    const source = this.#sources.get(accountingText(sourceId, "source id"));
    if (!source)
      throw new AccountingValidationError(
        "reconciliation source does not exist",
      );
    if (to <= from)
      throw new AccountingValidationError("reconciliation window is invalid");
    const id = `${source.id}:${from.toISOString()}:${to.toISOString()}`;
    const existing = this.#runs.get(id);
    if (existing) return cloneRun(existing);
    const postings = this.ledger.postings({
      accountId: source.expectedAccountId,
      from,
      to,
    });
    const transactions = [...this.#transactions.values()].filter(
      (transaction) =>
        transaction.sourceId === source.id &&
        new Date(transaction.occurredAt) >= from &&
        new Date(transaction.occurredAt) < to,
    );
    const used = new Set<number>();
    const matches = transactions.map((transaction): ReconciliationMatch => {
      const candidates = postings.filter(
        (posting) =>
          !used.has(posting.sequence) &&
          posting.journalReference.includes(transaction.reference),
      );
      const selected = candidates.length
        ? candidates
        : postings.filter(
            (posting) =>
              !used.has(posting.sequence) &&
              posting.baseAmountMinor === abs(transaction.amountMinor),
          );
      const ledgerAmountMinor = selected.reduce(
        (sum, posting) =>
          sum + signedPosting(posting.side, posting.amountMinor),
        0n,
      );
      selected.forEach((posting) => used.add(posting.sequence));
      const differenceMinor = ledgerAmountMinor - transaction.amountMinor;
      const absoluteDifference = abs(differenceMinor);
      return {
        externalTransactionId: transaction.id,
        postingSequences: selected.map((posting) => posting.sequence),
        externalAmountMinor: transaction.amountMinor,
        ledgerAmountMinor,
        differenceMinor,
        status:
          selected.length === 0
            ? "missing_ledger"
            : absoluteDifference === 0n
              ? "matched"
              : absoluteDifference <= source.toleranceMinor
                ? "within_tolerance"
                : "mismatch",
        matchedAt: at.toISOString(),
      };
    });
    const run = {
      id,
      sourceId: source.id,
      startedAt: at.toISOString(),
      completedAt: at.toISOString(),
      transactionCount: transactions.length,
      matchedCount: matches.filter((match) =>
        ["matched", "within_tolerance"].includes(match.status),
      ).length,
      exceptionCount: matches.filter(
        (match) => !["matched", "within_tolerance"].includes(match.status),
      ).length,
      matches,
    };
    this.#runs.set(id, run);
    return cloneRun(run);
  }

  unresolved(runId: string): readonly ReconciliationMatch[] {
    const run = this.#runs.get(runId);
    if (!run)
      throw new AccountingValidationError("reconciliation run does not exist");
    return run.matches
      .filter(
        (match) => !["matched", "within_tolerance"].includes(match.status),
      )
      .map((match) => ({
        ...match,
        postingSequences: [...match.postingSequences],
      }));
  }
}

function validateSource(value: ReconciliationSource): ReconciliationSource {
  if (value.toleranceMinor < 0n)
    throw new AccountingValidationError(
      "reconciliation tolerance cannot be negative",
    );
  return {
    ...value,
    id: accountingText(value.id, "source id"),
    name: accountingText(value.name, "source name"),
    currency: accountingCurrency(value.currency),
    expectedAccountId: accountingText(
      value.expectedAccountId,
      "expected account id",
    ),
  };
}

function validateTransaction(value: ExternalTransaction): ExternalTransaction {
  if (value.amountMinor === 0n)
    throw new AccountingValidationError("external transaction cannot be zero");
  return {
    ...value,
    id: accountingText(value.id, "transaction id"),
    sourceId: accountingText(value.sourceId, "source id"),
    reference: accountingText(value.reference, "transaction reference"),
    currency: accountingCurrency(value.currency),
    occurredAt: accountingDate(
      value.occurredAt,
      "transaction time",
    ).toISOString(),
  };
}

function signedPosting(side: "debit" | "credit", amount: bigint): bigint {
  return side === "debit" ? amount : -amount;
}
function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
function cloneRun(value: ReconciliationRun): ReconciliationRun {
  return {
    ...value,
    matches: value.matches.map((match) => ({
      ...match,
      postingSequences: [...match.postingSequences],
    })),
  };
}
