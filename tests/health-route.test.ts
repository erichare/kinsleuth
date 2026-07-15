import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  getRuntimeStatus: vi.fn(),
  isRuntimeReady: vi.fn()
}));

vi.mock("@/lib/runtime-status", () => runtimeMocks);

import { GET } from "@/app/api/health/route";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/health", () => {
  it("returns only the public liveness contract when the runtime is ready", async () => {
    const status = privateRuntimeStatus();
    runtimeMocks.getRuntimeStatus.mockResolvedValue(status);
    runtimeMocks.isRuntimeReady.mockReturnValue(true);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "ok",
      product: "KinSleuth",
      version: "0.18.0"
    });
    expect(runtimeMocks.isRuntimeReady).toHaveBeenCalledExactlyOnceWith(status);
    expect(JSON.stringify(body)).not.toMatch(
      /archive-private-marker|database|storage|capabilities|scheduledWrites|identity|peopleCount/
    );
  });

  it("keeps degraded diagnostics private", async () => {
    const status = privateRuntimeStatus();
    runtimeMocks.getRuntimeStatus.mockResolvedValue(status);
    runtimeMocks.isRuntimeReady.mockReturnValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "degraded",
      product: "KinSleuth",
      version: "0.18.0"
    });
    expect(JSON.stringify(body)).not.toContain("archive-private-marker");
  });
});

function privateRuntimeStatus() {
  return {
    product: "KinSleuth",
    version: "0.18.0",
    database: {
      connected: false,
      error: "archive-private-marker",
      identity: "a".repeat(64),
      peopleCount: 12
    },
    storage: { configured: false },
    capabilities: { valid: false },
    scheduledWrites: { valid: false }
  };
}
