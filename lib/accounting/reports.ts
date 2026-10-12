import type { ChartOfAccounts } from "./chart.ts";
import type { GeneralLedger } from "./journal.ts";
import type { AccountType, TrialBalanceRow } from "./types.ts";

export interface FinancialStatementLine {
  code: string;
  name: string;
  amountMinor: bigint;
  children: readonly FinancialStatementLine[];
}

export interface IncomeStatement {
  from: string;
  to: string;
  currency: string;
  revenue: readonly FinancialStatementLine[];
  expenses: readonly FinancialStatementLine[];
  totalRevenueMinor: bigint;
  totalExpenseMinor: bigint;
  netIncomeMinor: bigint;
}

export interface BalanceSheet {
  asOf: string;
  currency: string;
  assets: readonly FinancialStatementLine[];
  liabilities: readonly FinancialStatementLine[];
  equity: readonly FinancialStatementLine[];
  totalAssetsMinor: bigint;
  totalLiabilitiesMinor: bigint;
  totalEquityMinor: bigint;
  balanced: boolean;
}

export class FinancialReports {
  readonly ledger: GeneralLedger;
  readonly chart: ChartOfAccounts;

  constructor(ledger: GeneralLedger, chart: ChartOfAccounts) {
    this.ledger = ledger;
    this.chart = chart;
  }

  incomeStatement(from: Date, to: Date): IncomeStatement {
    const trial = this.ledger.trialBalance(from, to);
    const revenue = this.linesForTypes(trial, ["revenue"]);
    const expenses = this.linesForTypes(trial, ["expense"]);
    const totalRevenueMinor = sumLines(revenue);
    const totalExpenseMinor = sumLines(expenses);
    return { from: from.toISOString(), to: to.toISOString(), currency: this.ledger.baseCurrency, revenue, expenses, totalRevenueMinor, totalExpenseMinor, netIncomeMinor: totalRevenueMinor - totalExpenseMinor };
  }

  balanceSheet(asOf: Date): BalanceSheet {
    const trial = this.ledger.trialBalance(new Date(0), asOf);
    const assets = this.linesForTypes(trial, ["asset"]);
    const liabilities = this.linesForTypes(trial, ["liability"]);
    const equity = this.linesForTypes(trial, ["equity"]);
    const retainedEarnings = trial.filter((row) => ['revenue', 'expense'].includes(row.type)).reduce((sum, row) => sum + (row.type === "revenue" ? row.balanceMinor : -row.balanceMinor), 0n);
    const totalAssetsMinor = sumLines(assets);
    const totalLiabilitiesMinor = sumLines(liabilities);
    const totalEquityMinor = sumLines(equity) + retainedEarnings;
    return { asOf: asOf.toISOString(), currency: this.ledger.baseCurrency, assets, liabilities, equity, totalAssetsMinor, totalLiabilitiesMinor, totalEquityMinor, balanced: totalAssetsMinor === totalLiabilitiesMinor + totalEquityMinor };
  }

  movement(accountId: string, from: Date, to: Date): { openingMinor: bigint; debitsMinor: bigint; creditsMinor: bigint; closingMinor: bigint } {
    const account = this.chart.require(accountId);
    const opening = this.ledger.postings({ accountId, to: from });
    const period = this.ledger.postings({ accountId, from, to });
    const openingDebits = opening.filter((posting) => posting.side === "debit").reduce((sum, posting) => sum + posting.baseAmountMinor, 0n);
    const openingCredits = opening.filter((posting) => posting.side === "credit").reduce((sum, posting) => sum + posting.baseAmountMinor, 0n);
    const debitsMinor = period.filter((posting) => posting.side === "debit").reduce((sum, posting) => sum + posting.baseAmountMinor, 0n);
    const creditsMinor = period.filter((posting) => posting.side === "credit").reduce((sum, posting) => sum + posting.baseAmountMinor, 0n);
    const direction = account.normalBalance === "debit" ? 1n : -1n;
    const openingMinor = (openingDebits - openingCredits) * direction;
    const closingMinor = openingMinor + (debitsMinor - creditsMinor) * direction;
    return { openingMinor, debitsMinor, creditsMinor, closingMinor };
  }

  private linesForTypes(trial: readonly TrialBalanceRow[], types: readonly AccountType[]): readonly FinancialStatementLine[] {
    const selected = trial.filter((row) => types.includes(row.type));
    const roots = this.chart.search({ parentId: null }).filter((account) => types.includes(account.type));
    return roots.map((account) => buildLine(account.id, selected, this.chart)).filter((line) => line.amountMinor !== 0n || line.children.length > 0);
  }
}

function buildLine(accountId: string, trial: readonly TrialBalanceRow[], chart: ChartOfAccounts): FinancialStatementLine {
  const account = chart.require(accountId);
  const children = chart.search({ parentId: account.id }).map((child) => buildLine(child.id, trial, chart)).filter((line) => line.amountMinor !== 0n || line.children.length > 0);
  const own = trial.find((row) => row.accountId === account.id)?.balanceMinor ?? 0n;
  return { code: account.code, name: account.name, amountMinor: own + sumLines(children), children };
}

function sumLines(lines: readonly FinancialStatementLine[]): bigint { return lines.reduce((sum, line) => sum + line.amountMinor, 0n); }
