import { randomUUID } from "node:crypto";
import { AdminConflictError, AdminValidationError, required, validDate } from "./access.ts";

export interface ApprovalPolicy {
  action: string;
  requiredApprovals: number;
  distinctTeams: boolean;
  expiresAfterMs: number;
}

export interface ApprovalVote {
  operatorId: string;
  team: string;
  decision: "approve" | "reject";
  reason?: string;
  decidedAt: Date;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestedBy: string;
  requestedByTeam: string;
  requestedAt: Date;
  expiresAt: Date;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  payload: Readonly<Record<string, string | number | boolean | null>>;
  votes: readonly ApprovalVote[];
  version: number;
}

export class AdministrativeApprovals {
  private readonly policies = new Map<string, ApprovalPolicy>();
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly activeResources = new Map<string, string>();

  configure(policy: ApprovalPolicy): ApprovalPolicy {
    const action = required(policy.action, "approval action");
    if (!Number.isInteger(policy.requiredApprovals) || policy.requiredApprovals < 1 || policy.requiredApprovals > 10) {
      throw new AdminValidationError("required approval count is invalid");
    }
    if (!Number.isInteger(policy.expiresAfterMs) || policy.expiresAfterMs <= 0) {
      throw new AdminValidationError("approval expiry must be positive");
    }
    const normalized = { ...policy, action };
    this.policies.set(action, normalized);
    return { ...normalized };
  }

  request(
    action: string,
    resourceType: string,
    resourceId: string,
    requestedBy: string,
    requestedByTeam: string,
    payload: Readonly<Record<string, string | number | boolean | null>>,
    at = new Date(),
  ): ApprovalRequest {
    const normalizedAction = required(action, "approval action");
    const policy = this.policies.get(normalizedAction);
    if (!policy) throw new AdminValidationError("approval policy does not exist");
    const resourceKey = `${normalizedAction}:${resourceType}:${resourceId}`;
    const existingId = this.activeResources.get(resourceKey);
    if (existingId) return cloneRequest(this.requests.get(existingId)!);
    const requestedAt = validDate(at);
    const request: ApprovalRequest = {
      id: randomUUID(),
      action: normalizedAction,
      resourceType: required(resourceType, "resource type"),
      resourceId: required(resourceId, "resource id"),
      requestedBy: required(requestedBy, "requesting operator"),
      requestedByTeam: required(requestedByTeam, "requesting team"),
      requestedAt,
      expiresAt: new Date(requestedAt.getTime() + policy.expiresAfterMs),
      status: "pending",
      payload: { ...payload },
      votes: [],
      version: 1,
    };
    this.requests.set(request.id, request);
    this.activeResources.set(resourceKey, request.id);
    return cloneRequest(request);
  }

  decide(
    requestId: string,
    expectedVersion: number,
    operatorId: string,
    team: string,
    decision: ApprovalVote["decision"],
    reason?: string,
    at = new Date(),
  ): ApprovalRequest {
    const current = this.requireVersion(requestId, expectedVersion);
    const now = validDate(at);
    if (current.status !== "pending") throw new AdminConflictError("approval request is not pending");
    if (now >= current.expiresAt) return this.expire(current);
    const normalizedOperator = required(operatorId, "deciding operator");
    if (normalizedOperator === current.requestedBy) throw new AdminConflictError("requester cannot approve their own action");
    if (current.votes.some((vote) => vote.operatorId === normalizedOperator)) throw new AdminConflictError("operator already voted");
    const vote: ApprovalVote = {
      operatorId: normalizedOperator,
      team: required(team, "deciding team"),
      decision,
      reason: reason?.trim() || undefined,
      decidedAt: now,
    };
    const votes = [...current.votes, vote];
    const policy = this.policies.get(current.action)!;
    let status: ApprovalRequest["status"] = "pending";
    if (decision === "reject") {
      status = "rejected";
    } else {
      const approvals = votes.filter((item) => item.decision === "approve");
      const enoughPeople = approvals.length >= policy.requiredApprovals;
      const enoughTeams = !policy.distinctTeams || new Set(approvals.map((item) => item.team)).size >= policy.requiredApprovals;
      if (enoughPeople && enoughTeams) status = "approved";
    }
    const updated = { ...current, votes, status, version: current.version + 1 };
    this.requests.set(updated.id, updated);
    if (status !== "pending") this.releaseResource(updated);
    return cloneRequest(updated);
  }

  cancel(requestId: string, expectedVersion: number, operatorId: string): ApprovalRequest {
    const current = this.requireVersion(requestId, expectedVersion);
    if (current.status !== "pending") throw new AdminConflictError("approval request is not pending");
    if (current.requestedBy !== operatorId.trim()) throw new AdminConflictError("only requester can cancel approval");
    const updated = { ...current, status: "cancelled" as const, version: current.version + 1 };
    this.requests.set(updated.id, updated);
    this.releaseResource(updated);
    return cloneRequest(updated);
  }

  expireDue(at = new Date()): number {
    let count = 0;
    for (const request of this.requests.values()) {
      if (request.status !== "pending" || request.expiresAt > at) continue;
      this.expire(request);
      count += 1;
    }
    return count;
  }

  private expire(current: ApprovalRequest): ApprovalRequest {
    const updated = { ...current, status: "expired" as const, version: current.version + 1 };
    this.requests.set(updated.id, updated);
    this.releaseResource(updated);
    return cloneRequest(updated);
  }

  private releaseResource(request: ApprovalRequest): void {
    this.activeResources.delete(`${request.action}:${request.resourceType}:${request.resourceId}`);
  }

  private requireVersion(requestId: string, expectedVersion: number): ApprovalRequest {
    const request = this.requests.get(required(requestId, "approval request id"));
    if (!request) throw new AdminValidationError("approval request does not exist");
    if (request.version !== expectedVersion) throw new AdminConflictError("approval request version does not match");
    return request;
  }
}

function cloneRequest(value: ApprovalRequest): ApprovalRequest {
  return {
    ...value,
    requestedAt: new Date(value.requestedAt),
    expiresAt: new Date(value.expiresAt),
    payload: { ...value.payload },
    votes: value.votes.map((vote) => ({ ...vote, decidedAt: new Date(vote.decidedAt) })),
  };
}

