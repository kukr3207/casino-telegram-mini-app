import { randomUUID } from "node:crypto";

import {
  type MaintenanceWindow,
  type ReleaseCheck,
  type ReleasePlan,
  type ReleaseStatus,
  LiveOpsConflictError,
  LiveOpsValidationError,
  liveOpsDate,
  liveOpsText,
} from "./types.ts";

const releaseTransitions: Readonly<
  Record<ReleaseStatus, readonly ReleaseStatus[]>
> = {
  draft: ["approved", "failed"],
  approved: ["scheduled", "deploying", "failed"],
  scheduled: ["deploying", "failed"],
  deploying: ["completed", "failed", "rolled_back"],
  completed: ["rolled_back"],
  failed: [],
  rolled_back: [],
};

export class ReleaseService {
  readonly #releases = new Map<string, ReleasePlan>();
  readonly #resourceVersions = new Map<string, number>();

  create(
    value: Omit<ReleasePlan, "id" | "status" | "version"> & { id?: string },
  ): ReleasePlan {
    const plan = validateRelease({
      ...value,
      id: value.id ?? randomUUID(),
      status: "draft",
      version: 1,
    });
    if (this.#releases.has(plan.id))
      throw new LiveOpsConflictError("release id already exists");
    this.#releases.set(plan.id, plan);
    return cloneRelease(plan);
  }

  completeCheck(
    releaseId: string,
    expectedVersion: number,
    checkId: string,
    input: { passed: boolean; details?: string; actorId: string; at?: Date },
  ): ReleasePlan {
    const release = this.require(releaseId);
    this.assertVersion(release, expectedVersion);
    if (release.status !== "draft")
      throw new LiveOpsConflictError("release checks can only change in draft");
    const found = release.checks.some((check) => check.id === checkId);
    if (!found)
      throw new LiveOpsValidationError("release check does not exist");
    const checks = release.checks.map(
      (check): ReleaseCheck =>
        check.id === checkId
          ? {
              ...check,
              status: input.passed ? "passed" : "failed",
              details: input.details?.trim(),
              completedAt: (input.at ?? new Date()).toISOString(),
              completedBy: liveOpsText(input.actorId, "check actor"),
            }
          : check,
    );
    return this.save({ ...release, checks });
  }

  waiveCheck(
    releaseId: string,
    expectedVersion: number,
    checkId: string,
    actorId: string,
    reason: string,
  ): ReleasePlan {
    const release = this.require(releaseId);
    this.assertVersion(release, expectedVersion);
    const checks = release.checks.map(
      (check): ReleaseCheck =>
        check.id === checkId
          ? {
              ...check,
              status: "waived",
              details: liveOpsText(reason, "waiver reason"),
              completedAt: new Date().toISOString(),
              completedBy: liveOpsText(actorId, "waiver actor"),
            }
          : check,
    );
    if (!checks.some((check) => check.id === checkId))
      throw new LiveOpsValidationError("release check does not exist");
    return this.save({ ...release, checks });
  }

  approve(
    releaseId: string,
    expectedVersion: number,
    approverId: string,
  ): ReleasePlan {
    const release = this.require(releaseId);
    this.assertVersion(release, expectedVersion);
    if (release.requestedBy === approverId)
      throw new LiveOpsConflictError(
        "release requester cannot approve their own release",
      );
    const blocking = release.checks.filter(
      (check) => check.required && !["passed", "waived"].includes(check.status),
    );
    if (blocking.length)
      throw new LiveOpsConflictError("required release checks are incomplete");
    return this.transition(release, "approved", {
      approvedBy: liveOpsText(approverId, "release approver"),
    });
  }

  schedule(
    releaseId: string,
    expectedVersion: number,
    scheduledAt: Date,
  ): ReleasePlan {
    const release = this.require(releaseId);
    this.assertVersion(release, expectedVersion);
    if (scheduledAt <= new Date())
      throw new LiveOpsValidationError(
        "release schedule must be in the future",
      );
    return this.transition(release, "scheduled", {
      scheduledAt: scheduledAt.toISOString(),
    });
  }

  start(
    releaseId: string,
    expectedVersion: number,
    at = new Date(),
  ): ReleasePlan {
    const release = this.require(releaseId);
    this.assertVersion(release, expectedVersion);
    if (release.scheduledAt && at < new Date(release.scheduledAt))
      throw new LiveOpsConflictError("release schedule has not started");
    for (const change of release.changes) {
      const key = `${release.environment}:${change.kind}:${change.resourceId}`;
      const current = this.#resourceVersions.get(key);
      if (change.fromVersion !== undefined && current !== change.fromVersion)
        throw new LiveOpsConflictError(
          `resource ${change.resourceId} changed before deployment`,
        );
    }
    return this.transition(release, "deploying", {
      startedAt: at.toISOString(),
    });
  }

  complete(
    releaseId: string,
    expectedVersion: number,
    at = new Date(),
  ): ReleasePlan {
    const release = this.require(releaseId);
    this.assertVersion(release, expectedVersion);
    const completed = this.transition(release, "completed", {
      completedAt: at.toISOString(),
    });
    for (const change of release.changes)
      this.#resourceVersions.set(
        `${release.environment}:${change.kind}:${change.resourceId}`,
        change.toVersion,
      );
    return completed;
  }

