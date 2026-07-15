import { describe, expect, it, vi } from "vitest";

import {
  createIntegrationWorkerMaintenanceScheduler,
  integrationWorkerConfiguration,
  runIntegrationWorkerBatch,
  runIntegrationWorkerMaintenance
} from "@/lib/integrations/worker";

describe("bounded integration worker protocol", () => {
  it("reconciles terminal job failures before looking for new work", async () => {
    const dependencies = {
      listArchiveIds: vi.fn(async () => ["archive-synthetic"]),
      reconcileTerminalIntegrationFailures: vi.fn(async () => 1),
      leaseNextJob: vi.fn(async () => null)
    };

    await expect(runIntegrationWorkerBatch(
      {
        workerId: "worker-reconcile",
        maximumJobs: 1,
        leaseDurationMs: 60_000,
        databaseUrl: "postgres://synthetic.invalid/test"
      },
      dependencies as never
    )).resolves.toEqual({ archivesScanned: 1, leased: 0, completed: 0, failed: 0 });

    expect(dependencies.reconcileTerminalIntegrationFailures).toHaveBeenCalledWith({
      archiveId: "archive-synthetic",
      databaseUrl: "postgres://synthetic.invalid/test"
    });
  });

  it("does not lease another hosted job after its safe invocation deadline", async () => {
    const lease = leasedJob("job-deadline", "run-deadline", "lease-deadline");
    let now = new Date("2026-07-14T20:00:00.000Z");
    const deadlineAt = new Date("2026-07-14T20:00:10.000Z");
    const dependencies = {
      now: () => now,
      listArchiveIds: vi.fn(async () => ["archive-synthetic"]),
      reconcileTerminalIntegrationFailures: vi.fn(async () => 0),
      leaseNextJob: vi.fn(async () => lease),
      getSyncRun: vi.fn(async () => ({ id: "run-deadline", status: "queued" })),
      processIntegrationSyncRun: vi.fn(async () => {
        now = deadlineAt;
        return { run: { id: "run-deadline", status: "review_ready" } };
      }),
      completeJob: vi.fn(async () => ({ ...lease, state: "completed" })),
      failJob: vi.fn(),
      renewJobLease: vi.fn(async () => lease),
      resetIntegrationPreparationForRetry: vi.fn(),
      failIntegrationPreparationTerminally: vi.fn()
    };

    const result = await runIntegrationWorkerBatch(
      {
        workerId: "worker-hosted",
        maximumJobs: 25,
        leaseDurationMs: 60_000,
        databaseUrl: "postgres://synthetic.invalid/test",
        deadlineAt
      },
      dependencies as never
    );

    expect(result.leased).toBe(1);
    expect(dependencies.leaseNextJob).toHaveBeenCalledTimes(1);
  });

  it("leases archive-scoped parse jobs and completes them with fencing tokens", async () => {
    const lease = leasedJob("job-1", "run-1", "lease-1");
    const dependencies = {
      listArchiveIds: vi.fn(async () => ["archive-synthetic"]),
      leaseNextJob: vi.fn()
        .mockResolvedValueOnce(lease)
        .mockResolvedValueOnce(null),
      getSyncRun: vi.fn(async () => ({ id: "run-1", status: "queued" })),
      processIntegrationSyncRun: vi.fn(async () => ({ run: { id: "run-1" } })),
      completeJob: vi.fn(async () => ({ ...lease, state: "completed" })),
      failJob: vi.fn(),
      renewJobLease: vi.fn(async () => lease),
      resetIntegrationPreparationForRetry: vi.fn(),
      failIntegrationPreparationTerminally: vi.fn()
    };

    const result = await runIntegrationWorkerBatch(
      {
        workerId: "worker-test",
        maximumJobs: 5,
        leaseDurationMs: 60_000,
        databaseUrl: "postgres://synthetic.invalid/test"
      },
      dependencies as never
    );

    expect(result).toEqual({ archivesScanned: 1, leased: 1, completed: 1, failed: 0 });
    expect(dependencies.processIntegrationSyncRun).toHaveBeenCalledWith("run-1", {
      archiveId: "archive-synthetic",
      databaseUrl: "postgres://synthetic.invalid/test",
      assertLease: expect.any(Function),
      leaseFence: { jobId: "job-1", leaseToken: "lease-1" }
    });
    expect(dependencies.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", leaseToken: "lease-1" }),
      expect.objectContaining({ archiveId: "archive-synthetic" })
    );
  });

  it("injects the environment-configured malware scanner into every parse job", async () => {
    const lease = leasedJob("job-scanner", "run-scanner", "lease-scanner");
    const malwareScanner = { scan: vi.fn(async () => "clean" as const) };
    const dependencies = {
      listArchiveIds: vi.fn(async () => ["archive-synthetic"]),
      leaseNextJob: vi.fn().mockResolvedValueOnce(lease).mockResolvedValueOnce(null),
      getSyncRun: vi.fn(async () => ({ id: "run-scanner", status: "queued" })),
      processIntegrationSyncRun: vi.fn(async () => ({ run: { id: "run-scanner" } })),
      completeJob: vi.fn(async () => ({ ...lease, state: "completed" })),
      failJob: vi.fn(),
      renewJobLease: vi.fn(async () => lease),
      resetIntegrationPreparationForRetry: vi.fn(),
      failIntegrationPreparationTerminally: vi.fn()
    };

    await runIntegrationWorkerBatch(
      {
        workerId: "worker-scanner",
        maximumJobs: 1,
        leaseDurationMs: 60_000,
        databaseUrl: "postgres://synthetic.invalid/test",
        malwareScanner
      },
      dependencies as never
    );

    expect(dependencies.processIntegrationSyncRun).toHaveBeenCalledWith("run-scanner", {
      archiveId: "archive-synthetic",
      databaseUrl: "postgres://synthetic.invalid/test",
      assertLease: expect.any(Function),
      leaseFence: { jobId: "job-scanner", leaseToken: "lease-scanner" },
      malwareScanner
    });
  });

  it("persists only a public error classification while retaining retry semantics", async () => {
    const lease = leasedJob("job-secret", "run-secret", "lease-secret");
    const dependencies = {
      listArchiveIds: vi.fn(async () => ["archive-synthetic"]),
      leaseNextJob: vi.fn().mockResolvedValueOnce(lease).mockResolvedValueOnce(null),
      getSyncRun: vi.fn(async () => ({ id: "run-secret", status: "queued" })),
      processIntegrationSyncRun: vi.fn(async () => {
        throw new Error("postgres://private-user:private-password@db.internal/private-family");
      }),
      completeJob: vi.fn(),
      failJob: vi.fn(async () => ({ ...lease, state: "queued" })),
      renewJobLease: vi.fn(async () => lease),
      resetIntegrationPreparationForRetry: vi.fn(async () => ({ state: "queued" })),
      failIntegrationPreparationTerminally: vi.fn()
    };

    const result = await runIntegrationWorkerBatch(
      {
        workerId: "worker-test",
        maximumJobs: 1,
        leaseDurationMs: 60_000,
        databaseUrl: "postgres://synthetic.invalid/test"
      },
      dependencies as never
    );

    expect(result).toEqual({ archivesScanned: 1, leased: 1, completed: 0, failed: 1 });
    expect(dependencies.failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-secret",
        leaseToken: "lease-secret",
        publicErrorCode: "source_package_invalid",
        retryAt: expect.any(Date)
      }),
      expect.any(Object)
    );
    expect(dependencies.resetIntegrationPreparationForRetry).toHaveBeenCalledWith(
      "run-secret",
      expect.objectContaining({ archiveId: "archive-synthetic" })
    );
    expect(dependencies.failIntegrationPreparationTerminally).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private-password|private-family/);
  });

  it("completes a reclaimed parse job from the durable review checkpoint without parsing twice", async () => {
    const lease = leasedJob("job-reclaimed", "run-ready", "lease-reclaimed");
    const dependencies = {
      listArchiveIds: vi.fn(async () => ["archive-synthetic"]),
      leaseNextJob: vi.fn().mockResolvedValueOnce(lease).mockResolvedValueOnce(null),
      getSyncRun: vi.fn(async () => ({ id: "run-ready", status: "review_ready" })),
      processIntegrationSyncRun: vi.fn(),
      completeJob: vi.fn(async () => ({ ...lease, state: "completed" })),
      failJob: vi.fn(),
      renewJobLease: vi.fn(async () => lease),
      resetIntegrationPreparationForRetry: vi.fn(),
      failIntegrationPreparationTerminally: vi.fn()
    };

    await expect(runIntegrationWorkerBatch(
      {
        workerId: "worker-reclaimed",
        maximumJobs: 1,
        leaseDurationMs: 60_000,
        databaseUrl: "postgres://synthetic.invalid/test"
      },
      dependencies as never
    )).resolves.toEqual({ archivesScanned: 1, leased: 1, completed: 1, failed: 0 });
    expect(dependencies.processIntegrationSyncRun).not.toHaveBeenCalled();
    expect(dependencies.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ checkpointReplay: true }) }),
      expect.any(Object)
    );
  });

  it("awaits an in-flight lease renewal before allowing the preparation commit", async () => {
    const lease = leasedJob("job-renew", "run-renew", "lease-renew");
    let finishRenewal!: () => void;
    const renewal = new Promise<void>((resolve) => { finishRenewal = resolve; });
    const dependencies = {
      listArchiveIds: vi.fn(async () => ["archive-synthetic"]),
      leaseNextJob: vi.fn().mockResolvedValueOnce(lease),
      getSyncRun: vi.fn(async () => ({ id: "run-renew", status: "queued" })),
      processIntegrationSyncRun: vi.fn(async (_runId: string, options: { assertLease: () => Promise<void> }) => {
        const first = options.assertLease();
        const second = options.assertLease();
        await Promise.resolve();
        expect(dependencies.renewJobLease).toHaveBeenCalledTimes(1);
        finishRenewal();
        await Promise.all([first, second]);
        return { run: { id: "run-renew", status: "review_ready" } };
      }),
      completeJob: vi.fn(async () => ({ ...lease, state: "completed" })),
      failJob: vi.fn(),
      renewJobLease: vi.fn(async () => renewal),
      resetIntegrationPreparationForRetry: vi.fn(),
      failIntegrationPreparationTerminally: vi.fn()
    };

    await expect(runIntegrationWorkerBatch(
      {
        workerId: "worker-renew",
        maximumJobs: 1,
        leaseDurationMs: 60_000,
        databaseUrl: "postgres://synthetic.invalid/test"
      },
      dependencies as never
    )).resolves.toMatchObject({ completed: 1, failed: 0 });
  });

  it("marks the sync run failed only after the durable job exhausts retries", async () => {
    const lease = { ...leasedJob("job-terminal", "run-terminal", "lease-terminal"), attempt: 3, maximumAttempts: 3 };
    const dependencies = {
      listArchiveIds: vi.fn(async () => ["archive-synthetic"]),
      leaseNextJob: vi.fn().mockResolvedValueOnce(lease),
      getSyncRun: vi.fn(async () => ({ id: "run-terminal", status: "parsing" })),
      processIntegrationSyncRun: vi.fn(async () => {
        throw Object.assign(new Error("private parser detail"), { code: "PACKAGE_INVALID" });
      }),
      completeJob: vi.fn(),
      failJob: vi.fn(async () => ({ ...lease, state: "failed" })),
      renewJobLease: vi.fn(async () => lease),
      resetIntegrationPreparationForRetry: vi.fn(),
      failIntegrationPreparationTerminally: vi.fn(async () => ({ state: "failed" }))
    };

    await expect(runIntegrationWorkerBatch(
      {
        workerId: "worker-terminal",
        maximumJobs: 1,
        leaseDurationMs: 60_000,
        databaseUrl: "postgres://synthetic.invalid/test"
      },
      dependencies as never
    )).resolves.toEqual({ archivesScanned: 1, leased: 1, completed: 0, failed: 1 });
    expect(dependencies.resetIntegrationPreparationForRetry).not.toHaveBeenCalled();
    expect(dependencies.failIntegrationPreparationTerminally).toHaveBeenCalledWith(
      "run-terminal",
      { errorCode: "package_invalid" },
      expect.objectContaining({ archiveId: "archive-synthetic" })
    );
  });

  it("runs bounded direct-upload and media-claim maintenance without scanning parse queues", async () => {
    const cleanup = vi.fn(async () => ({ scanned: 7, deleted: 5, failed: 2 }));
    const cleanupMedia = vi.fn(async () => ({ scanned: 3, deleted: 2, failed: 1 }));

    await expect(runIntegrationWorkerMaintenance(
      {
        databaseUrl: "postgres://synthetic.invalid/test",
        maintenanceLimit: 7
      },
      {
        cleanupExpiredDirectIntegrationUploadIntents: cleanup,
        cleanupExpiredIntegrationMediaWriteClaims: cleanupMedia
      }
    )).resolves.toEqual({ scanned: 10, deleted: 7, failed: 3 });

    expect(cleanup).toHaveBeenCalledExactlyOnceWith(
      { limit: 7 },
      { databaseUrl: "postgres://synthetic.invalid/test", now: undefined }
    );
    expect(cleanupMedia).toHaveBeenCalledExactlyOnceWith(
      { limit: 7 },
      { databaseUrl: "postgres://synthetic.invalid/test", now: undefined }
    );
  });

  it("gates long-running maintenance by its own interval, including after failures", async () => {
    const start = new Date("2026-07-14T20:00:00.000Z");
    const cleanup = vi.fn()
      .mockRejectedValueOnce(new Error("private storage detail"))
      .mockResolvedValueOnce({ scanned: 1, deleted: 1, failed: 0 });
    const runMaintenanceIfDue = createIntegrationWorkerMaintenanceScheduler(
      {
        databaseUrl: "postgres://synthetic.invalid/test",
        maintenanceIntervalMs: 15 * 60_000,
        maintenanceLimit: 100
      },
      { cleanupExpiredDirectIntegrationUploadIntents: cleanup }
    );

    await expect(runMaintenanceIfDue(start)).rejects.toThrow("private storage detail");
    await expect(runMaintenanceIfDue(new Date(start.getTime() + 2_000))).resolves.toBeNull();
    await expect(runMaintenanceIfDue(new Date(start.getTime() + 15 * 60_000))).resolves.toEqual({
      scanned: 1,
      deleted: 1,
      failed: 0
    });
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("parses bounded hosted and long-running worker settings without accepting zero or negative values", () => {
    const scannerConfiguration = integrationWorkerConfiguration({
      DATABASE_URL: "postgres://synthetic.invalid/test",
      KINRESOLVE_WORKER_ID: "worker-hosted",
      KINRESOLVE_WORKER_MAX_JOBS_PER_RUN: "7",
      KINRESOLVE_WORKER_LEASE_DURATION_MS: "90000",
      KINRESOLVE_WORKER_POLL_INTERVAL_MS: "2500",
      KINRESOLVE_WORKER_MAINTENANCE_INTERVAL_MS: "600000",
      KINRESOLVE_WORKER_MAINTENANCE_LIMIT: "80",
      KINRESOLVE_MALWARE_SCANNER: "clamd",
      KINRESOLVE_CLAMD_HOST: "clamav"
    });
    expect(scannerConfiguration).toEqual({
      databaseUrl: "postgres://synthetic.invalid/test",
      workerId: "worker-hosted",
      maximumJobs: 7,
      leaseDurationMs: 90_000,
      pollIntervalMs: 2_500,
      maintenanceIntervalMs: 600_000,
      maintenanceLimit: 80,
      malwareScanner: expect.objectContaining({ scan: expect.any(Function) })
    });

    expect(() => integrationWorkerConfiguration({
      DATABASE_URL: "postgres://synthetic.invalid/test",
      KINRESOLVE_WORKER_MAX_JOBS_PER_RUN: "0"
    })).toThrow(/positive|maximum/i);
    expect(() => integrationWorkerConfiguration({
      DATABASE_URL: "postgres://synthetic.invalid/test",
      KINRESOLVE_WORKER_MAINTENANCE_LIMIT: "501"
    })).toThrow(/maintenance limit.*500/i);
  });
});

function leasedJob(id: string, runId: string, leaseToken: string) {
  const now = new Date("2026-07-14T20:00:00.000Z");
  return {
    id,
    archiveId: "archive-synthetic",
    kind: "integration_snapshot_parse",
    payload: { runId },
    state: "running" as const,
    idempotencyKey: `parse:${runId}`,
    attempt: 1,
    maximumAttempts: 3,
    availableAt: now,
    leaseOwner: "worker-test",
    leaseToken,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now
  };
}
