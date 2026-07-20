import { createHmac, randomUUID } from "node:crypto";

import { query, type DatabaseOptions } from "./db";
// Imported from ./db-rls directly so unit tests that mock "@/lib/db" keep the
// real scope helper. Heartbeat and data-operation writes target rows keyed by
// options.archiveId, so each write pins that archive for the RLS policies.
import { withRlsArchiveScope } from "./db-rls";
import type { OperationalWorkerKind } from "./observability";

export type WorkerOutcome = "failed" | "running" | "succeeded";
export type WorkerFreshness = Readonly<{
  workerKind: OperationalWorkerKind;
  outcome: WorkerOutcome | "missing";
  freshness: "critical" | "healthy" | "warning";
  ageSeconds: number | null;
  lastFailureCode?: string;
}>;

export type DataOperationType = "deletion-request" | "research-export";
export type DataOperationState = "cancelled" | "completed" | "failed" | "processing" | "requested";
export type JobLagHealth = Readonly<{
  eligibleCount: number;
  eligibleCountCapped: boolean;
  oldestEligibleAgeSeconds: number | null;
  recentFailedCount: number;
  recentFailedCountCapped: boolean;
  freshness: "critical" | "healthy" | "warning";
}>;

type OperationOptions = DatabaseOptions & { archiveId: string };

const workerKinds: readonly OperationalWorkerKind[] = [
  "integration-jobs",
  "import-upload-cleanup",
  "retention-cleanup"
];
const workerKindSet = new Set<string>(workerKinds);
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digestPattern = /^[a-f0-9]{64}$/;
const workerFailureCodeSet = new Set([
  "AUTHORIZATION_ERROR",
  "CONFIGURATION_ERROR",
  "DATABASE_ERROR",
  "NETWORK_ERROR",
  "STORAGE_ERROR",
  "TEST_ALERT",
  "TIMEOUT",
  "UNEXPECTED_ERROR"
]);
const dataOperationFailureCodeSet = new Set([
  "DELETION_FAILED",
  "EXPORT_FAILED",
  "UNEXPECTED_ERROR"
]);

export async function recordWorkerStarted(
  workerKind: OperationalWorkerKind,
  requestId: string,
  options: OperationOptions
): Promise<void> {
  validateWorkerInput(workerKind, requestId, options.archiveId);
  await query(
    `INSERT INTO public.beta_worker_heartbeats
       (archive_id, worker_kind, last_outcome, last_request_id, last_started_at, updated_at)
     VALUES ($1, $2, 'running', $3::uuid, now(), now())
     ON CONFLICT (archive_id, worker_kind) DO UPDATE
     SET last_outcome = 'running',
         last_request_id = EXCLUDED.last_request_id,
         last_started_at = EXCLUDED.last_started_at,
         last_failure_code = NULL,
         updated_at = EXCLUDED.updated_at`,
    [options.archiveId, workerKind, requestId],
    withRlsArchiveScope(options, options.archiveId)
  );
}

export async function recordWorkerSucceeded(
  workerKind: OperationalWorkerKind,
  requestId: string,
  options: OperationOptions
): Promise<boolean> {
  validateWorkerInput(workerKind, requestId, options.archiveId);
  const result = await query(
    `UPDATE public.beta_worker_heartbeats
     SET last_outcome = 'succeeded',
         last_succeeded_at = now(),
         last_failure_code = NULL,
         updated_at = now()
     WHERE archive_id = $1
       AND worker_kind = $2
       AND last_request_id = $3::uuid`,
    [options.archiveId, workerKind, requestId],
    withRlsArchiveScope(options, options.archiveId)
  );
  return result.rowCount === 1;
}

export async function recordWorkerFailed(
  workerKind: OperationalWorkerKind,
  requestId: string,
  failureCode: string,
  options: OperationOptions
): Promise<boolean> {
  validateWorkerInput(workerKind, requestId, options.archiveId);
  if (!workerFailureCodeSet.has(failureCode)) throw new Error("Worker failure code is invalid.");
  const result = await query(
    `UPDATE public.beta_worker_heartbeats
     SET last_outcome = 'failed',
         last_failed_at = now(),
         last_failure_code = $4,
         updated_at = now()
     WHERE archive_id = $1
       AND worker_kind = $2
       AND last_request_id = $3::uuid`,
    [options.archiveId, workerKind, requestId, failureCode],
    withRlsArchiveScope(options, options.archiveId)
  );
  return result.rowCount === 1;
}

