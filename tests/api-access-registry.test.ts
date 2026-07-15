import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  allowedApiMethods,
  apiRouteAccessRegistry,
  resolveApiAccess,
  resolveApiMethodPolicy,
  resolveApiRoute,
  type ApiMethod,
  type ApiRequestPolicy
} from "@/lib/api-access";

const apiRoot = path.join(process.cwd(), "app/api");
const methodPattern = /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;

async function routeFiles(directory = apiRoot): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? routeFiles(entryPath) : Promise.resolve([entryPath]);
    })
  );

  return nested.flat().filter((file) => file.endsWith(`${path.sep}route.ts`)).sort();
}

function routeTemplate(file: string): string {
  const relative = path.relative(apiRoot, file).split(path.sep).join("/");
  return `/api/${relative.replace(/\/route\.ts$/, "")}`;
}

function exportedMethods(source: string): ApiMethod[] {
  return [...source.matchAll(methodPattern)].map((match) => match[1] as ApiMethod).sort();
}

describe("API access registry", () => {
  it("classifies every exported route method exactly once", async () => {
    const files = await routeFiles();
    const discoveredTemplates = files.map(routeTemplate).sort();
    const registeredTemplates = apiRouteAccessRegistry.map((entry) => entry.path).sort();

    expect(new Set(registeredTemplates).size).toBe(registeredTemplates.length);
    expect(registeredTemplates).toEqual(discoveredTemplates);

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const entry = apiRouteAccessRegistry.find((candidate) => candidate.path === routeTemplate(file));

      expect(entry, file).toBeDefined();
      expect(Object.keys(entry?.methods ?? {}).sort(), file).toEqual(exportedMethods(source));
    }
  });

  it("wraps every permission-protected method with its registered permission", async () => {
    const files = await routeFiles();

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const entry = apiRouteAccessRegistry.find((candidate) => candidate.path === routeTemplate(file));
      if (!entry) continue;

      for (const [method, registration] of Object.entries(entry.methods)) {
        const { access } = registration;
        if (access.kind !== "permission") continue;

        expect(source, `${method} ${entry.path}`).toContain(
          `export const ${method} = withPermission("${access.permission}"`
        );
      }
    }
  });

  it("assigns an explicit request policy to every exported method", () => {
    const counts: Record<ApiRequestPolicy, number> = {
      "read-only": 0,
      "same-origin-cookie": 0,
      "better-auth-managed": 0,
      "service-bearer": 0
    };

    for (const route of apiRouteAccessRegistry) {
      for (const registration of Object.values(route.methods)) {
        expect(registration?.requestPolicy, route.path).toBeDefined();
        if (registration) counts[registration.requestPolicy] += 1;
      }
    }

    expect(counts).toEqual({
      "read-only": 17,
      "same-origin-cookie": 33,
      "better-auth-managed": 2,
      "service-bearer": 2
    });
  });

  it("resolves parameterized routes and explicit non-membership exceptions", () => {
    expect(resolveApiAccess("/api/health", "GET")).toEqual({ kind: "public" });
    expect(resolveApiAccess("/api/auth/session", "GET")).toEqual({ kind: "public" });
    expect(resolveApiAccess("/api/setup/claim", "POST")).toEqual({ kind: "bootstrap" });
    expect(resolveApiAccess("/api/cron/import-uploads", "GET")).toEqual({ kind: "service" });
    expect(resolveApiAccess("/api/cases/case-1/tasks", "POST")).toEqual({
      kind: "permission",
      permission: "cases:write"
    });
    expect(resolveApiAccess("/api/dna/match-1", "DELETE")).toEqual({
      kind: "permission",
      permission: "dna:write"
    });
    expect(resolveApiAccess("/api/dna/matches", "GET")).toEqual({
      kind: "permission",
      permission: "dna:read"
    });
    expect(resolveApiAccess("/api/dna/matches", "PATCH")).toBeNull();
    expect(resolveApiAccess("/api/auth/logout", "GET")).toBeNull();
    expect(resolveApiAccess("/api/not-registered", "GET")).toBeNull();
    expect(resolveApiAccess("/api/health", "POST")).toBeNull();

    expect(resolveApiMethodPolicy("/api/health", "GET")).toBe("read-only");
    expect(resolveApiMethodPolicy("/api/auth/session", "POST")).toBe("better-auth-managed");
    expect(resolveApiMethodPolicy("/api/auth/logout", "POST")).toBe("same-origin-cookie");
    expect(resolveApiMethodPolicy("/api/cron/import-uploads", "GET")).toBe("service-bearer");
    expect(resolveApiMethodPolicy("/api/not-registered", "GET")).toBeNull();

    const healthRoute = resolveApiRoute("/api/health");
    expect(healthRoute?.path).toBe("/api/health");
    expect(allowedApiMethods(healthRoute!)).toEqual(["GET", "HEAD"]);
    expect(resolveApiRoute("/api/not-registered")).toBeNull();
  });

  it("inherits HEAD only from read-only GET methods", () => {
    expect(resolveApiAccess("/api/health", "HEAD")).toEqual({ kind: "public" });
    expect(resolveApiMethodPolicy("/api/health", "HEAD")).toBe("read-only");

    const cronRoute = resolveApiRoute("/api/cron/import-uploads");
    expect(resolveApiAccess("/api/cron/import-uploads", "HEAD")).toBeNull();
    expect(resolveApiMethodPolicy("/api/cron/import-uploads", "HEAD")).toBeNull();
    expect(allowedApiMethods(cronRoute!)).toEqual(["GET"]);

    const authRoute = resolveApiRoute("/api/auth/session");
    expect(resolveApiAccess("/api/auth/session", "HEAD")).toBeNull();
    expect(resolveApiMethodPolicy("/api/auth/session", "HEAD")).toBeNull();
    expect(allowedApiMethods(authRoute!)).toEqual(["GET", "POST"]);
  });
});
