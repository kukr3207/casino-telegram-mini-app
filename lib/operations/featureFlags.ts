import { createHash } from "node:crypto";

import {
  type FeatureFlag,
  type FlagCondition,
  type FlagContext,
  type FlagEvaluation,
  type FlagRule,
  OperationsConflictError,
  OperationsValidationError,
  operationsDate,
  operationsText,
} from "./types.ts";

export interface CreateFlagInput {
  key: string;
  description: string;
  enabled?: boolean;
  defaultVariant: string;
  variants: Readonly<Record<string, unknown>>;
  rules?: readonly FlagRule[];
  tags?: readonly string[];
  expiresAt?: string;
  ownerId: string;
}

export interface FlagChange {
  sequence: number;
  key: string;
  actorId: string;
  reason: string;
  previous?: FeatureFlag;
  current: FeatureFlag;
  changedAt: string;
}

export class FeatureFlagService {
  readonly #flags = new Map<string, FeatureFlag>();
  readonly #changes: FlagChange[] = [];

  create(
    input: CreateFlagInput,
    actorId: string,
    reason: string,
    at = new Date(),
  ): FeatureFlag {
    const value = validateFlag({
      ...input,
      enabled: input.enabled ?? false,
      rules: input.rules ?? [],
      tags: input.tags ?? [],
      version: 1,
    });
    if (this.#flags.has(value.key))
      throw new OperationsConflictError("feature flag already exists");
    this.#flags.set(value.key, value);
    this.#record(undefined, value, actorId, reason, at);
    return cloneFlag(value);
  }

  update(
    key: string,
    patch: Partial<Omit<FeatureFlag, "key" | "version">>,
    expectedVersion: number,
    actorId: string,
    reason: string,
    at = new Date(),
  ): FeatureFlag {
    const current = this.#required(key);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError("feature flag version does not match");
    const changed = validateFlag({
      ...current,
      ...patch,
      key: current.key,
      version: current.version + 1,
    });
    this.#flags.set(changed.key, changed);
    this.#record(current, changed, actorId, reason, at);
    return cloneFlag(changed);
  }

  enable(
    key: string,
    expectedVersion: number,
    actorId: string,
    reason: string,
  ): FeatureFlag {
    return this.update(
      key,
      { enabled: true },
      expectedVersion,
      actorId,
      reason,
    );
  }

  disable(
    key: string,
    expectedVersion: number,
    actorId: string,
    reason: string,
  ): FeatureFlag {
    return this.update(
      key,
      { enabled: false },
      expectedVersion,
      actorId,
      reason,
    );
  }

  evaluate(key: string, context: FlagContext, at = new Date()): FlagEvaluation {
    const flag = this.#required(key);
    operationsText(context.subjectId, "flag subject id");
    if (!flag.enabled) return evaluation(flag, flag.defaultVariant, "disabled");
    if (flag.expiresAt && new Date(flag.expiresAt) <= at)
      return evaluation(flag, flag.defaultVariant, "expired");
    for (const rule of [...flag.rules].sort(
      (left, right) =>
        left.priority - right.priority || left.id.localeCompare(right.id),
    )) {
      if (
        !rule.enabled ||
        !rule.conditions.every((condition) =>
          conditionMatches(condition, context),
        )
      )
        continue;
      const variant = allocate(flag.key, context.subjectId, rule.allocation);
      return evaluation(flag, variant, "rule", rule.id);
    }
    return evaluation(flag, flag.defaultVariant, "default");
  }

  evaluateMany(
    keys: readonly string[],
    context: FlagContext,
    at = new Date(),
  ): Readonly<Record<string, FlagEvaluation>> {
    return Object.fromEntries(
      [...new Set(keys)].map((key) => [key, this.evaluate(key, context, at)]),
    );
  }

  get(key: string): FeatureFlag | undefined {
    const value = this.#flags.get(key.trim().toLowerCase());
    return value ? cloneFlag(value) : undefined;
  }

  list(
    filters: {
      enabled?: boolean;
      tag?: string;
      ownerId?: string;
      includeExpired?: boolean;
    } = {},
    at = new Date(),
  ): readonly FeatureFlag[] {
    return [...this.#flags.values()]
      .filter(
        (flag) =>
          filters.enabled === undefined || flag.enabled === filters.enabled,
      )
      .filter(
        (flag) => !filters.tag || flag.tags.includes(filters.tag.toLowerCase()),
      )
      .filter((flag) => !filters.ownerId || flag.ownerId === filters.ownerId)
      .filter(
        (flag) =>
          filters.includeExpired ||
          !flag.expiresAt ||
          new Date(flag.expiresAt) > at,
      )
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(cloneFlag);
  }

  history(key: string): readonly FlagChange[] {
    const normalized = operationsText(key, "feature flag key").toLowerCase();
    return this.#changes
      .filter((change) => change.key === normalized)
      .map(cloneChange);
  }

  rollback(
    key: string,
    targetVersion: number,
    expectedVersion: number,
    actorId: string,
    reason: string,
  ): FeatureFlag {
    const current = this.#required(key);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError("feature flag version does not match");
    const snapshot = this.#changes.find(
      (change) =>
        change.key === current.key && change.current.version === targetVersion,
    )?.current;
    if (!snapshot)
      throw new OperationsValidationError(
        "target feature flag version does not exist",
      );
    return this.update(
      current.key,
      {
        description: snapshot.description,
        enabled: snapshot.enabled,
        defaultVariant: snapshot.defaultVariant,
        variants: snapshot.variants,
        rules: snapshot.rules,
        tags: snapshot.tags,
        expiresAt: snapshot.expiresAt,
        ownerId: snapshot.ownerId,
      },
      expectedVersion,
      actorId,
      reason,
    );
  }

  #required(key: string): FeatureFlag {
    const value = this.#flags.get(
      operationsText(key, "feature flag key").toLowerCase(),
    );
    if (!value)
      throw new OperationsValidationError("feature flag does not exist");
    return value;
  }

  #record(
    previous: FeatureFlag | undefined,
    current: FeatureFlag,
    actorId: string,
    reason: string,
    at: Date,
  ): void {
    this.#changes.push({
      sequence: this.#changes.length + 1,
      key: current.key,
      actorId: operationsText(actorId, "flag actor"),
      reason: operationsText(reason, "flag change reason"),
      previous: previous ? cloneFlag(previous) : undefined,
      current: cloneFlag(current),
      changedAt: at.toISOString(),
    });
  }
}

