import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import { query, withTransaction, type DatabaseOptions } from "../db";

export type DurableJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type DurableJob = {
  id: string;
  archiveId: string;
  kind: string;
  payload: unknown;
  state: DurableJobState;
  idempotencyKey: string;
  attempt: number;
  maximumAttempts: number;
  availableAt: Date;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: Date;
  result?: unknown;
  lastError?: {
    code: string;
    message: string;
  };
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  cancelledAt?: Date;
};

export type EnqueuedJob = DurableJob & { duplicate: boolean };

export type LeasedJob = DurableJob & {
  state: "running";
  leaseOwner: string;
  leaseToken: string;
  leaseExpiresAt: Date;
};

export type LeasedJobStoreOptions = DatabaseOptions & {
  archiveId: string;
};

type EnqueueJobInput = {
  kind: string;
  payload: unknown;
  idempotencyKey: string;
  maximumAttempts: number;
  availableAt: Date;
};

type LeaseNextJobInput = {
  workerId: string;
  kinds?: readonly string[];
  now: Date;
  leaseDurationMs: number;
};

type CompleteJobInput = {
  jobId: string;
  leaseToken: string;
  result: unknown;
  completedAt: Date;
};

type RenewJobLeaseInput = {
  jobId: string;
  leaseToken: string;
  renewedAt: Date;
  leaseDurationMs: number;
};

type FailJobInput = {
  jobId: string;
  leaseToken: string;
  failedAt: Date;
  retryAt?: Date;
  error: unknown;
  publicErrorCode: string;
};

type CancelJobInput = {
  jobId: string;
  cancelledAt: Date;
};

type JobRow = QueryResultRow & {
  id: string;
  archive_id: string;
  kind: string;
  payload: unknown;
  state: DurableJobState;
  idempotency_key: string;
  attempt: number;
  maximum_attempts: number;
  available_at: Date | string;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  result: unknown | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
};

