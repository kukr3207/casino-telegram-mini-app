import { randomUUID } from "node:crypto";

import { ChartOfAccounts } from "./chart.ts";
import {
  type AccountingPeriod,
  type FxRate,
  type JournalEntry,
  type JournalLine,
  type LedgerPosting,
  type TrialBalanceRow,
  AccountingConflictError,
  AccountingValidationError,
  accountingCurrency,
  accountingDate,
  accountingText,
} from "./types.ts";

export class FxRateBook {
  readonly #rates = new Map<string, FxRate[]>();

  add(value: FxRate): FxRate {
    const rate = validateRate(value);
    const key = pairKey(rate.baseCurrency, rate.quoteCurrency);
    const rates = this.#rates.get(key) ?? [];
    const existing = rates.find((candidate) => candidate.observedAt === rate.observedAt && candidate.source === rate.source);
    if (existing) {
      if (existing.numerator !== rate.numerator || existing.denominator !== rate.denominator) {
        throw new AccountingConflictError("FX source contains different values for the same observation");
      }
      return { ...existing };
    }
    rates.push(rate);
    rates.sort((left, right) => left.observedAt.localeCompare(right.observedAt));
    this.#rates.set(key, rates);
    return { ...rate };
  }

  at(baseCurrency: string, quoteCurrency: string, at: Date): FxRate {
    const base = accountingCurrency(baseCurrency);
    const quote = accountingCurrency(quoteCurrency);
    if (base === quote) return { baseCurrency: base, quoteCurrency: quote, numerator: 1n, denominator: 1n, observedAt: at.toISOString(), source: "identity" };
    const direct = this.latest(pairKey(base, quote), at);
    if (direct) return { ...direct };
    const inverse = this.latest(pairKey(quote, base), at);
    if (inverse) return { ...inverse, baseCurrency: base, quoteCurrency: quote, numerator: inverse.denominator, denominator: inverse.numerator };
    throw new AccountingValidationError(`FX rate is unavailable for ${base}/${quote}`);
  }

  convert(amountMinor: bigint, baseCurrency: string, quoteCurrency: string, at: Date): bigint {
    const rate = this.at(baseCurrency, quoteCurrency, at);
    return roundHalfAway(amountMinor * rate.numerator, rate.denominator);
  }