function validateFlag(value: FeatureFlag): FeatureFlag {
  const key = operationsText(value.key, "feature flag key").toLowerCase();
  if (!/^[a-z][a-z0-9._-]{1,99}$/.test(key))
    throw new OperationsValidationError("feature flag key is invalid");
  const variants: Record<string, unknown> = {};
  for (const [name, variant] of Object.entries(value.variants))
    variants[validateVariant(name)] = cloneValue(variant);
  if (Object.keys(variants).length === 0)
    throw new OperationsValidationError(
      "feature flag needs at least one variant",
    );
  const defaultVariant = validateVariant(value.defaultVariant);
  if (!(defaultVariant in variants))
    throw new OperationsValidationError(
      "default feature flag variant does not exist",
    );
  const rules = value.rules.map((rule) => validateRule(rule, variants));
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
    throw new OperationsValidationError("feature flag rule ids must be unique");
  return {
    ...value,
    key,
    description: operationsText(value.description, "feature flag description"),
    defaultVariant,
    variants,
    rules,
    tags: [
      ...new Set(
        value.tags.map((tag) => operationsText(tag, "flag tag").toLowerCase()),
      ),
    ].sort(),
    expiresAt: value.expiresAt
      ? operationsDate(value.expiresAt, "flag expiry").toISOString()
      : undefined,
    ownerId: operationsText(value.ownerId, "flag owner"),
  };
}

function validateRule(
  value: FlagRule,
  variants: Readonly<Record<string, unknown>>,
): FlagRule {
  if (!Number.isSafeInteger(value.priority) || value.priority < 0)
    throw new OperationsValidationError("flag rule priority is invalid");
  const allocation: Record<string, number> = {};
  let total = 0;
  for (const [variant, weight] of Object.entries(value.allocation)) {
    if (!(variant in variants))
      throw new OperationsValidationError(
        "flag rule allocation uses an unknown variant",
      );
    if (!Number.isSafeInteger(weight) || weight < 0 || weight > 10_000)
      throw new OperationsValidationError("flag allocation weight is invalid");
    allocation[variant] = weight;
    total += weight;
  }
  if (total !== 10_000)
    throw new OperationsValidationError(
      "flag allocation must total 10000 basis points",
    );
  return {
    ...value,
    id: operationsText(value.id, "flag rule id"),
    conditions: value.conditions.map(validateCondition),
    allocation,
  };
}

