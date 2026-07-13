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

  it("returns an API error instead of redirecting", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/people"));

    expect(response.status).toBe(401);
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

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/settings/archive"));

    expect(response.status).toBe(401);
  });

  it("protects the GEDCOM export API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/exports/gedcom"));

    expect(response.status).toBe(401);
  });

  it("stays open in development when auth is not configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_SECRET", "");

    const response = await proxy(new NextRequest("https://kinsleuth.example/app"));

    expect(response.status).toBe(200);
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });
});
