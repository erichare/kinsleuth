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
      capabilities: {
        valid: true,
        deploymentMode: "hosted",
        datasetMode: "pilot",
        dna: false,
        externalAi: false,
        publicArchive: false,
        publicPublishing: false,
        evidenceBinaryUploads: false,
        packageMedia: false,
        plainGedcom: true,
        gedcomFileLimitBytes: 10 * 1024 * 1024,
        gedcomPersonLimit: 40_000
      },
      ai: { enabled: false, configured: false },
      storage: { configured: true }
    });
  });

  it("reports degraded readiness when the hosted capability configuration is invalid", async () => {
    runtimeMocks.getRuntimeStatus.mockResolvedValue(
      runtimeStatus(true, {}, { valid: false })
    );

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      capabilities: { valid: false }
    });
  });

  it("reports degraded readiness when the configured archive is not provisioned", async () => {
    runtimeMocks.getRuntimeStatus.mockResolvedValue(
      runtimeStatus(true, { provisioned: false, datasetMode: null, datasetModeMatches: false })
    );

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      database: {
        connected: true,
        provisioned: false,
        datasetMode: null,
        expectedDatasetMode: "pilot",
        datasetModeMatches: false
      }
    });
  });

  it("reports degraded readiness when persisted and configured dataset modes differ", async () => {
    runtimeMocks.getRuntimeStatus.mockResolvedValue(
      runtimeStatus(true, { datasetMode: "demo", datasetModeMatches: false })
    );

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      database: {
        provisioned: true,
        datasetMode: "demo",
        expectedDatasetMode: "pilot",
        datasetModeMatches: false
      }
    });
  });
});

function runtimeStatus(
  storageConfigured: boolean,
  databaseOverrides: Partial<{
    provisioned: boolean;
    datasetMode: "empty" | "demo" | "pilot" | null;
    datasetModeMatches: boolean;
  }> = {},
  capabilityOverrides: Partial<{
    valid: boolean;
  }> = {}
) {
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
      aiRunCount: 0,
      provisioned: true,
      datasetMode: "pilot",
      expectedDatasetMode: "pilot",
      datasetModeMatches: true,
      ...databaseOverrides
    },
    ai: {
      enabled: false,
      configured: false,
      baseUrl: "https://api.openai.com/v1",
      chatModel: "gpt-5-mini",
      embeddingModel: "text-embedding-3-small",
      mode: "responses"
    },
    capabilities: {
      valid: true,
      deploymentMode: "hosted",
      datasetMode: "pilot",
      dna: false,
      externalAi: false,
      publicArchive: false,
      publicPublishing: false,
      evidenceBinaryUploads: false,
      packageMedia: false,
      plainGedcom: true,
      gedcomFileLimitBytes: 10 * 1024 * 1024,
      gedcomPersonLimit: 40_000,
      ...capabilityOverrides
    },
    storage: { configured: storageConfigured }
  };
}