  fail(
    releaseId: string,
    expectedVersion: number,
    reason: string,
    at = new Date(),
  ): ReleasePlan {
    const release = this.require(releaseId);
    this.assertVersion(release, expectedVersion);
    return this.transition(release, "failed", {
      failureReason: liveOpsText(reason, "failure reason"),
      completedAt: at.toISOString(),
    });
  }

  rollback(
    releaseId: string,
    expectedVersion: number,
    requestedBy: string,
  ): ReleasePlan {
    const release = this.require(releaseId);
    this.assertVersion(release, expectedVersion);
    if (release.status !== "completed")
      throw new LiveOpsConflictError(
        "only completed release can be rolled back",
      );
    const rollback = this.create({
      name: `Rollback ${release.name}`,
      environment: release.environment,
      changes: release.changes.map((change) => ({
        ...change,
        fromVersion: change.toVersion,
        toVersion: change.fromVersion ?? 0,
      })),
      checks: release.checks.map((check) => ({
        ...check,
        id: randomUUID(),
        status: "pending",
        completedAt: undefined,
        completedBy: undefined,
        details: undefined,
      })),
      requestedBy,
      rollbackOf: release.id,
    });
    this.#releases.set(release.id, {
      ...release,
      status: "rolled_back",
      version: release.version + 1,
    });
    return rollback;
  }

  release(releaseId: string): ReleasePlan | undefined {
    const value = this.#releases.get(releaseId.trim());
    return value ? cloneRelease(value) : undefined;
  }
  resourceVersion(
    environment: string,
    kind: string,
    resourceId: string,
  ): number | undefined {
    return this.#resourceVersions.get(`${environment}:${kind}:${resourceId}`);
  }
  private require(releaseId: string): ReleasePlan {
    const value = this.#releases.get(liveOpsText(releaseId, "release id"));
    if (!value) throw new LiveOpsValidationError("release does not exist");
    return value;
  }
  private assertVersion(release: ReleasePlan, expectedVersion: number): void {
    if (release.version !== expectedVersion)
      throw new LiveOpsConflictError("release version does not match");
  }
  private save(value: ReleasePlan): ReleasePlan {
    const changed = { ...value, version: value.version + 1 };
    this.#releases.set(changed.id, changed);
    return cloneRelease(changed);
  }
  private transition(
    release: ReleasePlan,
    status: ReleaseStatus,
    changes: Partial<ReleasePlan>,
  ): ReleasePlan {
    if (!releaseTransitions[release.status].includes(status))
      throw new LiveOpsConflictError(
        `cannot move release from ${release.status} to ${status}`,
      );
    return this.save({ ...release, ...changes, status });
  }
}

export class MaintenanceScheduler {
  readonly #windows = new Map<string, MaintenanceWindow>();

