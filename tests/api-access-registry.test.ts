import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  allowedApiMethods,
  apiRouteAccessRegistry,
  isApiWriteBlockedByReleaseFence,
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
      "internal-probe": 0,
      "service-bearer": 0,
      "api-token": 0,
      "marketing-native-form": 0,
      "operator-signature": 0,
      "release-fence-control": 0
    };

    for (const route of apiRouteAccessRegistry) {
      for (const registration of Object.values(route.methods)) {
        expect(registration?.requestPolicy, route.path).toBeDefined();
        if (registration) counts[registration.requestPolicy] += 1;
      }
    }

    expect(counts).toEqual({
      "read-only": 22,
      "same-origin-cookie": 51,
      "better-auth-managed": 2,
      "internal-probe": 1,
      "service-bearer": 2,
      "api-token": 7,
      "marketing-native-form": 1,
      "operator-signature": 2,
      "release-fence-control": 4
    });
  });

  it("resolves parameterized routes and explicit non-membership exceptions", () => {
    expect(resolveApiAccess("/api/health", "GET")).toEqual({ kind: "public" });
    expect(resolveApiAccess("/api/beta/legal/privacy-notice", "GET")).toEqual({ kind: "public" });
    expect(resolveApiAccess("/api/auth/session", "GET")).toEqual({ kind: "public" });
    expect(resolveApiAccess("/api/setup/claim", "POST")).toEqual({ kind: "bootstrap" });
    expect(resolveApiAccess("/api/cron/import-uploads", "GET")).toEqual({ kind: "service" });
    expect(resolveApiAccess("/api/internal/health", "GET")).toEqual({ kind: "service" });
    expect(resolveApiAccess("/api/operator/invitations", "POST")).toEqual({ kind: "service" });
    expect(resolveApiAccess("/api/operator/observability", "POST")).toEqual({ kind: "service" });
    expect(resolveApiAccess("/api/observability/client-errors", "POST")).toEqual({
      kind: "permission",
      permission: "archive:read-private"
    });
    expect(resolveApiAccess("/api/release/fence/acquire", "POST")).toEqual({ kind: "service" });
    expect(resolveApiAccess("/api/release/fence/assert", "POST")).toEqual({ kind: "service" });
    expect(resolveApiAccess("/api/release/fence/reacquire", "POST")).toEqual({ kind: "service" });
    expect(resolveApiAccess("/api/release/fence/release", "POST")).toEqual({ kind: "service" });
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
    expect(resolveApiMethodPolicy("/api/internal/health", "GET")).toBe("internal-probe");
    expect(resolveApiMethodPolicy("/api/operator/invitations", "POST")).toBe("operator-signature");
    expect(resolveApiMethodPolicy("/api/operator/observability", "POST")).toBe("operator-signature");
    expect(resolveApiMethodPolicy("/api/observability/client-errors", "POST")).toBe("same-origin-cookie");
    expect(resolveApiMethodPolicy("/api/release/fence/acquire", "POST")).toBe("release-fence-control");
    expect(resolveApiMethodPolicy("/api/release/fence/assert", "POST")).toBe("release-fence-control");
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

  it("centrally fences every registered write while exempting only reads and fence control", () => {
    for (const route of apiRouteAccessRegistry) {
      for (const [method, registration] of Object.entries(route.methods)) {
        const expected = registration.requestPolicy !== "read-only"
          && registration.requestPolicy !== "release-fence-control"
          && registration.requestPolicy !== "api-token"
          && registration.requestPolicy !== "internal-probe"
          && registration.requestPolicy !== "service-bearer"
          && registration.requestPolicy !== "operator-signature"
          && !(registration.requestPolicy === "better-auth-managed" && method === "GET");
        expect(isApiWriteBlockedByReleaseFence(route.path, method), `${method} ${route.path}`).toBe(expected);
      }
    }

    expect(isApiWriteBlockedByReleaseFence("/api/not-registered", "POST")).toBe(false);
  });

  it("keeps Better Auth GET session checks read-only while fencing every Better Auth POST", async () => {
    const authConfiguration = await readFile(path.join(process.cwd(), "lib", "auth.ts"), "utf8");
    expect(authConfiguration).toContain("deferSessionRefresh: true");
    expect(isApiWriteBlockedByReleaseFence("/api/auth/session", "GET")).toBe(false);
    expect(isApiWriteBlockedByReleaseFence("/api/auth/session", "POST")).toBe(true);
  });

  it("keeps service-bearer access limited to cron handlers that authenticate before fencing", async () => {
    const serviceRegistrations = apiRouteAccessRegistry.flatMap((route) =>
      Object.entries(route.methods)
        .filter(([, registration]) => registration.requestPolicy === "service-bearer")
        .map(([method]) => ({ method, path: route.path }))
    );
    expect(serviceRegistrations).toEqual([
      { method: "GET", path: "/api/cron/integration-jobs" },
      { method: "GET", path: "/api/cron/import-uploads" }
    ]);

    for (const registration of serviceRegistrations) {
      const routeFile = path.join(
        apiRoot,
        registration.path.replace(/^\/api\//, ""),
        "route.ts"
      );
      const source = await readFile(routeFile, "utf8");
      const authentication = source.indexOf('request.headers.get("authorization")');
      const fence = source.indexOf("getActiveReleaseFence()");
      expect(authentication, routeFile).toBeGreaterThan(0);
      expect(fence, routeFile).toBeGreaterThan(authentication);
      expect(source, routeFile).toContain(
        "releaseFenceLockedResponse(activeFence, { discloseControlIdentity: true })"
      );
    }
  });

  it("keeps operator-signature handlers authenticating before control or alert mutations", async () => {
    const registrations = apiRouteAccessRegistry.flatMap((route) =>
      Object.entries(route.methods)
        .filter(([, registration]) => registration.requestPolicy === "operator-signature")
        .map(([method]) => ({ method, path: route.path }))
    );
    expect(registrations).toEqual([
      { method: "POST", path: "/api/operator/invitations" },
      { method: "POST", path: "/api/operator/observability" }
    ]);

    const invitationSource = await readFile(
      path.join(apiRoot, "operator", "invitations", "route.ts"),
      "utf8"
    );
    const invitationAuthentication = invitationSource.indexOf("authenticateOperatorRequest(request)");
    const fence = invitationSource.indexOf("getActiveReleaseFence()");
    expect(invitationAuthentication).toBeGreaterThan(0);
    expect(fence).toBeGreaterThan(invitationAuthentication);
    expect(invitationSource).toContain(
      "releaseFenceLockedResponse(activeFence, { discloseControlIdentity: true })"
    );

    const observabilitySource = await readFile(
      path.join(apiRoot, "operator", "observability", "route.ts"),
      "utf8"
    );
    const observabilityAuthentication = observabilitySource.indexOf("authenticateOperatorRequest(request)");
    const observabilityFence = observabilitySource.indexOf("getActiveReleaseFence()");
    const nonceConsumption = observabilitySource.lastIndexOf("consumeBetaOperatorRequest(");
    const alertDelivery = observabilitySource.lastIndexOf("emitOperationalEvent(");
    expect(observabilityAuthentication).toBeGreaterThan(0);
    expect(observabilityFence).toBeGreaterThan(observabilityAuthentication);
    expect(nonceConsumption).toBeGreaterThan(observabilityFence);
    expect(alertDelivery).toBeGreaterThan(nonceConsumption);
  });

  it("keeps internal diagnostics behind probe authentication", async () => {
    const source = await readFile(path.join(apiRoot, "internal", "health", "route.ts"), "utf8");
    const authentication = source.lastIndexOf("authenticateObservabilityProbe(request)");
    const runtimeStatus = source.lastIndexOf("getRuntimeStatus()");
    const workerFreshness = source.lastIndexOf("readWorkerFreshness(");

    expect(authentication).toBeGreaterThan(0);
    expect(runtimeStatus).toBeGreaterThan(authentication);
    expect(workerFreshness).toBeGreaterThan(authentication);
  });
});
