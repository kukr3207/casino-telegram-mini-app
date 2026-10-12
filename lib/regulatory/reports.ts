import { createHash } from "node:crypto";

import {
  type RegulatoryRecord,
  type RegulatoryReport,
  RegulatoryConflictError,
  RegulatoryValidationError,
  regulatoryDate,
  regulatoryText,
} from "./types.ts";

export interface ReportGenerationInput {
  id: string;
  jurisdiction: string;
  kind: RegulatoryReport["kind"];
  periodStartsAt: Date;
  periodEndsAt: Date;
  caseIds: readonly string[];
  records: readonly RegulatoryRecord[];
  generatedBy: string;
  generatedAt?: Date;
}

export interface ReportValidation {
  valid: boolean;
  errors: readonly string[];
  warnings: readonly string[];
  duplicateReferences: readonly string[];
  missingFields: Readonly<Record<string, readonly string[]>>;
}

interface StoredReport {
  report: RegulatoryReport;
  records: readonly RegulatoryRecord[];
  approvals: readonly { actorId: string; role: string; at: string }[];
  validation?: ReportValidation;
}

export class RegulatoryReportingService {
  readonly #reports = new Map<string, StoredReport>();

  generate(input: ReportGenerationInput): RegulatoryReport {
    const id = regulatoryText(input.id, "report id");
    if (this.#reports.has(id))
      throw new RegulatoryConflictError("regulatory report already exists");
    if (input.periodEndsAt <= input.periodStartsAt)
      throw new RegulatoryValidationError(
        "report period end must follow start",
      );
    const records = input.records
      .map(validateRecord)
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.reference.localeCompare(right.reference),
      );
    const report: RegulatoryReport = {
      id,
      jurisdiction: regulatoryText(
        input.jurisdiction,
        "jurisdiction",
      ).toUpperCase(),
      kind: input.kind,
      periodStartsAt: input.periodStartsAt.toISOString(),
      periodEndsAt: input.periodEndsAt.toISOString(),
      status: "draft",
      caseIds: [
        ...new Set(
          input.caseIds.map((value) => regulatoryText(value, "case id")),
        ),
      ].sort(),
      recordCount: records.length,
      totals: aggregateTotals(records),
      checksum: reportChecksum(records),
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
      generatedBy: regulatoryText(input.generatedBy, "report generator"),
      version: 1,
    };
    this.#reports.set(id, { report, records, approvals: [] });
    return cloneReport(report);
  }

  validate(
    id: string,
    expectedVersion: number,
  ): { report: RegulatoryReport; validation: ReportValidation } {
    const stored = this.#stored(id, expectedVersion);
    if (stored.report.status !== "draft")
      throw new RegulatoryConflictError("only draft reports can be validated");
    const validation = validateReport(stored.report, stored.records);
    if (!validation.valid)
      return { report: cloneReport(stored.report), validation };
    const report = {
      ...stored.report,
      status: "validated" as const,
      version: stored.report.version + 1,
    };
    this.#reports.set(report.id, { ...stored, report, validation });
    return {
      report: cloneReport(report),
      validation: cloneValidation(validation),
    };
  }

  approve(
    id: string,
    actorId: string,
    role: string,
    expectedVersion: number,
    at = new Date(),
  ): RegulatoryReport {
    const stored = this.#stored(id, expectedVersion);
    if (!["validated", "approved"].includes(stored.report.status))
      throw new RegulatoryConflictError(
        "report must be validated before approval",
      );
    const actor = regulatoryText(actorId, "approver id");
    const normalizedRole = regulatoryText(role, "approver role").toLowerCase();
    if (actor === stored.report.generatedBy)
      throw new RegulatoryConflictError(
        "report generator cannot approve the report",
      );
    if (stored.approvals.some((approval) => approval.actorId === actor))
      throw new RegulatoryConflictError(
        "approver has already approved the report",
      );
    const approvals = [
      ...stored.approvals,
      { actorId: actor, role: normalizedRole, at: at.toISOString() },
    ];
    const independentRoles = new Set(
      approvals.map((approval) => approval.role),
    );
    const fullyApproved = approvals.length >= 2 && independentRoles.size >= 2;
    const report: RegulatoryReport = {
      ...stored.report,
      status: fullyApproved ? "approved" : "validated",
      approvedBy: fullyApproved
        ? approvals.map((approval) => approval.actorId).join(",")
        : undefined,
      version: stored.report.version + 1,
    };
    this.#reports.set(report.id, { ...stored, report, approvals });
    return cloneReport(report);
  }

