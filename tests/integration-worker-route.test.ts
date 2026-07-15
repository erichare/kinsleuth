import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workerMocks = vi.hoisted(() => ({
  integrationWorkerConfiguration: vi.fn(),
  runIntegrationWorkerBatch: vi.fn(),
  runIntegrationWorkerMaintenance: vi.fn()
}));

vi.mock("@/lib/integrations/worker", () => workerMocks);

import { GET } from "@/app/api/cron/integration-jobs/route";

const originalSecret = process.env.CRON_SECRET;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CRON_SECRET = "synthetic-cron-secret";
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
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
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
    vi.useRealTimers();
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
      Object.assign(new Error(secret), { code: "DATABASE_UNAVAILABLE" })
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request("synthetic-cron-secret"));

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "integration_worker_error",
      code: "DATABASE_UNAVAILABLE"
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
    expect(workerMocks.runIntegrationWorkerBatch).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

function request(secret: string): Request {
  return new Request("https://kinresolve.example/api/cron/integration-jobs", {
    headers: { authorization: `Bearer ${secret}` }
  });
}
