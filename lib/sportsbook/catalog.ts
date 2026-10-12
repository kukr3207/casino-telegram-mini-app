import {
  type BettingMarket,
  type EventStatus,
  type MarketStatus,
  type Selection,
  type SportEvent,
  SportsbookConflictError,
  SportsbookValidationError,
  parsedDate,
  requiredText,
  validatePrice,
} from "./types.ts";

const terminalEventStatuses = new Set<EventStatus>([
  "finished",
  "cancelled",
  "abandoned",
]);

const eventTransitions: Readonly<Record<EventStatus, readonly EventStatus[]>> =
  {
    scheduled: ["live", "suspended", "cancelled", "abandoned"],
    live: ["suspended", "finished", "abandoned"],
    suspended: ["scheduled", "live", "finished", "cancelled", "abandoned"],
    finished: [],
    cancelled: [],
    abandoned: [],
  };

const marketTransitions: Readonly<
  Record<MarketStatus, readonly MarketStatus[]>
> = {
  open: ["suspended", "closed", "voided"],
  suspended: ["open", "closed", "voided"],
  closed: ["settled", "voided"],
  settled: [],
  voided: [],
};

export interface EventSearch {
  sport?: SportEvent["sport"];
  competitionId?: string;
  statuses?: readonly EventStatus[];
  startsAfter?: Date;
  startsBefore?: Date;
  participant?: string;
}

export interface MarketSearch {
  eventId?: string;
  statuses?: readonly MarketStatus[];
  inPlay?: boolean;
  cashOutEnabled?: boolean;
}

export interface CatalogSnapshot {
  revision: number;
  events: readonly SportEvent[];
  markets: readonly BettingMarket[];
}

export class SportsbookCatalog {
  readonly #events = new Map<string, SportEvent>();
  readonly #markets = new Map<string, BettingMarket>();
  readonly #eventMarkets = new Map<string, Set<string>>();
  readonly #sourceRevisions = new Map<string, number>();
  #revision = 0;

