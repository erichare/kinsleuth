import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workerMocks = vi.hoisted(() => ({
  integrationWorkerConfiguration: vi.fn(),
  runIntegrationWorkerBatch: vi.fn(),
  runIntegrationWorkerMaintenance: vi.fn()
}));
const releaseFenceMocks = vi.hoisted(() => ({
  getActiveReleaseFence: vi.fn().mockResolvedValue(null)
}));
const operationMocks = vi.hoisted(() => ({
  recordWorkerFailed: vi.fn(),
  recordWorkerStarted: vi.fn(),
  recordWorkerSucceeded: vi.fn()
}));

vi.mock("@/lib/integrations/worker", () => workerMocks);
vi.mock("@/lib/release-fence", () => releaseFenceMocks);
vi.mock("@/lib/beta-operations", () => operationMocks);

import { GET } from "@/app/api/cron/integration-jobs/route";

const originalEnvironment = { ...process.env };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  releaseFenceMocks.getActiveReleaseFence.mockResolvedValue(null);
  operationMocks.recordWorkerFailed.mockResolvedValue(true);
  operationMocks.recordWorkerStarted.mockResolvedValue(undefined);
  operationMocks.recordWorkerSucceeded.mockResolvedValue(true);
  process.env.CRON_SECRET = "synthetic-cron-secret";
  process.env.KINRESOLVE_DEPLOYMENT_MODE = "self-hosted";
  delete process.env.KINRESOLVE_SCHEDULED_WRITES_ENABLED;
  workerMocks.integrationWorkerConfiguration.mockReturnValue({
    databaseUrl: "postgres://synthetic.invalid/test",
    workerId: "hosted-cron",
    maximumJobs: 10,
    leaseDurationMs: 120_000,
    pollIntervalMs: 2_000,
    maintenanceIntervalMs: 900_000,
    maintenanceLimit: 100
  });
  workerMocks.runIntegrationWorkerMaintenance.mockResolvedValue({
    scanned: 2,
    deleted: 1,
    failed: 0
  });
  workerMocks.runIntegrationWorkerBatch.mockResolvedValue({
    archivesScanned: 2,
    leased: 1,
    completed: 1,
    failed: 0
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
});

