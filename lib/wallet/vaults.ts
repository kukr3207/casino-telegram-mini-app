import { positiveUnits } from "./money.ts";
import { WalletLedger } from "./ledger.ts";

export interface VaultPolicy {
  minimumDeposit: bigint;
  lockDays: number;
  earlyWithdrawalPenaltyBps: number;
  dailyWithdrawalLimit: bigint;
}

export interface ChipVault {
  id: string;
  playerId: string;
  sourceAccount: string;
  vaultAccount: string;
  policy: VaultPolicy;
  openedAt: string;
  lockedUntil: string;
  deposited: bigint;
  withdrawn: bigint;
  penalties: bigint;
  status: "active" | "closed";
}

export interface VaultWithdrawal {
  vaultId: string;
  gross: bigint;
  penalty: bigint;
  net: bigint;
  early: boolean;
  withdrawnAt: string;
}

function normalizePolicy(policy: VaultPolicy): VaultPolicy {
  const minimumDeposit = positiveUnits(policy.minimumDeposit, "minimum vault deposit");
  const dailyWithdrawalLimit = positiveUnits(policy.dailyWithdrawalLimit, "daily withdrawal limit");
  if (!Number.isSafeInteger(policy.lockDays) || policy.lockDays < 0 || policy.lockDays > 3650) {
    throw new RangeError("vault lock days must be from 0 to 3650");
  }
  if (!Number.isSafeInteger(policy.earlyWithdrawalPenaltyBps) || policy.earlyWithdrawalPenaltyBps < 0 || policy.earlyWithdrawalPenaltyBps > 10000) {
    throw new RangeError("vault penalty must be from 0 to 10000 basis points");
  }
  return { ...policy, minimumDeposit, dailyWithdrawalLimit };
}

function date(value: string | Date): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError("vault date is invalid");
  return parsed;
}

export class VaultService {
  readonly #ledger: WalletLedger;
  readonly #vaults = new Map<string, ChipVault>();
  readonly #withdrawals = new Map<string, VaultWithdrawal[]>();

  constructor(ledger: WalletLedger) {
    this.#ledger = ledger;
  }

  open(input: {
    vaultId: string;
    playerId: string;
    sourceAccount: string;
    vaultAccount: string;
    policy: VaultPolicy;
    deposit: bigint | number | string;
    at: string | Date;
  }): ChipVault {
    if (!input.vaultId.trim() || !input.playerId.trim()) throw new RangeError("vault and player ids cannot be blank");
    const policy = normalizePolicy(input.policy);
    const deposit = positiveUnits(input.deposit, "vault deposit");
    if (deposit < policy.minimumDeposit) throw new RangeError("deposit is below the vault minimum");
    const source = this.#ledger.account(input.sourceAccount);
    const destination = this.#ledger.account(input.vaultAccount);
    if (source.ownerId !== input.playerId || destination.ownerId !== input.playerId) throw new RangeError("vault accounts must belong to the player");
    if (source.asset !== destination.asset || destination.kind !== "reserve") throw new RangeError("vault account configuration is invalid");
    const openedAt = date(input.at);
    const lockedUntil = new Date(openedAt);
    lockedUntil.setUTCDate(lockedUntil.getUTCDate() + policy.lockDays);
    const value: ChipVault = {
      id: input.vaultId.trim(), playerId: input.playerId.trim(),
      sourceAccount: source.id, vaultAccount: destination.id, policy,
      openedAt: openedAt.toISOString(), lockedUntil: lockedUntil.toISOString(),
      deposited: deposit, withdrawn: 0n, penalties: 0n, status: "active",
    };
    const existing = this.#vaults.get(value.id);
    if (existing) {
      if (JSON.stringify({ ...existing, deposited: String(existing.deposited) }) === JSON.stringify({ ...value, deposited: String(value.deposited) })) return existing;
      throw new Error("vault id already exists");
    }
    this.#ledger.transfer({
      id: `vault:${value.id}:open`, reference: `vault-open:${value.id}`,
      fromAccount: source.id, toAccount: destination.id, units: deposit,
      kind: "vault_deposit", occurredAt: openedAt,
    });
    this.#vaults.set(value.id, value);
    this.#withdrawals.set(value.id, []);
    return value;
  }

  deposit(vaultId: string, amount: bigint | number | string, at: string | Date): ChipVault {
    const vault = this.get(vaultId);
    if (vault.status !== "active") throw new Error("vault is closed");
    const parsed = positiveUnits(amount, "vault deposit");
    const sequence = this.#withdrawals.get(vaultId)!.length;
    this.#ledger.transfer({
      id: `vault:${vault.id}:deposit:${vault.deposited}:${sequence}`,
      reference: `vault-deposit:${vault.id}:${vault.deposited}:${sequence}`,
      fromAccount: vault.sourceAccount, toAccount: vault.vaultAccount,
      units: parsed, kind: "vault_deposit", occurredAt: at,
    });
    const changed = { ...vault, deposited: vault.deposited + parsed };
    this.#vaults.set(vault.id, changed);
    return changed;
  }

  withdraw(vaultId: string, amount: bigint | number | string, at: string | Date, penaltyAccount: string): VaultWithdrawal {
    const vault = this.get(vaultId);
    if (vault.status !== "active") throw new Error("vault is closed");
    const gross = positiveUnits(amount, "vault withdrawal");
    const available = vault.deposited - vault.withdrawn - vault.penalties;
    if (gross > available) throw new RangeError("withdrawal exceeds the vault balance");
    const withdrawalTime = date(at);
    const day = withdrawalTime.toISOString().slice(0, 10);
    const usedToday = this.#withdrawals.get(vaultId)!
      .filter((item) => item.withdrawnAt.slice(0, 10) === day)
      .reduce((total, item) => total + item.gross, 0n);
    if (usedToday + gross > vault.policy.dailyWithdrawalLimit) throw new RangeError("withdrawal exceeds the daily vault limit");
    const early = withdrawalTime < new Date(vault.lockedUntil);
    const penalty = early ? (gross * BigInt(vault.policy.earlyWithdrawalPenaltyBps)) / 10000n : 0n;
    const net = gross - penalty;
    const sequence = this.#withdrawals.get(vaultId)!.length + 1;
    this.#ledger.post({
      id: `vault:${vault.id}:withdraw:${sequence}`,
      reference: `vault-withdraw:${vault.id}:${sequence}`,
      kind: "vault_withdrawal",
      occurredAt: withdrawalTime,
      postings: [
        { accountId: vault.vaultAccount, direction: "debit" as const, units: gross },
        { accountId: vault.sourceAccount, direction: "credit" as const, units: net },
        { accountId: penaltyAccount, direction: "credit" as const, units: penalty },
      ].filter((posting) => posting.units > 0n),
      metadata: { vaultId, early },
    });
    const result = { vaultId, gross, penalty, net, early, withdrawnAt: withdrawalTime.toISOString() };
    this.#withdrawals.get(vaultId)!.push(result);
    this.#vaults.set(vaultId, { ...vault, withdrawn: vault.withdrawn + gross, penalties: vault.penalties + penalty });
    return result;
  }

  get(vaultId: string): ChipVault {
    const vault = this.#vaults.get(vaultId);
    if (!vault) throw new Error("chip vault was not found");
    return vault;
  }

  history(vaultId: string): readonly VaultWithdrawal[] {
    this.get(vaultId);
    return [...this.#withdrawals.get(vaultId)!];
  }
}
