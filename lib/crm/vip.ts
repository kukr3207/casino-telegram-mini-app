import { randomUUID } from "node:crypto";

import {
  type VipCase,
  type VipCaseStatus,
  type VipInteraction,
  type VipProfile,
  CrmConflictError,
  CrmValidationError,
  crmDate,
  crmText,
} from "./types.ts";

const caseTransitions: Readonly<
  Record<VipCaseStatus, readonly VipCaseStatus[]>
> = {
  open: ["in_progress", "waiting_player", "resolved", "cancelled"],
  in_progress: ["waiting_player", "resolved", "cancelled"],
  waiting_player: ["in_progress", "resolved", "cancelled"],
  resolved: ["open"],
  cancelled: ["open"],
};

export class VipService {
  readonly #profiles = new Map<string, VipProfile>();
  readonly #cases = new Map<string, VipCase>();

  upsertProfile(value: VipProfile, expectedVersion?: number): VipProfile {
    const profile = validateProfile(value);
    const current = this.#profiles.get(profile.playerId);
    if (current && expectedVersion !== current.version)
      throw new CrmConflictError("VIP profile version does not match");
    if (!current && expectedVersion !== undefined && expectedVersion !== 0)
      throw new CrmConflictError(
        "new VIP profile expected version must be zero",
      );
    const changed = { ...profile, version: (current?.version ?? 0) + 1 };
    this.#profiles.set(changed.playerId, changed);
    return cloneProfile(changed);
  }

  assignHost(
    playerId: string,
    expectedVersion: number,
    hostId: string | undefined,
  ): VipProfile {
    const profile = this.requireProfile(playerId);
    if (profile.version !== expectedVersion)
      throw new CrmConflictError("VIP profile version does not match");
    const changed = {
      ...profile,
      hostId: hostId ? crmText(hostId, "host id") : undefined,
      version: profile.version + 1,
    };
    this.#profiles.set(changed.playerId, changed);
    return cloneProfile(changed);
  }