describe("hosted integration worker invocation", () => {
  it("fails closed when scheduled work is not configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request("synthetic-cron-secret"));

    expect(response.status).toBe(503);
    expect(workerMocks.runIntegrationWorkerBatch).not.toHaveBeenCalled();
    expect(workerMocks.runIntegrationWorkerMaintenance).not.toHaveBeenCalled();
  });

  it("requires the cron bearer secret", async () => {
    const response = await GET(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(workerMocks.runIntegrationWorkerBatch).not.toHaveBeenCalled();
    expect(workerMocks.runIntegrationWorkerMaintenance).not.toHaveBeenCalled();
  });

  it("authenticates before checking a disabled hosted scheduled-write gate", async () => {
    setHostedScheduledWrites("false");

    const response = await GET(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(releaseFenceMocks.getActiveReleaseFence).not.toHaveBeenCalled();
    expect(workerMocks.runIntegrationWorkerBatch).not.toHaveBeenCalled();
    expect(workerMocks.runIntegrationWorkerMaintenance).not.toHaveBeenCalled();
  });

  it.each([undefined, "invalid"])(
    "fails closed without inspecting the fence for a hosted scheduled-write value of %s",
    async (value) => {
      setHostedScheduledWrites(value);

      const response = await GET(request("synthetic-cron-secret"));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "Scheduled work is unavailable." });
      expect(releaseFenceMocks.getActiveReleaseFence).not.toHaveBeenCalled();
      expect(workerMocks.runIntegrationWorkerBatch).not.toHaveBeenCalled();
      expect(workerMocks.runIntegrationWorkerMaintenance).not.toHaveBeenCalled();
    }
  );

  it("returns a generic non-mutating response while hosted scheduled writes are disabled", async () => {
    setHostedScheduledWrites("false");
    releaseFenceMocks.getActiveReleaseFence.mockResolvedValue({
      fenceId: "fence-private-beta-01",
      releaseCommitSha: "a".repeat(40),
      state: "active",
      activationGeneration: 1,
      firstActivatedAt: "2026-07-15T06:00:00.000Z",
      activatedAt: "2026-07-15T06:00:00.000Z",
      releasedAt: null,
      updatedAt: "2026-07-15T06:00:00.000Z"
    });

    const response = await GET(request("synthetic-cron-secret"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "Scheduled work is unavailable." });
    expect(JSON.stringify(body)).not.toContain("fence-private-beta-01");
    expect(releaseFenceMocks.getActiveReleaseFence).not.toHaveBeenCalled();
    expect(workerMocks.runIntegrationWorkerBatch).not.toHaveBeenCalled();
    expect(workerMocks.runIntegrationWorkerMaintenance).not.toHaveBeenCalled();
  });

  it("runs a bounded checkpointed batch and returns metadata-only counters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T20:00:00.000Z"));
    const response = await GET(request("synthetic-cron-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      archivesScanned: 2,
      leased: 1,
      completed: 1,
      failed: 0,
      maintenance: { scanned: 2, deleted: 1, failed: 0 }
    });
    expect(workerMocks.runIntegrationWorkerMaintenance).toHaveBeenCalledExactlyOnceWith({
      databaseUrl: "postgres://synthetic.invalid/test",
      maintenanceLimit: 100
    });
    expect(workerMocks.runIntegrationWorkerBatch).toHaveBeenCalledWith({
      databaseUrl: "postgres://synthetic.invalid/test",
      workerId: "hosted-cron",
      maximumJobs: 1,
      leaseDurationMs: 120_000,
      deadlineAt: new Date("2026-07-14T20:04:30.000Z")
    });
    expect(operationMocks.recordWorkerStarted).toHaveBeenCalledWith(
      "integration-jobs",
      expect.any(String),
      { archiveId: expect.any(String) }
    );
    expect(operationMocks.recordWorkerSucceeded).toHaveBeenCalledWith(
      "integration-jobs",
      expect.any(String),
      { archiveId: expect.any(String) }
    );
    vi.useRealTimers();
  });

  it("returns 423 with the exact active fence before leasing or maintenance", async () => {
    releaseFenceMocks.getActiveReleaseFence.mockResolvedValue({
      fenceId: "fence-private-beta-01",
      releaseCommitSha: "a".repeat(40),
      state: "active",
      activationGeneration: 1,
      firstActivatedAt: "2026-07-15T06:00:00.000Z",
      activatedAt: "2026-07-15T06:00:00.000Z",
      releasedAt: null,
      updatedAt: "2026-07-15T06:00:00.000Z"
    });

    const response = await GET(request("synthetic-cron-secret"));

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toMatchObject({
      fenceId: "fence-private-beta-01",
      releaseCommitSha: "a".repeat(40)
    });
    expect(workerMocks.runIntegrationWorkerBatch).not.toHaveBeenCalled();
    expect(workerMocks.runIntegrationWorkerMaintenance).not.toHaveBeenCalled();
  });

  it("runs upload-intent cleanup even when the parse queue has no archives", async () => {
    workerMocks.runIntegrationWorkerBatch.mockResolvedValueOnce({
      archivesScanned: 0,
      leased: 0,
      completed: 0,
      failed: 0
    });

    const response = await GET(request("synthetic-cron-secret"));

    expect(response.status).toBe(200);
    expect(workerMocks.runIntegrationWorkerMaintenance).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      archivesScanned: 0,
      leased: 0,
      maintenance: { scanned: 2, deleted: 1, failed: 0 }
    });
  });

  it("logs only a structured code when a scheduled invocation fails", async () => {
    const secret = "postgres://private-user:private-password@db.internal/family";
    workerMocks.runIntegrationWorkerMaintenance.mockRejectedValueOnce(
      Object.assign(new Error(secret), { code: "DATABASE_ERROR" })
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request("synthetic-cron-secret"));

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledOnce();
    const payload = consoleError.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      schemaVersion: 1,
      event: "integration_worker_failed",
      severity: "error",
      code: "DATABASE_ERROR",
      environment: "test",
      route: "/api/cron/integration-jobs",
      workerKind: "integration-jobs"
    });
    expect(payload.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
    expect(operationMocks.recordWorkerFailed).toHaveBeenCalledExactlyOnceWith(
      "integration-jobs",
      payload.requestId,
      "DATABASE_ERROR",
      { archiveId: expect.any(String) }
    );
    expect(workerMocks.runIntegrationWorkerBatch).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

function request(secret: string): Request {
  return new Request("https://kinresolve.example/api/cron/integration-jobs", {
    headers: { authorization: `Bearer ${secret}` }
  });
}

function setHostedScheduledWrites(value: string | undefined) {
  process.env.KINRESOLVE_DEPLOYMENT_MODE = "hosted";
  process.env.KINRESOLVE_DATASET_MODE = "pilot";
  if (value === undefined) delete process.env.KINRESOLVE_SCHEDULED_WRITES_ENABLED;
  else process.env.KINRESOLVE_SCHEDULED_WRITES_ENABLED = value;
}
