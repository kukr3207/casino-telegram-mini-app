import { createHash } from "node:crypto";

import {
  type CaseEvidence,
  type CaseNote,
  type MonitoringAlert,
  type RegulatoryCase,
  type RegulatoryCaseStatus,
  RegulatoryConflictError,
  RegulatoryValidationError,
  regulatoryDate,
  regulatoryText,
} from "./types.ts";

export interface CreateCaseInput {
  id: string;
  playerId: string;
  kind: RegulatoryCase["kind"];
  priority: RegulatoryCase["priority"];
  subject: string;
  summary: string;
  alertIds?: readonly string[];
  ownerId?: string;
  openedAt?: Date;
  dueAt?: Date;
}

export interface CaseSearch {
  playerId?: string;
  kind?: RegulatoryCase["kind"];
  status?: RegulatoryCaseStatus;
  priority?: RegulatoryCase["priority"];
  ownerId?: string;
  dueBefore?: Date;
  includeClosed?: boolean;
}

export interface CaseWorkload {
  ownerId: string;
  open: number;
  overdue: number;
  urgent: number;
  waiting: number;
}

const transitions: Readonly<
  Record<RegulatoryCaseStatus, readonly RegulatoryCaseStatus[]>
> = {
  open: ["investigating", "dismissed"],
  investigating: ["waiting", "reported", "closed", "dismissed"],
  waiting: ["investigating", "reported", "closed", "dismissed"],
  reported: ["investigating", "closed"],
  closed: [],
  dismissed: [],
};

export class RegulatoryCaseService {
  readonly #cases = new Map<string, RegulatoryCase>();
  readonly #evidenceChecksums = new Map<string, string>();