  schedule(value: MaintenanceWindow): MaintenanceWindow {
    const window = validateWindow(value);
    if (this.#windows.has(window.id))
      throw new LiveOpsConflictError("maintenance id already exists");
    for (const current of this.#windows.values()) {
      if (
        current.status === "cancelled" ||
        !current.services.some((service) => window.services.includes(service))
      )
        continue;
      if (
        new Date(window.startsAt) < new Date(current.endsAt) &&
        new Date(window.endsAt) > new Date(current.startsAt)
      )
        throw new LiveOpsConflictError(
          "maintenance windows overlap for a service",
        );
    }
    this.#windows.set(window.id, window);
    return cloneWindow(window);
  }

  transition(
    windowId: string,
    expectedVersion: number,
    status: MaintenanceWindow["status"],
  ): MaintenanceWindow {
    const current = this.#windows.get(windowId);
    if (!current)
      throw new LiveOpsValidationError("maintenance window does not exist");
    if (current.version !== expectedVersion)
      throw new LiveOpsConflictError("maintenance version does not match");
    const allowed: Readonly<
      Record<
        MaintenanceWindow["status"],
        readonly MaintenanceWindow["status"][]
      >
    > = {
      scheduled: ["active", "cancelled"],
      active: ["completed"],
      completed: [],
      cancelled: [],
    };
    if (!allowed[current.status].includes(status))
      throw new LiveOpsConflictError(
        `cannot move maintenance from ${current.status} to ${status}`,
      );
    const changed = { ...current, status, version: current.version + 1 };
    this.#windows.set(changed.id, changed);
    return cloneWindow(changed);
  }

  activeFor(
    service: string,
    country: string | undefined,
    at = new Date(),
  ): readonly MaintenanceWindow[] {
    const normalizedCountry = country?.toUpperCase();
    return [...this.#windows.values()]
      .filter(
        (window) =>
          window.status !== "cancelled" &&
          window.services.includes(service) &&
          new Date(window.startsAt) <= at &&
          new Date(window.endsAt) > at &&
          (!window.countries ||
            Boolean(
              normalizedCountry && window.countries.includes(normalizedCountry),
            )),
      )
      .map(cloneWindow);
  }

  message(windowId: string, locale: string, fallback = "en"): string {
    const window = this.#windows.get(windowId);
    if (!window)
      throw new LiveOpsValidationError("maintenance window does not exist");
    return (
      window.messageByLocale[locale] ??
      window.messageByLocale[fallback] ??
      Object.values(window.messageByLocale)[0]
    );
  }
}

function validateRelease(value: ReleasePlan): ReleasePlan {
  if (!value.changes.length)
    throw new LiveOpsValidationError("release requires changes");
  const keys = value.changes.map(
    (change) => `${change.kind}:${change.resourceId}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new LiveOpsValidationError("release contains duplicate resources");
  if (value.checks.length === 0)
    throw new LiveOpsValidationError("release requires checks");
  return {
    ...value,
    id: liveOpsText(value.id, "release id"),
    name: liveOpsText(value.name, "release name"),
    environment: liveOpsText(value.environment, "release environment"),
    requestedBy: liveOpsText(value.requestedBy, "release requester"),
    changes: value.changes.map((change) => ({
      ...change,
      resourceId: liveOpsText(change.resourceId, "release resource"),
    })),
    checks: value.checks.map((check) => ({
      ...check,
      id: liveOpsText(check.id, "check id"),
      name: liveOpsText(check.name, "check name"),
    })),
  };
}
function validateWindow(value: MaintenanceWindow): MaintenanceWindow {
  const startsAt = liveOpsDate(value.startsAt, "maintenance start");
  const endsAt = liveOpsDate(value.endsAt, "maintenance end");
  if (endsAt <= startsAt)
    throw new LiveOpsValidationError("maintenance end must follow start");
  if (!value.services.length)
    throw new LiveOpsValidationError("maintenance requires a service");
  if (!Object.keys(value.messageByLocale).length)
    throw new LiveOpsValidationError("maintenance requires a message");
  return {
    ...value,
    id: liveOpsText(value.id, "maintenance id"),
    name: liveOpsText(value.name, "maintenance name"),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    services: [
      ...new Set(
        value.services.map((service) => liveOpsText(service, "service")),
      ),
    ].sort(),
    countries: value.countries
      ? [
          ...new Set(value.countries.map((country) => country.toUpperCase())),
        ].sort()
      : undefined,
    messageByLocale: { ...value.messageByLocale },
    createdBy: liveOpsText(value.createdBy, "maintenance creator"),
  };
}
function cloneRelease(value: ReleasePlan): ReleasePlan {
  return {
    ...value,
    changes: value.changes.map((change) => ({ ...change })),
    checks: value.checks.map((check) => ({ ...check })),
  };
}
function cloneWindow(value: MaintenanceWindow): MaintenanceWindow {
  return {
    ...value,
    services: [...value.services],
    countries: value.countries ? [...value.countries] : undefined,
    messageByLocale: { ...value.messageByLocale },
  };
}
