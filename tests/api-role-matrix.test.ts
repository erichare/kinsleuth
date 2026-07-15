import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

vi.mock("@/lib/auth-session", () => ({
  getSessionContext: authMocks.getSessionContext
}));

import { withPermission } from "@/lib/api-authorization";
import { apiRouteAccessRegistry } from "@/lib/api-access";
import type { Role } from "@/lib/models";
import { hasPermission, type Permission } from "@/lib/rbac";

const permissions = [
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
] as const satisfies readonly Permission[];

const allowedByRole: Record<Role, readonly Permission[]> = {
  owner: permissions,
  admin: permissions.filter((permission) => permission !== "archive:data-portability"),
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

const roles = Object.keys(allowedByRole) as Role[];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("API role matrix", () => {
  it("keeps the policy table explicit for every role and permission", () => {
    for (const role of roles) {
      for (const permission of permissions) {
        expect(hasPermission(role, permission), `${role} ${permission}`).toBe(
          allowedByRole[role].includes(permission)
        );
      }
    }
  });

  it("enforces the role matrix before any protected handler runs", async () => {
    for (const role of roles) {
      for (const permission of permissions) {
        authMocks.getSessionContext.mockResolvedValueOnce({
          userId: `${role}-1`,
          email: `${role}@example.com`,
          name: role,
          role,
          archiveId: "archive-default"
        });
        const handler = vi.fn(async () => Response.json({ changed: true }));
        const wrapped = withPermission(permission, handler);

        const response = await wrapped(
          new Request("https://app.kinresolve.com/api/protected", { method: "POST" })
        );
        const allowed = allowedByRole[role].includes(permission);

        expect(response.status, `${role} ${permission}`).toBe(allowed ? 200 : 403);
        expect(handler, `${role} ${permission}`).toHaveBeenCalledTimes(allowed ? 1 : 0);
      }
    }
  });

  it("covers every permission referenced by the route registry", () => {
    const registeredPermissions = apiRouteAccessRegistry.flatMap((route) =>
      Object.values(route.methods).flatMap((registration) =>
        registration?.access.kind === "permission" ? [registration.access.permission] : []
      )
    );

    expect(new Set(permissions)).toEqual(new Set([...registeredPermissions, "users:manage"]));
  });

  it.each(["anonymous", "authenticated without archive membership"])(
    "returns the same private 401 for %s callers",
    async () => {
      authMocks.getSessionContext.mockResolvedValue(null);
      const handler = vi.fn(async () => Response.json({ private: true }));
      const wrapped = withPermission("archive:read-private", handler);

      const response = await wrapped(new Request("https://app.kinresolve.com/api/people"));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
      expect(handler).not.toHaveBeenCalled();
    }
  );
});
