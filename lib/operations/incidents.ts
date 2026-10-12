import {
  type IncidentAction,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentUpdate,
  type OperationalIncident,
  OperationsConflictError,
  OperationsValidationError,
  operationsDate,
  operationsText,
} from "./types.ts";

export interface DeclareIncidentInput {
  id: string;
  title: string;
  summary: string;
  severity: IncidentSeverity;
  commanderId: string;
  serviceIds: readonly string[];
  channel?: string;
  declaredAt?: Date;
}

export interface IncidentMetrics {
  incidentCount: number;
  resolvedCount: number;
  meanAcknowledgeMinutes?: number;
  meanResolveMinutes?: number;
  bySeverity: Readonly<Record<IncidentSeverity, number>>;
}

const transitions: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> =
  {
    declared: ["investigating", "resolved"],
    investigating: ["identified", "monitoring", "resolved"],
    identified: ["investigating", "monitoring", "resolved"],
    monitoring: ["investigating", "identified", "resolved"],
    resolved: ["investigating", "closed"],
    closed: [],
  };

export class IncidentManagementService {
  readonly #incidents = new Map<string, OperationalIncident>();

  declare(input: DeclareIncidentInput): OperationalIncident {
    const id = operationsText(input.id, "incident id");
    if (this.#incidents.has(id))
      throw new OperationsConflictError("incident already exists");
    const declaredAt = input.declaredAt ?? new Date();
    const value: OperationalIncident = {
      id,
      title: operationsText(input.title, "incident title"),
      summary: operationsText(input.summary, "incident summary"),
      severity: input.severity,
      status: "declared",
      commanderId: operationsText(input.commanderId, "incident commander"),
      serviceIds: unique(input.serviceIds, "service id"),
      channel: input.channel?.trim(),
      declaredAt: declaredAt.toISOString(),
      updates: [
        {
          id: `${id}:declared`,
          status: "declared",
          message: input.summary.trim(),
          authorId: input.commanderId.trim(),
          customerVisible: false,
          createdAt: declaredAt.toISOString(),
        },
      ],
      actionItems: [],
      version: 1,
    };
    if (!value.serviceIds.length)
      throw new OperationsValidationError(
        "incident needs at least one affected service",
      );
    this.#incidents.set(value.id, value);
    return cloneIncident(value);
  }

  acknowledge(
    id: string,
    actorId: string,
    expectedVersion: number,
    at = new Date(),
  ): OperationalIncident {
    return this.#change(id, expectedVersion, (value) => {
      if (value.acknowledgedAt)
        throw new OperationsConflictError("incident is already acknowledged");
      const update: IncidentUpdate = {
        id: `${value.id}:ack:${value.version + 1}`,
        status: value.status,
        message: "Incident acknowledged",
        authorId: operationsText(actorId, "incident actor"),
        customerVisible: false,
        createdAt: at.toISOString(),
      };
      return {
        ...value,
        acknowledgedAt: at.toISOString(),
        updates: [...value.updates, update],
      };
    });
  }

  update(
    id: string,
    input: Omit<IncidentUpdate, "status"> & { status?: IncidentStatus },
    expectedVersion: number,
  ): OperationalIncident {
    return this.#change(id, expectedVersion, (value) => {
      if (value.updates.some((update) => update.id === input.id))
        throw new OperationsConflictError("incident update already exists");
      const status = input.status ?? value.status;
      if (
        status !== value.status &&
        !transitions[value.status].includes(status)
      )
        throw new OperationsConflictError(
          `incident cannot move from ${value.status} to ${status}`,
        );
      const createdAt = operationsDate(input.createdAt, "incident update time");
      if (createdAt < new Date(value.declaredAt))
        throw new OperationsValidationError(
          "incident update cannot predate declaration",
        );
      const update: IncidentUpdate = {
        id: operationsText(input.id, "incident update id"),
        status,
        message: operationsText(input.message, "incident update message"),
        authorId: operationsText(input.authorId, "incident update author"),
        customerVisible: Boolean(input.customerVisible),
        createdAt: createdAt.toISOString(),
      };
      return {
        ...value,
        status,
        resolvedAt:
          status === "resolved"
            ? createdAt.toISOString()
            : status === "investigating" && value.status === "resolved"
              ? undefined
              : value.resolvedAt,
        closedAt:
          status === "closed" ? createdAt.toISOString() : value.closedAt,
        updates: [...value.updates, update],
      };
    });
  }

  changeSeverity(
    id: string,
    severity: IncidentSeverity,
    reason: string,
    actorId: string,
    expectedVersion: number,
    at = new Date(),
  ): OperationalIncident {
    return this.#change(id, expectedVersion, (value) => {
      if (value.status === "closed")
        throw new OperationsConflictError(
          "closed incidents cannot change severity",
        );
      const update: IncidentUpdate = {
        id: `${value.id}:severity:${value.version + 1}`,
        status: value.status,
        message: `${operationsText(reason, "severity change reason")} (${value.severity} -> ${severity})`,
        authorId: operationsText(actorId, "incident actor"),
        customerVisible: false,
        createdAt: at.toISOString(),
      };
      return { ...value, severity, updates: [...value.updates, update] };
    });
  }

  transferCommand(
    id: string,
    commanderId: string,
    reason: string,
    expectedVersion: number,
    at = new Date(),
  ): OperationalIncident {
    return this.#change(id, expectedVersion, (value) => {
      if (value.status === "closed")
        throw new OperationsConflictError(
          "closed incidents cannot transfer command",
        );
      const commander = operationsText(commanderId, "incident commander");
      const update: IncidentUpdate = {
        id: `${value.id}:commander:${value.version + 1}`,
        status: value.status,
        message: `Command transferred from ${value.commanderId} to ${commander}: ${operationsText(reason, "transfer reason")}`,
        authorId: commander,
        customerVisible: false,
        createdAt: at.toISOString(),
      };
      return {
        ...value,
        commanderId: commander,
        updates: [...value.updates, update],
      };
    });
  }

  addAction(
    id: string,
    input: Omit<IncidentAction, "status" | "completedAt">,
    expectedVersion: number,
  ): OperationalIncident {
    return this.#change(id, expectedVersion, (value) => {
      if (value.actionItems.some((action) => action.id === input.id))
        throw new OperationsConflictError("incident action already exists");
      const createdAt = operationsDate(input.createdAt, "action creation time");
      const dueAt = input.dueAt
        ? operationsDate(input.dueAt, "action due time")
        : undefined;
      if (dueAt && dueAt <= createdAt)
        throw new OperationsValidationError(
          "action due time must follow creation",
        );
      const action: IncidentAction = {
        id: operationsText(input.id, "action id"),
        title: operationsText(input.title, "action title"),
        ownerId: operationsText(input.ownerId, "action owner"),
        dueAt: dueAt?.toISOString(),
        status: "open",
        createdAt: createdAt.toISOString(),
      };
      return { ...value, actionItems: [...value.actionItems, action] };
    });
  }

  changeAction(
    id: string,
    actionId: string,
    status: IncidentAction["status"],
    expectedVersion: number,
    at = new Date(),
  ): OperationalIncident {
    return this.#change(id, expectedVersion, (value) => {
      const action = value.actionItems.find((item) => item.id === actionId);
      if (!action)
        throw new OperationsValidationError("incident action does not exist");
      if (["done", "cancelled"].includes(action.status))
        throw new OperationsConflictError(
          "completed incident actions cannot change",
        );
      if (status === "open")
        throw new OperationsConflictError(
          "incident actions cannot return to open",
        );
      return {
        ...value,
        actionItems: value.actionItems.map((item) =>
          item.id === actionId
            ? {
                ...item,
                status,
                completedAt: ["done", "cancelled"].includes(status)
                  ? at.toISOString()
                  : undefined,
              }
            : item,
        ),
      };
    });
  }

  close(
    id: string,
    actorId: string,
    expectedVersion: number,
    at = new Date(),
  ): OperationalIncident {
    const current = this.#required(id);
    if (current.status !== "resolved")
      throw new OperationsConflictError(
        "incident must be resolved before closing",
      );
    if (
      current.actionItems.some(
        (action) => !["done", "cancelled"].includes(action.status),
      )
    )
      throw new OperationsConflictError("incident has unfinished actions");
    return this.update(
      id,
      {
        id: `${current.id}:closed`,
        message: "Incident review complete",
        authorId: actorId,
        customerVisible: false,
        createdAt: at.toISOString(),
        status: "closed",
      },
      expectedVersion,
    );
  }

  get(id: string): OperationalIncident | undefined {
    const value = this.#incidents.get(id.trim());
    return value ? cloneIncident(value) : undefined;
  }

  list(
    filters: {
      status?: IncidentStatus;
      severity?: IncidentSeverity;
      serviceId?: string;
      commanderId?: string;
      from?: Date;
      to?: Date;
    } = {},
  ): readonly OperationalIncident[] {
    return [...this.#incidents.values()]
      .filter((value) => !filters.status || value.status === filters.status)
      .filter(
        (value) => !filters.severity || value.severity === filters.severity,
      )
      .filter(
        (value) =>
          !filters.serviceId || value.serviceIds.includes(filters.serviceId),
      )
      .filter(
        (value) =>
          !filters.commanderId || value.commanderId === filters.commanderId,
      )
      .filter(
        (value) => !filters.from || new Date(value.declaredAt) >= filters.from,
      )
      .filter((value) => !filters.to || new Date(value.declaredAt) < filters.to)
      .sort(
        (left, right) =>
          severityRank(left.severity) - severityRank(right.severity) ||
          right.declaredAt.localeCompare(left.declaredAt),
      )
      .map(cloneIncident);
  }

  customerTimeline(id: string): readonly IncidentUpdate[] {
    return this.#required(id)
      .updates.filter((update) => update.customerVisible)
      .map((update) => ({ ...update }));
  }

  metrics(from?: Date, to?: Date): IncidentMetrics {
    const incidents = this.list({ from, to });
    const acknowledged = incidents.filter((value) => value.acknowledgedAt);
    const resolved = incidents.filter((value) => value.resolvedAt);
    const average = (values: number[]) =>
      values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : undefined;
    return {
      incidentCount: incidents.length,
      resolvedCount: resolved.length,
      meanAcknowledgeMinutes: average(
        acknowledged.map(
          (value) =>
            (new Date(value.acknowledgedAt!).getTime() -
              new Date(value.declaredAt).getTime()) /
            60_000,
        ),
      ),
      meanResolveMinutes: average(
        resolved.map(
          (value) =>
            (new Date(value.resolvedAt!).getTime() -
              new Date(value.declaredAt).getTime()) /
            60_000,
        ),
      ),
      bySeverity: {
        sev1: incidents.filter((value) => value.severity === "sev1").length,
        sev2: incidents.filter((value) => value.severity === "sev2").length,
        sev3: incidents.filter((value) => value.severity === "sev3").length,
        sev4: incidents.filter((value) => value.severity === "sev4").length,
      },
    };
  }

  #required(id: string): OperationalIncident {
    const value = this.#incidents.get(operationsText(id, "incident id"));
    if (!value) throw new OperationsValidationError("incident does not exist");
    return value;
  }
  #change(
    id: string,
    expectedVersion: number,
    change: (value: OperationalIncident) => OperationalIncident,
  ): OperationalIncident {
    const current = this.#required(id);
    if (current.version !== expectedVersion)
      throw new OperationsConflictError("incident version does not match");
    const changed = { ...change(current), version: current.version + 1 };
    this.#incidents.set(changed.id, changed);
    return cloneIncident(changed);
  }
}

function unique(values: readonly string[], field: string): string[] {
  return [
    ...new Set(values.map((value) => operationsText(value, field))),
  ].sort();
}
function severityRank(value: IncidentSeverity): number {
  return value === "sev1" ? 1 : value === "sev2" ? 2 : value === "sev3" ? 3 : 4;
}
function cloneIncident(value: OperationalIncident): OperationalIncident {
  return {
    ...value,
    serviceIds: [...value.serviceIds],
    updates: value.updates.map((update) => ({ ...update })),
    actionItems: value.actionItems.map((action) => ({ ...action })),
  };
}