  upsertEvent(value: SportEvent): SportEvent {
    const event = validateEvent(value);
    const current = this.#events.get(event.id);
    if (current && event.sourceRevision < current.sourceRevision) {
      throw new SportsbookConflictError(
        "event source revision moved backwards",
      );
    }
    if (current && event.sourceRevision === current.sourceRevision) {
      if (eventFingerprint(current) !== eventFingerprint(event)) {
        throw new SportsbookConflictError(
          "event source revision contains different data",
        );
      }
      return cloneEvent(current);
    }
    if (
      current &&
      terminalEventStatuses.has(current.status) &&
      event.status !== current.status
    ) {
      throw new SportsbookConflictError("terminal event cannot be reopened");
    }
    const stored: SportEvent = {
      ...event,
      version: (current?.version ?? 0) + 1,
    };
    this.#events.set(stored.id, stored);
    this.#eventMarkets.set(
      stored.id,
      this.#eventMarkets.get(stored.id) ?? new Set(),
    );
    this.#sourceRevisions.set(stored.id, stored.sourceRevision);
    this.#revision += 1;
    return cloneEvent(stored);
  }

  transitionEvent(
    eventId: string,
    expectedVersion: number,
    status: EventStatus,
    live?: { clock?: string; period?: string },
  ): SportEvent {
    const current = this.requireEvent(eventId);
    if (current.version !== expectedVersion) {
      throw new SportsbookConflictError("event version does not match");
    }
    if (status === current.status) return cloneEvent(current);
    if (!eventTransitions[current.status].includes(status)) {
      throw new SportsbookConflictError(
        `cannot move event from ${current.status} to ${status}`,
      );
    }
    const changed: SportEvent = {
      ...current,
      status,
      liveClock: live?.clock?.trim() || current.liveClock,
      livePeriod: live?.period?.trim() || current.livePeriod,
      version: current.version + 1,
    };
    this.#events.set(current.id, changed);
    this.#revision += 1;
    if (terminalEventStatuses.has(status)) {
      this.suspendOpenMarkets(
        current.id,
        status === "finished" ? "closed" : "voided",
      );
    }
    return cloneEvent(changed);
  }

  putMarket(value: BettingMarket): BettingMarket {
    const market = validateMarket(value);
    const event = this.requireEvent(market.eventId);
    if (terminalEventStatuses.has(event.status)) {
      throw new SportsbookConflictError(
        "cannot add a market to a terminal event",
      );
    }
    const current = this.#markets.get(market.id);
    if (current && current.eventId !== market.eventId) {
      throw new SportsbookConflictError("market cannot move to another event");
    }
    if (current && market.sequence < current.sequence) {
      throw new SportsbookConflictError("market sequence moved backwards");
    }
    if (current && market.sequence === current.sequence) {
      if (marketFingerprint(current) !== marketFingerprint(market)) {
        throw new SportsbookConflictError(
          "market sequence contains different data",
        );
      }
      return cloneMarket(current);
    }
    if (current && ["settled", "voided"].includes(current.status)) {
      throw new SportsbookConflictError("terminal market cannot be replaced");
    }
    const stored: BettingMarket = {
      ...market,
      version: (current?.version ?? 0) + 1,
    };
    this.#markets.set(stored.id, stored);
    this.#eventMarkets.get(stored.eventId)!.add(stored.id);
    this.#revision += 1;
    return cloneMarket(stored);
  }

  transitionMarket(
    marketId: string,
    expectedVersion: number,
    status: MarketStatus,
  ): BettingMarket {
    const current = this.requireMarket(marketId);
    if (current.version !== expectedVersion) {
      throw new SportsbookConflictError("market version does not match");
    }
    if (status === current.status) return cloneMarket(current);
    if (!marketTransitions[current.status].includes(status)) {
      throw new SportsbookConflictError(
        `cannot move market from ${current.status} to ${status}`,
      );
    }
    const changed: BettingMarket = {
      ...current,
      status,
      selections: current.selections.map((selection) => ({
        ...selection,
        status: status === "open" ? "active" : "suspended",
        version: selection.version + 1,
      })),
      version: current.version + 1,
    };
    this.#markets.set(current.id, changed);
    this.#revision += 1;
    return cloneMarket(changed);
  }

  event(eventId: string): SportEvent | undefined {
    const value = this.#events.get(eventId.trim());
    return value ? cloneEvent(value) : undefined;
  }

  market(marketId: string): BettingMarket | undefined {
    const value = this.#markets.get(marketId.trim());
    return value ? cloneMarket(value) : undefined;
  }

  selection(marketId: string, selectionId: string): Selection | undefined {
    const market = this.#markets.get(marketId.trim());
    const selection = market?.selections.find(
      (value) => value.id === selectionId.trim(),
    );
    return selection ? cloneSelection(selection) : undefined;
  }

  marketsForEvent(eventId: string): readonly BettingMarket[] {
    const ids = this.#eventMarkets.get(eventId.trim());
    if (!ids) return [];
    return [...ids]
      .map((id) => this.#markets.get(id)!)
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      )
      .map(cloneMarket);
  }

  searchEvents(query: EventSearch = {}): readonly SportEvent[] {
    const participant = query.participant?.trim().toLocaleLowerCase();
    return [...this.#events.values()]
      .filter((event) => !query.sport || event.sport === query.sport)
      .filter(
        (event) =>
          !query.competitionId || event.competitionId === query.competitionId,
      )
      .filter(
        (event) => !query.statuses || query.statuses.includes(event.status),
      )
      .filter(
        (event) =>
          !query.startsAfter || new Date(event.startsAt) >= query.startsAfter,
      )
      .filter(
        (event) =>
          !query.startsBefore || new Date(event.startsAt) < query.startsBefore,
      )
      .filter(
        (event) =>
          !participant ||
          event.participants.some((value) =>
            value.name.toLocaleLowerCase().includes(participant),
          ),
      )
      .sort(
        (left, right) =>
          left.startsAt.localeCompare(right.startsAt) ||
          left.id.localeCompare(right.id),
      )
      .map(cloneEvent);
  }

  searchMarkets(query: MarketSearch = {}): readonly BettingMarket[] {
    return [...this.#markets.values()]
      .filter((market) => !query.eventId || market.eventId === query.eventId)
      .filter(
        (market) => !query.statuses || query.statuses.includes(market.status),
      )
      .filter(
        (market) =>
          query.inPlay === undefined || market.inPlay === query.inPlay,
      )
      .filter(
        (market) =>
          query.cashOutEnabled === undefined ||
          market.cashOutEnabled === query.cashOutEnabled,
      )
      .sort(
        (left, right) =>
          left.eventId.localeCompare(right.eventId) ||
          left.name.localeCompare(right.name),
      )
      .map(cloneMarket);
  }

  snapshot(): CatalogSnapshot {
    return {
      revision: this.#revision,
      events: this.searchEvents(),
      markets: this.searchMarkets(),
    };
  }

  private suspendOpenMarkets(eventId: string, next: "closed" | "voided"): void {
    for (const marketId of this.#eventMarkets.get(eventId) ?? []) {
      const market = this.#markets.get(marketId)!;
      if (!["open", "suspended"].includes(market.status)) continue;
      const changed: BettingMarket = {
        ...market,
        status: next,
        selections: market.selections.map((selection) => ({
          ...selection,
          status: "suspended",
          version: selection.version + 1,
        })),
        version: market.version + 1,
      };
      this.#markets.set(marketId, changed);
      this.#revision += 1;
    }
  }

  private requireEvent(eventId: string): SportEvent {
    const value = this.#events.get(requiredText(eventId, "event id"));
    if (!value) throw new SportsbookValidationError("event does not exist");
    return value;
  }

  private requireMarket(marketId: string): BettingMarket {
    const value = this.#markets.get(requiredText(marketId, "market id"));
    if (!value) throw new SportsbookValidationError("market does not exist");
    return value;
  }
}

export function validateEvent(value: SportEvent): SportEvent {
  const id = requiredText(value.id, "event id");
  const competitionId = requiredText(value.competitionId, "competition id");
  const name = requiredText(value.name, "event name");
  const startsAt = parsedDate(value.startsAt, "event start");
  const expectedEndsAt = value.expectedEndsAt
    ? parsedDate(value.expectedEndsAt, "expected event end")
    : undefined;
  if (expectedEndsAt && expectedEndsAt <= startsAt) {
    throw new SportsbookValidationError(
      "expected event end must follow its start",
    );
  }
  if (!Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1) {
    throw new SportsbookValidationError("source revision must be positive");
  }
  if (value.participants.length < 1) {
    throw new SportsbookValidationError(
      "event requires at least one participant",
    );
  }
  const participantIds = new Set<string>();
  const participants = value.participants.map((participant) => {
    const participantId = requiredText(participant.id, "participant id");
    if (participantIds.has(participantId)) {
      throw new SportsbookValidationError("participant ids must be unique");
    }
    participantIds.add(participantId);
    return {
      ...participant,
      id: participantId,
      name: requiredText(participant.name, "participant name"),
      country: participant.country?.trim().toUpperCase(),
    };
  });
  return {
    ...value,
    id,
    competitionId,
    name,
    startsAt: startsAt.toISOString(),
    expectedEndsAt: expectedEndsAt?.toISOString(),
    participants,
    version: Math.max(0, value.version || 0),
  };
}

export function validateMarket(value: BettingMarket): BettingMarket {
  const id = requiredText(value.id, "market id");
  const eventId = requiredText(value.eventId, "event id");
  const name = requiredText(value.name, "market name");
  const period = requiredText(value.period, "market period");
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) {
    throw new SportsbookValidationError("market sequence must be positive");
  }
  if (value.selections.length < 2) {
    throw new SportsbookValidationError(
      "market requires at least two selections",
    );
  }
  const selectionIds = new Set<string>();
  const selections = value.selections.map((selection) => {
    const selectionId = requiredText(selection.id, "selection id");
    if (selectionIds.has(selectionId)) {
      throw new SportsbookValidationError("selection ids must be unique");
    }
    if (selection.marketId !== id) {
      throw new SportsbookValidationError(
        "selection belongs to another market",
      );
    }
    selectionIds.add(selectionId);
    return {
      ...selection,
      id: selectionId,
      name: requiredText(selection.name, "selection name"),
      price: validatePrice(selection.price),
      version: Math.max(1, selection.version || 1),
    };
  });
  return {
    ...value,
    id,
    eventId,
    name,
    period,
    selections,
    version: Math.max(0, value.version || 0),
  };
}

function cloneEvent(value: SportEvent): SportEvent {
  return {
    ...value,
    participants: value.participants.map((participant) => ({ ...participant })),
  };
}

function cloneSelection(value: Selection): Selection {
  return {
    ...value,
    price: { ...value.price },
  };
}

function cloneMarket(value: BettingMarket): BettingMarket {
  return {
    ...value,
    selections: value.selections.map(cloneSelection),
  };
}

function eventFingerprint(value: SportEvent): string {
  return JSON.stringify({
    ...value,
    version: undefined,
    participants: [...value.participants].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  });
}

function marketFingerprint(value: BettingMarket): string {
  return JSON.stringify({
    ...value,
    version: undefined,
    selections: [...value.selections]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((selection) => ({
        ...selection,
        price: {
          numerator: selection.price.numerator.toString(),
          denominator: selection.price.denominator.toString(),
        },
        version: undefined,
      })),
  });
}
