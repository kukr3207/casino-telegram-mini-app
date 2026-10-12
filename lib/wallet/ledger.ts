import { createHash } from "node:crypto";

import { assetCode, positiveUnits, units } from "./money.ts";

export type AccountKind =
  | "player"
  | "house"
  | "escrow"
  | "promotion"
  | "payment"
  | "reserve";

export interface LedgerAccount {
  id: string;
  ownerId: string;
  asset: string;
  kind: AccountKind;
  allowNegative: boolean;
  status: "active" | "frozen" | "closed";
  createdAt: string;
}

export interface LedgerPosting {
  accountId: string;
  direction: "debit" | "credit";
  units: bigint;
  memo?: string;
}

export interface LedgerEntry {
  id: string;
  reference: string;
  kind: string;
  occurredAt: string;
  postings: readonly LedgerPosting[];
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  previousHash: string;
  hash: string;
}

export interface BalanceSnapshot {
  accountId: string;
  asset: string;
  balance: bigint;
  available: bigint;
  entryCount: number;
  lastEntryId: string | null;
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new RangeError(`${name} cannot be blank`);
  if (value.trim().length > 128) throw new RangeError(`${name} is too long`);
  return value.trim();
}

function timestamp(value: string | Date, name: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${name} must be a valid date`);
  return parsed.toISOString();
}

function metadata(value: Readonly<Record<string, unknown>> = {}): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [name, item] of Object.entries(value)) {
    if (!name.trim()) throw new RangeError("metadata names cannot be blank");
    if (item !== null && !["string", "number", "boolean"].includes(typeof item)) {
      throw new TypeError("metadata values must be JSON scalars");
    }
    if (typeof item === "number" && !Number.isFinite(item)) throw new RangeError("metadata numbers must be finite");
    result[name] = item as string | number | boolean | null;
  }
  return result;
}

function entryHash(entry: Omit<LedgerEntry, "hash">): string {
  const canonical = JSON.stringify({
    id: entry.id,
    reference: entry.reference,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    postings: entry.postings.map((posting) => ({ ...posting, units: posting.units.toString() })),
    metadata: Object.fromEntries(Object.entries(entry.metadata).sort(([left], [right]) => left.localeCompare(right))),
    previousHash: entry.previousHash,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export class WalletLedger {
  readonly #accounts = new Map<string, LedgerAccount>();
  readonly #entries = new Map<string, LedgerEntry>();
  readonly #references = new Map<string, string>();
  readonly #balances = new Map<string, bigint>();
  readonly #accountEntries = new Map<string, string[]>();
  #lastHash = "0".repeat(64);

  openAccount(input: Omit<LedgerAccount, "createdAt"> & { createdAt: string | Date }): LedgerAccount {
    const account: LedgerAccount = {
      id: identifier(input.id, "account id"),
      ownerId: identifier(input.ownerId, "account owner"),
      asset: assetCode(input.asset),
      kind: input.kind,
      allowNegative: Boolean(input.allowNegative),
      status: input.status,
      createdAt: timestamp(input.createdAt, "account creation time"),
    };
    if (!new Set<AccountKind>(["player", "house", "escrow", "promotion", "payment", "reserve"]).has(account.kind)) {
      throw new RangeError("account kind is not supported");
    }
    if (!new Set(["active", "frozen", "closed"]).has(account.status)) throw new RangeError("account status is not supported");
    const existing = this.#accounts.get(account.id);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(account)) return existing;
      throw new Error("account id already exists");
    }
    this.#accounts.set(account.id, account);
    this.#balances.set(account.id, 0n);
    this.#accountEntries.set(account.id, []);
    return account;
  }

  account(accountId: string): LedgerAccount {
    const account = this.#accounts.get(accountId);
    if (!account) throw new Error("ledger account was not found");
    return account;
  }

  balance(accountId: string): bigint {
    this.account(accountId);
    return this.#balances.get(accountId) ?? 0n;
  }

  post(input: {
    id: string;
    reference: string;
    kind: string;
    occurredAt: string | Date;
    postings: readonly LedgerPosting[];
    metadata?: Readonly<Record<string, unknown>>;
  }): LedgerEntry {
    const id = identifier(input.id, "entry id");
    const reference = identifier(input.reference, "entry reference");
    const kind = identifier(input.kind, "entry kind");
    const occurredAt = timestamp(input.occurredAt, "entry time");
    if (input.postings.length < 2) throw new RangeError("ledger entry requires at least two postings");
    const seenAccounts = new Set<string>();
    const normalized = input.postings.map((posting) => {
      const account = this.account(posting.accountId);
      if (account.status !== "active") throw new Error("ledger entry references an unavailable account");
      if (seenAccounts.has(account.id)) throw new RangeError("ledger entry can post to each account once");
      seenAccounts.add(account.id);
      if (!new Set(["debit", "credit"]).has(posting.direction)) throw new RangeError("posting direction is invalid");
      return {
        accountId: account.id,
        direction: posting.direction,
        units: positiveUnits(posting.units, "posting units"),
        ...(posting.memo?.trim() ? { memo: posting.memo.trim() } : {}),
      } as LedgerPosting;
    });
    const normalizedMetadata = metadata(input.metadata);
    const storedById = this.#entries.get(id);
    const storedReferenceId = this.#references.get(reference);
    if (storedById || storedReferenceId) {
      const stored = storedById ?? this.#entries.get(storedReferenceId!);
      const same = stored
        && stored.id === id
        && stored.reference === reference
        && stored.kind === kind
        && stored.occurredAt === occurredAt
        && JSON.stringify(stored.postings, (_, value) => typeof value === "bigint" ? value.toString() : value)
          === JSON.stringify(normalized, (_, value) => typeof value === "bigint" ? value.toString() : value)
        && JSON.stringify(stored.metadata) === JSON.stringify(normalizedMetadata);
      if (same) return stored;
      throw new Error("entry id or reference already exists with different data");
    }
    const assets = new Map<string, { debit: bigint; credit: bigint }>();
    for (const posting of normalized) {
      const account = this.account(posting.accountId);
      const total = assets.get(account.asset) ?? { debit: 0n, credit: 0n };
      total[posting.direction] += posting.units;
      assets.set(account.asset, total);
    }
    for (const [asset, total] of assets) {
      if (total.debit !== total.credit) throw new RangeError(`ledger postings do not balance for ${asset}`);
    }
    const candidateBalances = new Map(this.#balances);
    for (const posting of normalized) {
      const account = this.account(posting.accountId);
      const before = candidateBalances.get(account.id) ?? 0n;
      const after = posting.direction === "debit" ? before - posting.units : before + posting.units;
      if (after < 0n && !account.allowNegative) throw new RangeError(`entry would overdraw ${account.id}`);
      candidateBalances.set(account.id, after);
    }
    const unsigned: Omit<LedgerEntry, "hash"> = {
      id,
      reference,
      kind,
      occurredAt,
      postings: normalized,
      metadata: normalizedMetadata,
      previousHash: this.#lastHash,
    };
    const entry: LedgerEntry = { ...unsigned, hash: entryHash(unsigned) };
    this.#balances.clear();
    for (const [accountId, balance] of candidateBalances) this.#balances.set(accountId, balance);
    this.#entries.set(id, entry);
    this.#references.set(reference, id);
    for (const posting of normalized) this.#accountEntries.get(posting.accountId)!.push(id);
    this.#lastHash = entry.hash;
    return entry;
  }

  transfer(input: {
    id: string;
    reference: string;
    fromAccount: string;
    toAccount: string;
    units: bigint | number | string;
    kind: string;
    occurredAt: string | Date;
    metadata?: Readonly<Record<string, unknown>>;
  }): LedgerEntry {
    const from = this.account(input.fromAccount);
    const to = this.account(input.toAccount);
    if (from.asset !== to.asset) throw new RangeError("transfer accounts must use the same asset");
    const amount = positiveUnits(input.units);
    return this.post({
      ...input,
      postings: [
        { accountId: from.id, direction: "debit", units: amount },
        { accountId: to.id, direction: "credit", units: amount },
      ],
    });
  }

  snapshot(accountId: string): BalanceSnapshot {
    const account = this.account(accountId);
    const entries = this.#accountEntries.get(accountId) ?? [];
    const balance = this.balance(accountId);
    return {
      accountId,
      asset: account.asset,
      balance,
      available: account.status === "active" ? balance : 0n,
      entryCount: entries.length,
      lastEntryId: entries.at(-1) ?? null,
    };
  }

  entries(accountId?: string): readonly LedgerEntry[] {
    if (!accountId) return [...this.#entries.values()];
    this.account(accountId);
    return (this.#accountEntries.get(accountId) ?? []).map((id) => this.#entries.get(id)!);
  }

  verifyChain(): boolean {
    let previous = "0".repeat(64);
    for (const entry of this.#entries.values()) {
      if (entry.previousHash !== previous) return false;
      const { hash, ...unsigned } = entry;
      if (entryHash(unsigned) !== hash) return false;
      previous = hash;
    }
    return previous === this.#lastHash;
  }
}
