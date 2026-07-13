import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("private workspace proxy", () => {
  it("fails closed when production authentication is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KINSLEUTH_APP_PASSWORD", "");
    vi.stubEnv("AUTH_SECRET", "");

    const response = await proxy(new NextRequest("https://kinsleuth.example/app"));

    expect(response.status).toBe(503);
  });

  it("redirects unauthenticated production users when authentication is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KINSLEUTH_APP_PASSWORD", "private-password");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");

    const response = await proxy(new NextRequest("https://kinsleuth.example/app/cases?view=open"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://kinsleuth.example/login?next=%2Fapp%2Fcases%3Fview%3Dopen");
  });

  it("returns an API error instead of redirecting", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KINSLEUTH_APP_PASSWORD", "private-password");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/people"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("protects the settings API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KINSLEUTH_APP_PASSWORD", "private-password");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/settings/archive"));

    expect(response.status).toBe(401);
  });
});