  submit(
    id: string,
    submissionReference: string,
    expectedVersion: number,
    at = new Date(),
  ): RegulatoryReport {
    return this.#change(id, expectedVersion, (stored) => {
      if (stored.report.status !== "approved")
        throw new RegulatoryConflictError(
          "only approved reports can be submitted",
        );
      return {
        ...stored.report,
        status: "submitted",
        submittedAt: at.toISOString(),
        submissionReference: regulatoryText(
          submissionReference,
          "submission reference",
        ),
      };
    });
  }

  accept(id: string, expectedVersion: number): RegulatoryReport {
    return this.#change(id, expectedVersion, (stored) => {
      if (stored.report.status !== "submitted")
        throw new RegulatoryConflictError(
          "only submitted reports can be accepted",
        );
      return { ...stored.report, status: "accepted" };
    });
  }

  reject(
    id: string,
    reason: string,
    expectedVersion: number,
  ): RegulatoryReport {
    return this.#change(id, expectedVersion, (stored) => {
      if (stored.report.status !== "submitted")
        throw new RegulatoryConflictError(
          "only submitted reports can be rejected",
        );
      return {
        ...stored.report,
        status: "rejected",
        rejectionReason: regulatoryText(reason, "rejection reason"),
      };
    });
  }

  revise(
    id: string,
    records: readonly RegulatoryRecord[],
    expectedVersion: number,
    actorId: string,
    at = new Date(),
  ): RegulatoryReport {
    const stored = this.#stored(id, expectedVersion);
    if (!["draft", "rejected"].includes(stored.report.status))
      throw new RegulatoryConflictError(
        "only draft or rejected reports can be revised",
      );
    const normalized = records
      .map(validateRecord)
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.reference.localeCompare(right.reference),
      );
    const report: RegulatoryReport = {
      ...stored.report,
      status: "draft",
      recordCount: normalized.length,
      totals: aggregateTotals(normalized),
      checksum: reportChecksum(normalized),
      generatedAt: at.toISOString(),
      generatedBy: regulatoryText(actorId, "report generator"),
      approvedBy: undefined,
      submittedAt: undefined,
      submissionReference: undefined,
      rejectionReason: undefined,
      version: stored.report.version + 1,
    };
    this.#reports.set(report.id, {
      report,
      records: normalized,
      approvals: [],
    });
    return cloneReport(report);
  }

  get(id: string): RegulatoryReport | undefined {
    const value = this.#reports.get(id.trim());
    return value ? cloneReport(value.report) : undefined;
  }

  records(id: string): readonly RegulatoryRecord[] {
    const value = this.#reports.get(regulatoryText(id, "report id"));
    if (!value)
      throw new RegulatoryValidationError("regulatory report does not exist");
    return value.records.map(cloneRecord);
  }

  list(
    filters: {
      jurisdiction?: string;
      kind?: RegulatoryReport["kind"];
      status?: RegulatoryReport["status"];
      from?: Date;
      to?: Date;
    } = {},
  ): readonly RegulatoryReport[] {
    return [...this.#reports.values()]
      .map((stored) => stored.report)
      .filter(
        (report) =>
          !filters.jurisdiction ||
          report.jurisdiction === filters.jurisdiction.toUpperCase(),
      )
      .filter((report) => !filters.kind || report.kind === filters.kind)
      .filter((report) => !filters.status || report.status === filters.status)
      .filter(
        (report) =>
          !filters.from || new Date(report.periodEndsAt) > filters.from,
      )
      .filter(
        (report) => !filters.to || new Date(report.periodStartsAt) < filters.to,
      )
      .sort(
        (left, right) =>
          right.periodEndsAt.localeCompare(left.periodEndsAt) ||
          left.id.localeCompare(right.id),
      )
      .map(cloneReport);
  }

  exportJson(id: string): string {
    const stored = this.#reports.get(regulatoryText(id, "report id"));
    if (!stored)
      throw new RegulatoryValidationError("regulatory report does not exist");
    return JSON.stringify(
      {
        report: serializeReport(stored.report),
        records: stored.records.map(serializeRecord),
        approvals: stored.approvals,
      },
      null,
      2,
    );
  }

  exportDelimited(id: string, separator = ","): string {
    if (!separator || separator.includes("\n") || separator.includes('"'))
      throw new RegulatoryValidationError("report separator is invalid");
    const records = this.records(id);
    const fieldNames = [
      ...new Set(records.flatMap((record) => Object.keys(record.fields))),
    ].sort();
    const amountNames = [
      ...new Set(records.flatMap((record) => Object.keys(record.amounts))),
    ].sort();
    const header = [
      "type",
      "reference",
      "occurredAt",
      ...fieldNames,
      ...amountNames.map((name) => `amount:${name}`),
    ];
    const rows = records.map((record) => [
      record.type,
      record.reference,
      record.occurredAt,
      ...fieldNames.map((name) => record.fields[name] ?? ""),
      ...amountNames.map((name) => record.amounts[name]?.toString() ?? ""),
    ]);
    return [header, ...rows]
      .map((row) => row.map(csvCell).join(separator))
      .join("\n");
  }

  #stored(id: string, expectedVersion: number): StoredReport {
    const stored = this.#reports.get(regulatoryText(id, "report id"));
    if (!stored)
      throw new RegulatoryValidationError("regulatory report does not exist");
    if (stored.report.version !== expectedVersion)
      throw new RegulatoryConflictError(
        "regulatory report version does not match",
      );
    return stored;
  }

  #change(
    id: string,
    expectedVersion: number,
    change: (stored: StoredReport) => RegulatoryReport,
  ): RegulatoryReport {
    const stored = this.#stored(id, expectedVersion);
    const report = { ...change(stored), version: stored.report.version + 1 };
    this.#reports.set(report.id, { ...stored, report });
    return cloneReport(report);
  }
}

