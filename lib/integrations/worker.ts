import { query, type DatabaseOptions } from "../db";
import {
  completeJob,
  failJob,
  leaseNextJob,
  renewJobLease,
  type LeasedJob,
  type LeasedJobStoreOptions
} from "../jobs/leased-job-store";
import {
  failIntegrationPreparationTerminally,
  reconcileTerminalIntegrationFailures,
  resetIntegrationPreparationForRetry
} from "./preparation-store";
import { processIntegrationSyncRun } from "./run-processor";
import {
  createMalwareScannerFromEnvironment,
  type MalwareScanner
} from "./malware-scanner";
import { getSyncRun } from "./store";
import { cleanupExpiredDirectIntegrationUploadIntents } from "./direct-upload";
import { cleanupExpiredIntegrationMediaWriteClaims } from "./media-claims";

export type IntegrationWorkerConfiguration = {
  databaseUrl: string;
  workerId: string;
  maximumJobs: number;
  leaseDurationMs: number;
  pollIntervalMs: number;
  maintenanceIntervalMs: number;
  maintenanceLimit: number;
  malwareScanner?: MalwareScanner;
};

type WorkerBatchConfiguration = Pick<
  IntegrationWorkerConfiguration,
  "databaseUrl" | "workerId" | "maximumJobs" | "leaseDurationMs" | "malwareScanner"
> & {
  deadlineAt?: Date;
};

type WorkerMaintenanceConfiguration = Pick<
  IntegrationWorkerConfiguration,
  "databaseUrl" | "maintenanceIntervalMs" | "maintenanceLimit"
>;

type WorkerMaintenanceDependencies = {
  cleanupExpiredDirectIntegrationUploadIntents: typeof cleanupExpiredDirectIntegrationUploadIntents;
  cleanupExpiredIntegrationMediaWriteClaims?: typeof cleanupExpiredIntegrationMediaWriteClaims;
  now?: () => Date;
};

const defaultMaintenanceDependencies: WorkerMaintenanceDependencies = {
  cleanupExpiredDirectIntegrationUploadIntents,
  cleanupExpiredIntegrationMediaWriteClaims
};

type WorkerDependencies = {
  listArchiveIds(options: DatabaseOptions): Promise<string[]>;
  leaseNextJob: typeof leaseNextJob;
  processIntegrationSyncRun: typeof processIntegrationSyncRun;
  getSyncRun: typeof getSyncRun;
  completeJob: typeof completeJob;
  failJob: typeof failJob;
  renewJobLease: typeof renewJobLease;
  resetIntegrationPreparationForRetry: typeof resetIntegrationPreparationForRetry;
  failIntegrationPreparationTerminally: typeof failIntegrationPreparationTerminally;
  reconcileTerminalIntegrationFailures?: typeof reconcileTerminalIntegrationFailures;
  now?: () => Date;
};

const defaultDependencies: WorkerDependencies = {
  listArchiveIds: listIntegrationJobArchiveIds,
  leaseNextJob,
  processIntegrationSyncRun,
  getSyncRun,
  completeJob,
  failJob,
  renewJobLease,
  resetIntegrationPreparationForRetry,
  failIntegrationPreparationTerminally,
  reconcileTerminalIntegrationFailures
};

export function integrationWorkerConfiguration(
  environment: Record<string, string | undefined> = process.env
): IntegrationWorkerConfiguration {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the integration worker");

  return {
    databaseUrl,
    workerId: environment.KINRESOLVE_WORKER_ID?.trim() || `kinresolve-worker-${process.pid}`,
    maximumJobs: positiveInteger(
      environment.KINRESOLVE_WORKER_MAX_JOBS_PER_RUN,
      25,
      "maximum jobs per run"
    ),
    leaseDurationMs: positiveInteger(
      environment.KINRESOLVE_WORKER_LEASE_DURATION_MS,
      5 * 60_000,
      "worker lease duration"
    ),
    pollIntervalMs: positiveInteger(
      environment.KINRESOLVE_WORKER_POLL_INTERVAL_MS,
      2_000,
      "worker poll interval"
    ),
    maintenanceIntervalMs: positiveInteger(
      environment.KINRESOLVE_WORKER_MAINTENANCE_INTERVAL_MS,
      15 * 60_000,
      "worker maintenance interval"
    ),
    maintenanceLimit: boundedPositiveInteger(
      environment.KINRESOLVE_WORKER_MAINTENANCE_LIMIT,
      100,
      "worker maintenance limit",
      500
    ),
    malwareScanner: createMalwareScannerFromEnvironment(environment)
  };
}

