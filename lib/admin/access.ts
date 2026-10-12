import { randomUUID } from "node:crypto";

export type AdminPermission =
  | "players.read"
  | "players.restrict"
  | "payments.read"
  | "payments.refund"
  | "bonuses.manage"
  | "fraud.investigate"
  | "support.respond"
  | "reports.export"
  | "settings.manage"
  | "admins.manage";

export interface AdminRole {
  id: string;
  name: string;
  permissions: readonly AdminPermission[];
  builtIn: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface AdminMembership {
  id: string;
  operatorId: string;
  roleIds: readonly string[];
  status: "invited" | "active" | "suspended" | "revoked";
  invitedBy: string;
  invitedAt: Date;
  activatedAt?: Date;
  expiresAt?: Date;
  version: number;
}

export class AdminValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminValidationError";
  }
}

export class AdminConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminConflictError";
  }
}

const ALL_PERMISSIONS = new Set<AdminPermission>([
  "players.read", "players.restrict", "payments.read", "payments.refund", "bonuses.manage",
  "fraud.investigate", "support.respond", "reports.export", "settings.manage", "admins.manage",
]);

export class AdminAccessControl {
  private readonly roles = new Map<string, AdminRole>();
  private readonly memberships = new Map<string, AdminMembership>();
  private readonly membershipByOperator = new Map<string, string>();

