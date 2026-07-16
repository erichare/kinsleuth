import { pathToFileURL } from "node:url";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

type Monitor = (
  environment?: Readonly<Record<string, string | undefined>>,
  fetchImplementation?: typeof fetch
) => Promise<Readonly<{ active: number; occupied: number; dailyAiUsed: number }>>;

const canonicalEnvironment = {
  PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com",
  KINRESOLVE_OBSERVABILITY_PROBE_SECRET: "o".repeat(43)
};

describe("public demo protected internal-health monitor", () => {
  it("authenticates and validates the fixed operational diagnostics", async () => {
    const runMonitor = await loadMonitor();
    const fetchImplementation = vi.fn(successfulMonitorFetch);

    await expect(runMonitor(canonicalEnvironment, fetchImplementation)).resolves.toEqual({
      active: 2,
      occupied: 3,
      dailyAiUsed: 12
    });
    const [input, init] = fetchImplementation.mock.calls[0];
    expect(String(input)).toBe("https://demo.kinresolve.com/api/internal/health");
    expect(init).toMatchObject({ cache: "no-store", method: "GET", redirect: "manual" });
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${"o".repeat(43)}`);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const [cronInput, cronInit] = fetchImplementation.mock.calls[1];
    expect(String(cronInput)).toBe("https://demo.kinresolve.com/api/cron/integration-jobs");
    expect(new Headers(cronInit?.headers).get("authorization")).toBeNull();
  });

  it("requires candidate protection and never sends credentials to another origin", async () => {
    const runMonitor = await loadMonitor();
    const fetchImplementation = vi.fn(successfulMonitorFetch);

    await expect(runMonitor({
      ...canonicalEnvironment,
      PUBLIC_DEMO_ORIGIN: "https://candidate-team.vercel.app"
    }, fetchImplementation)).rejects.toThrow(/approved demo origin/i);

    await expect(runMonitor({
      ...canonicalEnvironment,
      PUBLIC_DEMO_ORIGIN: "https://candidate-team.vercel.app",
      VERCEL_AUTOMATION_BYPASS_SECRET: "v".repeat(43)
    }, fetchImplementation)).resolves.toMatchObject({ active: 2 });
    expect(new Headers(fetchImplementation.mock.calls.at(-1)?.[1]?.headers).get(
      "x-vercel-protection-bypass"
    )).toBe("v".repeat(43));
  });

  it("proves CRON_SECRET is configured by requiring the app's unauthenticated 401 shape", async () => {
    const runMonitor = await loadMonitor();

    await expect(runMonitor(canonicalEnvironment, vi.fn(async (input) => (
      new URL(String(input)).pathname === "/api/internal/health"
        ? healthyResponse()
        : cronResponse(503, { error: "Scheduled integration work is not configured." })
    )))).rejects.toThrow(/operational health/i);

    await expect(runMonitor(canonicalEnvironment, vi.fn(async (input) => (
      new URL(String(input)).pathname === "/api/internal/health"
        ? healthyResponse()
        : new Response("Authentication Required", {
            headers: { "content-type": "text/html" },
            status: 401
          })
    )))).rejects.toThrow(/operational health/i);

    await expect(runMonitor(canonicalEnvironment, vi.fn(async (input) => (
      new URL(String(input)).pathname === "/api/internal/health"
        ? healthyResponse()
        : cronResponse(200, { demoCleanup: {} })
    )))).rejects.toThrow(/operational health/i);
  });

  it("fails closed for missing credentials, stale cleanup, or unsafe budget values", async () => {
    const runMonitor = await loadMonitor();
    await expect(runMonitor({ PUBLIC_DEMO_ORIGIN: canonicalEnvironment.PUBLIC_DEMO_ORIGIN }, vi.fn()))
      .rejects.toThrow(/OBSERVABILITY_PROBE_SECRET/);

    await expect(runMonitor(canonicalEnvironment, vi.fn(async () => healthyResponse({
      cleanup: { freshness: "stale", lastCompletedAt: new Date().toISOString() }
    })))).rejects.toThrow(/operational health/i);

    await expect(runMonitor(canonicalEnvironment, vi.fn(async () => healthyResponse({
      aiBudget: { concurrentLimit: 5, running: 6, dailyLimit: 150, dailyUsed: 151 }
    })))).rejects.toThrow(/operational health/i);
  });
});

async function loadMonitor(): Promise<Monitor> {
  const moduleUrl = pathToFileURL(path.join(
    process.cwd(),
    "scripts/public-demo-internal-health-monitor.mjs"
  )).href;
  const loaded = await import(moduleUrl) as { runPublicDemoInternalHealthMonitor?: Monitor };
  if (typeof loaded.runPublicDemoInternalHealthMonitor !== "function") {
    throw new Error("The protected demo health monitor is unavailable.");
  }
  return loaded.runPublicDemoInternalHealthMonitor;
}

function healthyResponse(overrides: {
  cleanup?: Record<string, unknown>;
  aiBudget?: Record<string, unknown>;
} = {}): Response {
  return new Response(JSON.stringify({
    status: "ok",
    publicDemo: {
      capacity: { maximum: 25, active: 2, provisioning: 1, occupied: 3 },
      cleanup: overrides.cleanup ?? {
        freshness: "healthy",
        lastCompletedAt: new Date().toISOString()
      },
      staleProvisioning: 0,
      aiBudget: overrides.aiBudget ?? {
        concurrentLimit: 5,
        running: 1,
        dailyLimit: 150,
        dailyUsed: 12
      }
    }
  }), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    },
    status: 200
  });
}

async function successfulMonitorFetch(
  input: RequestInfo | URL,
  _init?: RequestInit
): Promise<Response> {
  const pathname = new URL(String(input)).pathname;
  if (pathname === "/api/internal/health") return healthyResponse();
  if (pathname === "/api/cron/integration-jobs") {
    return cronResponse(401, { error: "Unauthorized" });
  }
  throw new Error(`Unexpected monitor URL: ${pathname}`);
}

function cronResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status
  });
}