export async function enqueueJob(
  input: EnqueueJobInput,
  options: LeasedJobStoreOptions
): Promise<EnqueuedJob> {
  const archiveId = requiredText(options.archiveId, "archiveId");
  const kind = requiredText(input.kind, "kind");
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  const maximumAttempts = positiveInteger(input.maximumAttempts, "maximumAttempts");
  const availableAt = validDate(input.availableAt, "availableAt");
  const payload = serializeJson(input.payload, "payload");
  const id = randomUUID();
  const now = new Date();

  const inserted = await query<JobRow>(
    `INSERT INTO durable_jobs (
       archive_id, id, kind, payload, state, idempotency_key, attempt,
       maximum_attempts, available_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4::jsonb, 'queued', $5, 0, $6, $7, $8, $8)
     ON CONFLICT (archive_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [archiveId, id, kind, payload, idempotencyKey, maximumAttempts, availableAt, now],
    options
  );

  if (inserted.rows[0]) {
    return { ...mapJob(inserted.rows[0]), duplicate: false };
  }

  const existing = await query<JobRow>(
    `SELECT *
     FROM durable_jobs
     WHERE archive_id = $1 AND idempotency_key = $2`,
    [archiveId, idempotencyKey],
    options
  );
  if (!existing.rows[0]) {
    throw new Error("Unable to resolve the idempotent job enqueue request");
  }

  return { ...mapJob(existing.rows[0]), duplicate: true };
}

export async function leaseNextJob(
  input: LeaseNextJobInput,
  options: LeasedJobStoreOptions
): Promise<LeasedJob | null> {
  const archiveId = requiredText(options.archiveId, "archiveId");
  const workerId = requiredText(input.workerId, "workerId");
  const now = validDate(input.now, "now");
  const leaseDurationMs = positiveInteger(input.leaseDurationMs, "leaseDurationMs");
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  if (Number.isNaN(leaseExpiresAt.getTime())) {
    throw new Error("leaseDurationMs produces an invalid lease expiration");
  }
  const kinds = input.kinds?.map((kind) => requiredText(kind, "kind")) ?? null;

  return withTransaction(options, async (client) => {
    await expireExhaustedLeases(client, archiveId, now);

    const leased = await client.query<JobRow>(
      `WITH candidate AS (
         SELECT archive_id, id
         FROM durable_jobs
         WHERE archive_id = $1
           AND (
             (state = 'queued' AND available_at <= $2)
             OR (
               state = 'running'
               AND lease_expires_at <= $2
               AND attempt < maximum_attempts
             )
           )
           AND ($3::text[] IS NULL OR kind = ANY($3::text[]))
         ORDER BY
           CASE WHEN state = 'running' THEN 0 ELSE 1 END,
           available_at,
           created_at,
           id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE durable_jobs AS job
       SET state = 'running',
           attempt = job.attempt + 1,
           lease_owner = $4,
           lease_token = $5,
           lease_expires_at = $6,
           updated_at = $2
       FROM candidate
       WHERE job.archive_id = candidate.archive_id
         AND job.id = candidate.id
       RETURNING job.*`,
      [archiveId, now, kinds, workerId, randomUUID(), leaseExpiresAt]
    );

    return leased.rows[0] ? mapLeasedJob(leased.rows[0]) : null;
  });
}

export async function completeJob(
  input: CompleteJobInput,
  options: LeasedJobStoreOptions
): Promise<DurableJob> {
  const archiveId = requiredText(options.archiveId, "archiveId");
  const jobId = requiredText(input.jobId, "jobId");
  const leaseToken = requiredText(input.leaseToken, "leaseToken");
  const completedAt = validDate(input.completedAt, "completedAt");
  const resultJson = serializeJson(input.result, "result");

  const updated = await query<JobRow>(
    `UPDATE durable_jobs
     SET state = 'completed',
         result = $4::jsonb,
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         completed_at = $5,
         updated_at = $5
     WHERE archive_id = $1
       AND id = $2
       AND state = 'running'
       AND lease_token = $3
       AND lease_expires_at > $5
     RETURNING *`,
    [archiveId, jobId, leaseToken, resultJson, completedAt],
    options
  );

  if (!updated.rows[0]) {
    throw await invalidTransitionError(jobId, options);
  }
  return mapJob(updated.rows[0]);
}

export async function renewJobLease(
  input: RenewJobLeaseInput,
  options: LeasedJobStoreOptions
): Promise<LeasedJob> {
  const archiveId = requiredText(options.archiveId, "archiveId");
  const jobId = requiredText(input.jobId, "jobId");
  const leaseToken = requiredText(input.leaseToken, "leaseToken");
  const renewedAt = validDate(input.renewedAt, "renewedAt");
  const leaseDurationMs = positiveInteger(input.leaseDurationMs, "leaseDurationMs");
  const leaseExpiresAt = new Date(renewedAt.getTime() + leaseDurationMs);
  if (Number.isNaN(leaseExpiresAt.getTime())) throw new Error("lease renewal produces an invalid expiration");

  const updated = await query<JobRow>(
    `UPDATE durable_jobs
     SET lease_expires_at = $4, updated_at = $5
     WHERE archive_id = $1 AND id = $2
       AND state = 'running' AND lease_token = $3
       AND lease_expires_at > $5
     RETURNING *`,
    [archiveId, jobId, leaseToken, leaseExpiresAt, renewedAt],
    options
  );
  if (!updated.rows[0]) throw await invalidTransitionError(jobId, options);
  return mapLeasedJob(updated.rows[0]);
}

export async function failJob(
  input: FailJobInput,
  options: LeasedJobStoreOptions
): Promise<DurableJob> {
  const archiveId = requiredText(options.archiveId, "archiveId");
  const jobId = requiredText(input.jobId, "jobId");
  const leaseToken = requiredText(input.leaseToken, "leaseToken");
  const failedAt = validDate(input.failedAt, "failedAt");
  const retryAt = input.retryAt ? validDate(input.retryAt, "retryAt") : undefined;
  const publicErrorCode = publicCode(input.publicErrorCode);

  // Raw exceptions may contain family details, credentials, paths, or database
  // URLs. They are deliberately never persisted in this status-facing table.
  void input.error;

  return withTransaction(options, async (client) => {
    const selected = await client.query<JobRow>(
      `SELECT *
       FROM durable_jobs
       WHERE archive_id = $1 AND id = $2
       FOR UPDATE`,
      [archiveId, jobId]
    );
    const current = selected.rows[0];
    if (!current || !hasActiveLease(current, leaseToken, failedAt)) {
      throw transitionError(current);
    }

    const shouldRetry = retryAt !== undefined && current.attempt < current.maximum_attempts;
    const state: DurableJobState = shouldRetry ? "queued" : "failed";
    const publicMessage = shouldRetry
      ? "Job failed and will be retried."
      : "Job failed after reaching its attempt limit.";

    const updated = await client.query<JobRow>(
      `UPDATE durable_jobs
       SET state = $3,
           available_at = $4,
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error_code = $5,
           last_error_message = $6,
           updated_at = $7
       WHERE archive_id = $1 AND id = $2
       RETURNING *`,
      [
        archiveId,
        jobId,
        state,
        shouldRetry ? retryAt : current.available_at,
        publicErrorCode,
        publicMessage,
        failedAt
      ]
    );

    return mapJob(updated.rows[0]);
  });
}

export async function cancelJob(
  input: CancelJobInput,
  options: LeasedJobStoreOptions
): Promise<DurableJob> {
  const archiveId = requiredText(options.archiveId, "archiveId");
  const jobId = requiredText(input.jobId, "jobId");
  const cancelledAt = validDate(input.cancelledAt, "cancelledAt");

  const updated = await query<JobRow>(
    `UPDATE durable_jobs
     SET state = 'cancelled',
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         cancelled_at = $3,
         updated_at = $3
     WHERE archive_id = $1
       AND id = $2
       AND state IN ('queued', 'running')
     RETURNING *`,
    [archiveId, jobId, cancelledAt],
    options
  );
  if (updated.rows[0]) {
    return mapJob(updated.rows[0]);
  }

  const current = await getJob(jobId, options);
  if (current?.state === "cancelled") {
    return current;
  }
  throw transitionError(current ? jobToRowShape(current) : undefined);
}

export async function getJob(
  jobId: string,
  options: LeasedJobStoreOptions
): Promise<DurableJob | null> {
  const archiveId = requiredText(options.archiveId, "archiveId");
  const normalizedJobId = requiredText(jobId, "jobId");
  const result = await query<JobRow>(
    `SELECT *
     FROM durable_jobs
     WHERE archive_id = $1 AND id = $2`,
    [archiveId, normalizedJobId],
    options
  );

  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function expireExhaustedLeases(
  client: PoolClient,
  archiveId: string,
  now: Date
): Promise<void> {
  await client.query(
    `UPDATE durable_jobs
     SET state = 'failed',
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error_code = 'attempts_exhausted',
         last_error_message = 'Job failed after reaching its attempt limit.',
         updated_at = $2
     WHERE archive_id = $1
       AND state = 'running'
       AND lease_expires_at <= $2
       AND attempt >= maximum_attempts`,
    [archiveId, now]
  );
}

async function invalidTransitionError(
  jobId: string,
  options: LeasedJobStoreOptions
): Promise<Error> {
  const current = await getJob(jobId, options);
  return transitionError(current ? jobToRowShape(current) : undefined);
}

function transitionError(job: Pick<JobRow, "state"> | undefined): Error {
  if (!job) {
    return new Error("Job not found in this archive");
  }
  if (job.state === "cancelled") {
    return new Error("Job was cancelled and its lease is no longer valid");
  }
  return new Error(`Job lease is stale or the ${job.state} state does not permit this operation`);
}

function hasActiveLease(row: JobRow, leaseToken: string, at: Date): boolean {
  return row.state === "running"
    && row.lease_token === leaseToken
    && row.lease_expires_at !== null
    && toDate(row.lease_expires_at).getTime() > at.getTime();
}

function mapJob(row: JobRow): DurableJob {
  return {
    id: row.id,
    archiveId: row.archive_id,
    kind: row.kind,
    payload: row.payload,
    state: row.state,
    idempotencyKey: row.idempotency_key,
    attempt: row.attempt,
    maximumAttempts: row.maximum_attempts,
    availableAt: toDate(row.available_at),
    leaseOwner: row.lease_owner ?? undefined,
    leaseToken: row.lease_token ?? undefined,
    leaseExpiresAt: optionalDate(row.lease_expires_at),
    result: row.result ?? undefined,
    lastError: row.last_error_code || row.last_error_message
      ? {
          code: row.last_error_code ?? "job_failed",
          message: row.last_error_message ?? "Job failed."
        }
      : undefined,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    completedAt: optionalDate(row.completed_at),
    cancelledAt: optionalDate(row.cancelled_at)
  };
}

function mapLeasedJob(row: JobRow): LeasedJob {
  if (
    row.state !== "running"
    || !row.lease_owner
    || !row.lease_token
    || row.lease_expires_at === null
  ) {
    throw new Error("Leased job row is missing its lease fencing fields");
  }

  return {
    ...mapJob(row),
    state: "running",
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: toDate(row.lease_expires_at)
  };
}

function jobToRowShape(job: DurableJob): Pick<JobRow, "state"> {
  return { state: job.state };
}

function requiredText(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return value;
}

function publicCode(value: string): string {
  const normalized = requiredText(value, "publicErrorCode");
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) {
    throw new Error("publicErrorCode is invalid");
  }
  return normalized;
}

function serializeJson(value: unknown, label: string): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error();
    }
    return serialized;
  } catch {
    throw new Error(`${label} must be JSON serializable`);
  }
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function optionalDate(value: Date | string | null): Date | undefined {
  return value === null ? undefined : toDate(value);
}