  createCase(
    input: Omit<
      VipCase,
      "id" | "status" | "createdAt" | "updatedAt" | "interactions" | "version"
    > & { id?: string; createdAt?: Date },
  ): VipCase {
    this.requireProfile(input.playerId);
    const at = input.createdAt ?? new Date();
    const value: VipCase = {
      ...input,
      id: input.id ?? randomUUID(),
      status: "open",
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      interactions: [],
      version: 1,
    };
    const item = validateCase(value);
    if (this.#cases.has(item.id))
      throw new CrmConflictError("VIP case id already exists");
    this.#cases.set(item.id, item);
    return cloneCase(item);
  }

  assignCase(caseId: string, expectedVersion: number, hostId: string): VipCase {
    const item = this.requireCase(caseId);
    this.assertVersion(item, expectedVersion);
    return this.saveCase({
      ...item,
      hostId: crmText(hostId, "host id"),
      status: item.status === "open" ? "in_progress" : item.status,
    });
  }
  addInteraction(
    caseId: string,
    expectedVersion: number,
    interaction: VipInteraction,
  ): VipCase {
    const item = this.requireCase(caseId);
    this.assertVersion(item, expectedVersion);
    if (["resolved", "cancelled"].includes(item.status))
      throw new CrmConflictError("closed VIP case cannot receive interactions");
    const normalized = validateInteraction(interaction);
    if (item.interactions.some((current) => current.id === normalized.id))
      return cloneCase(item);
    return this.saveCase({
      ...item,
      interactions: [...item.interactions, normalized],
    });
  }
  transitionCase(
    caseId: string,
    expectedVersion: number,
    status: VipCaseStatus,
    resolution?: string,
  ): VipCase {
    const item = this.requireCase(caseId);
    this.assertVersion(item, expectedVersion);
    if (
      status !== item.status &&
      !caseTransitions[item.status].includes(status)
    )
      throw new CrmConflictError(
        `cannot move VIP case from ${item.status} to ${status}`,
      );
    if (status === "resolved" && !resolution?.trim())
      throw new CrmValidationError("resolved VIP case requires a resolution");
    return this.saveCase({
      ...item,
      status,
      resolution:
        status === "resolved"
          ? crmText(resolution!, "case resolution")
          : undefined,
    });
  }

  workload(hostId: string): readonly VipCase[] {
    return [...this.#cases.values()]
      .filter(
        (item) =>
          item.hostId === hostId &&
          !["resolved", "cancelled"].includes(item.status),
      )
      .sort(
        (left, right) =>
          priorityRank(right.priority) - priorityRank(left.priority) ||
          (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999") ||
          left.createdAt.localeCompare(right.createdAt),
      )
      .map(cloneCase);
  }
  overdue(at = new Date()): readonly VipCase[] {
    return [...this.#cases.values()]
      .filter(
        (item) =>
          item.dueAt &&
          new Date(item.dueAt) < at &&
          !["resolved", "cancelled"].includes(item.status),
      )
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
      .map(cloneCase);
  }
  profile(playerId: string): VipProfile | undefined {
    const value = this.#profiles.get(playerId.trim());
    return value ? cloneProfile(value) : undefined;
  }
  casesForPlayer(playerId: string): readonly VipCase[] {
    return [...this.#cases.values()]
      .filter((item) => item.playerId === playerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(cloneCase);
  }
  private requireProfile(id: string): VipProfile {
    const value = this.#profiles.get(crmText(id, "player id"));
    if (!value) throw new CrmValidationError("VIP profile does not exist");
    return value;
  }
  private requireCase(id: string): VipCase {
    const value = this.#cases.get(crmText(id, "case id"));
    if (!value) throw new CrmValidationError("VIP case does not exist");
    return value;
  }
  private assertVersion(item: VipCase, version: number): void {
    if (item.version !== version)
      throw new CrmConflictError("VIP case version does not match");
  }
  private saveCase(value: VipCase): VipCase {
    const changed = {
      ...value,
      updatedAt: new Date().toISOString(),
      version: value.version + 1,
    };
    this.#cases.set(changed.id, changed);
    return cloneCase(changed);
  }
}

function validateProfile(value: VipProfile): VipProfile {
  return {
    ...value,
    playerId: crmText(value.playerId, "player id"),
    hostId: value.hostId?.trim() || undefined,
    interests: normalized(value.interests),
    restrictions: normalized(value.restrictions),
    serviceNotes: value.serviceNotes.trim(),
    reviewAt: value.reviewAt
      ? crmDate(value.reviewAt, "profile review").toISOString()
      : undefined,
  };
}
function validateCase(value: VipCase): VipCase {
  return {
    ...value,
    id: crmText(value.id, "case id"),
    playerId: crmText(value.playerId, "player id"),
    subject: crmText(value.subject, "case subject"),
    description: crmText(value.description, "case description"),
    dueAt: value.dueAt
      ? crmDate(value.dueAt, "case due time").toISOString()
      : undefined,
    createdAt: crmDate(value.createdAt, "case creation").toISOString(),
    updatedAt: crmDate(value.updatedAt, "case update").toISOString(),
    interactions: value.interactions.map(validateInteraction),
  };
}
function validateInteraction(value: VipInteraction): VipInteraction {
  return {
    ...value,
    id: crmText(value.id, "interaction id"),
    actorId: crmText(value.actorId, "interaction actor"),
    summary: crmText(value.summary, "interaction summary"),
    occurredAt: crmDate(value.occurredAt, "interaction time").toISOString(),
  };
}
function normalized(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.map((value) =>
        crmText(value, "profile list item").toLocaleLowerCase(),
      ),
    ),
  ].sort();
}
function priorityRank(value: VipCase["priority"]): number {
  return { low: 0, normal: 1, high: 2, urgent: 3 }[value];
}
function cloneProfile(value: VipProfile): VipProfile {
  return {
    ...value,
    interests: [...value.interests],
    restrictions: [...value.restrictions],
  };
}
function cloneCase(value: VipCase): VipCase {
  return {
    ...value,
    interactions: value.interactions.map((interaction) => ({ ...interaction })),
  };
}
