import { randomUUID } from "node:crypto";

export type ReportReason = "technical_issue" | "incorrect_outcome" | "abusive_player" | "fairness_concern" | "other";
export type ReportStatus = "open" | "triaged" | "investigating" | "resolved" | "dismissed";

export interface GameReportMessage {
  id: string;
  author: "player" | "operator" | "system";
  authorId: string;
  text: string;
  createdAt: Date;
  attachments: readonly string[];
}

export interface GameReport {
  id: string;
  playerId: string;
  gameId: string;
  roundId: string;
  reason: ReportReason;
  status: ReportStatus;
  summary: string;
  messages: readonly GameReportMessage[];
  assignedTo?: string;
  resolution?: string;
  openedAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  version: number;
}

export class PlayerFeatureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerFeatureValidationError";
  }
}

export class PlayerFeatureConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerFeatureConflictError";
  }
}

export class GameReportService {
  private readonly reports = new Map<string, GameReport>();
  private readonly activeRoundReports = new Map<string, string>();

  open(
    playerId: string,
    gameId: string,
    roundId: string,
    reason: ReportReason,
    summary: string,
    at = new Date(),
  ): GameReport {
    const activeKey = `${required(playerId, "player id")}:${required(roundId, "round id")}`;
    const existingId = this.activeRoundReports.get(activeKey);
    if (existingId) return cloneReport(this.reports.get(existingId)!);
    const now = validDate(at);
    const report: GameReport = {
      id: randomUUID(),
      playerId: playerId.trim(),
      gameId: required(gameId, "game id"),
      roundId: roundId.trim(),
      reason,
      status: "open",
      summary: required(summary, "report summary"),
      messages: [],
      openedAt: now,
      updatedAt: now,
      version: 1,
    };
    this.reports.set(report.id, report);
    this.activeRoundReports.set(activeKey, report.id);
    return cloneReport(report);
  }

  addMessage(
    reportId: string,
    expectedVersion: number,
    author: GameReportMessage["author"],
    authorId: string,
    text: string,
    attachments: readonly string[] = [],
    at = new Date(),
  ): GameReport {
    const current = this.requireOpenVersion(reportId, expectedVersion);
    const message: GameReportMessage = {
      id: randomUUID(),
      author,
      authorId: required(authorId, "message author"),
      text: required(text, "message text"),
      createdAt: validDate(at),
      attachments: [...new Set(attachments.map((item) => required(item, "attachment")))],
    };
    return this.save({
      ...current,
      messages: [...current.messages, message],
      updatedAt: message.createdAt,
      version: current.version + 1,
    });
  }

  assign(reportId: string, expectedVersion: number, operatorId: string, at = new Date()): GameReport {
    const current = this.requireOpenVersion(reportId, expectedVersion);
    return this.save({
      ...current,
      assignedTo: required(operatorId, "operator id"),
      status: current.status === "open" ? "triaged" : current.status,
      updatedAt: validDate(at),
      version: current.version + 1,
    });
  }

  investigate(reportId: string, expectedVersion: number, at = new Date()): GameReport {
    const current = this.requireOpenVersion(reportId, expectedVersion);
    if (!current.assignedTo) throw new PlayerFeatureConflictError("report must be assigned before investigation");
    return this.save({ ...current, status: "investigating", updatedAt: validDate(at), version: current.version + 1 });
  }

  close(
    reportId: string,
    expectedVersion: number,
    resolution: string,
    dismissed = false,
    at = new Date(),
  ): GameReport {
    const current = this.requireOpenVersion(reportId, expectedVersion);
    if (!current.assignedTo) throw new PlayerFeatureConflictError("report must be assigned before closure");
    const closedAt = validDate(at);
    const report = this.save({
      ...current,
      status: dismissed ? "dismissed" : "resolved",
      resolution: required(resolution, "report resolution"),
      closedAt,
      updatedAt: closedAt,
      version: current.version + 1,
    });
    this.activeRoundReports.delete(`${current.playerId}:${current.roundId}`);
    return report;
  }

  listForPlayer(playerId: string, includeClosed = true): readonly GameReport[] {
    return [...this.reports.values()]
      .filter((report) => report.playerId === playerId.trim())
      .filter((report) => includeClosed || !["resolved", "dismissed"].includes(report.status))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map(cloneReport);
  }

  private requireOpenVersion(reportId: string, expectedVersion: number): GameReport {
    const report = this.reports.get(required(reportId, "report id"));
    if (!report) throw new PlayerFeatureValidationError("game report does not exist");
    if (report.version !== expectedVersion) throw new PlayerFeatureConflictError("game report version does not match");
    if (["resolved", "dismissed"].includes(report.status)) throw new PlayerFeatureConflictError("game report is closed");
    return report;
  }

  private save(report: GameReport): GameReport {
    this.reports.set(report.id, report);
    return cloneReport(report);
  }
}

export function required(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PlayerFeatureValidationError(`${field} is required`);
  return value.trim();
}

export function validDate(value: Date): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new PlayerFeatureValidationError("date is invalid");
  return date;
}

function cloneReport(report: GameReport): GameReport {
  return {
    ...report,
    messages: report.messages.map((message) => ({
      ...message,
      createdAt: new Date(message.createdAt),
      attachments: [...message.attachments],
    })),
    openedAt: new Date(report.openedAt),
    updatedAt: new Date(report.updatedAt),
    closedAt: report.closedAt ? new Date(report.closedAt) : undefined,
  };
}

