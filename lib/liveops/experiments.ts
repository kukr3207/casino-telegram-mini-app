import { createHash } from "node:crypto";

import { matchesCondition } from "./flags.ts";
import {
  type EvaluationContext,
  type Experiment,
  type ExperimentAssignment,
  type ExperimentMetric,
  type ExperimentObservation,
  LiveOpsConflictError,
  LiveOpsValidationError,
  liveOpsDate,
  liveOpsText,
} from "./types.ts";

export interface VariantMetricResult {
  experimentId: string;
  metricKey: string;
  variantId: string;
  subjects: number;
  observations: number;
  value: number;
}

export class ExperimentService {
  readonly #experiments = new Map<string, Experiment>();
  readonly #assignments = new Map<string, ExperimentAssignment>();
  readonly #observations = new Map<string, ExperimentObservation>();

  create(value: Experiment): Experiment {
    const experiment = validateExperiment(value);
    if (this.#experiments.has(experiment.id))
      throw new LiveOpsConflictError("experiment id already exists");
    this.#experiments.set(experiment.id, experiment);
    return cloneExperiment(experiment);
  }

  transition(
    experimentId: string,
    expectedVersion: number,
    status: Experiment["status"],
  ): Experiment {
    const current = this.require(experimentId);
    if (current.version !== expectedVersion)
      throw new LiveOpsConflictError("experiment version does not match");
    const allowed: Readonly<
      Record<Experiment["status"], readonly Experiment["status"][]>
    > = {
      draft: ["running", "cancelled"],
      running: ["paused", "completed", "cancelled"],
      paused: ["running", "completed", "cancelled"],
      completed: [],
      cancelled: [],
    };
    if (status !== current.status && !allowed[current.status].includes(status))
      throw new LiveOpsConflictError(
        `cannot move experiment from ${current.status} to ${status}`,
      );
    const changed = { ...current, status, version: current.version + 1 };
    this.#experiments.set(changed.id, changed);
    return cloneExperiment(changed);
  }

  assign(
    experimentId: string,
    context: EvaluationContext,
    at = new Date(),
  ): ExperimentAssignment | null {
    const experiment = this.require(experimentId);
    const key = `${experiment.id}:${context.subjectId}`;
    const existing = this.#assignments.get(key);
    if (existing) return { ...existing };
    if (
      experiment.status !== "running" ||
      at < new Date(experiment.startsAt) ||
      at >= new Date(experiment.endsAt)
    )
      return null;
    if (
      !experiment.eligibility.every((condition) =>
        matchesCondition(condition, context.attributes[condition.attribute]),
      )
    )
      return null;
    if (!insideAllocation(experiment, context.subjectId)) return null;
    if (experiment.exclusionGroup) {
      const conflict = [...this.#assignments.values()].find((assignment) => {
        const assignedExperiment = this.#experiments.get(
          assignment.experimentId,
        )!;
        return (
          assignment.subjectId === context.subjectId &&
          assignedExperiment.exclusionGroup === experiment.exclusionGroup
        );
      });
      if (conflict) return null;
    }
    const variantId = chooseVariant(experiment, context.subjectId);
    const assignment = {
      experimentId: experiment.id,
      subjectId: context.subjectId,
      variantId,
      assignedAt: at.toISOString(),
      fingerprint: createHash("sha256")
        .update(
          `${experiment.id}:${experiment.version}:${context.subjectId}:${variantId}`,
        )
        .digest("hex"),
    };
    this.#assignments.set(key, assignment);
    return { ...assignment };
  }

  observe(value: ExperimentObservation): ExperimentObservation {
    const observation = validateObservation(
      value,
      this.require(value.experimentId),
    );
    const assignment = this.#assignments.get(
      `${observation.experimentId}:${observation.subjectId}`,
    );
    if (!assignment)
      throw new LiveOpsConflictError("subject is not assigned to experiment");
    const existing = this.#observations.get(observation.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(observation))
        throw new LiveOpsConflictError(
          "observation id contains different data",
        );
      return { ...existing };
    }
    this.#observations.set(observation.id, observation);
    return { ...observation };
  }

  results(
    experimentId: string,
    metricKey: string,
  ): readonly VariantMetricResult[] {
    const experiment = this.require(experimentId);
    const metric = experiment.metrics.find(
      (candidate) => candidate.key === metricKey,
    );
    if (!metric)
      throw new LiveOpsValidationError("experiment metric does not exist");
    return experiment.variants.map((variant) => {
      const subjects = [...this.#assignments.values()]
        .filter(
          (assignment) =>
            assignment.experimentId === experiment.id &&
            assignment.variantId === variant.id,
        )
        .map((assignment) => assignment.subjectId);
      const observations = [...this.#observations.values()].filter(
        (observation) =>
          observation.experimentId === experiment.id &&
          observation.metricKey === metric.key &&
          subjects.includes(observation.subjectId),
      );
      return {
        experimentId: experiment.id,
        metricKey: metric.key,
        variantId: variant.id,
        subjects: new Set(subjects).size,
        observations: observations.length,
        value: aggregate(metric, observations),
      };
    });
  }

  assignment(
    experimentId: string,
    subjectId: string,
  ): ExperimentAssignment | undefined {
    const value = this.#assignments.get(`${experimentId}:${subjectId}`);
    return value ? { ...value } : undefined;
  }
  private require(experimentId: string): Experiment {
    const value = this.#experiments.get(
      liveOpsText(experimentId, "experiment id"),
    );
    if (!value) throw new LiveOpsValidationError("experiment does not exist");
    return value;
  }
}

