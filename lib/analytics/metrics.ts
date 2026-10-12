import type { AnalyticsEvent } from "./events.ts";
import { AnalyticsValidationError } from "./events.ts";

export type MetricAggregation = "count" | "sum" | "unique_players" | "average" | "minimum" | "maximum";

export interface MetricDefinition {
  id: string;
  eventName: string;
  aggregation: MetricAggregation;
  property?: string;
  dimensions?: readonly string[];
}

export interface MetricPoint {
  metricId: string;
  periodStart: Date;
  periodEnd: Date;
  dimensions: Readonly<Record<string, string>>;
  value: number;
  sampleCount: number;
}

export class MetricEngine {
  private readonly definitions = new Map<string, MetricDefinition>();

  register(definition: MetricDefinition): MetricDefinition {
    if (!definition.id?.trim() || !definition.eventName?.trim()) throw new AnalyticsValidationError("metric id and event name are required");
    if (["sum", "average", "minimum", "maximum"].includes(definition.aggregation) && !definition.property) {
      throw new AnalyticsValidationError("numeric metric requires a property");
    }
    const normalized = {
      ...definition,
      id: definition.id.trim(),
      eventName: definition.eventName.trim(),
      property: definition.property?.trim(),
      dimensions: [...new Set(definition.dimensions ?? [])],
    };
    this.definitions.set(normalized.id, normalized);
    return { ...normalized, dimensions: [...(normalized.dimensions ?? [])] };
  }

  calculate(
    metricId: string,
    events: readonly AnalyticsEvent[],
    periodStart: Date,
    periodEnd: Date,
  ): readonly MetricPoint[] {
    const definition = this.definitions.get(metricId.trim());
    if (!definition) throw new AnalyticsValidationError("metric definition does not exist");
    if (periodEnd <= periodStart) throw new AnalyticsValidationError("metric period is invalid");
    const matching = events.filter(
      (event) => event.name === definition.eventName && event.occurredAt >= periodStart && event.occurredAt < periodEnd,
    );
    const groups = new Map<string, { dimensions: Record<string, string>; events: AnalyticsEvent[] }>();
    for (const event of matching) {
      const dimensions: Record<string, string> = {};
      for (const dimension of definition.dimensions ?? []) {
        const value = event.properties[dimension] ?? event.context[dimension];
        dimensions[dimension] = value === undefined || value === null ? "unknown" : String(value);
      }
      const key = JSON.stringify(Object.entries(dimensions).sort(([left], [right]) => left.localeCompare(right)));
      const group = groups.get(key) ?? { dimensions, events: [] };
      group.events.push(event);
      groups.set(key, group);
    }
    if (groups.size === 0 && (definition.dimensions?.length ?? 0) === 0) groups.set("[]", { dimensions: {}, events: [] });
    return [...groups.values()]
      .map((group) => ({
        metricId: definition.id,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        dimensions: group.dimensions,
        value: aggregate(definition, group.events),
        sampleCount: group.events.length,
      }))
      .sort((left, right) => JSON.stringify(left.dimensions).localeCompare(JSON.stringify(right.dimensions)));
  }
}

function aggregate(definition: MetricDefinition, events: readonly AnalyticsEvent[]): number {
  if (definition.aggregation === "count") return events.length;
  if (definition.aggregation === "unique_players") return new Set(events.map((event) => event.playerId).filter(Boolean)).size;
  const values = events.map((event) => event.properties[definition.property!]).filter((value): value is number => typeof value === "number");
  if (values.length !== events.length) throw new AnalyticsValidationError(`metric property ${definition.property} is missing or nonnumeric`);
  if (values.length === 0) return 0;
  if (definition.aggregation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (definition.aggregation === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (definition.aggregation === "minimum") return Math.min(...values);
  return Math.max(...values);
}