  create(input: CreateCaseInput): RegulatoryCase {
    const id = regulatoryText(input.id, "case id");
    if (this.#cases.has(id))
      throw new RegulatoryConflictError("regulatory case already exists");
    const openedAt = input.openedAt ?? new Date();
    const dueAt = input.dueAt;
    if (dueAt && dueAt <= openedAt)
      throw new RegulatoryValidationError(
        "case due time must follow its opening time",
      );
    const value: RegulatoryCase = {
      id,
      playerId: regulatoryText(input.playerId, "player id"),
      kind: input.kind,
      status: "open",
      priority: input.priority,
      alertIds: uniqueText(input.alertIds ?? [], "alert id"),
      ownerId: input.ownerId
        ? regulatoryText(input.ownerId, "owner id")
        : undefined,
      subject: regulatoryText(input.subject, "case subject"),
      summary: regulatoryText(input.summary, "case summary"),
      openedAt: openedAt.toISOString(),
      dueAt: dueAt?.toISOString(),
      notes: [],
      evidence: [],
      version: 1,
    };
    this.#cases.set(id, value);
    return cloneCase(value);
  }

  createFromAlert(
    alert: MonitoringAlert,
    id: string,
    ownerId?: string,
    at = new Date(),
  ): RegulatoryCase {
    const priority: RegulatoryCase["priority"] =
      alert.severity === "critical"
        ? "urgent"
        : alert.severity === "high"
          ? "high"
          : "normal";
    return this.create({
      id,
      playerId: alert.playerId,
      kind: alert.reason.includes("responsible")
        ? "responsible_play"
        : alert.reason.includes("sanction")
          ? "sanctions"
          : "aml",
      priority,
      subject: `${alert.severity.toUpperCase()} monitoring alert`,
      summary: alert.reason,
      alertIds: [alert.id],
      ownerId,
      openedAt: at,
      dueAt: new Date(
        at.getTime() +
          (priority === "urgent" ? 4 : priority === "high" ? 24 : 72) *
            3_600_000,
      ),
    });
  }

  assign(id: string, ownerId: string, expectedVersion: number): RegulatoryCase {
    return this.#change(id, expectedVersion, (value) => ({
      ...value,
      ownerId: regulatoryText(ownerId, "owner id"),
    }));
  }

  addAlerts(
    id: string,
    alertIds: readonly string[],
    expectedVersion: number,
  ): RegulatoryCase {
    return this.#change(id, expectedVersion, (value) => ({
      ...value,
      alertIds: [
        ...new Set([...value.alertIds, ...uniqueText(alertIds, "alert id")]),
      ],
    }));
  }

  addNote(
    id: string,
    input: Omit<CaseNote, "createdAt"> & { createdAt?: string },
    expectedVersion: number,
  ): RegulatoryCase {
    return this.#change(id, expectedVersion, (value) => {
      if (value.notes.some((note) => note.id === input.id))
        throw new RegulatoryConflictError("case note already exists");
      const note: CaseNote = {
        id: regulatoryText(input.id, "note id"),
        authorId: regulatoryText(input.authorId, "note author"),
        body: regulatoryText(input.body, "note body"),
        private: Boolean(input.private),
        createdAt: regulatoryDate(
          input.createdAt ?? new Date().toISOString(),
          "note time",
        ).toISOString(),
      };
      if (new Date(note.createdAt) < new Date(value.openedAt))
        throw new RegulatoryValidationError("note cannot predate the case");
      return {
        ...value,
        notes: [...value.notes, note].sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt),
        ),
      };
    });
  }

  addEvidence(
    id: string,
    input: CaseEvidence,
    expectedVersion: number,
  ): RegulatoryCase {
    return this.#change(id, expectedVersion, (value) => {
      if (value.evidence.some((item) => item.id === input.id))
        throw new RegulatoryConflictError("case evidence already exists");
      const evidence = validateEvidence(input);
      const checksumOwner = this.#evidenceChecksums.get(evidence.checksum);
      if (checksumOwner && checksumOwner !== value.id)
        throw new RegulatoryConflictError(
          "evidence is already attached to another case",
        );
      this.#evidenceChecksums.set(evidence.checksum, value.id);
      return {
        ...value,
        evidence: [...value.evidence, evidence].sort((left, right) =>
          left.collectedAt.localeCompare(right.collectedAt),
        ),
      };
    });
  }

  attachDocument(
    id: string,
    documentId: string,
    content: Uint8Array,
    collectedBy: string,
    expectedVersion: number,
    at = new Date(),
  ): RegulatoryCase {
    if (content.byteLength === 0)
      throw new RegulatoryValidationError("evidence document is empty");
    return this.addEvidence(
      id,
      {
        id: regulatoryText(documentId, "document id"),
        kind: "document",
        reference: documentId,
        checksum: createHash("sha256").update(content).digest("hex"),
        collectedBy,
        collectedAt: at.toISOString(),
      },
      expectedVersion,
    );
  }

  transition(
    id: string,
    status: RegulatoryCaseStatus,
    expectedVersion: number,
    options: { outcome?: string; at?: Date } = {},
  ): RegulatoryCase {
    return this.#change(id, expectedVersion, (value) => {
      if (!transitions[value.status].includes(status))
        throw new RegulatoryConflictError(
          `case cannot move from ${value.status} to ${status}`,
        );
      const terminal = status === "closed" || status === "dismissed";
      if (terminal && !options.outcome?.trim())
        throw new RegulatoryValidationError(
          "terminal cases require an outcome",
        );
      if (status === "reported" && value.evidence.length === 0)
        throw new RegulatoryValidationError("reported cases require evidence");
      return {
        ...value,
        status,
        outcome: terminal
          ? regulatoryText(options.outcome!, "case outcome")
          : value.outcome,
        closedAt: terminal
          ? (options.at ?? new Date()).toISOString()
          : undefined,
      };
    });
  }

  reopen(
    id: string,
    reason: string,
    actorId: string,
    expectedVersion: number,
    at = new Date(),
  ): RegulatoryCase {
    return this.#change(id, expectedVersion, (value) => {
      if (!["closed", "dismissed"].includes(value.status))
        throw new RegulatoryConflictError(
          "only terminal cases can be reopened",
        );
      const note: CaseNote = {
        id: `reopen_${value.version + 1}`,
        authorId: regulatoryText(actorId, "actor id"),
        body: `Reopened: ${regulatoryText(reason, "reopen reason")}`,
        private: true,
        createdAt: at.toISOString(),
      };
      return {
        ...value,
        status: "investigating",
        closedAt: undefined,
        outcome: undefined,
        notes: [...value.notes, note],
      };
    });
  }

  get(id: string): RegulatoryCase | undefined {
    const value = this.#cases.get(id.trim());
    return value ? cloneCase(value) : undefined;
  }

  search(
    filters: CaseSearch = {},
    now = new Date(),
  ): readonly RegulatoryCase[] {
    return [...this.#cases.values()]
      .filter(
        (value) =>
          filters.includeClosed ||
          !["closed", "dismissed"].includes(value.status),
      )
      .filter(
        (value) => !filters.playerId || value.playerId === filters.playerId,
      )
      .filter((value) => !filters.kind || value.kind === filters.kind)
      .filter((value) => !filters.status || value.status === filters.status)
      .filter(
        (value) => !filters.priority || value.priority === filters.priority,
      )
      .filter((value) => !filters.ownerId || value.ownerId === filters.ownerId)
      .filter(
        (value) =>
          !filters.dueBefore ||
          (value.dueAt !== undefined &&
            new Date(value.dueAt) < filters.dueBefore),
      )
      .sort(
        (left, right) =>
          priorityRank(right.priority) - priorityRank(left.priority) ||
          dueTime(left, now) - dueTime(right, now) ||
          left.openedAt.localeCompare(right.openedAt),
      )
      .map(cloneCase);
  }

  overdue(now = new Date()): readonly RegulatoryCase[] {
    return this.search({ dueBefore: now }).filter(
      (value) => !["closed", "dismissed"].includes(value.status),
    );
  }

  workload(): readonly CaseWorkload[] {
    const rows = new Map<string, CaseWorkload>();
    const now = new Date();
    for (const value of this.search()) {
      const ownerId = value.ownerId ?? "unassigned";
      const current = rows.get(ownerId) ?? {
        ownerId,
        open: 0,
        overdue: 0,
        urgent: 0,
        waiting: 0,
      };
      current.open += 1;
      if (value.dueAt && new Date(value.dueAt) < now) current.overdue += 1;
      if (value.priority === "urgent") current.urgent += 1;
      if (value.status === "waiting") current.waiting += 1;
      rows.set(ownerId, current);
    }
    return [...rows.values()].sort(
      (left, right) =>
        right.open - left.open || left.ownerId.localeCompare(right.ownerId),
    );
  }

  #change(
    id: string,
    expectedVersion: number,
    change: (value: RegulatoryCase) => RegulatoryCase,
  ): RegulatoryCase {
    const current = this.#cases.get(regulatoryText(id, "case id"));
    if (!current)
      throw new RegulatoryValidationError("regulatory case does not exist");
    if (current.version !== expectedVersion)
      throw new RegulatoryConflictError(
        "regulatory case version does not match",
      );
    const changed = { ...change(current), version: current.version + 1 };
    this.#cases.set(changed.id, changed);
    return cloneCase(changed);
  }
}

