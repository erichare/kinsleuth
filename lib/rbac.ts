import type { Role } from "./models";

export type Permission =
  | "archive:read-private"
  | "archive:publish"
  | "archive:export"
  | "archive:data-portability"
  | "imports:manage"
  | "cases:read"
  | "cases:write"
  | "evidence:write"
  | "sources:write"
  | "dna:read"
  | "dna:write"
  | "ai:whole-tree"
  | "settings:manage"
  | "users:manage";

const rolePermissions: Record<Role, Permission[]> = {
  owner: [
    "archive:read-private",
    "archive:publish",
    "archive:export",
    "archive:data-portability",
    "imports:manage",
    "cases:read",
    "cases:write",
    "evidence:write",
    "sources:write",
    "dna:read",
    "dna:write",
    "ai:whole-tree",
    "settings:manage",
    "users:manage"
  ],
  admin: [
    "archive:read-private",
    "archive:publish",
    "archive:export",
    "imports:manage",
    "cases:read",
    "cases:write",
    "evidence:write",
    "sources:write",
    "dna:read",
    "dna:write",
    "ai:whole-tree",
    "settings:manage",
    "users:manage"
  ],
  editor: [
    "archive:read-private",
    "archive:publish",
    "cases:read",
    "cases:write",
    "evidence:write",
    "sources:write",
    "dna:read",
    "dna:write"
  ],
  contributor: ["archive:read-private", "cases:read", "evidence:write", "dna:read"],
  viewer: ["archive:read-private", "cases:read", "dna:read"]
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Role ${role} cannot perform ${permission}`);
  }
}

export function getPermissions(role: Role): Permission[] {
  return [...rolePermissions[role]];
}
