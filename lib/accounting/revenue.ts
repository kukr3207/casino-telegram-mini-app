import { randomUUID } from "node:crypto";

import type { GeneralLedger } from "./journal.ts";
import {
  type RevenueContract,
  type RevenueRecognition,
  AccountingConflictError,
  AccountingValidationError,
  accountingCurrency,
  accountingDate,
  accountingText,
} from "./types.ts";

export interface RevenueAccounts {
  cashAccountId: string;
  deferredRevenueAccountId: string;
  revenueAccountId: string;
}

export class RevenueRecognitionService {
  readonly #contracts = new Map<string, RevenueContract>();
  readonly #recognitions = new Map<string, RevenueRecognition>();
  readonly ledger: GeneralLedger;
  readonly accounts: RevenueAccounts;

  constructor(ledger: GeneralLedger, accounts: RevenueAccounts) {
    this.ledger = ledger;
    this.accounts = { ...accounts };
  }

  create(value: RevenueContract, receivedAt = new Date()): RevenueContract {
    const contract = validateContract(value);
    if (this.#contracts.has(contract.id))
      throw new AccountingConflictError("revenue contract already exists");
    const receipt = this.ledger.draft({
      reference: `revenue-contract:${contract.id}`,
      source: "revenue_contract",
      description: `Consideration received for ${contract.kind}`,
      effectiveAt: receivedAt.toISOString(),
      lines: [
        line(
          this.accounts.cashAccountId,
          "debit",
          contract.considerationMinor,
          contract.currency,
          { contract: contract.id },
        ),
        line(
          this.accounts.deferredRevenueAccountId,
          "credit",
          contract.considerationMinor,
          contract.currency,
          { contract: contract.id },
        ),
      ],
      metadata: { contractId: contract.id, kind: contract.kind },
    });
    this.ledger.post(receipt.id, receipt.version, receivedAt);
    this.#contracts.set(contract.id, contract);
    return { ...contract };
  }

  recognize(
    contractId: string,
    period: string,
    fulfilledUnits: number,
    at = new Date(),
  ): RevenueRecognition {
    const contract = this.require(contractId);
    if (contract.status !== "active")
      throw new AccountingConflictError("revenue contract is not active");
    const key = `${contract.id}:${accountingText(period, "recognition period")}`;
    const existing = this.#recognitions.get(key);
    if (existing) {
      if (existing.fulfilledUnits !== fulfilledUnits)
        throw new AccountingConflictError(
          "recognition period contains different usage",
        );
      return { ...existing };
    }
    if (!Number.isSafeInteger(fulfilledUnits) || fulfilledUnits < 0)
      throw new AccountingValidationError("fulfilled units are invalid");
    const amountMinor = recognitionAmount(contract, fulfilledUnits, at);
    if (amountMinor <= 0n)
      throw new AccountingConflictError("no revenue is available to recognize");
    if (amountMinor > contract.deferredMinor)
      throw new AccountingConflictError("recognition exceeds deferred revenue");
    const journalReference = `revenue-recognition:${key}`;
    const journal = this.ledger.draft({
      reference: journalReference,
      source: "revenue_recognition",
      description: `Recognize revenue for ${contract.kind}`,
      effectiveAt: at.toISOString(),
      lines: [
        line(
          this.accounts.deferredRevenueAccountId,
          "debit",
          amountMinor,
          contract.currency,
          { contract: contract.id, period },
        ),
        line(
          this.accounts.revenueAccountId,
          "credit",
          amountMinor,
          contract.currency,
          { contract: contract.id, period },
        ),
      ],
      metadata: { contractId: contract.id, period },
    });
    this.ledger.post(journal.id, journal.version, at);
    const recognition = {
      id: randomUUID(),
      contractId: contract.id,
      period,
      amountMinor,
      fulfilledUnits,
      recognizedAt: at.toISOString(),
      journalReference,
    };
    this.#recognitions.set(key, recognition);
    const recognizedMinor = contract.recognizedMinor + amountMinor;
    const deferredMinor = contract.considerationMinor - recognizedMinor;
    this.#contracts.set(contract.id, {
      ...contract,
      fulfilledUnits: contract.fulfilledUnits + fulfilledUnits,
      recognizedMinor,
      deferredMinor,
      status: deferredMinor === 0n ? "completed" : "active",
      version: contract.version + 1,
    });
    return { ...recognition };
  }

  cancel(contractId: string, expectedVersion: number): RevenueContract {
    const contract = this.require(contractId);
    if (contract.version !== expectedVersion)
      throw new AccountingConflictError(
        "revenue contract version does not match",
      );
    if (contract.recognizedMinor > 0n)
      throw new AccountingConflictError(
        "recognized contract cannot be cancelled automatically",
      );
    const changed = {
      ...contract,
      status: "cancelled" as const,
      version: contract.version + 1,
    };
    this.#contracts.set(changed.id, changed);
    return { ...changed };
  }

  contract(contractId: string): RevenueContract | undefined {
    const value = this.#contracts.get(contractId.trim());
    return value ? { ...value } : undefined;
  }

  recognitions(contractId: string): readonly RevenueRecognition[] {
    return [...this.#recognitions.values()]
      .filter((value) => value.contractId === contractId)
      .sort((left, right) => left.period.localeCompare(right.period))
      .map((value) => ({ ...value }));
  }

  private require(contractId: string): RevenueContract {
    const value = this.#contracts.get(
      accountingText(contractId, "contract id"),
    );
    if (!value)
      throw new AccountingValidationError("revenue contract does not exist");
    return value;
  }
}

function recognitionAmount(
  contract: RevenueContract,
  fulfilledUnits: number,
  at: Date,
): bigint {
  if (contract.recognition === "point_in_time")
    return at >= new Date(contract.endsAt) ? contract.deferredMinor : 0n;
  if (contract.recognition === "usage") {
    if (!contract.performanceUnits || contract.performanceUnits < 1)
      throw new AccountingValidationError(
        "usage contract requires performance units",
      );
    return (
      (contract.considerationMinor * BigInt(fulfilledUnits)) /
      BigInt(contract.performanceUnits)
    );
  }
  const start = new Date(contract.startsAt).getTime();
  const end = new Date(contract.endsAt).getTime();
  const elapsed = Math.min(end, Math.max(start, at.getTime())) - start;
  const cumulative =
    (contract.considerationMinor * BigInt(elapsed)) / BigInt(end - start);
  return cumulative - contract.recognizedMinor;
}

function validateContract(value: RevenueContract): RevenueContract {
  const id = accountingText(value.id, "contract id");
  const currency = accountingCurrency(value.currency);
  const startsAt = accountingDate(value.startsAt, "contract start");
  const endsAt = accountingDate(value.endsAt, "contract end");
  if (endsAt <= startsAt)
    throw new AccountingValidationError("contract end must follow start");
  if (
    value.considerationMinor <= 0n ||
    value.recognizedMinor < 0n ||
    value.deferredMinor < 0n
  )
    throw new AccountingValidationError("contract amounts are invalid");
  if (value.recognizedMinor + value.deferredMinor !== value.considerationMinor)
    throw new AccountingValidationError(
      "recognized and deferred amounts must equal consideration",
    );
  return {
    ...value,
    id,
    currency,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}

function line(
  accountId: string,
  side: "debit" | "credit",
  amountMinor: bigint,
  currency: string,
  dimensions: Readonly<Record<string, string>>,
) {
  return {
    accountId,
    side,
    amountMinor,
    currency,
    baseAmountMinor: 0n,
    dimensions,
  };
}
