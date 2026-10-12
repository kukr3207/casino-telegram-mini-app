import { createHash } from "node:crypto";

import {
  type DurableJob,
  type RetryPolicy,
  OperationsConflictError,
  OperationsValidationError,
  operationsDate,
  operationsText,
} from "./types.ts";

export interface EnqueueJob<T> {
  id?: string;
  type: string;
  payload: T;
  queue?: string;
  priority?: number;
  scheduledAt?: Date;
  maximumAttempts?: number;
  timeoutSeconds?: number;
  idempotencyKey?: string;
}

export interface QueueStatistics {
  queue: string;
  scheduled: number;
  ready: number;
  running: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
  cancelled: number;
  oldestReadyAt?: string;
}

export interface JobAttempt {
  jobId: string;
  number: number;
  workerId: string;
  startedAt: string;
  finishedAt?: string;
  outcome?: "succeeded" | "failed" | "timed_out" | "lease_lost";
  error?: string;
}

const defaultRetry: RetryPolicy = {
  initialDelaySeconds: 5,
  maximumDelaySeconds: 3600,
  multiplier: 2,
  jitter: 0,
};

export class DurableJobQueue {
  readonly #jobs = new Map<string, DurableJob>();
  readonly #idempotency = new Map<string, string>();
  readonly #attempts: JobAttempt[] = [];
  readonly #retryPolicies = new Map<string, RetryPolicy>();
  #serial = 0;

  setRetryPolicy(type: string, policy: RetryPolicy): RetryPolicy {
    const normalized = validateRetryPolicy(policy);
    this.#retryPolicies.set(operationsText(type, "job type"), normalized);
    return { ...normalized };
  }

  enqueue<T>(input: EnqueueJob<T>, now = new Date()): DurableJob<T> {
    const type = operationsText(input.type, "job type");
    const queue = operationsText(input.queue ?? "default", "job queue");
    const idempotencyKey = input.idempotencyKey?.trim();
    if (idempotencyKey) {
      const existingId = this.#idempotency.get(`${type}:${idempotencyKey}`);
      if (existingId) {
        const existing = this.#jobs.get(existingId);
        if (!existing)
          throw new OperationsConflictError(
            "idempotency index is inconsistent",
          );
        if (
          stableStringify(existing.payload) !== stableStringify(input.payload)
        )
          throw new OperationsConflictError(
            "job idempotency key is already used for different data",
          );
        return cloneJob(existing) as DurableJob<T>;
      }
    }
    const scheduledAt = input.scheduledAt ?? now;
    const id = operationsText(input.id ?? this.#newId(type, now), "job id");
    if (this.#jobs.has(id))
      throw new OperationsConflictError("job id already exists");
    const priority = input.priority ?? 0;
    const maximumAttempts = input.maximumAttempts ?? 5;
    const timeoutSeconds = input.timeoutSeconds ?? 300;
    if (!Number.isSafeInteger(priority) || priority < -100 || priority > 100)
      throw new OperationsValidationError(
        "job priority must be between -100 and 100",
      );
    if (
      !Number.isSafeInteger(maximumAttempts) ||
      maximumAttempts < 1 ||
      maximumAttempts > 100
    )
      throw new OperationsValidationError(
        "job maximum attempts must be between 1 and 100",
      );
    if (
      !Number.isSafeInteger(timeoutSeconds) ||
      timeoutSeconds < 1 ||
      timeoutSeconds > 86_400
    )
      throw new OperationsValidationError(
        "job timeout must be between 1 and 86400 seconds",
      );
    const job: DurableJob<T> = {
      id,
      type,
      payload: cloneValue(input.payload),
      queue,
      priority,
      status: scheduledAt <= now ? "ready" : "scheduled",
      scheduledAt: scheduledAt.toISOString(),
      attempts: 0,
      maximumAttempts,
      timeoutSeconds,
      idempotencyKey,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: 1,
    };
    this.#jobs.set(id, job);
    if (idempotencyKey) this.#idempotency.set(`${type}:${idempotencyKey}`, id);
    return cloneJob(job);
  }

  promoteDue(now = new Date()): readonly DurableJob[] {
    const promoted: DurableJob[] = [];
    for (const job of this.#jobs.values()) {
      if (job.status !== "scheduled" || new Date(job.scheduledAt) > now)
        continue;
      const changed = {
        ...job,
        status: "ready" as const,
        updatedAt: now.toISOString(),
        version: job.version + 1,
      };
      this.#jobs.set(job.id, changed);
      promoted.push(cloneJob(changed));
    }
    return promoted;
  }

  lease(
    queue: string,
    workerId: string,
    leaseSeconds: number,
    limit = 1,
    now = new Date(),
  ): readonly DurableJob[] {
    if (
      !Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < 1 ||
      leaseSeconds > 86_400
    )
      throw new OperationsValidationError(
        "lease duration must be between 1 and 86400 seconds",
      );
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new OperationsValidationError(
        "lease limit must be between 1 and 1000",
      );
    this.promoteDue(now);
    this.recoverExpiredLeases(now);
    const selected = [...this.#jobs.values()]
      .filter((job) => job.queue === queue && job.status === "ready")
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.scheduledAt.localeCompare(right.scheduledAt) ||
          left.createdAt.localeCompare(right.createdAt),
      )
      .slice(0, limit);
    return selected.map((job) => {
      const changed: DurableJob = {
        ...job,
        status: "running",
        attempts: job.attempts + 1,
        leaseOwner: operationsText(workerId, "worker id"),
        leaseExpiresAt: new Date(
          now.getTime() + leaseSeconds * 1000,
        ).toISOString(),
        updatedAt: now.toISOString(),
        version: job.version + 1,
      };
      this.#jobs.set(changed.id, changed);
      this.#attempts.push({
        jobId: changed.id,
        number: changed.attempts,
        workerId: changed.leaseOwner!,
        startedAt: now.toISOString(),
      });
      return cloneJob(changed);
    });
  }