export async function runIntegrationWorkerMaintenance(
  configuration: Pick<IntegrationWorkerConfiguration, "databaseUrl" | "maintenanceLimit">,
  dependencies: WorkerMaintenanceDependencies = defaultMaintenanceDependencies
): Promise<{ scanned: number; deleted: number; failed: number }> {
  const directUploads = await dependencies.cleanupExpiredDirectIntegrationUploadIntents(
    { limit: configuration.maintenanceLimit },
    { databaseUrl: configuration.databaseUrl, now: dependencies.now }
  );
  const mediaClaims = dependencies.cleanupExpiredIntegrationMediaWriteClaims
    ? await dependencies.cleanupExpiredIntegrationMediaWriteClaims(
        { limit: configuration.maintenanceLimit },
        { databaseUrl: configuration.databaseUrl, now: dependencies.now }
      )
    : { scanned: 0, deleted: 0, failed: 0 };
  return {
    scanned: directUploads.scanned + mediaClaims.scanned,
    deleted: directUploads.deleted + mediaClaims.deleted,
    failed: directUploads.failed + mediaClaims.failed
  };
}

/** Stateful interval gate used by the long-running worker loop. */
export function createIntegrationWorkerMaintenanceScheduler(
  configuration: WorkerMaintenanceConfiguration,
  dependencies: WorkerMaintenanceDependencies = defaultMaintenanceDependencies
): (now?: Date) => Promise<{ scanned: number; deleted: number; failed: number } | null> {
  let nextRunAt = 0;
  return async (now = dependencies.now?.() ?? new Date()) => {
    if (now.getTime() < nextRunAt) return null;
    // Advance before awaiting so a failure cannot cause maintenance on every
    // short job-poll iteration.
    nextRunAt = now.getTime() + configuration.maintenanceIntervalMs;
    return runIntegrationWorkerMaintenance(configuration, dependencies);
  };
}

export async function runIntegrationWorkerBatch(
  configuration: WorkerBatchConfiguration,
  dependencies: WorkerDependencies = defaultDependencies
): Promise<{ archivesScanned: number; leased: number; completed: number; failed: number }> {
  const archiveIds = await dependencies.listArchiveIds({ databaseUrl: configuration.databaseUrl });
  const result = { archivesScanned: archiveIds.length, leased: 0, completed: 0, failed: 0 };
  if (archiveIds.length === 0) return result;

  for (const archiveId of archiveIds) {
    await dependencies.reconcileTerminalIntegrationFailures?.({
      archiveId,
      databaseUrl: configuration.databaseUrl
    });
  }
  if (deadlineReached(configuration, dependencies)) return result;

  let foundWork = true;
  while (
    foundWork
    && result.leased < configuration.maximumJobs
    && !deadlineReached(configuration, dependencies)
  ) {
    foundWork = false;
    for (const archiveId of archiveIds) {
      if (result.leased >= configuration.maximumJobs || deadlineReached(configuration, dependencies)) break;
      const jobOptions: LeasedJobStoreOptions = {
        archiveId,
        databaseUrl: configuration.databaseUrl
      };
      const job = await dependencies.leaseNextJob(
        {
          workerId: configuration.workerId,
          kinds: ["integration_snapshot_parse"],
          now: workerNow(dependencies),
          leaseDurationMs: configuration.leaseDurationMs
        },
        jobOptions
      );
      if (!job) continue;
      foundWork = true;
      result.leased += 1;

      let runId: string | undefined;
      try {
        runId = integrationRunId(job);
        const existingRun = await dependencies.getSyncRun(runId, {
          archiveId,
          databaseUrl: configuration.databaseUrl
        });
        if (["review_ready", "applied", "rolled_back"].includes(existingRun.status)) {
          await dependencies.completeJob(
            {
              jobId: job.id,
              leaseToken: job.leaseToken,
              result: { runId, status: existingRun.status, checkpointReplay: true },
              completedAt: new Date()
            },
            jobOptions
          );
          result.completed += 1;
          continue;
        }
        if (existingRun.status === "cancelled") continue;
        const processed = await processWithRenewableLease(
          runId,
          job,
          configuration,
          jobOptions,
          dependencies
        );
        await dependencies.completeJob(
          {
            jobId: job.id,
            leaseToken: job.leaseToken,
            result: { runId, status: processed.run.status },
            completedAt: new Date()
          },
          jobOptions
        );
        result.completed += 1;
      } catch (error) {
        if (runId && await runIsCancelled(runId, jobOptions, dependencies)) continue;
        const failedJob = await dependencies.failJob(
          {
            jobId: job.id,
            leaseToken: job.leaseToken,
            failedAt: new Date(),
            retryAt: retryTime(job),
            error,
            publicErrorCode: publicWorkerErrorCode(error)
          },
          jobOptions
        ).catch(() => undefined);
        if (!failedJob) {
          result.failed += 1;
          continue;
        }
        if (runId) {
          if (failedJob.state === "queued") {
            await dependencies.resetIntegrationPreparationForRetry(runId, jobOptions);
          } else {
            await dependencies.failIntegrationPreparationTerminally(
              runId,
              { errorCode: publicWorkerErrorCode(error) },
              jobOptions
            );
          }
        }
        result.failed += 1;
      }
    }
  }

  return result;
}

