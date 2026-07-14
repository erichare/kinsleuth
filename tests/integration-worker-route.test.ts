import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workerMocks = vi.hoisted(() => ({
  integrationWorkerConfiguration: vi.fn(),
  runIntegrationWorkerBatch: vi.fn()
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
    pollIntervalMs: 2_000
  });
  workerMocks.runIntegrationWorkerBatch.mockResolvedValue({
    archivesScanned: 2,
    leased: 3,
    completed: 3,
    failed: 0
  });
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("hosted integration worker invocation", () => {
  it("fails closed when scheduled work is not configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request("synthetic-cron-secret"));

    expect(response.status).toBe(503);
    expect(workerMocks.runIntegrationWorkerBatch).not.toHaveBeenCalled();
  });

  it("requires the cron bearer secret", async () => {
    const response = await GET(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(workerMocks.runIntegrationWorkerBatch).not.toHaveBeenCalled();
  });

  it("runs a bounded checkpointed batch and returns metadata-only counters", async () => {
    const response = await GET(request("synthetic-cron-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      archivesScanned: 2,
      leased: 3,
      completed: 3,
      failed: 0
    });
    expect(workerMocks.runIntegrationWorkerBatch).toHaveBeenCalledWith({
      databaseUrl: "postgres://synthetic.invalid/test",
      workerId: "hosted-cron",
      maximumJobs: 10,
      leaseDurationMs: 120_000
    });
  });
});

function request(secret: string): Request {
  return new Request("https://kinresolve.example/api/cron/integration-jobs", {
    headers: { authorization: `Bearer ${secret}` }
  });
}
