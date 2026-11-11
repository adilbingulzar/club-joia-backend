import type { Role } from "@/generated/prisma/enums";

/**
 * Single source of truth for role-based access control.
 * Every service checks these permissions server-side; UI only uses them to decide what to show.
 */
export const PERMISSIONS = [
  // member self-service
  "self:profile",
  "self:membership",
  "self:tickets",
  "self:concierge",
  "self:notifications",
  "events:view",
  // staff
  "scan:validate",
  "scan:check_in",
  "concierge:view_all",
  "concierge:manage",
  "concierge:internal_notes",
  "members:view_basic",
  "members:view",
  "members:manage",
  "memberships:manage",
  "tiers:manage",
  "events:manage",
  "programme:manage",
  "tickets:view",
  "tickets:manage",
  "scans:view",
  "notifications:send",
  "dashboard:view",
  "audit:view",
  "staff:manage",
  "settings:manage",
  "admin:access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MEMBER: Permission[] = [
  "self:profile",
  "self:membership",
  "self:tickets",
  "self:concierge",
  "self:notifications",
  "events:view",
];

const CHECK_IN_STAFF: Permission[] = ["scan:validate", "scan:check_in", "events:view"];

const CONCIERGE: Permission[] = [
  "concierge:view_all",
  "concierge:manage",
  "concierge:internal_notes",
  "members:view_basic",
  "events:view",
  "admin:access",
];

const ADMIN: Permission[] = [
  ...CONCIERGE,
  ...CHECK_IN_STAFF,
  "members:view",
  "members:manage",
  "memberships:manage",
  "tiers:manage",
  "programme:manage",
  "tickets:view",
  "tickets:manage",
  "scans:view",
  "notifications:send",
  "dashboard:view",
  "audit:view",
];

const SUPER_ADMIN: Permission[] = [...ADMIN, "staff:manage", "settings:manage", "events:manage"];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  MEMBER: new Set(MEMBER),
  CHECK_IN_STAFF: new Set(CHECK_IN_STAFF),
  CONCIERGE: new Set(CONCIERGE),
  ADMIN: new Set(ADMIN),
  SUPER_ADMIN: new Set(SUPER_ADMIN),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export const STAFF_ROLES: Role[] = ["CONCIERGE", "CHECK_IN_STAFF", "ADMIN", "SUPER_ADMIN"];

export function isStaff(role: Role): boolean {
  return role !== "MEMBER";
}

/** Roles that must confirm an authenticator code after their password (docs/ARCHITECTURE.md#mfa). */
export function mfaRequired(role: Role): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/** Where a user lands after signing in. */
export function homePathFor(role: Role): string {
  switch (role) {
    case "MEMBER":
      return "/";
    case "CHECK_IN_STAFF":
      return "/staff/scanner";
    case "CONCIERGE":
      return "/admin/concierge";
    default:
      return "/admin";
  }
}

export const ROLE_LABELS: Record<Role, string> = {
  MEMBER: "Member",
  CONCIERGE: "Concierge",
  CHECK_IN_STAFF: "Check-in staff",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super admin",
};
