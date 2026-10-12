import { randomUUID } from "node:crypto";
import { FraudValidationError } from "./device-graph.ts";

export interface Chargeback {
  id: string;
  paymentId: string;
  playerId: string;
  providerCaseId: string;
  amountMinor: bigint;
  currency: string;
  reasonCode: string;
  status: "received" | "evidence_due" | "submitted" | "won" | "lost" | "accepted";
  receivedAt: Date;
  responseDueAt: Date;
  evidence: readonly ChargebackEvidence[];
  submittedAt?: Date;
  closedAt?: Date;
  version: number;
}

export interface ChargebackEvidence {
  id: string;
  type: string;
  content: string;
  createdAt: Date;
}

export class ChargebackConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChargebackConflictError";
  }
}

export class ChargebackService {
  private readonly cases = new Map<string, Chargeback>();
  private readonly providerCases = new Map<string, string>();

  receive(input: Omit<Chargeback, "id" | "status" | "evidence" | "submittedAt" | "closedAt" | "version">): Chargeback {
    const providerCaseId = required(input.providerCaseId, "provider case id");
    const existingId = this.providerCases.get(providerCaseId);
    if (existingId) return cloneChargeback(this.cases.get(existingId)!);
    if (input.amountMinor <= 0n) throw new FraudValidationError("chargeback amount must be positive");
    const receivedAt = validDate(input.receivedAt);
    const responseDueAt = validDate(input.responseDueAt);
    if (responseDueAt <= receivedAt) throw new FraudValidationError("chargeback deadline must follow receipt");
    const chargeback: Chargeback = {
      id: randomUUID(),
      paymentId: required(input.paymentId, "payment id"),
      playerId: required(input.playerId, "player id"),
      providerCaseId,
      amountMinor: input.amountMinor,
      currency: required(input.currency, "currency").toUpperCase(),
      reasonCode: required(input.reasonCode, "reason code"),
      status: "evidence_due",
      receivedAt,
      responseDueAt,
      evidence: [],
      version: 1,
    };
    this.cases.set(chargeback.id, chargeback);
    this.providerCases.set(providerCaseId, chargeback.id);
    return cloneChargeback(chargeback);
  }

  addEvidence(caseId: string, expectedVersion: number, type: string, content: string, at = new Date()): Chargeback {
    const current = this.requireVersion(caseId, expectedVersion);
    if (current.status !== "evidence_due") throw new ChargebackConflictError("chargeback is not accepting evidence");
    const evidence: ChargebackEvidence = {
      id: randomUUID(),
      type: required(type, "evidence type"),
      content: required(content, "evidence content"),
      createdAt: validDate(at),
    };
    return this.save({ ...current, evidence: [...current.evidence, evidence], version: current.version + 1 });
  }

  submit(caseId: string, expectedVersion: number, at = new Date()): Chargeback {
    const current = this.requireVersion(caseId, expectedVersion);
    const now = validDate(at);
    if (current.status !== "evidence_due") throw new ChargebackConflictError("chargeback evidence is not due");
    if (current.evidence.length === 0) throw new ChargebackConflictError("chargeback needs evidence before submission");
    if (now > current.responseDueAt) throw new ChargebackConflictError("chargeback response deadline passed");
    return this.save({ ...current, status: "submitted", submittedAt: now, version: current.version + 1 });
  }

  accept(caseId: string, expectedVersion: number, at = new Date()): Chargeback {
    const current = this.requireVersion(caseId, expectedVersion);
    if (!(["evidence_due", "received"] as string[]).includes(current.status)) throw new ChargebackConflictError("chargeback cannot be accepted now");
    return this.save({ ...current, status: "accepted", closedAt: validDate(at), version: current.version + 1 });
  }

  resolve(caseId: string, expectedVersion: number, outcome: "won" | "lost", at = new Date()): Chargeback {
    const current = this.requireVersion(caseId, expectedVersion);
    if (current.status !== "submitted") throw new ChargebackConflictError("only submitted chargebacks can resolve");
    return this.save({ ...current, status: outcome, closedAt: validDate(at), version: current.version + 1 });
  }

  dueBefore(at: Date): readonly Chargeback[] {
    return [...this.cases.values()]
      .filter((item) => item.status === "evidence_due" && item.responseDueAt <= at)
      .sort((left, right) => left.responseDueAt.getTime() - right.responseDueAt.getTime())
      .map(cloneChargeback);
  }

  exposure(currency: string): bigint {
    return [...this.cases.values()]
      .filter((item) => item.currency === currency.toUpperCase() && !["won", "accepted"].includes(item.status))
      .reduce((sum, item) => sum + item.amountMinor, 0n);
  }

  private requireVersion(caseId: string, expectedVersion: number): Chargeback {
    const current = this.cases.get(required(caseId, "chargeback id"));
    if (!current) throw new FraudValidationError("chargeback does not exist");
    if (current.version !== expectedVersion) throw new ChargebackConflictError("chargeback version does not match");
    return current;
  }

  private save(value: Chargeback): Chargeback {
    this.cases.set(value.id, value);
    return cloneChargeback(value);
  }
}

function required(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new FraudValidationError(`${field} is required`);
  return value.trim();
}

function validDate(value: Date): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new FraudValidationError("chargeback time is invalid");
  return date;
}

function cloneChargeback(value: Chargeback): Chargeback {
  return {
    ...value,
    receivedAt: new Date(value.receivedAt),
    responseDueAt: new Date(value.responseDueAt),
    submittedAt: value.submittedAt ? new Date(value.submittedAt) : undefined,
    closedAt: value.closedAt ? new Date(value.closedAt) : undefined,
    evidence: value.evidence.map((item) => ({ ...item, createdAt: new Date(item.createdAt) })),
  };
}

