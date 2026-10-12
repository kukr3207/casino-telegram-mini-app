import type { AnalyticsEvent } from "./events.ts";
import { AnalyticsValidationError } from "./events.ts";

export interface CohortDefinition {
  id: string;
  entryEvent: string;
  returnEvent: string;
  periodDays: number;
  periods: number;
}

export interface CohortRow {
  cohortDate: string;
  acquiredPlayers: number;
  retainedByPeriod: readonly number[];
  retentionRates: readonly number[];
}

export function calculateRetention(
  events: readonly AnalyticsEvent[],
  definition: CohortDefinition,
  from: Date,
  to: Date,
): readonly CohortRow[] {
  if (!definition.id?.trim() || !definition.entryEvent?.trim() || !definition.returnEvent?.trim()) {
    throw new AnalyticsValidationError("cohort id and event names are required");
  }
  if (!Number.isInteger(definition.periodDays) || definition.periodDays < 1) throw new AnalyticsValidationError("cohort period must be positive");
  if (!Number.isInteger(definition.periods) || definition.periods < 1 || definition.periods > 365) throw new AnalyticsValidationError("cohort period count is invalid");
  if (to <= from) throw new AnalyticsValidationError("cohort date range is invalid");
  const entryByPlayer = new Map<string, Date>();
  for (const event of events) {
    if (event.name !== definition.entryEvent || !event.playerId || event.occurredAt < from || event.occurredAt >= to) continue;
    const current = entryByPlayer.get(event.playerId);
    if (!current || event.occurredAt < current) entryByPlayer.set(event.playerId, event.occurredAt);
  }
  const cohorts = new Map<string, { players: Set<string>; retained: Array<Set<string>> }>();
  for (const [playerId, entry] of entryByPlayer) {
    const cohortDate = entry.toISOString().slice(0, 10);
    const cohort = cohorts.get(cohortDate) ?? {
      players: new Set<string>(),
      retained: Array.from({ length: definition.periods }, () => new Set<string>()),
    };
    cohort.players.add(playerId);
    cohorts.set(cohortDate, cohort);
  }
  const periodMs = definition.periodDays * 24 * 60 * 60 * 1_000;
  for (const event of events) {
    if (event.name !== definition.returnEvent || !event.playerId) continue;
    const entry = entryByPlayer.get(event.playerId);
    if (!entry || event.occurredAt < entry) continue;
    const period = Math.floor((event.occurredAt.getTime() - entry.getTime()) / periodMs);
    if (period < 0 || period >= definition.periods) continue;
    const cohortDate = entry.toISOString().slice(0, 10);
    cohorts.get(cohortDate)!.retained[period].add(event.playerId);
  }
  return [...cohorts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([cohortDate, cohort]) => {
      const retainedByPeriod = cohort.retained.map((players) => players.size);
      return {
        cohortDate,
        acquiredPlayers: cohort.players.size,
        retainedByPeriod,
        retentionRates: retainedByPeriod.map((count) => cohort.players.size === 0 ? 0 : count / cohort.players.size),
      };
    });
}

export interface FunnelStep {
  eventName: string;
  maximumDelayMs?: number;
}

export interface FunnelResult {
  step: string;
  reachedPlayers: number;
  conversionFromStart: number;
  conversionFromPrevious: number;
}

export function calculateFunnel(events: readonly AnalyticsEvent[], steps: readonly FunnelStep[], from: Date, to: Date): readonly FunnelResult[] {
  if (steps.length < 2) throw new AnalyticsValidationError("funnel requires at least two steps");
  const byPlayer = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    if (!event.playerId || event.occurredAt < from || event.occurredAt >= to) continue;
    const values = byPlayer.get(event.playerId) ?? [];
    values.push(event);
    byPlayer.set(event.playerId, values);
  }
  const reached = Array.from({ length: steps.length }, () => 0);
  for (const playerEvents of byPlayer.values()) {
    playerEvents.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
    let previousTime: Date | undefined;
    let searchFrom = 0;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const foundAt = playerEvents.findIndex((event, eventIndex) => (
        eventIndex >= searchFrom
        && event.name === step.eventName
        && (!previousTime || step.maximumDelayMs === undefined || event.occurredAt.getTime() - previousTime.getTime() <= step.maximumDelayMs)
      ));
      if (foundAt < 0) break;
      reached[index] += 1;
      previousTime = playerEvents[foundAt].occurredAt;
      searchFrom = foundAt + 1;
    }
  }
  return steps.map((step, index) => ({
    step: step.eventName,
    reachedPlayers: reached[index],
    conversionFromStart: reached[0] === 0 ? 0 : reached[index] / reached[0],
    conversionFromPrevious: index === 0 || reached[index - 1] === 0 ? 1 : reached[index] / reached[index - 1],
  }));
}