function validateExperiment(value: Experiment): Experiment {
  const startsAt = liveOpsDate(value.startsAt, "experiment start");
  const endsAt = liveOpsDate(value.endsAt, "experiment end");
  if (endsAt <= startsAt)
    throw new LiveOpsValidationError("experiment end must follow start");
  if (
    !Number.isSafeInteger(value.allocationBasisPoints) ||
    value.allocationBasisPoints < 1 ||
    value.allocationBasisPoints > 10_000
  )
    throw new LiveOpsValidationError("experiment allocation is invalid");
  if (
    value.variants.length < 2 ||
    value.variants.reduce(
      (sum, variant) => sum + variant.weightBasisPoints,
      0,
    ) !== 10_000
  )
    throw new LiveOpsValidationError("variant weights must total 100 percent");
  const variantIds = new Set(
    value.variants.map((variant) => liveOpsText(variant.id, "variant id")),
  );
  if (variantIds.size !== value.variants.length)
    throw new LiveOpsValidationError("variant ids must be unique");
  if (value.metrics.length === 0)
    throw new LiveOpsValidationError("experiment requires a metric");
  return {
    ...value,
    id: liveOpsText(value.id, "experiment id"),
    name: liveOpsText(value.name, "experiment name"),
    hypothesis: liveOpsText(value.hypothesis, "experiment hypothesis"),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    eligibility: value.eligibility.map((condition) => ({
      ...condition,
      values: [...condition.values],
    })),
    variants: value.variants.map((variant) => ({
      ...variant,
      configuration: { ...variant.configuration },
    })),
    metrics: value.metrics.map((metric) => ({ ...metric })),
  };
}
function validateObservation(
  value: ExperimentObservation,
  experiment: Experiment,
): ExperimentObservation {
  if (!experiment.metrics.some((metric) => metric.key === value.metricKey))
    throw new LiveOpsValidationError("experiment metric does not exist");
  if (!Number.isFinite(value.value))
    throw new LiveOpsValidationError("observation value is invalid");
  return {
    ...value,
    id: liveOpsText(value.id, "observation id"),
    subjectId: liveOpsText(value.subjectId, "subject id"),
    occurredAt: liveOpsDate(value.occurredAt, "observation time").toISOString(),
  };
}
function insideAllocation(experiment: Experiment, subjectId: string): boolean {
  return (
    bucket(`${experiment.id}:allocation:${subjectId}`) <
    experiment.allocationBasisPoints
  );
}
function chooseVariant(experiment: Experiment, subjectId: string): string {
  const selected = bucket(`${experiment.id}:variant:${subjectId}`);
  let cursor = 0;
  for (const variant of experiment.variants) {
    cursor += variant.weightBasisPoints;
    if (selected < cursor) return variant.id;
  }
  return experiment.variants.at(-1)!.id;
}
function bucket(value: string): number {
  return createHash("sha256").update(value).digest().readUInt32BE(0) % 10_000;
}
function aggregate(
  metric: ExperimentMetric,
  observations: readonly ExperimentObservation[],
): number {
  if (!observations.length) return 0;
  if (metric.kind === "conversion")
    return (
      new Set(
        observations
          .filter((item) => item.value > 0)
          .map((item) => item.subjectId),
      ).size / new Set(observations.map((item) => item.subjectId)).size
    );
  if (metric.kind === "count") return observations.length;
  const total = observations.reduce((sum, item) => sum + item.value, 0);
  return metric.kind === "sum" ? total : total / observations.length;
}
function cloneExperiment(value: Experiment): Experiment {
  return {
    ...value,
    eligibility: value.eligibility.map((condition) => ({
      ...condition,
      values: [...condition.values],
    })),
    variants: value.variants.map((variant) => ({
      ...variant,
      configuration: { ...variant.configuration },
    })),
    metrics: value.metrics.map((metric) => ({ ...metric })),
  };
}