  heartbeat(
    jobId: string,
    workerId: string,
    leaseSeconds: number,
    expectedVersion: number,
    now = new Date(),
  ): DurableJob {
    const current = this.#running(jobId, workerId, expectedVersion, now);
    if (
      !Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < 1 ||
      leaseSeconds > 86_400
    )
      throw new OperationsValidationError(
        "lease duration must be between 1 and 86400 seconds",
      );
    const changed = {
      ...current,
      leaseExpiresAt: new Date(
        now.getTime() + leaseSeconds * 1000,
      ).toISOString(),
      updatedAt: now.toISOString(),
      version: current.version + 1,
    };
    this.#jobs.set(changed.id, changed);
    return cloneJob(changed);
  }

  succeed(
    jobId: string,
    workerId: string,
    result: unknown,
    expectedVersion: number,
    now = new Date(),
  ): DurableJob {
    const current = this.#running(jobId, workerId, expectedVersion, now);
    const changed: DurableJob = {
      ...current,
      status: "succeeded",
      result: cloneValue(result),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      completedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: current.version + 1,
    };
    this.#jobs.set(changed.id, changed);
    this.#finishAttempt(
      changed.id,
      changed.attempts,
      "succeeded",
      undefined,
      now,
    );
    return cloneJob(changed);
  }

  fail(
    jobId: string,
    workerId: string,
    error: string,
    expectedVersion: number,
    retryable = true,
    now = new Date(),
  ): DurableJob {
    const current = this.#running(jobId, workerId, expectedVersion, now);
    const message = operationsText(error, "job error");
    const exhausted = current.attempts >= current.maximumAttempts;
    const retry = retryable && !exhausted;
    const scheduledAt = retry
      ? new Date(
          now.getTime() +
            this.#delay(current.type, current.attempts, current.id) * 1000,
        ).toISOString()
      : current.scheduledAt;
    const changed: DurableJob = {
      ...current,
      status: retry ? "scheduled" : "dead_letter",
      error: message,
      scheduledAt,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      completedAt: retry ? undefined : now.toISOString(),
      updatedAt: now.toISOString(),
      version: current.version + 1,
    };
    this.#jobs.set(changed.id, changed);
    this.#finishAttempt(changed.id, changed.attempts, "failed", message, now);
    return cloneJob(changed);
  }

  cancel(jobId: string, expectedVersion: number, now = new Date()): DurableJob {
    const current = this.#required(jobId);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError("job version does not match");
    if (["succeeded", "dead_letter", "cancelled"].includes(current.status))
      throw new OperationsConflictError("completed job cannot be cancelled");
    const changed: DurableJob = {
      ...current,
      status: "cancelled",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      completedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: current.version + 1,
    };
    this.#jobs.set(changed.id, changed);
    if (current.status === "running")
      this.#finishAttempt(
        changed.id,
        changed.attempts,
        "lease_lost",
        "job cancelled",
        now,
      );
    return cloneJob(changed);
  }

  replayDeadLetter(
    jobId: string,
    expectedVersion: number,
    now = new Date(),
  ): DurableJob {
    const current = this.#required(jobId);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError("job version does not match");
    if (current.status !== "dead_letter")
      throw new OperationsConflictError(
        "only dead-letter jobs can be replayed",
      );
    const changed: DurableJob = {
      ...current,
      status: "ready",
      attempts: 0,
      error: undefined,
      result: undefined,
      completedAt: undefined,
      scheduledAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: current.version + 1,
    };
    this.#jobs.set(changed.id, changed);
    return cloneJob(changed);
  }

  recoverExpiredLeases(now = new Date()): readonly DurableJob[] {
    const recovered: DurableJob[] = [];
    for (const current of this.#jobs.values()) {
      if (
        current.status !== "running" ||
        !current.leaseExpiresAt ||
        new Date(current.leaseExpiresAt) > now
      )
        continue;
      const exhausted = current.attempts >= current.maximumAttempts;
      const changed: DurableJob = {
        ...current,
        status: exhausted ? "dead_letter" : "ready",
        error: "worker lease expired",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        completedAt: exhausted ? now.toISOString() : undefined,
        updatedAt: now.toISOString(),
        version: current.version + 1,
      };
      this.#jobs.set(changed.id, changed);
      this.#finishAttempt(
        changed.id,
        changed.attempts,
        "timed_out",
        changed.error,
        now,
      );
      recovered.push(cloneJob(changed));
    }
    return recovered;
  }

  get(id: string): DurableJob | undefined {
    const value = this.#jobs.get(id.trim());
    return value ? cloneJob(value) : undefined;
  }
  attempts(jobId: string): readonly JobAttempt[] {
    return this.#attempts
      .filter((attempt) => attempt.jobId === jobId)
      .map((attempt) => ({ ...attempt }));
  }

  list(
    filters: {
      queue?: string;
      type?: string;
      status?: DurableJob["status"];
      before?: Date;
      limit?: number;
    } = {},
  ): readonly DurableJob[] {
    const limit = filters.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
      throw new OperationsValidationError("job list limit is invalid");
    return [...this.#jobs.values()]
      .filter((job) => !filters.queue || job.queue === filters.queue)
      .filter((job) => !filters.type || job.type === filters.type)
      .filter((job) => !filters.status || job.status === filters.status)
      .filter(
        (job) => !filters.before || new Date(job.createdAt) < filters.before,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(cloneJob);
  }

  statistics(): readonly QueueStatistics[] {
    const queues = [
      ...new Set([...this.#jobs.values()].map((job) => job.queue)),
    ].sort();
    return queues.map((queue) => {
      const jobs = [...this.#jobs.values()].filter(
        (job) => job.queue === queue,
      );
      const count = (status: DurableJob["status"]) =>
        jobs.filter((job) => job.status === status).length;
      return {
        queue,
        scheduled: count("scheduled"),
        ready: count("ready"),
        running: count("running"),
        succeeded: count("succeeded"),
        failed: count("failed"),
        deadLetter: count("dead_letter"),
        cancelled: count("cancelled"),
        oldestReadyAt: jobs
          .filter((job) => job.status === "ready")
          .sort((left, right) =>
            left.scheduledAt.localeCompare(right.scheduledAt),
          )[0]?.scheduledAt,
      };
    });
  }

  #required(id: string): DurableJob {
    const value = this.#jobs.get(operationsText(id, "job id"));
    if (!value) throw new OperationsValidationError("job does not exist");
    return value;
  }
  #running(
    id: string,
    workerId: string,
    expectedVersion: number,
    now: Date,
  ): DurableJob {
    const current = this.#required(id);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError("job version does not match");
    if (current.status !== "running")
      throw new OperationsConflictError("job is not running");
    if (current.leaseOwner !== workerId)
      throw new OperationsConflictError("job is leased by another worker");
    if (!current.leaseExpiresAt || new Date(current.leaseExpiresAt) <= now)
      throw new OperationsConflictError("job lease has expired");
    return current;
  }
  #finishAttempt(
    jobId: string,
    number: number,
    outcome: JobAttempt["outcome"],
    error: string | undefined,
    at: Date,
  ): void {
    const attempt = [...this.#attempts]
      .reverse()
      .find(
        (value) =>
          value.jobId === jobId && value.number === number && !value.finishedAt,
      );
    if (attempt) {
      attempt.finishedAt = at.toISOString();
      attempt.outcome = outcome;
      attempt.error = error;
    }
  }
  #delay(type: string, attempt: number, id: string): number {
    const policy = this.#retryPolicies.get(type) ?? defaultRetry;
    const base = Math.min(
      policy.maximumDelaySeconds,
      policy.initialDelaySeconds *
        policy.multiplier ** Math.max(0, attempt - 1),
    );
    if (policy.jitter === 0) return Math.round(base);
    const bucket =
      Number.parseInt(
        createHash("sha256")
          .update(`${id}:${attempt}`)
          .digest("hex")
          .slice(0, 8),
        16,
      ) / 0xffffffff;
    return Math.max(
      1,
      Math.round(base * (1 - policy.jitter + bucket * policy.jitter * 2)),
    );
  }
  #newId(type: string, now: Date): string {
    this.#serial += 1;
    return `job_${createHash("sha256").update(`${type}:${now.toISOString()}:${this.#serial}`).digest("hex").slice(0, 24)}`;
  }
}

function validateRetryPolicy(value: RetryPolicy): RetryPolicy {
  if (
    !Number.isFinite(value.initialDelaySeconds) ||
    value.initialDelaySeconds < 0
  )
    throw new OperationsValidationError("initial retry delay is invalid");
  if (
    !Number.isFinite(value.maximumDelaySeconds) ||
    value.maximumDelaySeconds < value.initialDelaySeconds
  )
    throw new OperationsValidationError("maximum retry delay is invalid");
  if (!Number.isFinite(value.multiplier) || value.multiplier < 1)
    throw new OperationsValidationError("retry multiplier is invalid");
  if (!Number.isFinite(value.jitter) || value.jitter < 0 || value.jitter > 1)
    throw new OperationsValidationError("retry jitter is invalid");
  return { ...value };
}
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}
function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    throw new OperationsValidationError("job data must be cloneable");
  }
}
function cloneJob<T>(value: DurableJob<T>): DurableJob<T> {
  return {
    ...value,
    payload: cloneValue(value.payload),
    result: cloneValue(value.result),
  };
}