  private latest(key: string, at: Date): FxRate | undefined {
    return [...(this.#rates.get(key) ?? [])].reverse().find((rate) => new Date(rate.observedAt) <= at);
  }
}

export class AccountingPeriods {
  readonly #periods = new Map<string, AccountingPeriod>();

  add(value: AccountingPeriod): AccountingPeriod {
    const period = validatePeriod(value);
    if (this.#periods.has(period.id)) throw new AccountingConflictError("accounting period already exists");
    for (const current of this.#periods.values()) {
      if (new Date(period.startsAt) < new Date(current.endsAt) && new Date(period.endsAt) > new Date(current.startsAt)) {
        throw new AccountingConflictError("accounting periods cannot overlap");
      }
    }
    this.#periods.set(period.id, period);
    return { ...period };
  }

  close(periodId: string, expectedVersion: number, actorId: string, hard = false, at = new Date()): AccountingPeriod {
    const period = this.require(periodId);
    if (period.version !== expectedVersion) throw new AccountingConflictError("accounting period version does not match");
    if (period.status === "closed") return { ...period };
    const changed = { ...period, status: hard ? "closed" as const : "soft_closed" as const, closedAt: at.toISOString(), closedBy: accountingText(actorId, "closing actor"), version: period.version + 1 };
    this.#periods.set(period.id, changed);
    return { ...changed };
  }

  assertOpen(effectiveAt: Date): void {
    const period = [...this.#periods.values()].find((candidate) => effectiveAt >= new Date(candidate.startsAt) && effectiveAt < new Date(candidate.endsAt));
    if (!period) throw new AccountingValidationError("effective date is outside configured accounting periods");
    if (period.status === "closed") throw new AccountingConflictError("accounting period is closed");
  }

  require(periodId: string): AccountingPeriod {
    const period = this.#periods.get(accountingText(periodId, "period id"));
    if (!period) throw new AccountingValidationError("accounting period does not exist");
    return period;
  }
}

export class GeneralLedger {
  readonly #journals = new Map<string, JournalEntry>();
  readonly #byReference = new Map<string, string>();
  readonly #postings: LedgerPosting[] = [];
  readonly chart: ChartOfAccounts;
  readonly rates: FxRateBook;
  readonly periods: AccountingPeriods;
  readonly baseCurrency: string;

  constructor(
    chart: ChartOfAccounts,
    rates: FxRateBook,
    periods: AccountingPeriods,
    baseCurrency: string,
  ) {
    this.chart = chart;
    this.rates = rates;
    this.periods = periods;
    this.baseCurrency = accountingCurrency(baseCurrency);
  }

  draft(input: Omit<JournalEntry, "id" | "status" | "version"> & { id?: string }): JournalEntry {
    const journal = validateJournal({ ...input, id: input.id ?? randomUUID(), status: "draft", version: 1 }, this.chart, this.rates, this.baseCurrency);
    const existingId = this.#byReference.get(journal.reference);
    if (existingId) {
      const existing = this.#journals.get(existingId)!;
      if (journalFingerprint(existing) !== journalFingerprint(journal)) throw new AccountingConflictError("journal reference contains different data");
      return cloneJournal(existing);
    }
    this.#journals.set(journal.id, journal);
    this.#byReference.set(journal.reference, journal.id);
    return cloneJournal(journal);
  }

  post(journalId: string, expectedVersion: number, at = new Date()): JournalEntry {
    const current = this.require(journalId);
    if (current.version !== expectedVersion) throw new AccountingConflictError("journal version does not match");
    if (current.status === "posted") return cloneJournal(current);
    if (current.status !== "draft") throw new AccountingConflictError("journal cannot be posted");
    this.periods.assertOpen(new Date(current.effectiveAt));
    const postedAt = accountingDate(at, "posting time").toISOString();
    const changed = { ...current, status: "posted" as const, postedAt, version: current.version + 1 };
    for (const line of changed.lines) {
      this.#postings.push({
        sequence: this.#postings.length + 1,
        journalId: changed.id,
        journalReference: changed.reference,
        accountId: line.accountId,
        side: line.side,
        amountMinor: line.amountMinor,
        currency: line.currency,
        baseAmountMinor: line.baseAmountMinor,
        effectiveAt: changed.effectiveAt,
        postedAt,
        dimensions: { ...line.dimensions },
      });
    }
    this.#journals.set(changed.id, changed);
    return cloneJournal(changed);
  }

  reverse(journalId: string, reference: string, description: string, effectiveAt: Date, at = new Date()): JournalEntry {
    const original = this.require(journalId);
    if (original.status !== "posted") throw new AccountingConflictError("only posted journals can be reversed");
    if (original.reversedBy) return cloneJournal(this.require(original.reversedBy));
    const reversal = this.draft({
      reference,
      source: original.source,
      description,
      effectiveAt: effectiveAt.toISOString(),
      lines: original.lines.map((line) => ({ ...line, side: line.side === "debit" ? "credit" as const : "debit" as const })),
      reversalOf: original.id,
      metadata: { ...original.metadata, reversal: "true" },
    });
    const posted = this.post(reversal.id, reversal.version, at);
    this.#journals.set(original.id, { ...original, status: "reversed", reversedBy: posted.id, version: original.version + 1 });
    return posted;
  }

  postings(input: { accountId?: string; from?: Date; to?: Date; dimension?: [string, string] } = {}): readonly LedgerPosting[] {
    return this.#postings
      .filter((posting) => !input.accountId || posting.accountId === input.accountId)
      .filter((posting) => !input.from || new Date(posting.effectiveAt) >= input.from)
      .filter((posting) => !input.to || new Date(posting.effectiveAt) < input.to)
      .filter((posting) => !input.dimension || posting.dimensions[input.dimension[0]] === input.dimension[1])
      .map(clonePosting);
  }

  trialBalance(from: Date, to: Date): readonly TrialBalanceRow[] {
    return this.chart.search({ active: true }).map((account) => {
      const postings = this.postings({ accountId: account.id, from, to });
      const debitMinor = postings.filter((posting) => posting.side === "debit").reduce((sum, posting) => sum + posting.baseAmountMinor, 0n);
      const creditMinor = postings.filter((posting) => posting.side === "credit").reduce((sum, posting) => sum + posting.baseAmountMinor, 0n);
      return { accountId: account.id, code: account.code, name: account.name, type: account.type, debitMinor, creditMinor, balanceMinor: account.normalBalance === "debit" ? debitMinor - creditMinor : creditMinor - debitMinor };
    }).filter((row) => row.debitMinor !== 0n || row.creditMinor !== 0n);
  }

  journal(journalId: string): JournalEntry | undefined {
    const value = this.#journals.get(journalId.trim());
    return value ? cloneJournal(value) : undefined;
  }

  require(journalId: string): JournalEntry {
    const value = this.#journals.get(accountingText(journalId, "journal id"));
    if (!value) throw new AccountingValidationError("journal does not exist");
    return value;
  }
}

function validateRate(value: FxRate): FxRate {
  const baseCurrency = accountingCurrency(value.baseCurrency);
  const quoteCurrency = accountingCurrency(value.quoteCurrency);
  if (baseCurrency === quoteCurrency) throw new AccountingValidationError("FX pair currencies must differ");
  if (value.numerator <= 0n || value.denominator <= 0n) throw new AccountingValidationError("FX rate must be positive");
  return { ...value, baseCurrency, quoteCurrency, observedAt: accountingDate(value.observedAt, "FX observation").toISOString(), source: accountingText(value.source, "FX source") };
}

function validatePeriod(value: AccountingPeriod): AccountingPeriod {
  const id = accountingText(value.id, "period id");
  const startsAt = accountingDate(value.startsAt, "period start");
  const endsAt = accountingDate(value.endsAt, "period end");
  if (endsAt <= startsAt) throw new AccountingValidationError("period end must follow start");
  return { ...value, id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

function validateJournal(value: JournalEntry, chart: ChartOfAccounts, rates: FxRateBook, baseCurrency: string): JournalEntry {
  const id = accountingText(value.id, "journal id");
  const reference = accountingText(value.reference, "journal reference");
  const source = accountingText(value.source, "journal source");
  const description = accountingText(value.description, "journal description");
  const effectiveAt = accountingDate(value.effectiveAt, "journal effective date");
  if (value.lines.length < 2) throw new AccountingValidationError("journal requires at least two lines");
  const lines = value.lines.map((line) => validateLine(line, chart, rates, baseCurrency, effectiveAt));
  const debits = lines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.baseAmountMinor, 0n);
  const credits = lines.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.baseAmountMinor, 0n);
  if (debits !== credits) throw new AccountingValidationError("journal is not balanced in base currency");
  return { ...value, id, reference, source, description, effectiveAt: effectiveAt.toISOString(), lines, metadata: { ...value.metadata } };
}

function validateLine(line: JournalLine, chart: ChartOfAccounts, rates: FxRateBook, baseCurrency: string, at: Date): JournalLine {
  const account = chart.require(line.accountId);
  if (!account.active) throw new AccountingConflictError("journal account is inactive");
  const currency = accountingCurrency(line.currency);
  if (account.currency && account.currency !== currency) throw new AccountingValidationError("journal currency does not match account");
  if (line.amountMinor <= 0n) throw new AccountingValidationError("journal line amount must be positive");
  const baseAmountMinor = currency === baseCurrency ? line.amountMinor : rates.convert(line.amountMinor, currency, baseCurrency, at);
  if (line.baseAmountMinor !== 0n && abs(line.baseAmountMinor - baseAmountMinor) > 1n) throw new AccountingValidationError("journal base amount differs from FX conversion");
  return { ...line, currency, baseAmountMinor, dimensions: Object.fromEntries(Object.entries(line.dimensions).map(([key, value]) => [accountingText(key, "dimension key"), accountingText(value, "dimension value")])) };
}

function pairKey(base: string, quote: string): string { return `${base}/${quote}`; }
function roundHalfAway(numerator: bigint, denominator: bigint): bigint { const quotient = numerator / denominator; const remainder = numerator % denominator; return remainder * 2n >= denominator ? quotient + 1n : quotient; }
function abs(value: bigint): bigint { return value < 0n ? -value : value; }
function clonePosting(value: LedgerPosting): LedgerPosting { return { ...value, dimensions: { ...value.dimensions } }; }
function cloneJournal(value: JournalEntry): JournalEntry { return { ...value, lines: value.lines.map((line) => ({ ...line, dimensions: { ...line.dimensions } })), metadata: { ...value.metadata } }; }
function journalFingerprint(value: JournalEntry): string { return JSON.stringify({ ...value, id: undefined, status: undefined, version: undefined, lines: value.lines.map((line) => ({ ...line, amountMinor: line.amountMinor.toString(), baseAmountMinor: line.baseAmountMinor.toString() })) }); }
