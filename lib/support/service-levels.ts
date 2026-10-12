import type { SupportTicket, TicketPriority } from "./tickets.ts";
import { SupportValidationError } from "./tickets.ts";

export interface ServiceLevelPolicy {
  priority: TicketPriority;
  firstResponseMs: number;
  resolutionMs: number;
  businessHoursOnly: boolean;
}

export interface ServiceLevelState {
  ticketId: string;
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  completed: boolean;
}

export interface BusinessCalendar {
  isBusinessTime(at: Date): boolean;
  addBusinessMilliseconds(start: Date, milliseconds: number): Date;
}

export class WeeklyBusinessCalendar implements BusinessCalendar {
  readonly openingHourUtc: number;
  readonly closingHourUtc: number;
  readonly workingDays: readonly number[];

  constructor(
    openingHourUtc = 9,
    closingHourUtc = 17,
    workingDays: readonly number[] = [1, 2, 3, 4, 5],
  ) {
    if (!Number.isInteger(openingHourUtc) || !Number.isInteger(closingHourUtc) || openingHourUtc < 0 || closingHourUtc > 24 || openingHourUtc >= closingHourUtc) {
      throw new SupportValidationError("business hours are invalid");
    }
    this.openingHourUtc = openingHourUtc;
    this.closingHourUtc = closingHourUtc;
    this.workingDays = [...workingDays];
  }

  isBusinessTime(at: Date): boolean {
    return this.workingDays.includes(at.getUTCDay())
      && at.getUTCHours() >= this.openingHourUtc
      && at.getUTCHours() < this.closingHourUtc;
  }

  addBusinessMilliseconds(start: Date, milliseconds: number): Date {
    if (!Number.isInteger(milliseconds) || milliseconds < 0) throw new SupportValidationError("business duration is invalid");
    let remaining = milliseconds;
    let cursor = new Date(start);
    while (remaining > 0) {
      if (!this.isBusinessTime(cursor)) {
        cursor = this.nextBusinessStart(cursor);
        continue;
      }
      const close = new Date(cursor);
      close.setUTCHours(this.closingHourUtc, 0, 0, 0);
      const available = close.getTime() - cursor.getTime();
      const consumed = Math.min(available, remaining);
      cursor = new Date(cursor.getTime() + consumed);
      remaining -= consumed;
      if (remaining > 0) cursor = this.nextBusinessStart(cursor);
    }
    return cursor;
  }

  private nextBusinessStart(after: Date): Date {
    const cursor = new Date(after);
    cursor.setUTCMinutes(0, 0, 0);
    if (this.workingDays.includes(cursor.getUTCDay()) && cursor.getUTCHours() < this.openingHourUtc) {
      cursor.setUTCHours(this.openingHourUtc);
      return cursor;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(this.openingHourUtc, 0, 0, 0);
    while (!this.workingDays.includes(cursor.getUTCDay())) cursor.setUTCDate(cursor.getUTCDate() + 1);
    return cursor;
  }
}

export class SupportServiceLevels {
  private readonly policies = new Map<TicketPriority, ServiceLevelPolicy>();
  private readonly calendar: BusinessCalendar;

  constructor(calendar: BusinessCalendar = new WeeklyBusinessCalendar()) {
    this.calendar = calendar;
  }

  configure(policy: ServiceLevelPolicy): ServiceLevelPolicy {
    if (!Number.isInteger(policy.firstResponseMs) || policy.firstResponseMs <= 0) throw new SupportValidationError("first-response target must be positive");
    if (!Number.isInteger(policy.resolutionMs) || policy.resolutionMs <= policy.firstResponseMs) throw new SupportValidationError("resolution target must exceed first-response target");
    this.policies.set(policy.priority, { ...policy });
    return { ...policy };
  }

  evaluate(ticket: SupportTicket, at = new Date()): ServiceLevelState {
    const policy = this.policies.get(ticket.priority);
    if (!policy) throw new SupportValidationError(`service-level policy is missing for ${ticket.priority}`);
    const add = policy.businessHoursOnly
      ? (duration: number) => this.calendar.addBusinessMilliseconds(ticket.createdAt, duration)
      : (duration: number) => new Date(ticket.createdAt.getTime() + duration);
    const firstResponseDueAt = add(policy.firstResponseMs);
    const resolutionDueAt = add(policy.resolutionMs);
    return {
      ticketId: ticket.id,
      firstResponseDueAt,
      resolutionDueAt,
      firstResponseBreached: !ticket.firstResponseAt && at > firstResponseDueAt,
      resolutionBreached: !ticket.resolvedAt && at > resolutionDueAt,
      completed: Boolean(ticket.resolvedAt || ticket.closedAt),
    };
  }
}