  createRole(name: string, permissions: readonly AdminPermission[], builtIn = false, at = new Date()): AdminRole {
    const normalizedName = required(name, "role name");
    if ([...this.roles.values()].some((role) => role.name.toLowerCase() === normalizedName.toLowerCase())) {
      throw new AdminConflictError("role name already exists");
    }
    const now = validDate(at);
    const role: AdminRole = {
      id: randomUUID(),
      name: normalizedName,
      permissions: normalizePermissions(permissions),
      builtIn,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.roles.set(role.id, role);
    return cloneRole(role);
  }

  updateRole(roleId: string, expectedVersion: number, permissions: readonly AdminPermission[], at = new Date()): AdminRole {
    const current = this.requireRoleVersion(roleId, expectedVersion);
    if (current.builtIn) throw new AdminConflictError("built-in roles cannot be edited");
    const updated = {
      ...current,
      permissions: normalizePermissions(permissions),
      updatedAt: validDate(at),
      version: current.version + 1,
    };
    this.roles.set(updated.id, updated);
    return cloneRole(updated);
  }

  invite(
    operatorId: string,
    roleIds: readonly string[],
    invitedBy: string,
    options: { at?: Date; expiresAt?: Date } = {},
  ): AdminMembership {
    const normalizedOperatorId = required(operatorId, "operator id");
    if (this.membershipByOperator.has(normalizedOperatorId)) throw new AdminConflictError("operator already has a membership");
    const normalizedRoleIds = normalizeRoleIds(roleIds, this.roles);
    const invitedAt = validDate(options.at ?? new Date());
    const expiresAt = options.expiresAt ? validDate(options.expiresAt) : undefined;
    if (expiresAt && expiresAt <= invitedAt) throw new AdminValidationError("membership expiry must follow invitation");
    const membership: AdminMembership = {
      id: randomUUID(),
      operatorId: normalizedOperatorId,
      roleIds: normalizedRoleIds,
      status: "invited",
      invitedBy: required(invitedBy, "inviting operator"),
      invitedAt,
      expiresAt,
      version: 1,
    };
    this.memberships.set(membership.id, membership);
    this.membershipByOperator.set(normalizedOperatorId, membership.id);
    return cloneMembership(membership);
  }

  activate(membershipId: string, expectedVersion: number, at = new Date()): AdminMembership {
    const current = this.requireMembershipVersion(membershipId, expectedVersion);
    const now = validDate(at);
    if (current.status !== "invited") throw new AdminConflictError("membership is not awaiting activation");
    if (current.expiresAt && current.expiresAt <= now) throw new AdminConflictError("membership invitation expired");
    return this.saveMembership({ ...current, status: "active", activatedAt: now, version: current.version + 1 });
  }

  replaceRoles(membershipId: string, expectedVersion: number, roleIds: readonly string[]): AdminMembership {
    const current = this.requireMembershipVersion(membershipId, expectedVersion);
    if (current.status === "revoked") throw new AdminConflictError("revoked membership cannot change");
    return this.saveMembership({ ...current, roleIds: normalizeRoleIds(roleIds, this.roles), version: current.version + 1 });
  }

  suspend(membershipId: string, expectedVersion: number): AdminMembership {
    const current = this.requireMembershipVersion(membershipId, expectedVersion);
    if (current.status !== "active") throw new AdminConflictError("only active membership can be suspended");
    return this.saveMembership({ ...current, status: "suspended", version: current.version + 1 });
  }

  restore(membershipId: string, expectedVersion: number): AdminMembership {
    const current = this.requireMembershipVersion(membershipId, expectedVersion);
    if (current.status !== "suspended") throw new AdminConflictError("membership is not suspended");
    return this.saveMembership({ ...current, status: "active", version: current.version + 1 });
  }

  revoke(membershipId: string, expectedVersion: number): AdminMembership {
    const current = this.requireMembershipVersion(membershipId, expectedVersion);
    if (current.status === "revoked") return cloneMembership(current);
    return this.saveMembership({ ...current, status: "revoked", version: current.version + 1 });
  }

  permissionsFor(operatorId: string, at = new Date()): readonly AdminPermission[] {
    const id = this.membershipByOperator.get(operatorId.trim());
    const membership = id ? this.memberships.get(id) : undefined;
    if (!membership || membership.status !== "active" || (membership.expiresAt && membership.expiresAt <= at)) return [];
    return [...new Set(membership.roleIds.flatMap((roleId) => this.roles.get(roleId)?.permissions ?? []))].sort();
  }

  authorize(operatorId: string, permission: AdminPermission, at = new Date()): void {
    if (!this.permissionsFor(operatorId, at).includes(permission)) {
      throw new AdminConflictError(`operator is not authorized for ${permission}`);
    }
  }

  private requireRoleVersion(roleId: string, expectedVersion: number): AdminRole {
    const role = this.roles.get(required(roleId, "role id"));
    if (!role) throw new AdminValidationError("admin role does not exist");
    if (role.version !== expectedVersion) throw new AdminConflictError("admin role version does not match");
    return role;
  }

  private requireMembershipVersion(membershipId: string, expectedVersion: number): AdminMembership {
    const membership = this.memberships.get(required(membershipId, "membership id"));
    if (!membership) throw new AdminValidationError("admin membership does not exist");
    if (membership.version !== expectedVersion) throw new AdminConflictError("admin membership version does not match");
    return membership;
  }

  private saveMembership(value: AdminMembership): AdminMembership {
    this.memberships.set(value.id, value);
    return cloneMembership(value);
  }
}

export function required(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AdminValidationError(`${field} is required`);
  return value.trim();
}

export function validDate(value: Date): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AdminValidationError("date is invalid");
  return date;
}

function normalizePermissions(values: readonly AdminPermission[]): AdminPermission[] {
  if (values.length === 0) throw new AdminValidationError("role requires at least one permission");
  for (const value of values) if (!ALL_PERMISSIONS.has(value)) throw new AdminValidationError(`unknown admin permission: ${value}`);
  return [...new Set(values)].sort();
}

function normalizeRoleIds(values: readonly string[], roles: ReadonlyMap<string, AdminRole>): string[] {
  const ids = [...new Set(values.map((value) => required(value, "role id")))];
  if (ids.length === 0) throw new AdminValidationError("membership requires at least one role");
  for (const id of ids) if (!roles.has(id)) throw new AdminValidationError(`admin role does not exist: ${id}`);
  return ids.sort();
}

function cloneRole(value: AdminRole): AdminRole {
  return { ...value, permissions: [...value.permissions], createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}

function cloneMembership(value: AdminMembership): AdminMembership {
  return {
    ...value,
    roleIds: [...value.roleIds],
    invitedAt: new Date(value.invitedAt),
    activatedAt: value.activatedAt ? new Date(value.activatedAt) : undefined,
    expiresAt: value.expiresAt ? new Date(value.expiresAt) : undefined,
  };
}