async function processWithRenewableLease(
  runId: string,
  job: LeasedJob,
  configuration: WorkerBatchConfiguration,
  options: LeasedJobStoreOptions,
  dependencies: WorkerDependencies
) {
  let lostLease: unknown;
  let renewal: Promise<void> | undefined;
  const renew = async () => {
    if (lostLease) throw lostLease;
    if (deadlineReached(configuration, dependencies)) {
      lostLease = Object.assign(
        new Error("worker invocation deadline reached before the review checkpoint"),
        { code: "WORKER_DEADLINE" }
      );
      throw lostLease;
    }
    if (!renewal) {
      renewal = (async () => {
        try {
          await dependencies.renewJobLease(
            {
              jobId: job.id,
              leaseToken: job.leaseToken,
              renewedAt: workerNow(dependencies),
              leaseDurationMs: configuration.leaseDurationMs
            },
            options
          );
        } catch (error) {
          lostLease = error;
          throw error;
        }
      })().finally(() => {
        renewal = undefined;
      });
    }
    await renewal;
  };
  const heartbeat = setInterval(
    () => void renew().catch(() => undefined),
    Math.max(1_000, Math.floor(configuration.leaseDurationMs / 3))
  );
  heartbeat.unref?.();
  try {
    const processed = await dependencies.processIntegrationSyncRun(runId, {
      archiveId: options.archiveId,
      databaseUrl: configuration.databaseUrl,
      assertLease: renew,
      leaseFence: { jobId: job.id, leaseToken: job.leaseToken },
      ...(configuration.malwareScanner ? { malwareScanner: configuration.malwareScanner } : {})
    });
    if (lostLease) throw lostLease;
    return processed;
  } finally {
    clearInterval(heartbeat);
  }
}

async function runIsCancelled(
  runId: string,
  options: LeasedJobStoreOptions,
  dependencies: WorkerDependencies
): Promise<boolean> {
  const run = await dependencies.getSyncRun(runId, options).catch(() => undefined);
  return run?.status === "cancelled" || run?.status === "cancel_requested";
}

function publicWorkerErrorCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    && /^[A-Z0-9_]{1,64}$/.test(error.code)
  ) {
    return error.code.toLowerCase();
  }
  return "source_package_invalid";
}

async function listIntegrationJobArchiveIds(options: DatabaseOptions): Promise<string[]> {
  const result = await query<{ archive_id: string }>(
    `SELECT DISTINCT archive_id
     FROM durable_jobs
     WHERE kind = 'integration_snapshot_parse'
       AND (
         (state = 'queued' AND available_at <= now())
         OR (state = 'running' AND lease_expires_at <= now())
         OR (
           state = 'failed'
           AND EXISTS (
             SELECT 1 FROM sync_runs run
             WHERE run.archive_id = durable_jobs.archive_id
               AND run.id = durable_jobs.payload->>'runId'
               AND run.status IN ('queued', 'parsing')
           )
         )
       )
     ORDER BY archive_id`,
    [],
    options
  );
  return result.rows.map((row) => row.archive_id);
}

function workerNow(dependencies: WorkerDependencies): Date {
  return dependencies.now?.() ?? new Date();
}

function deadlineReached(
  configuration: WorkerBatchConfiguration,
  dependencies: WorkerDependencies
): boolean {
  if (!configuration.deadlineAt) return false;
  if (Number.isNaN(configuration.deadlineAt.getTime())) {
    throw new Error("worker invocation deadline must be a valid date");
  }
  return workerNow(dependencies).getTime() >= configuration.deadlineAt.getTime();
}

function integrationRunId(job: LeasedJob): string {
  if (
    typeof job.payload !== "object"
    || job.payload === null
    || !("runId" in job.payload)
    || typeof job.payload.runId !== "string"
    || !job.payload.runId.trim()
  ) {
    throw new Error("Integration parse job has an invalid public payload");
  }
  return job.payload.runId.trim();
}

function retryTime(job: LeasedJob): Date {
  const backoffMs = Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, job.attempt - 1));
  return new Date(Date.now() + backoffMs);
}

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function boundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  label: string,
  maximum: number
): number {
  const parsed = positiveInteger(value, fallback, label);
  if (parsed > maximum) throw new Error(`${label} must be at most ${maximum}`);
  return parsed;
}
