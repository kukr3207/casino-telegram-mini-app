import { createHash } from "node:crypto";

import {
  type EvaluationContext,
  type FlagEvaluation,
  type FlagValue,
  type RuntimeFlag,
  type TargetingCondition,
  type TargetingRule,
  LiveOpsConflictError,
  LiveOpsValidationError,
  liveOpsText,
} from "./types.ts";

export class RuntimeFlagService {
  readonly #flags = new Map<string, RuntimeFlag>();
  readonly #audit: { key: string; version: number; actorId: string; changedAt: string; before?: RuntimeFlag; after: RuntimeFlag }[] = [];

  create(value: RuntimeFlag, actorId: string): RuntimeFlag {
    const flag = validateFlag(value);
    if (this.#flags.has(flag.key)) throw new LiveOpsConflictError("runtime flag already exists");
    this.#flags.set(flag.key, flag);
    this.record(undefined, flag, actorId);
    return cloneFlag(flag);
  }

  update(key: string, expectedVersion: number, changes: Partial<Omit<RuntimeFlag, "key" | "createdAt" | "version">>, actorId: string): RuntimeFlag {
    const current = this.require(key);
    if (current.version !== expectedVersion) throw new LiveOpsConflictError("runtime flag version does not match");
    const changed = validateFlag({ ...current, ...changes, key: current.key, createdAt: current.createdAt, updatedAt: new Date().toISOString(), version: current.version + 1 });
    this.#flags.set(changed.key, changed);
    this.record(current, changed, actorId);
    return cloneFlag(changed);
  }

  evaluate(key: string, context: EvaluationContext): FlagEvaluation {
    const flag = this.require(key);
    const matching = [...flag.rules].filter((rule) => rule.enabled).sort((left, right) => left.priority - right.priority).find((rule) => matchesRule(rule, context) && insideRollout(flag.key, rule, context.subjectId));
    if (matching) return { key: flag.key, value: matching.value, source: "rule", ruleId: matching.id, version: flag.version };
    if (Object.prototype.hasOwnProperty.call(flag.environments, context.environment)) return { key: flag.key, value: flag.environments[context.environment], source: "environment", version: flag.version };
    return { key: flag.key, value: flag.defaultValue, source: "default", version: flag.version };
  }

  snapshot(context: EvaluationContext): Readonly<Record<string, FlagEvaluation>> {
    return Object.fromEntries([...this.#flags.keys()].sort().map((key) => [key, this.evaluate(key, context)]));
  }

  history(key: string): readonly { key: string; version: number; actorId: string; changedAt: string }[] {
    return this.#audit.filter((entry) => entry.key === key).map(({ before: _before, after: _after, ...entry }) => ({ ...entry }));
  }

  private require(key: string): RuntimeFlag {
    const flag = this.#flags.get(liveOpsText(key, "flag key"));
    if (!flag) throw new LiveOpsValidationError("runtime flag does not exist");
    return flag;
  }

  private record(before: RuntimeFlag | undefined, after: RuntimeFlag, actorId: string): void {
    this.#audit.push({ key: after.key, version: after.version, actorId: liveOpsText(actorId, "flag actor"), changedAt: new Date().toISOString(), before: before ? cloneFlag(before) : undefined, after: cloneFlag(after) });
  }
}

function validateFlag(value: RuntimeFlag): RuntimeFlag {
  const key = liveOpsText(value.key, "flag key");
  if (!/^[a-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/.test(key)) throw new LiveOpsValidationError("flag key is invalid");
  assertValueType(value.valueType, value.defaultValue);
  for (const environmentValue of Object.values(value.environments)) assertValueType(value.valueType, environmentValue);
  const priorities = new Set<number>();
  const ids = new Set<string>();
  const rules = value.rules.map((rule) => {
    const normalized = validateRule(rule, value.valueType);
    if (ids.has(normalized.id)) throw new LiveOpsValidationError("flag rule ids must be unique");
    if (priorities.has(normalized.priority)) throw new LiveOpsValidationError("flag rule priorities must be unique");
    ids.add(normalized.id); priorities.add(normalized.priority); return normalized;
  });
  return { ...value, key, description: liveOpsText(value.description, "flag description"), owner: liveOpsText(value.owner, "flag owner"), environments: { ...value.environments }, rules };
}

function validateRule(value: TargetingRule, valueType: RuntimeFlag["valueType"]): TargetingRule {
  if (!Number.isSafeInteger(value.priority) || value.priority < 0) throw new LiveOpsValidationError("flag priority is invalid");
  if (value.rolloutBasisPoints !== undefined && (!Number.isSafeInteger(value.rolloutBasisPoints) || value.rolloutBasisPoints < 0 || value.rolloutBasisPoints > 10_000)) throw new LiveOpsValidationError("flag rollout is invalid");
  assertValueType(valueType, value.value);
  return { ...value, id: liveOpsText(value.id, "rule id"), conditions: value.conditions.map((condition) => ({ ...condition, attribute: liveOpsText(condition.attribute, "condition attribute"), values: condition.values.map((item) => String(item)) })) };
}

function assertValueType(type: RuntimeFlag["valueType"], value: FlagValue): void { if (typeof value !== type) throw new LiveOpsValidationError(`flag value must be ${type}`); }
function matchesRule(rule: TargetingRule, context: EvaluationContext): boolean { return rule.conditions.every((condition) => matchesCondition(condition, context.attributes[condition.attribute])); }
export function matchesCondition(condition: TargetingCondition, actual: string | number | boolean | undefined): boolean {
  if (actual === undefined) return false;
  const value = String(actual);
  if (condition.operator === "equals") return condition.values.includes(value);
  if (condition.operator === "not_equals") return !condition.values.includes(value);
  if (condition.operator === "in") return condition.values.includes(value);
  if (condition.operator === "not_in") return !condition.values.includes(value);
  if (condition.operator === "starts_with") return condition.values.some((item) => value.startsWith(item));
  if (condition.operator === "ends_with") return condition.values.some((item) => value.endsWith(item));
  const numeric = Number(actual); const boundary = Number(condition.values[0]);
  if (!Number.isFinite(numeric) || !Number.isFinite(boundary)) return false;
  return condition.operator === "greater_than" ? numeric > boundary : numeric < boundary;
}
function insideRollout(flagKey: string, rule: TargetingRule, subjectId: string): boolean { if (rule.rolloutBasisPoints === undefined) return true; const bucket = createHash("sha256").update(`${flagKey}:${rule.id}:${subjectId}`).digest().readUInt32BE(0) % 10_000; return bucket < rule.rolloutBasisPoints; }
function cloneFlag(value: RuntimeFlag): RuntimeFlag { return { ...value, environments: { ...value.environments }, rules: value.rules.map((rule) => ({ ...rule, conditions: rule.conditions.map((condition) => ({ ...condition, values: [...condition.values] })) })) }; }
