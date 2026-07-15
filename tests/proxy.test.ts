import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

vi.mock("@/lib/auth-session", () => ({
  getSessionContext: authMocks.getSessionContext
}));
vi.mock("@/lib/db", () => ({
  ensureDatabaseSchema: vi.fn().mockResolvedValue(undefined)
}));

import { proxy } from "@/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const memberContext = { userId: "u1", email: "a@b.c", name: "A", role: "owner" as const, archiveId: "archive-default" };

describe("private workspace proxy", () => {
  it.each(["/", "/people", "/people/ada", "/places", "/stories", "/kinsleuth"])(
    "redirects the disabled hosted public archive route %s before database access",
    async (pathname) => {
      stubPrivateHostedEnvironment();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
      vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");

      const response = await proxy(new NextRequest(`https://preview.example${pathname}`));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://app.kinresolve.com/login?next=%2Fapp");
      expect(authMocks.getSessionContext).not.toHaveBeenCalled();
    }
  );

  it("keeps the static challenge and self-hosted public archive reachable", async () => {
    stubPrivateHostedEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");

    expect((await proxy(new NextRequest("https://kinsleuth.example/challenge"))).status).toBe(200);

    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
    vi.stubEnv("KINRESOLVE_PUBLIC_ARCHIVE_ENABLED", "true");
    expect((await proxy(new NextRequest("https://kinsleuth.example/people"))).status).toBe(200);
    expect((await proxy(new NextRequest("https://kinsleuth.example/peopleish"))).status).toBe(200);
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("fails closed when production authentication is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");

    const response = await proxy(new NextRequest("https://kinsleuth.example/app"));

    expect(response.status).toBe(503);
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated production users to login", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/app/cases?view=open"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://kinsleuth.example/login?next=%2Fapp%2Fcases%3Fview%3Dopen");
  });

  it("uses the canonical application origin for production login redirects", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinresolve-release.vercel.app/app"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.kinresolve.com/login?next=%2Fapp");
  });

  it("returns an API error instead of redirecting", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/people"));

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("lets a session WITH archive membership through", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(memberContext);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/people"));

    expect(response.status).toBe(200);
  });

  it("rejects an authenticated session that has no membership", async () => {
    // getSessionContext returns null for accounts with no archive membership,
    // so a membership-less signup cannot reach private data.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/people"));

    expect(response.status).toBe(401);
  });

  it("protects the settings API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/settings/archive", { method: "PATCH" }));

    expect(response.status).toBe(401);
  });

  it("protects the GEDCOM export API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/exports/gedcom"));

    expect(response.status).toBe(401);
  });

  it("fails closed for unregistered future API routes, even for members", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(memberContext);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/future-private-feature"));

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("returns 405 for unsupported methods on registered routes without membership checks", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");

    for (const [url, method, allow] of [
      ["https://kinsleuth.example/api/health", "POST", "GET, HEAD"],
      ["https://kinsleuth.example/api/auth/logout", "GET", "POST"]
    ]) {
      const response = await proxy(new NextRequest(url, { method }));
      expect(response.status, `${method} ${url}`).toBe(405);
      expect(response.headers.get("allow"), `${method} ${url}`).toBe(allow);
      expect(response.headers.get("x-request-id"), `${method} ${url}`).toMatch(/^[0-9a-f-]{36}$/);
    }

    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("returns an explicit 503 for auth and bootstrap APIs when production auth is unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");

    for (const [url, method] of [
      ["https://kinsleuth.example/api/auth/session", "GET"],
      ["https://kinsleuth.example/api/setup/claim", "POST"]
    ]) {
      const response = await proxy(new NextRequest(url, { method }));
      expect(response.status, `${method} ${url}`).toBe(503);
      expect(response.headers.get("x-request-id"), `${method} ${url}`).toMatch(/^[0-9a-f-]{36}$/);
      await expect(response.json()).resolves.toEqual({
        error: "Private workspace authentication is not configured"
      });
    }

    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("keeps health, service-authenticated cron, and logout reachable without production auth configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");

    for (const [url, method] of [
      ["https://kinsleuth.example/api/health", "GET"],
      ["https://kinsleuth.example/api/cron/import-uploads", "GET"],
      ["https://kinsleuth.example/api/auth/logout", "POST"]
    ]) {
      const response = await proxy(new NextRequest(url, { method }));
      expect(response.status, `${method} ${url}`).toBe(200);
    }

    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("does not membership-gate public, bootstrap, or service-authenticated APIs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    for (const [url, method] of [
      ["https://kinsleuth.example/api/health", "GET"],
      ["https://kinsleuth.example/api/auth/session", "GET"],
      ["https://kinsleuth.example/api/setup/claim", "POST"],
      ["https://kinsleuth.example/api/cron/import-uploads", "GET"]
    ]) {
      const response = await proxy(new NextRequest(url, { method }));
      expect(response.status, `${method} ${url}`).toBe(200);
    }

    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("stays open in development when auth is not configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_SECRET", "");

    const response = await proxy(new NextRequest("https://kinsleuth.example/app"));

    expect(response.status).toBe(200);
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });
});

function stubPrivateHostedEnvironment(): void {
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");
  vi.stubEnv("KINRESOLVE_DNA_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_EXTERNAL_AI_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PUBLIC_ARCHIVE_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PUBLIC_PUBLISHING_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PACKAGE_MEDIA_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PLAIN_GEDCOM_ENABLED", "true");
}