function validateCondition(value: FlagCondition): FlagCondition {
  const attribute = operationsText(value.attribute, "flag condition attribute");
  if (value.operator === "matches") {
    if (typeof value.value !== "string")
      throw new OperationsValidationError(
        "regular expression condition must be a string",
      );
    try {
      new RegExp(value.value);
    } catch {
      throw new OperationsValidationError(
        "flag condition regular expression is invalid",
      );
    }
  }
  if (["in", "not_in"].includes(value.operator) && !Array.isArray(value.value))
    throw new OperationsValidationError(
      "set conditions require an array value",
    );
  return { ...value, attribute, value: cloneValue(value.value) };
}

function conditionMatches(
  condition: FlagCondition,
  context: FlagContext,
): boolean {
  const actual = attributeValue(context, condition.attribute);
  const expected = condition.value;
  if (condition.operator === "equals") return Object.is(actual, expected);
  if (condition.operator === "not_equals") return !Object.is(actual, expected);
  if (condition.operator === "in")
    return (expected as unknown[]).some((value) => Object.is(actual, value));
  if (condition.operator === "not_in")
    return !(expected as unknown[]).some((value) => Object.is(actual, value));
  if (condition.operator === "contains")
    return (
      typeof actual === "string" &&
      typeof expected === "string" &&
      actual.includes(expected)
    );
  if (condition.operator === "starts_with")
    return (
      typeof actual === "string" &&
      typeof expected === "string" &&
      actual.startsWith(expected)
    );
  if (condition.operator === "ends_with")
    return (
      typeof actual === "string" &&
      typeof expected === "string" &&
      actual.endsWith(expected)
    );
  if (condition.operator === "greater_than")
    return (
      typeof actual === "number" &&
      typeof expected === "number" &&
      actual > expected
    );
  if (condition.operator === "less_than")
    return (
      typeof actual === "number" &&
      typeof expected === "number" &&
      actual < expected
    );
  return (
    typeof actual === "string" &&
    typeof expected === "string" &&
    new RegExp(expected).test(actual)
  );
}

function attributeValue(context: FlagContext, path: string): unknown {
  if (path === "subjectId") return context.subjectId;
  return path
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined,
      context.attributes,
    );
}

function allocate(
  flagKey: string,
  subjectId: string,
  allocation: Readonly<Record<string, number>>,
): string {
  const bucket =
    Number.parseInt(
      createHash("sha256")
        .update(`${flagKey}\u0000${subjectId}`)
        .digest("hex")
        .slice(0, 8),
      16,
    ) % 10_000;
  let upper = 0;
  for (const [variant, weight] of Object.entries(allocation)) {
    upper += weight;
    if (bucket < upper) return variant;
  }
  throw new OperationsValidationError("feature flag allocation is incomplete");
}

function evaluation(
  flag: FeatureFlag,
  variant: string,
  reason: FlagEvaluation["reason"],
  ruleId?: string,
): FlagEvaluation {
  return {
    key: flag.key,
    variant,
    value: cloneValue(flag.variants[variant]),
    reason,
    ruleId,
    version: flag.version,
  };
}
function validateVariant(value: string): string {
  const variant = operationsText(value, "flag variant");
  if (!/^[a-zA-Z0-9._-]{1,50}$/.test(variant))
    throw new OperationsValidationError("flag variant is invalid");
  return variant;
}
function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    throw new OperationsValidationError(
      "feature flag values must be cloneable",
    );
  }
}
function cloneFlag(value: FeatureFlag): FeatureFlag {
  return {
    ...value,
    variants: cloneValue(value.variants),
    rules: value.rules.map((rule) => ({
      ...rule,
      conditions: rule.conditions.map((condition) => ({
        ...condition,
        value: cloneValue(condition.value),
      })),
      allocation: { ...rule.allocation },
    })),
    tags: [...value.tags],
  };
}
function cloneChange(value: FlagChange): FlagChange {
  return {
    ...value,
    previous: value.previous ? cloneFlag(value.previous) : undefined,
    current: cloneFlag(value.current),
  };
}
