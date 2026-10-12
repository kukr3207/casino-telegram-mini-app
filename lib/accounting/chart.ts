import {
  type AccountType,
  type LedgerAccount,
  AccountingConflictError,
  AccountingValidationError,
  accountNormalBalance,
  accountingCurrency,
  accountingText,
} from "./types.ts";

export interface AccountQuery {
  type?: AccountType;
  parentId?: string | null;
  currency?: string;
  active?: boolean;
  tag?: string;
  text?: string;
}

export class ChartOfAccounts {
  readonly #accounts = new Map<string, LedgerAccount>();
  readonly #byCode = new Map<string, string>();

  create(input: Omit<LedgerAccount, "normalBalance" | "createdAt" | "version"> & {
    normalBalance?: LedgerAccount["normalBalance"];
    createdAt?: Date;
  }): LedgerAccount {
    const account = validateAccount({
      ...input,
      normalBalance: input.normalBalance ?? accountNormalBalance(input.type),
      createdAt: (input.createdAt ?? new Date()).toISOString(),
      version: 1,
    });
    if (this.#accounts.has(account.id)) throw new AccountingConflictError("account id already exists");
    if (this.#byCode.has(account.code)) throw new AccountingConflictError("account code already exists");
    if (account.parentId) {
      const parent = this.#accounts.get(account.parentId);
      if (!parent) throw new AccountingValidationError("parent account does not exist");
      if (parent.type !== account.type) throw new AccountingValidationError("parent and child account types must match");
    }
    this.#accounts.set(account.id, account);
    this.#byCode.set(account.code, account.id);
    return cloneAccount(account);
  }

  update(
    accountId: string,
    expectedVersion: number,
    changes: Partial<Pick<LedgerAccount, "name" | "tags" | "active">>,
  ): LedgerAccount {
    const current = this.require(accountId);
    if (current.version !== expectedVersion) throw new AccountingConflictError("account version does not match");
    const changed = validateAccount({ ...current, ...changes, version: current.version + 1 });
    this.#accounts.set(changed.id, changed);
    return cloneAccount(changed);
  }

  get(accountId: string): LedgerAccount | undefined {
    const value = this.#accounts.get(accountId.trim());
    return value ? cloneAccount(value) : undefined;
  }

  byCode(code: string): LedgerAccount | undefined {
    const id = this.#byCode.get(code.trim().toUpperCase());
    return id ? this.get(id) : undefined;
  }

  search(query: AccountQuery = {}): readonly LedgerAccount[] {
    const text = query.text?.trim().toLocaleLowerCase();
    const currency = query.currency ? accountingCurrency(query.currency) : undefined;
    return [...this.#accounts.values()]
      .filter((account) => !query.type || account.type === query.type)
      .filter((account) => query.parentId === undefined || account.parentId === (query.parentId ?? undefined))
      .filter((account) => !currency || account.currency === currency)
      .filter((account) => query.active === undefined || account.active === query.active)
      .filter((account) => !query.tag || account.tags.includes(query.tag.trim().toLocaleLowerCase()))
      .filter((account) => !text || `${account.code} ${account.name}`.toLocaleLowerCase().includes(text))
      .sort((left, right) => left.code.localeCompare(right.code))
      .map(cloneAccount);
  }

  descendants(accountId: string): readonly LedgerAccount[] {
    this.require(accountId);
    const output: LedgerAccount[] = [];
    const visit = (parentId: string): void => {
      const children = [...this.#accounts.values()].filter((account) => account.parentId === parentId);
      for (const child of children.sort((left, right) => left.code.localeCompare(right.code))) {
        output.push(cloneAccount(child));
        visit(child.id);
      }
    };
    visit(accountId);
    return output;
  }

  require(accountId: string): LedgerAccount {
    const value = this.#accounts.get(accountingText(accountId, "account id"));
    if (!value) throw new AccountingValidationError("account does not exist");
    return value;
  }
}

function validateAccount(value: LedgerAccount): LedgerAccount {
  const id = accountingText(value.id, "account id");
  const code = accountingText(value.code, "account code").toUpperCase();
  const name = accountingText(value.name, "account name");
  if (!/^[A-Z0-9][A-Z0-9.-]{1,31}$/.test(code)) throw new AccountingValidationError("account code is invalid");
  if (value.normalBalance !== accountNormalBalance(value.type)) {
    throw new AccountingValidationError("normal balance does not match account type");
  }
  const tags = [...new Set(value.tags.map((tag) => accountingText(tag, "account tag").toLocaleLowerCase()))].sort();
  return {
    ...value,
    id,
    code,
    name,
    currency: value.currency ? accountingCurrency(value.currency) : undefined,
    parentId: value.parentId?.trim() || undefined,
    tags,
  };
}

function cloneAccount(value: LedgerAccount): LedgerAccount {
  return { ...value, tags: [...value.tags] };
}