export async function readWorkerFreshness(
  options: OperationOptions & {
    now?: Date;
    thresholds?: Partial<Record<OperationalWorkerKind, { warningSeconds: number; criticalSeconds: number }>>;
  }
): Promise<WorkerFreshness[]> {
  const result = await query<{
    worker_kind: OperationalWorkerKind;
    last_outcome: WorkerOutcome;
    last_started_at: Date;
    last_succeeded_at: Date | null;
    last_failed_at: Date | null;
    last_failure_code: string | null;
    updated_at: Date;
  }>(
    `SELECT worker_kind, last_outcome, last_started_at, last_succeeded_at,
            last_failed_at, last_failure_code, updated_at
     FROM public.beta_worker_heartbeats
     WHERE archive_id = $1
       AND worker_kind = ANY($2::text[])
     ORDER BY worker_kind ASC
     LIMIT 3`,
    [options.archiveId, workerKinds],
    options
  );
  const byKind = new Map(result.rows.map((row) => [row.worker_kind, row]));
  const now = options.now ?? new Date();

  return workerKinds.map((workerKind) => {
    const row = byKind.get(workerKind);
    if (!row) {
      return { workerKind, outcome: "missing", freshness: "critical", ageSeconds: null };
    }
    const lastHealthyAt = row.last_succeeded_at ?? row.updated_at;
    const ageSeconds = Math.max(0, Math.floor((now.getTime() - lastHealthyAt.getTime()) / 1_000));
    const defaults = defaultFreshnessThresholds(workerKind);
    const thresholds = options.thresholds?.[workerKind] ?? defaults;
    validateThresholds(thresholds);
    const freshness = row.last_outcome === "failed" || ageSeconds >= thresholds.criticalSeconds
      ? "critical"
      : ageSeconds >= thresholds.warningSeconds || row.last_outcome === "running"
        ? "warning"
        : "healthy";
    return {
      workerKind,
      outcome: row.last_outcome,
      freshness,
      ageSeconds,
      ...(row.last_failure_code ? { lastFailureCode: row.last_failure_code } : {})
    };
  });
}

export async function readJobLagHealth(
  options: OperationOptions & {
    now?: Date;
    warningSeconds?: number;
    criticalSeconds?: number;
  }
): Promise<JobLagHealth> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("Job-lag observation time is invalid.");
  const warningSeconds = options.warningSeconds ?? 10 * 60;
  const criticalSeconds = options.criticalSeconds ?? 20 * 60;
  validateThresholds({ warningSeconds, criticalSeconds });
  const maximumReportedCount = 1_000;
  const result = await query<{
    eligible_count: string;
    oldest_eligible_at: Date | null;
    recent_failed_count: string;
  }>(
    `WITH eligible AS (
       SELECT CASE WHEN state = 'queued' THEN available_at ELSE lease_expires_at END AS eligible_at
       FROM public.durable_jobs
       WHERE archive_id = $1
         AND (
           (state = 'queued' AND available_at <= $2)
           OR (state = 'running' AND lease_expires_at <= $2 AND attempt < maximum_attempts)
         )
       ORDER BY eligible_at ASC, id ASC
       LIMIT 1001
     ), recent_failed AS (
       SELECT updated_at
       FROM public.durable_jobs
       WHERE archive_id = $1
         AND state = 'failed'
         AND updated_at >= $2 - interval '24 hours'
       ORDER BY updated_at DESC, id DESC
       LIMIT 1001
     )
     SELECT (SELECT COUNT(*)::text FROM eligible) AS eligible_count,
            (SELECT MIN(eligible_at) FROM eligible) AS oldest_eligible_at,
            (SELECT COUNT(*)::text FROM recent_failed) AS recent_failed_count`,
    [options.archiveId, now],
    options
  );
  const row = result.rows[0];
  const rawEligibleCount = boundedCount(row?.eligible_count, "eligible job count", maximumReportedCount + 1);
  const rawRecentFailedCount = boundedCount(
    row?.recent_failed_count,
    "recent failed job count",
    maximumReportedCount + 1
  );
  const oldestEligibleAt = row?.oldest_eligible_at;
  const oldestEligibleAgeSeconds = oldestEligibleAt
    ? Math.max(0, Math.floor((now.getTime() - oldestEligibleAt.getTime()) / 1_000))
    : null;
  const freshness = rawRecentFailedCount > 0
    || (oldestEligibleAgeSeconds !== null && oldestEligibleAgeSeconds >= criticalSeconds)
    ? "critical"
    : oldestEligibleAgeSeconds !== null && oldestEligibleAgeSeconds >= warningSeconds
      ? "warning"
      : "healthy";
  return {
    eligibleCount: Math.min(rawEligibleCount, maximumReportedCount),
    eligibleCountCapped: rawEligibleCount > maximumReportedCount,
    oldestEligibleAgeSeconds,
    recentFailedCount: Math.min(rawRecentFailedCount, maximumReportedCount),
    recentFailedCountCapped: rawRecentFailedCount > maximumReportedCount,
    freshness
  };
}