function validateRecord(value: RegulatoryRecord): RegulatoryRecord {
  const fields: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value.fields)) {
    const name = regulatoryText(key, "record field name");
    if (
      !["string", "number", "boolean"].includes(typeof item) ||
      (typeof item === "number" && !Number.isFinite(item))
    )
      throw new RegulatoryValidationError(`record field ${name} is invalid`);
    fields[name] = item;
  }
  const amounts: Record<string, bigint> = {};
  for (const [key, amount] of Object.entries(value.amounts)) {
    if (typeof amount !== "bigint")
      throw new RegulatoryValidationError("record amounts must use bigint");
    amounts[regulatoryText(key, "amount name")] = amount;
  }
  return {
    type: regulatoryText(value.type, "record type"),
    reference: regulatoryText(value.reference, "record reference"),
    occurredAt: regulatoryDate(value.occurredAt, "record time").toISOString(),
    fields,
    amounts,
  };
}

function validateReport(
  report: RegulatoryReport,
  records: readonly RegulatoryRecord[],
): ReportValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const missingFields: Record<string, string[]> = {};
  for (const record of records) {
    if (seen.has(record.reference)) duplicates.add(record.reference);
    seen.add(record.reference);
    if (
      new Date(record.occurredAt) < new Date(report.periodStartsAt) ||
      new Date(record.occurredAt) >= new Date(report.periodEndsAt)
    )
      errors.push(`record ${record.reference} falls outside report period`);
    if (
      Object.keys(record.fields).length === 0 &&
      Object.keys(record.amounts).length === 0
    )
      missingFields[record.reference] = ["fields", "amounts"];
  }
  if (duplicates.size) errors.push("report contains duplicate references");
  if (Object.keys(missingFields).length)
    errors.push("report contains empty records");
  if (records.length === 0) warnings.push("report has no records");
  if (report.checksum !== reportChecksum(records))
    errors.push("report checksum does not match its records");
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings,
    duplicateReferences: [...duplicates].sort(),
    missingFields,
  };
}

function aggregateTotals(
  records: readonly RegulatoryRecord[],
): Readonly<Record<string, bigint>> {
  const totals: Record<string, bigint> = {};
  for (const record of records)
    for (const [name, amount] of Object.entries(record.amounts))
      totals[name] = (totals[name] ?? 0n) + amount;
  return totals;
}

function reportChecksum(records: readonly RegulatoryRecord[]): string {
  return createHash("sha256")
    .update(JSON.stringify(records.map(serializeRecord)))
    .digest("hex");
}
function serializeRecord(value: RegulatoryRecord): object {
  return {
    ...value,
    amounts: Object.fromEntries(
      Object.entries(value.amounts).map(([key, amount]) => [
        key,
        amount.toString(),
      ]),
    ),
  };
}
function serializeReport(value: RegulatoryReport): object {
  return {
    ...value,
    totals: Object.fromEntries(
      Object.entries(value.totals).map(([key, amount]) => [
        key,
        amount.toString(),
      ]),
    ),
  };
}
function csvCell(value: unknown): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function cloneRecord(value: RegulatoryRecord): RegulatoryRecord {
  return {
    ...value,
    fields: { ...value.fields },
    amounts: { ...value.amounts },
  };
}
function cloneReport(value: RegulatoryReport): RegulatoryReport {
  return { ...value, caseIds: [...value.caseIds], totals: { ...value.totals } };
}
function cloneValidation(value: ReportValidation): ReportValidation {
  return {
    ...value,
    errors: [...value.errors],
    warnings: [...value.warnings],
    duplicateReferences: [...value.duplicateReferences],
    missingFields: Object.fromEntries(
      Object.entries(value.missingFields).map(([key, fields]) => [
        key,
        [...fields],
      ]),
    ),
  };
}
