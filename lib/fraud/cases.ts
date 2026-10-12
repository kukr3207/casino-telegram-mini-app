import { randomUUID } from "node:crypto";
import { FraudValidationError } from "./device-graph.ts";

export type FraudCaseStatus = "open" | "investigating" | "waiting_for_player" | "resolved" | "dismissed";
export type FraudCasePriority = "low" | "medium" | "high" | "critical";

export interface FraudEvidence {
  id: string;
  type: string;
  reference: string;
  summary: string;
  collectedAt: Date;
  collectedBy: string;
  metadata: Readonly<Record<string, string>>;
}

export interface FraudCaseNote {
  id: string;
  authorId: string;
  text: string;
  createdAt: Date;
  visibility: "internal" | "player";
}

export interface FraudCase {
  id: string;
  playerId: string;
  title: string;
  priority: FraudCasePriority;
  status: FraudCaseStatus;
  assignedTo?: string;
  labels: readonly string[];
  evidence: readonly FraudEvidence[];
  notes: readonly FraudCaseNote[];
  openedAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  resolution?: string;
  version: number;
}

export class FraudCaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FraudCaseConflictError";
  }
}

export class FraudCaseService {
  private readonly cases = new Map<string, FraudCase>();

  open(playerId: string, title: string, priority: FraudCasePriority, labels: readonly string[] = [], at = new Date()): FraudCase {
    const now = validDate(at);
    const fraudCase: FraudCase = {
      id: randomUUID(),
      playerId: required(playerId, "player id"),
      title: required(title, "case title"),
      priority,
      status: "open",
      labels: [...new Set(labels.map((label) => required(label, "case label")))].sort(),
      evidence: [],
      notes: [],
      openedAt: now,
      updatedAt: now,
      version: 1,
    };
    this.cases.set(fraudCase.id, fraudCase);
    return cloneCase(fraudCase);
  }

  assign(caseId: string, expectedVersion: number, operatorId: string, at = new Date()): FraudCase {
    const current = this.requireVersion(caseId, expectedVersion);
    return this.save({
      ...current,
      assignedTo: required(operatorId, "operator id"),
      status: current.status === "open" ? "investigating" : current.status,
      updatedAt: validDate(at),
      version: current.version + 1,
    });
  }

  addEvidence(
    caseId: string,
    expectedVersion: number,
    input: Omit<FraudEvidence, "id">,
    at = new Date(),
  ): FraudCase {
    const current = this.requireOpenVersion(caseId, expectedVersion);
    const duplicate = current.evidence.find((item) => item.type === input.type && item.reference === input.reference);
    if (duplicate) return cloneCase(current);
    const evidence: FraudEvidence = {
      ...input,
      id: randomUUID(),
      type: required(input.type, "evidence type"),
      reference: required(input.reference, "evidence reference"),
      summary: required(input.summary, "evidence summary"),
      collectedBy: required(input.collectedBy, "evidence collector"),
      collectedAt: validDate(input.collectedAt),
      metadata: { ...input.metadata },
    };
    return this.save({
      ...current,
      evidence: [...current.evidence, evidence],
      updatedAt: validDate(at),
      version: current.version + 1,
    });
  }

  addNote(
    caseId: string,
    expectedVersion: number,
    authorId: string,
    text: string,
    visibility: FraudCaseNote["visibility"] = "internal",
    at = new Date(),
  ): FraudCase {
    const current = this.requireOpenVersion(caseId, expectedVersion);
    const note: FraudCaseNote = {
      id: randomUUID(),
      authorId: required(authorId, "note author"),
      text: required(text, "note text"),
      visibility,
      createdAt: validDate(at),
    };
    return this.save({
      ...current,
      notes: [...current.notes, note],
      updatedAt: note.createdAt,
      version: current.version + 1,
    });
  }

  setWaiting(caseId: string, expectedVersion: number, at = new Date()): FraudCase {
    const current = this.requireOpenVersion(caseId, expectedVersion);
    if (!current.assignedTo) throw new FraudCaseConflictError("case must be assigned before contacting the player");
    return this.save({ ...current, status: "waiting_for_player", updatedAt: validDate(at), version: current.version + 1 });
  }

  resume(caseId: string, expectedVersion: number, at = new Date()): FraudCase {
    const current = this.requireVersion(caseId, expectedVersion);
    if (current.status !== "waiting_for_player") throw new FraudCaseConflictError("case is not waiting for the player");
    return this.save({ ...current, status: "investigating", updatedAt: validDate(at), version: current.version + 1 });
  }

  resolve(caseId: string, expectedVersion: number, resolution: string, dismissed = false, at = new Date()): FraudCase {
    const current = this.requireOpenVersion(caseId, expectedVersion);
    if (!current.assignedTo) throw new FraudCaseConflictError("case must be assigned before resolution");
    if (current.evidence.length === 0 && !dismissed) throw new FraudCaseConflictError("confirmed fraud requires evidence");
    const resolvedAt = validDate(at);
    return this.save({
      ...current,
      status: dismissed ? "dismissed" : "resolved",
      resolution: required(resolution, "case resolution"),
      resolvedAt,
      updatedAt: resolvedAt,
      version: current.version + 1,
    });
  }

  list(options: { playerId?: string; status?: FraudCaseStatus; assignedTo?: string } = {}): readonly FraudCase[] {
    return [...this.cases.values()]
      .filter((item) => !options.playerId || item.playerId === options.playerId)
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.assignedTo || item.assignedTo === options.assignedTo)
      .sort((left, right) => priorityRank(right.priority) - priorityRank(left.priority) || left.openedAt.getTime() - right.openedAt.getTime())
      .map(cloneCase);
  }

  private requireVersion(caseId: string, expectedVersion: number): FraudCase {
    const current = this.cases.get(required(caseId, "case id"));
    if (!current) throw new FraudValidationError("fraud case does not exist");
    if (current.version !== expectedVersion) throw new FraudCaseConflictError("fraud case version does not match");
    return current;
  }

  private requireOpenVersion(caseId: string, expectedVersion: number): FraudCase {
    const current = this.requireVersion(caseId, expectedVersion);
    if (["resolved", "dismissed"].includes(current.status)) throw new FraudCaseConflictError("fraud case is closed");
    return current;
  }

  private save(value: FraudCase): FraudCase {
    this.cases.set(value.id, value);
    return cloneCase(value);
  }
}

function required(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new FraudValidationError(`${field} is required`);
  return value.trim();
}

function validDate(value: Date): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new FraudValidationError("case time is invalid");
  return date;
}

function priorityRank(priority: FraudCasePriority): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[priority];
}

function cloneCase(value: FraudCase): FraudCase {
  return {
    ...value,
    labels: [...value.labels],
    evidence: value.evidence.map((item) => ({ ...item, collectedAt: new Date(item.collectedAt), metadata: { ...item.metadata } })),
    notes: value.notes.map((item) => ({ ...item, createdAt: new Date(item.createdAt) })),
    openedAt: new Date(value.openedAt),
    updatedAt: new Date(value.updatedAt),
    resolvedAt: value.resolvedAt ? new Date(value.resolvedAt) : undefined,
  };
}