function validateEvidence(input: CaseEvidence): CaseEvidence {
  const checksum = regulatoryText(
    input.checksum,
    "evidence checksum",
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum))
    throw new RegulatoryValidationError("evidence checksum must be SHA-256");
  return {
    ...input,
    id: regulatoryText(input.id, "evidence id"),
    reference: regulatoryText(input.reference, "evidence reference"),
    checksum,
    collectedBy: regulatoryText(input.collectedBy, "evidence collector"),
    collectedAt: regulatoryDate(
      input.collectedAt,
      "evidence collection time",
    ).toISOString(),
  };
}

function uniqueText(values: readonly string[], field: string): string[] {
  return [...new Set(values.map((value) => regulatoryText(value, field)))];
}
function priorityRank(value: RegulatoryCase["priority"]): number {
  return value === "urgent"
    ? 4
    : value === "high"
      ? 3
      : value === "normal"
        ? 2
        : 1;
}
function dueTime(value: RegulatoryCase, now: Date): number {
  return value.dueAt
    ? new Date(value.dueAt).getTime()
    : now.getTime() + 315_360_000_000;
}
function cloneCase(value: RegulatoryCase): RegulatoryCase {
  return {
    ...value,
    alertIds: [...value.alertIds],
    notes: value.notes.map((note) => ({ ...note })),
    evidence: value.evidence.map((evidence) => ({ ...evidence })),
  };
}
