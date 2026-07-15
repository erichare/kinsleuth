import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  getRuntimeStatus: vi.fn()
}));

vi.mock("@/lib/runtime-status", () => runtimeMocks);

import { GET } from "@/app/api/health/route";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/health", () => {
  it("reports degraded readiness when private object storage is not configured", async () => {
    runtimeMocks.getRuntimeStatus.mockResolvedValue(runtimeStatus(false));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      database: { connected: true },
      storage: { configured: false }
    });
  });

  it("reports ready when both the database and private object storage are configured", async () => {
    runtimeMocks.getRuntimeStatus.mockResolvedValue(runtimeStatus(true));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      storage: { configured: true }
    });
  });
});

function runtimeStatus(storageConfigured: boolean) {
  return {
    product: "KinSleuth",
    version: "0.17.4",
    database: {
      configured: true,
      connected: true,
      archiveId: "archive-synthetic",
      archiveName: "Synthetic archive",
      archiveTagline: "",
      archiveCount: 1,
      peopleCount: 0,
      caseCount: 0,
      aiRunCount: 0
    },
    ai: {
      configured: false,
      baseUrl: "https://api.openai.com/v1",
      chatModel: "gpt-5-mini",
      embeddingModel: "text-embedding-3-small",
      mode: "responses"
    },
    storage: { configured: storageConfigured }
  };
}