export async function beginDataOperation(
  input: {
    operationType: DataOperationType;
    requestId: string;
    userId: string;
  },
  options: OperationOptions
): Promise<Readonly<{ id: string; state: "requested" }>> {
  validateDataOperationInput(input, options.archiveId);
  const id = randomUUID();
  const actorDigest = participantDigest(input.userId);
  const result = await query<{ id: string; state: "requested" }>(
    `INSERT INTO public.beta_data_operations
       (id, archive_id, operation_type, state, actor_digest, request_id)
     VALUES ($1::uuid, $2, $3, 'requested', $4, $5::uuid)
     RETURNING id::text, state`,
    [id, options.archiveId, input.operationType, actorDigest, input.requestId],
    withRlsArchiveScope(options, options.archiveId)
  );
  return result.rows[0];
}

export async function completeDataOperation(
  input: {
    id: string;
    manifestDigest: string;
    operationType: DataOperationType;
    userId: string;
  },
  options: OperationOptions
): Promise<void> {
  if (!requestIdPattern.test(input.id) || !digestPattern.test(input.manifestDigest)) {
    throw new Error("Data operation completion is invalid.");
  }
  const actorDigest = participantDigest(input.userId);
  const result = await query(
    `UPDATE public.beta_data_operations
     SET state = 'completed', manifest_digest = $5, completed_at = now(), updated_at = now()
     WHERE id = $1::uuid
       AND archive_id = $2
       AND operation_type = $3
       AND actor_digest = $4
       AND state IN ('requested', 'processing')`,
    [input.id, options.archiveId, input.operationType, actorDigest, input.manifestDigest],
    withRlsArchiveScope(options, options.archiveId)
  );
  if (result.rowCount !== 1) throw new Error("Data operation could not be completed.");
}

export async function failDataOperation(
  input: {
    failureCode: string;
    id: string;
    operationType: DataOperationType;
    userId: string;
  },
  options: OperationOptions
): Promise<void> {
  if (!requestIdPattern.test(input.id) || !dataOperationFailureCodeSet.has(input.failureCode)) {
    throw new Error("Data operation failure is invalid.");
  }
  const actorDigest = participantDigest(input.userId);
  const result = await query(
    `UPDATE public.beta_data_operations
     SET state = 'failed', failure_code = $5, completed_at = now(), updated_at = now()
     WHERE id = $1::uuid
       AND archive_id = $2
       AND operation_type = $3
       AND actor_digest = $4
       AND state IN ('requested', 'processing')`,
    [input.id, options.archiveId, input.operationType, actorDigest, input.failureCode],
    withRlsArchiveScope(options, options.archiveId)
  );
  if (result.rowCount !== 1) throw new Error("Data operation could not be failed.");
}

function participantDigest(userId: string): string {
  const secret = process.env.KINRESOLVE_BETA_PRIVACY_HMAC_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Beta privacy digesting is not configured.");
  }
  return createHmac("sha256", secret)
    .update("kinresolve:beta-data-operation:participant:v1\0")
    .update(userId)
    .digest("hex");
}

function validateWorkerInput(workerKind: string, requestId: string, archiveId: string): void {
  if (!workerKindSet.has(workerKind) || !requestIdPattern.test(requestId) || !archiveId.trim()) {
    throw new Error("Worker heartbeat input is invalid.");
  }
}

function validateDataOperationInput(
  input: { operationType: string; requestId: string; userId: string },
  archiveId: string
): void {
  if (
    !operationTypeSet.has(input.operationType)
    || !requestIdPattern.test(input.requestId)
    || !archiveId.trim()
    || !input.userId.trim()
  ) {
    throw new Error("Data operation request is invalid.");
  }
}

const operationTypeSet = new Set<string>(["deletion-request", "research-export"]);

function defaultFreshnessThresholds(workerKind: OperationalWorkerKind): {
  warningSeconds: number;
  criticalSeconds: number;
} {
  if (workerKind === "integration-jobs") return { warningSeconds: 10 * 60, criticalSeconds: 20 * 60 };
  return { warningSeconds: 30 * 60 * 60, criticalSeconds: 48 * 60 * 60 };
}

function validateThresholds(thresholds: { warningSeconds: number; criticalSeconds: number }): void {
  if (
    !Number.isSafeInteger(thresholds.warningSeconds)
    || !Number.isSafeInteger(thresholds.criticalSeconds)
    || thresholds.warningSeconds < 1
    || thresholds.criticalSeconds <= thresholds.warningSeconds
  ) {
    throw new Error("Worker freshness thresholds are invalid.");
  }
}

function boundedCount(value: string | undefined, label: string, maximum: number): number {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(value)) {
    throw new Error(`The ${label} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`The ${label} exceeds its bounded query.`);
  }
  return parsed;
}
