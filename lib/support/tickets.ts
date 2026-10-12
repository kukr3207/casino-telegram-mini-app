import { randomUUID } from "node:crypto";

export type TicketStatus = "new" | "open" | "waiting_on_player" | "waiting_on_team" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface SupportMessage {
  id: string;
  authorType: "player" | "agent" | "system";
  authorId: string;
  body: string;
  attachments: readonly string[];
  createdAt: Date;
  internal: boolean;
}

export interface SupportTicket {
  id: string;
  playerId: string;
  category: string;
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTeam?: string;
  assignedAgent?: string;
  tags: readonly string[];
  messages: readonly SupportMessage[];
  linkedReferences: readonly string[];
  createdAt: Date;
  updatedAt: Date;
  firstResponseAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  resolution?: string;
  version: number;
}

export class SupportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportValidationError";
  }
}

export class SupportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportConflictError";
  }
}

export class SupportTicketService {
  private readonly tickets = new Map<string, SupportTicket>();

  open(
    playerId: string,
    category: string,
    subject: string,
    message: string,
    options: { priority?: TicketPriority; references?: readonly string[]; attachments?: readonly string[]; at?: Date } = {},
  ): SupportTicket {
    const now = validDate(options.at ?? new Date());
    const initial: SupportMessage = {
      id: randomUUID(),
      authorType: "player",
      authorId: required(playerId, "player id"),
      body: required(message, "ticket message"),
      attachments: normalizedList(options.attachments ?? []),
      createdAt: now,
      internal: false,
    };
    const ticket: SupportTicket = {
      id: randomUUID(),
      playerId: initial.authorId,
      category: required(category, "ticket category").toLowerCase(),
      subject: required(subject, "ticket subject"),
      priority: options.priority ?? "normal",
      status: "new",
      tags: [],
      messages: [initial],
      linkedReferences: normalizedList(options.references ?? []),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.tickets.set(ticket.id, ticket);
    return cloneTicket(ticket);
  }

  assign(
    ticketId: string,
    expectedVersion: number,
    team: string,
    agent?: string,
    at = new Date(),
  ): SupportTicket {
    const current = this.requireActiveVersion(ticketId, expectedVersion);
    return this.save({
      ...current,
      assignedTeam: required(team, "support team"),
      assignedAgent: agent ? required(agent, "support agent") : undefined,
      status: current.status === "new" ? "open" : current.status,
      updatedAt: validDate(at),
      version: current.version + 1,
    });
  }

  addMessage(
    ticketId: string,
    expectedVersion: number,
    authorType: SupportMessage["authorType"],
    authorId: string,
    body: string,
    options: { internal?: boolean; attachments?: readonly string[]; at?: Date } = {},
  ): SupportTicket {
    const current = this.requireActiveVersion(ticketId, expectedVersion);
    if (authorType === "player" && options.internal) throw new SupportValidationError("player messages cannot be internal");
    const message: SupportMessage = {
      id: randomUUID(),
      authorType,
      authorId: required(authorId, "message author"),
      body: required(body, "message body"),
      attachments: normalizedList(options.attachments ?? []),
      createdAt: validDate(options.at ?? new Date()),
      internal: Boolean(options.internal),
    };
    const firstResponseAt = current.firstResponseAt
      ?? (authorType === "agent" && !message.internal ? message.createdAt : undefined);
    const status = message.internal
      ? current.status
      : authorType === "player"
        ? "waiting_on_team"
        : "waiting_on_player";
    return this.save({
      ...current,
      messages: [...current.messages, message],
      firstResponseAt,
      status,
      updatedAt: message.createdAt,
      version: current.version + 1,
    });
  }

  tag(ticketId: string, expectedVersion: number, tags: readonly string[], at = new Date()): SupportTicket {
    const current = this.requireActiveVersion(ticketId, expectedVersion);
    return this.save({
      ...current,
      tags: normalizedList([...current.tags, ...tags]).map((tag) => tag.toLowerCase()).sort(),
      updatedAt: validDate(at),
      version: current.version + 1,
    });
  }

  link(ticketId: string, expectedVersion: number, references: readonly string[], at = new Date()): SupportTicket {
    const current = this.requireActiveVersion(ticketId, expectedVersion);
    return this.save({
      ...current,
      linkedReferences: normalizedList([...current.linkedReferences, ...references]),
      updatedAt: validDate(at),
      version: current.version + 1,
    });
  }

  resolve(ticketId: string, expectedVersion: number, resolution: string, at = new Date()): SupportTicket {
    const current = this.requireActiveVersion(ticketId, expectedVersion);
    if (!current.assignedTeam) throw new SupportConflictError("ticket must be assigned before resolution");
    const resolvedAt = validDate(at);
    return this.save({
      ...current,
      status: "resolved",
      resolution: required(resolution, "ticket resolution"),
      resolvedAt,
      updatedAt: resolvedAt,
      version: current.version + 1,
    });
  }

  reopen(ticketId: string, expectedVersion: number, message: string, at = new Date()): SupportTicket {
    const current = this.requireVersion(ticketId, expectedVersion);
    if (!(["resolved", "closed"] as string[]).includes(current.status)) throw new SupportConflictError("only resolved tickets can reopen");
    const now = validDate(at);
    const reopened: SupportTicket = {
      ...current,
      status: "waiting_on_team",
      resolvedAt: undefined,
      closedAt: undefined,
      resolution: undefined,
      messages: [...current.messages, {
        id: randomUUID(),
        authorType: "player",
        authorId: current.playerId,
        body: required(message, "reopen message"),
        attachments: [],
        createdAt: now,
        internal: false,
      }],
      updatedAt: now,
      version: current.version + 1,
    };
    return this.save(reopened);
  }

  closeResolved(before: Date, at = new Date()): number {
    const cutoff = validDate(before);
    const closedAt = validDate(at);
    let count = 0;
    for (const ticket of this.tickets.values()) {
      if (ticket.status !== "resolved" || !ticket.resolvedAt || ticket.resolvedAt > cutoff) continue;
      this.tickets.set(ticket.id, {
        ...ticket,
        status: "closed",
        closedAt,
        updatedAt: closedAt,
        version: ticket.version + 1,
      });
      count += 1;
    }
    return count;
  }

  list(options: { playerId?: string; status?: TicketStatus; team?: string; priority?: TicketPriority } = {}): readonly SupportTicket[] {
    return [...this.tickets.values()]
      .filter((ticket) => !options.playerId || ticket.playerId === options.playerId)
      .filter((ticket) => !options.status || ticket.status === options.status)
      .filter((ticket) => !options.team || ticket.assignedTeam === options.team)
      .filter((ticket) => !options.priority || ticket.priority === options.priority)
      .sort((left, right) => priorityRank(right.priority) - priorityRank(left.priority) || left.createdAt.getTime() - right.createdAt.getTime())
      .map(cloneTicket);
  }

  private requireVersion(ticketId: string, expectedVersion: number): SupportTicket {
    const ticket = this.tickets.get(required(ticketId, "ticket id"));
    if (!ticket) throw new SupportValidationError("support ticket does not exist");
    if (ticket.version !== expectedVersion) throw new SupportConflictError("support ticket version does not match");
    return ticket;
  }

  private requireActiveVersion(ticketId: string, expectedVersion: number): SupportTicket {
    const ticket = this.requireVersion(ticketId, expectedVersion);
    if (ticket.status === "closed") throw new SupportConflictError("support ticket is closed");
    return ticket;
  }

  private save(ticket: SupportTicket): SupportTicket {
    this.tickets.set(ticket.id, ticket);
    return cloneTicket(ticket);
  }
}

export function required(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new SupportValidationError(`${field} is required`);
  return value.trim();
}

export function validDate(value: Date): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new SupportValidationError("date is invalid");
  return date;
}

function normalizedList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => required(value, "list value")))];
}

function priorityRank(value: TicketPriority): number {
  return { low: 0, normal: 1, high: 2, urgent: 3 }[value];
}

function cloneTicket(value: SupportTicket): SupportTicket {
  return {
    ...value,
    tags: [...value.tags],
    linkedReferences: [...value.linkedReferences],
    messages: value.messages.map((message) => ({ ...message, attachments: [...message.attachments], createdAt: new Date(message.createdAt) })),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    firstResponseAt: value.firstResponseAt ? new Date(value.firstResponseAt) : undefined,
    resolvedAt: value.resolvedAt ? new Date(value.resolvedAt) : undefined,
    closedAt: value.closedAt ? new Date(value.closedAt) : undefined,
  };
}

