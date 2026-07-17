import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabaseOptions } from "./db";
import { query, withTransaction } from "./db";
import {
  createPublicDemoSessionToken,
  digestPublicDemoSessionToken
} from "./public-demo-session-token";
import {
  decidePublicDemoAdmission,
  publicDemoSessionPolicy,
  rotatePublicDemoSession,
  type PublicDemoSessionState,
  type PublicDemoSessionStatus
} from "./public-demo-sessions";
import { provisionArchive } from "./workspace-store";
import { publicDemoNoticeVersion } from "./public-demo-contract";

type PublicDemoSessionRow = {
  session_id: string;
  archive_id: string;
  generation: number;
  expires_at: Date | string;
  token_digest?: string | null;
  status?: PublicDemoSessionStatus;
  reset_count?: number;
  ai_attempts_used?: number;
  created_at?: Date | string;
};

export type PublicDemoGuestIdentity = {
  sessionId: string;
  archiveId: string;
  generation: number;
  expiresAt: string;
};

export type PublicDemoSessionView = PublicDemoGuestIdentity & {
  status: "active";
  resetCount: number;
  aiAttemptsRemaining: number;
};

export type PublicDemoEventName =
  | "landing_viewed"
  | "session_started"
  | "guide_started"
  | "outcome_completed"
  | "ai_attempted"
  | "reset"
  | "feedback_submitted"
  | "beta_cta_clicked"
  | "capacity_rejected";

export type PublicDemoPromptId = "case_next_steps" | "evidence_gaps" | "dna_cluster_summary";

export type PublicDemoAiAdmissionErrorCode =
  | "session-stale"
  | "session-limit"
  | "global-concurrency"
  | "global-daily";

export class PublicDemoAiAdmissionError extends Error {
  readonly code: PublicDemoAiAdmissionErrorCode;

  constructor(code: PublicDemoAiAdmissionErrorCode) {
    super(`Public demo AI admission failed: ${code}.`);
    this.name = "PublicDemoAiAdmissionError";
    this.code = code;
  }
}

export function publicDemoAiAdmissionErrorCode(error: unknown): PublicDemoAiAdmissionErrorCode | null {
  return error instanceof PublicDemoAiAdmissionError ? error.code : null;
}

const sessionColumns = `session.id::text AS session_id,
  session.archive_id,
  session.generation,
  session.token_digest,
  session.status,
  session.reset_count,
  session.ai_attempts_used,
  session.created_at,
  session.expires_at`;

export async function resolvePublicDemoGuestIdentity(
  rawToken: string,
  options: DatabaseOptions = {}
): Promise<PublicDemoGuestIdentity | null> {
  const tokenDigest = digestPublicDemoSessionToken(rawToken);
  const result = await query<PublicDemoSessionRow>(
    `SELECT ${sessionColumns}
     FROM public.public_demo_sessions AS session
     WHERE session.token_digest = $1
       AND session.status = 'active'
       AND session.expires_at > clock_timestamp()
     LIMIT 1`,
    [tokenDigest],
    options
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    sessionId: row.session_id,
    archiveId: row.archive_id,
    generation: row.generation,
    expiresAt: timestamp(row.expires_at)
  };
}

export async function readPublicDemoSession(
  rawToken: string,
  options: DatabaseOptions = {}
): Promise<PublicDemoSessionView | null> {
  const identity = await resolvePublicDemoGuestIdentity(rawToken, options);
  if (!identity) return null;
  const result = await query<PublicDemoSessionRow>(
    `SELECT ${sessionColumns}
     FROM public.public_demo_sessions AS session
     WHERE session.id = $1::uuid
       AND session.status = 'active'
       AND session.expires_at > clock_timestamp()
     LIMIT 1`,
    [identity.sessionId],
    options
  );
  return result.rows[0] ? sessionView(result.rows[0]) : null;
}

export async function startPublicDemoSession(
  input: {
    rawToken?: string;
    noticeVersion: string;
    networkSubjectDigest: string;
    isCanary?: boolean;
    now?: Date;
  },
  options: DatabaseOptions = {}
): Promise<
  | { kind: "created" | "resumed"; rawToken: string; session: PublicDemoSessionView }
  | { kind: "capacity-exceeded"; maximumActiveSessions: 25 }
  | { kind: "rate-limited"; retryAfterSeconds: number }
> {
  if (input.noticeVersion !== publicDemoNoticeVersion) {
    throw new Error("The public demo notice version is invalid.");
  }
  const now = validDate(input.now ?? new Date(), "session start time");
  const candidateToken = createPublicDemoSessionToken();
  const candidate = {
    sessionId: randomUUID(),
    archiveId: publicDemoArchiveId(),
    tokenDigest: digestPublicDemoSessionToken(candidateToken)
  };

  const reserved = await withTransaction(options, async (client) => {
    await lockCapacity(client);
    const current = input.rawToken
      ? await selectSessionForToken(client, digestPublicDemoSessionToken(input.rawToken), true)
      : null;
    const counts = await client.query<{ active: number; provisioning: number }>(
      `SELECT
         count(*) FILTER (WHERE status = 'active')::int AS active,
         count(*) FILTER (WHERE status = 'provisioning')::int AS provisioning
       FROM public.public_demo_sessions
       WHERE status IN ('active', 'provisioning')
         AND expires_at > $1`,
      [now]
    );
    const decision = decidePublicDemoAdmission({
      now,
      currentSession: current,
      activeSessionCount: counts.rows[0]?.active ?? 0,
      provisioningSessionCount: counts.rows[0]?.provisioning ?? 0,
      create: candidate
    });
    if (decision.kind !== "create") return decision;
    const rateLimit = input.isCanary === true
      ? ({ allowed: true } as const)
      : await consumePublicDemoNetworkRateLimit(
          client,
          input.networkSubjectDigest,
          now
        );
    if (!rateLimit.allowed) {
      return { kind: "rate-limited", retryAfterSeconds: rateLimit.retryAfterSeconds } as const;
    }

    await client.query(
      `INSERT INTO public.public_demo_sessions (
         id, token_digest, archive_id, generation, status, notice_version,
         reset_count, ai_attempts_used, is_canary, created_at, expires_at, updated_at
       ) VALUES ($1::uuid, $2, $3, 1, 'provisioning', $4, 0, 0, $5, $6, $7, $6)`,
      [
        decision.session.sessionId,
        decision.session.tokenDigest,
        decision.session.archiveId,
        input.noticeVersion,
        input.isCanary === true,
        decision.session.createdAt,
        decision.session.expiresAt
      ]
    );
    await client.query(
      `INSERT INTO public.public_demo_generations (
         session_id, generation, archive_id, state, created_at
       ) VALUES ($1::uuid, 1, $2, 'provisioning', $3)`,
      [decision.session.sessionId, decision.session.archiveId, now]
    );
    return decision;
  });

  if (reserved.kind === "capacity-exceeded") {
    await recordPublicDemoEvent({ eventName: "capacity_rejected", now }, options)
      .catch(() => undefined);
    return reserved;
  }
  if (reserved.kind === "rate-limited") return reserved;

  if (reserved.kind === "resume") {
    const resumedToken = input.rawToken;
    if (!resumedToken) throw new Error("The resumable public demo token is unavailable.");
    if (reserved.session.status === "provisioning") {
      await activateProvisionedSessionOrCleanup(reserved.session, now, options);
    }
    const session = activeSessionView({ ...reserved.session, status: "active" });
    return { kind: "resumed", rawToken: resumedToken, session };
  }

  await activateProvisionedSessionOrCleanup(reserved.session, now, options);

  const session = activeSessionView({ ...reserved.session, status: "active" });
  await recordPublicDemoEvent({ sessionId: session.sessionId, eventName: "session_started", now }, options)
    .catch(() => undefined);
  return { kind: "created", rawToken: candidateToken, session };
}

export async function resetPublicDemoSession(
  rawToken: string,
  input: { now?: Date } = {},
  options: DatabaseOptions = {}
): Promise<{ rawToken: string; session: PublicDemoSessionView; retiredArchiveId: string }> {
  const now = validDate(input.now ?? new Date(), "session reset time");
  const current = await readSessionState(rawToken, options);
  if (!current) throw new Error("The public demo session is unavailable or expired.");

  const nextToken = createPublicDemoSessionToken();
  const next = {
    archiveId: publicDemoArchiveId(),
    tokenDigest: digestPublicDemoSessionToken(nextToken)
  };
  const planned = await withTransaction(options, async (client) => {
    await lockCapacity(client);
    const locked = await selectSessionForToken(client, digestPublicDemoSessionToken(rawToken), true);
    if (!locked || locked.sessionId !== current.sessionId) {
      throw new Error("The public demo reset request is stale.");
    }
    const pending = await client.query(
      `SELECT 1
       FROM public.public_demo_generations
       WHERE session_id = $1::uuid AND state = 'provisioning'
       FOR UPDATE`,
      [locked.sessionId]
    );
    if (pending.rows.length > 0) {
      throw new Error("A public demo reset is already in progress.");
    }
    await assertNoActiveAiLease(client, locked, now);
    const reservation = rotatePublicDemoSession(locked, next, now);
    await client.query(
      `INSERT INTO public.public_demo_generations (
         session_id, generation, archive_id, state, created_at
       ) VALUES ($1::uuid, $2, $3, 'provisioning', $4)`,
      [
        locked.sessionId,
        reservation.session.generation,
        reservation.session.archiveId,
        now
      ]
    );
    return reservation;
  });

  let activatedSession: PublicDemoSessionState | undefined;
  try {
    await provisionArchive("demo", { ...options, archiveId: planned.session.archiveId });
    activatedSession = await withTransaction(options, async (client) => {
      await lockCapacity(client);
      const locked = await selectSessionForToken(client, digestPublicDemoSessionToken(rawToken), true);
      if (
        !locked
        || locked.sessionId !== current.sessionId
        || locked.archiveId !== planned.retiredArchive.archiveId
        || locked.generation !== planned.retiredArchive.generation
      ) {
        throw new Error("The public demo reset request is stale.");
      }
      await assertNoActiveAiLease(client, locked, now);
      const replacement = await client.query(
        `SELECT 1
         FROM public.public_demo_generations
         WHERE session_id = $1::uuid
           AND generation = $2
           AND archive_id = $3
           AND state = 'provisioning'
         FOR UPDATE`,
        [locked.sessionId, planned.session.generation, planned.session.archiveId]
      );
      if (replacement.rows.length !== 1) {
        throw new Error("The public demo reset generation is stale.");
      }
      const fenced = rotatePublicDemoSession(
        locked,
        next,
        now
      );
      await client.query(
        `UPDATE public.public_demo_generations
         SET state = 'retired', retired_at = $3
         WHERE session_id = $1::uuid AND generation = $2 AND state = 'active'`,
        [locked.sessionId, locked.generation, now]
      );
      const activated = await client.query(
        `UPDATE public.public_demo_generations
         SET state = 'active'
         WHERE session_id = $1::uuid
           AND generation = $2
           AND archive_id = $3
           AND state = 'provisioning'`,
        [locked.sessionId, fenced.session.generation, fenced.session.archiveId]
      );
      if (activated.rowCount !== 1) throw new Error("The public demo reset activation is stale.");
      await client.query(
        `UPDATE public.public_demo_sessions
         SET token_digest = $2,
             archive_id = $3,
             generation = $4,
             reset_count = $5,
             status = 'active',
             updated_at = $6
         WHERE id = $1::uuid`,
        [
          locked.sessionId,
          fenced.session.tokenDigest,
          fenced.session.archiveId,
          fenced.session.generation,
          fenced.session.resetCount,
          now
        ]
      );
      return { ...fenced.session, status: "active" as const };
    });
  } catch (error) {
    await failResetGeneration(
      current.sessionId,
      planned.session.generation,
      planned.session.archiveId,
      now,
      options
    ).catch(() => undefined);
    await deletePublicDemoArchive(planned.session.archiveId, options).catch(() => undefined);
    throw error;
  }

  if (!activatedSession) throw new Error("The reset public demo session could not be activated.");
  const session = activeSessionView(activatedSession);
  await recordPublicDemoEvent({ sessionId: session.sessionId, eventName: "reset", now }, options)
    .catch(() => undefined);
  return { rawToken: nextToken, session, retiredArchiveId: current.archiveId };
}

export async function endPublicDemoSession(
  rawToken: string,
  input: { now?: Date } = {},
  options: DatabaseOptions = {}
): Promise<{ ended: boolean; retiredArchiveId?: string }> {
  const now = validDate(input.now ?? new Date(), "session end time");
  return withTransaction(options, async (client) => {
    await lockCapacity(client);
    const session = await selectSessionForToken(client, digestPublicDemoSessionToken(rawToken), true);
    if (!session) return { ended: false };
    await client.query(
      `UPDATE public.public_demo_sessions
       SET status = 'ended', token_digest = NULL, ended_at = $2, updated_at = $2
       WHERE id = $1::uuid`,
      [session.sessionId, now]
    );
    await client.query(
      `UPDATE public.public_demo_generations
       SET state = 'retired', retired_at = COALESCE(retired_at, $2)
       WHERE session_id = $1::uuid AND state IN ('active', 'provisioning')`,
      [session.sessionId, now]
    );
    return { ended: true, retiredArchiveId: session.archiveId };
  });
}

export async function drainPublicDemoSessionsForRelease(
  input: { now?: Date } = {},
  options: DatabaseOptions = {}
): Promise<{ sessionsDrained: number; aiAttemptsClosed: number }> {
  const now = validDate(input.now ?? new Date(), "release drain time");
  return withTransaction(options, async (client) => {
    await lockCapacity(client);
    const provisioning = await client.query<{ in_flight: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM public.public_demo_sessions AS session
         WHERE session.status = 'provisioning'
           AND session.updated_at > $1::timestamptz - interval '2 minutes'
         UNION ALL
         SELECT 1
         FROM public.public_demo_generations AS generation
         WHERE generation.state = 'provisioning'
           AND generation.created_at > $1::timestamptz - interval '2 minutes'
       ) AS in_flight`,
      [now]
    );
    if (provisioning.rows[0]?.in_flight !== false) {
      throw new Error("The public demo release drain found an in-flight provisioning request.");
    }
    const result = await client.query<{
      sessions_drained: number;
      ai_attempts_closed: number;
    }>(
      `WITH drained_sessions AS (
         UPDATE public.public_demo_sessions AS session
         SET status = 'ended',
             token_digest = NULL,
             ended_at = GREATEST(
               session.created_at,
               COALESCE(session.ended_at, $1::timestamptz),
               $1::timestamptz
             ),
             updated_at = GREATEST(
               session.created_at,
               session.updated_at,
               $1::timestamptz
             )
         WHERE session.status IN ('active', 'provisioning')
         RETURNING 1
       ), retired_generations AS (
         UPDATE public.public_demo_generations AS generation
         SET state = 'retired',
             retired_at = GREATEST(
               generation.created_at,
               COALESCE(generation.retired_at, $1::timestamptz),
               $1::timestamptz
             )
         WHERE generation.state IN ('active', 'provisioning')
         RETURNING 1
       ), closed_ai_attempts AS (
         UPDATE public.public_demo_ai_attempts AS attempt
         SET state = 'failed',
             completed_at = GREATEST(attempt.started_at, $1::timestamptz)
         WHERE attempt.state = 'running'
         RETURNING 1
       ), retirement_summary AS (
         SELECT count(*)::int AS generations_retired FROM retired_generations
       )
       SELECT
         (SELECT count(*)::int FROM drained_sessions) AS sessions_drained,
         (SELECT count(*)::int FROM closed_ai_attempts) AS ai_attempts_closed
       FROM retirement_summary`,
      [now]
    );
    const row = result.rows[0];
    if (!row) throw new Error("The public demo release drain result is unavailable.");
    return {
      sessionsDrained: row.sessions_drained,
      aiAttemptsClosed: row.ai_attempts_closed
    };
  });
}

export async function recordPublicDemoEvent(
  input: {
    sessionId?: string;
    eventName: PublicDemoEventName;
    feedback?: {
      usefulness: number;
      clarity: number;
      featureInterest: "research-cases" | "sources" | "gedcom" | "dna" | "ai" | "public-family";
      betaInterest: boolean;
    };
    now?: Date;
  },
  options: DatabaseOptions = {}
): Promise<void> {
  const now = validDate(input.now ?? new Date(), "event time");
  const feedback = input.feedback;
  if ((input.eventName === "feedback_submitted") !== Boolean(feedback)) {
    throw new Error("The public demo feedback event schema is invalid.");
  }
  await query(
    `INSERT INTO public.public_demo_events (
       id, session_id, event_name, usefulness, clarity, feature_interest,
       beta_interest, occurred_at, retention_expires_at
     )
     SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, $7,
       $8::timestamptz, $8::timestamptz + interval '30 days'
     WHERE $2::uuid IS NULL OR EXISTS (
       SELECT 1 FROM public.public_demo_sessions AS session
       WHERE session.id = $2::uuid AND session.is_canary = false
     )`,
    [
      randomUUID(),
      input.sessionId ?? null,
      input.eventName,
      feedback?.usefulness ?? null,
      feedback?.clarity ?? null,
      feedback?.featureInterest ?? null,
      feedback?.betaInterest ?? null,
      now
    ],
    options
  );
}

export async function reservePublicDemoAiAttempt(
  input: {
    sessionId: string;
    archiveId: string;
    generation: number;
    promptId: PublicDemoPromptId;
    now?: Date;
  },
  options: DatabaseOptions = {}
): Promise<{ attemptId: string; remaining: number }> {
  const now = validDate(input.now ?? new Date(), "AI attempt time");
  return withTransaction(options, async (client) => {
    await lockCapacity(client);
    const session = await client.query<{ ai_attempts_used: number }>(
      `SELECT ai_attempts_used
       FROM public.public_demo_sessions
       WHERE id = $1::uuid
         AND archive_id = $2
         AND generation = $3
         AND status = 'active'
         AND expires_at > $4
         AND NOT EXISTS (
           SELECT 1 FROM public.public_demo_generations AS pending
           WHERE pending.session_id = public_demo_sessions.id
             AND pending.state = 'provisioning'
         )
       FOR UPDATE`,
      [input.sessionId, input.archiveId, input.generation, now]
    );
    const used = session.rows[0]?.ai_attempts_used;
    if (used === undefined) throw new PublicDemoAiAdmissionError("session-stale");
    if (used >= publicDemoSessionPolicy.aiAttemptsPerSession) {
      throw new PublicDemoAiAdmissionError("session-limit");
    }
    const budgets = await client.query<{ running: number; daily: number }>(
      `SELECT
         count(*) FILTER (WHERE state = 'running' AND lease_expires_at > $1)::int AS running,
         count(*) FILTER (
           WHERE started_at >= date_trunc(
             'day', $1::timestamptz AT TIME ZONE 'UTC'
           ) AT TIME ZONE 'UTC'
         )::int AS daily
       FROM public.public_demo_ai_attempts`,
      [now]
    );
    if ((budgets.rows[0]?.running ?? 0) >= 5) {
      throw new PublicDemoAiAdmissionError("global-concurrency");
    }
    if ((budgets.rows[0]?.daily ?? 0) >= 150) {
      throw new PublicDemoAiAdmissionError("global-daily");
    }

    const attemptId = randomUUID();
    await client.query(
      `UPDATE public.public_demo_sessions
       SET ai_attempts_used = ai_attempts_used + 1, updated_at = $2
       WHERE id = $1::uuid`,
      [input.sessionId, now]
    );
    await client.query(
      `INSERT INTO public.public_demo_ai_attempts (
         id, session_id, archive_id, generation, prompt_id, state, started_at, lease_expires_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, 'running',
         $6::timestamptz, $6::timestamptz + interval '30 seconds'
       )`,
      [attemptId, input.sessionId, input.archiveId, input.generation, input.promptId, now]
    );
    return { attemptId, remaining: publicDemoSessionPolicy.aiAttemptsPerSession - used - 1 };
  });
}

export async function completePublicDemoAiAttempt(
  input: {
    attemptId: string;
    sessionId: string;
    archiveId: string;
    generation: number;
    outcome: "completed" | "failed" | "timed-out";
    now?: Date;
  },
  options: DatabaseOptions = {}
): Promise<void> {
  const now = validDate(input.now ?? new Date(), "AI completion time");
  const result = await query(
    `UPDATE public.public_demo_ai_attempts
     SET state = $2, completed_at = $3
     WHERE id = $1::uuid
       AND state = 'running'
       AND session_id = $4::uuid
       AND archive_id = $5
       AND generation = $6`,
    [input.attemptId, input.outcome, now, input.sessionId, input.archiveId, input.generation],
    options
  );
  if (result.rowCount !== 1) throw new Error("The public demo AI attempt is unavailable.");
}

export async function readPublicDemoDiagnostics(
  input: { now?: Date } = {},
  options: DatabaseOptions = {}
): Promise<{
  capacity: { maximum: 25; active: number; provisioning: number; available: number };
  cleanup: {
    leaseHeld: boolean;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastFailedAt: string | null;
    staleProvisioning: number;
  };
  ai: { maximumConcurrent: 5; running: number; maximumDaily: 150; usedToday: number };
}> {
  const now = validDate(input.now ?? new Date(), "diagnostic time");
  const result = await query<{
    active: number;
    provisioning: number;
    stale_provisioning: number;
    cleanup_lease_held: boolean;
    last_cleanup_started_at: Date | string | null;
    last_cleanup_completed_at: Date | string | null;
    last_cleanup_failed_at: Date | string | null;
    ai_running: number;
    ai_daily: number;
  }>(
    `SELECT
       count(*) FILTER (
         WHERE session.status = 'active' AND session.expires_at > $1
       )::int AS active,
       count(*) FILTER (
         WHERE session.status = 'provisioning' AND session.expires_at > $1
       )::int AS provisioning,
       count(*) FILTER (
         WHERE session.status = 'provisioning'
           AND session.updated_at <= $1::timestamptz - interval '2 minutes'
       )::int AS stale_provisioning,
       capacity.cleanup_lease_owner IS NOT NULL
         AND capacity.cleanup_lease_expires_at > clock_timestamp() AS cleanup_lease_held,
       capacity.last_cleanup_started_at,
       capacity.last_cleanup_completed_at,
       capacity.last_cleanup_failed_at,
       (SELECT count(*)::int FROM public.public_demo_ai_attempts AS attempt
        WHERE attempt.state = 'running' AND attempt.lease_expires_at > $1) AS ai_running,
       (SELECT count(*)::int FROM public.public_demo_ai_attempts AS attempt
        WHERE attempt.started_at >= date_trunc('day', $1::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS ai_daily
     FROM public.public_demo_capacity AS capacity
     LEFT JOIN public.public_demo_sessions AS session ON true
     WHERE capacity.singleton = true
     GROUP BY capacity.cleanup_lease_owner, capacity.cleanup_lease_expires_at,
       capacity.last_cleanup_started_at, capacity.last_cleanup_completed_at,
       capacity.last_cleanup_failed_at`,
    [now],
    options
  );
  const row = result.rows[0];
  if (!row) throw new Error("The public demo diagnostic state is unavailable.");
  const occupied = row.active + row.provisioning;
  return {
    capacity: {
      maximum: publicDemoSessionPolicy.maximumActiveSessions,
      active: row.active,
      provisioning: row.provisioning,
      available: Math.max(0, publicDemoSessionPolicy.maximumActiveSessions - occupied)
    },
    cleanup: {
      leaseHeld: row.cleanup_lease_held,
      lastStartedAt: nullableTimestamp(row.last_cleanup_started_at),
      lastCompletedAt: nullableTimestamp(row.last_cleanup_completed_at),
      lastFailedAt: nullableTimestamp(row.last_cleanup_failed_at),
      staleProvisioning: row.stale_provisioning
    },
    ai: {
      maximumConcurrent: 5,
      running: row.ai_running,
      maximumDaily: 150,
      usedToday: row.ai_daily
    }
  };
}

export async function cleanupPublicDemoSessions(
  input: { now?: Date; limit?: number; leaseOwner?: string } = {},
  options: DatabaseOptions = {}
): Promise<{
  expired: number;
  staleProvisioningRecovered: number;
  archivesCleaned: number;
  eventsDeleted: number;
}> {
  const now = validDate(input.now ?? new Date(), "cleanup time");
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("The public demo cleanup limit is invalid.");
  }
  const leaseOwner = input.leaseOwner ?? randomUUID();
  if (!uuidPattern.test(leaseOwner)) throw new Error("The public demo cleanup lease owner is invalid.");

  const prepared = await withTransaction(options, async (client) => {
    await lockCapacity(client);
    const lease = await client.query<{ available: boolean }>(
      `SELECT cleanup_lease_owner IS NULL
         OR cleanup_lease_expires_at <= clock_timestamp() AS available
       FROM public.public_demo_capacity WHERE singleton = true`
    );
    if (lease.rows[0]?.available !== true) {
      throw new Error("The public demo cleanup lease is already held.");
    }
    await client.query(
      `UPDATE public.public_demo_capacity
       SET cleanup_lease_owner = $1::uuid,
           cleanup_lease_expires_at = clock_timestamp() + interval '4 minutes',
           last_cleanup_started_at = clock_timestamp(),
           last_cleanup_completed_at = NULL,
           last_cleanup_failed_at = NULL,
           updated_at = clock_timestamp()
       WHERE singleton = true`,
      [leaseOwner]
    );
    const staleProvisioning = await client.query<{ id: string }>(
      `UPDATE public.public_demo_sessions
       SET status = 'failed', token_digest = NULL, ended_at = $1, updated_at = $1
       WHERE status = 'provisioning'
         AND updated_at <= $1::timestamptz - interval '2 minutes'
       RETURNING id::text`,
      [now]
    );
    if (staleProvisioning.rows.length > 0) {
      await client.query(
        `UPDATE public.public_demo_generations
         SET state = 'failed', retired_at = COALESCE(retired_at, $2)
         WHERE session_id = ANY($1::uuid[]) AND state = 'provisioning'`,
        [staleProvisioning.rows.map(({ id }) => id), now]
      );
    }
    const staleResetGenerations = await client.query<{ session_id: string }>(
      `UPDATE public.public_demo_generations AS generation
       SET state = 'failed', retired_at = COALESCE(generation.retired_at, $1)
       FROM public.public_demo_sessions AS session
       WHERE generation.session_id = session.id
         AND generation.state = 'provisioning'
         AND generation.created_at <= $1::timestamptz - interval '2 minutes'
         AND (
           session.archive_id <> generation.archive_id
           OR session.generation <> generation.generation
         )
       RETURNING generation.session_id::text`,
      [now]
    );
    const expired = await client.query<{ id: string }>(
      `UPDATE public.public_demo_sessions
       SET status = 'expired', token_digest = NULL, ended_at = $1, updated_at = $1
       WHERE status IN ('active', 'provisioning') AND expires_at <= $1
       RETURNING id::text`,
      [now]
    );
    if (expired.rows.length > 0) {
      await client.query(
        `UPDATE public.public_demo_generations
         SET state = 'retired', retired_at = COALESCE(retired_at, $2)
         WHERE session_id = ANY($1::uuid[]) AND state IN ('active', 'provisioning')`,
        [expired.rows.map(({ id }) => id), now]
      );
    }
    await client.query(
      `UPDATE public.public_demo_ai_attempts
       SET state = 'timed-out', completed_at = $1
       WHERE state = 'running' AND lease_expires_at <= $1`,
      [now]
    );
    const archives = await client.query<{ archive_id: string; session_id: string; generation: number }>(
      `SELECT archive_id, session_id::text, generation
       FROM public.public_demo_generations AS generation
       WHERE generation.state IN ('retired', 'failed')
          OR (
            generation.state = 'cleaned'
            AND EXISTS (
              SELECT 1
              FROM public.archives AS archive
              WHERE archive.id = generation.archive_id
                AND archive.dataset_mode = 'demo'
            )
          )
       ORDER BY COALESCE(generation.retired_at, generation.created_at),
         generation.session_id, generation.generation
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [limit]
    );
    return {
      expired: expired.rows.length,
      staleProvisioningRecovered: staleProvisioning.rows.length + staleResetGenerations.rows.length,
      archives: archives.rows
    };
  });

  let archivesCleaned = 0;
  let eventsDeleted = 0;
  try {
    for (const archive of prepared.archives) {
      await deletePublicDemoArchive(archive.archive_id, options);
      await query(
        `UPDATE public.public_demo_generations
         SET state = 'cleaned', cleaned_at = $4
         WHERE session_id = $1::uuid AND generation = $2 AND archive_id = $3`,
        [archive.session_id, archive.generation, archive.archive_id, now],
        options
      );
      archivesCleaned += 1;
    }
    const events = await query(
      `DELETE FROM public.public_demo_events WHERE retention_expires_at <= $1`,
      [now],
      options
    );
    eventsDeleted = events.rowCount ?? 0;
    await query(
      "DELETE FROM public.public_demo_rate_limits WHERE expires_at <= $1",
      [now],
      options
    );
    await query(
      `UPDATE public.public_demo_sessions AS session
       SET status = 'cleaned', updated_at = $1
       WHERE session.status IN ('ended', 'expired', 'failed')
         AND NOT EXISTS (
           SELECT 1 FROM public.public_demo_generations AS generation
           WHERE generation.session_id = session.id AND generation.state <> 'cleaned'
         )`,
      [now],
      options
    );
    await query(
      `DELETE FROM public.public_demo_sessions
       WHERE status = 'cleaned'
         AND ended_at <= $1::timestamptz - interval '30 days'`,
      [now],
      options
    );
    const result = {
      expired: prepared.expired,
      staleProvisioningRecovered: prepared.staleProvisioningRecovered,
      archivesCleaned,
      eventsDeleted
    };
    await query(
      `UPDATE public.public_demo_capacity
       SET cleanup_lease_owner = NULL,
           cleanup_lease_expires_at = NULL,
           last_cleanup_completed_at = clock_timestamp(),
           last_cleanup_failed_at = NULL,
           updated_at = clock_timestamp()
       WHERE singleton = true AND cleanup_lease_owner = $1::uuid`,
      [leaseOwner],
      options
    );
    return result;
  } catch (error) {
    await query(
      `UPDATE public.public_demo_capacity
       SET cleanup_lease_owner = NULL,
           cleanup_lease_expires_at = NULL,
           last_cleanup_failed_at = clock_timestamp(),
           updated_at = clock_timestamp()
       WHERE singleton = true AND cleanup_lease_owner = $1::uuid`,
      [leaseOwner],
      options
    ).catch(() => undefined);
    throw error;
  }
}

async function activateProvisionedSession(
  session: PublicDemoSessionState,
  options: DatabaseOptions
): Promise<void> {
  await provisionArchive("demo", { ...options, archiveId: session.archiveId });
  await withTransaction(options, async (client) => {
    await lockCapacity(client);
    await client.query(
      `UPDATE public.public_demo_generations
       SET state = 'active'
       WHERE session_id = $1::uuid AND generation = $2 AND state = 'provisioning'`,
      [session.sessionId, session.generation]
    );
    const activated = await client.query(
      `UPDATE public.public_demo_sessions
       SET status = 'active', updated_at = clock_timestamp()
       WHERE id = $1::uuid AND generation = $2 AND status = 'provisioning'`,
      [session.sessionId, session.generation]
    );
    if (activated.rowCount !== 1) throw new Error("The public demo session activation is stale.");
  });
}

async function activateProvisionedSessionOrCleanup(
  session: PublicDemoSessionState,
  now: Date,
  options: DatabaseOptions
): Promise<void> {
  try {
    await activateProvisionedSession(session, options);
  } catch (error) {
    await failProvisioningSession(session.sessionId, now, options).catch(() => undefined);
    await deletePublicDemoArchive(session.archiveId, options).catch(() => undefined);
    throw error;
  }
}

async function failProvisioningSession(sessionId: string, now: Date, options: DatabaseOptions): Promise<void> {
  await withTransaction(options, async (client) => {
    await lockCapacity(client);
    const failed = await client.query<{ id: string }>(
      `UPDATE public.public_demo_sessions
       SET status = 'failed', token_digest = NULL, ended_at = $2, updated_at = $2
       WHERE id = $1::uuid AND status = 'provisioning'
       RETURNING id::text`,
      [sessionId, now]
    );
    if (failed.rows.length === 0) return;
    await client.query(
      `UPDATE public.public_demo_generations
       SET state = 'failed', retired_at = COALESCE(retired_at, $2)
       WHERE session_id = $1::uuid AND state = 'provisioning'`,
      [sessionId, now]
    );
  });
}

async function failResetGeneration(
  sessionId: string,
  generation: number,
  archiveId: string,
  now: Date,
  options: DatabaseOptions
): Promise<void> {
  await query(
    `UPDATE public.public_demo_generations
     SET state = 'failed', retired_at = COALESCE(retired_at, $4)
     WHERE session_id = $1::uuid
       AND generation = $2
       AND archive_id = $3
       AND state = 'provisioning'`,
    [sessionId, generation, archiveId, now],
    options
  );
}

async function assertNoActiveAiLease(
  client: PoolClient,
  session: Pick<PublicDemoSessionState, "sessionId" | "archiveId" | "generation">,
  now: Date
): Promise<void> {
  const activeAi = await client.query(
    `SELECT 1
     FROM public.public_demo_ai_attempts
     WHERE session_id = $1::uuid
       AND archive_id = $2
       AND generation = $3
       AND state = 'running'
       AND lease_expires_at > $4
     LIMIT 1`,
    [session.sessionId, session.archiveId, session.generation, now]
  );
  if (activeAi.rows.length > 0) {
    throw new Error("A curated AI request is in progress for this demo session.");
  }
}

async function readSessionState(rawToken: string, options: DatabaseOptions): Promise<PublicDemoSessionState | null> {
  const result = await query<PublicDemoSessionRow>(
    `SELECT ${sessionColumns}
     FROM public.public_demo_sessions AS session
     WHERE session.token_digest = $1 AND session.status = 'active'
     LIMIT 1`,
    [digestPublicDemoSessionToken(rawToken)],
    options
  );
  return result.rows[0] ? sessionState(result.rows[0]) : null;
}

async function selectSessionForToken(
  client: PoolClient,
  tokenDigest: string,
  forUpdate: boolean
): Promise<PublicDemoSessionState | null> {
  const result = await client.query<PublicDemoSessionRow>(
    `SELECT ${sessionColumns}
     FROM public.public_demo_sessions AS session
     WHERE session.token_digest = $1 AND session.status IN ('active', 'provisioning')
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tokenDigest]
  );
  return result.rows[0] ? sessionState(result.rows[0]) : null;
}

async function lockCapacity(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO public.public_demo_capacity (singleton) VALUES (true)
     ON CONFLICT (singleton) DO NOTHING`
  );
  await client.query(
    "SELECT singleton FROM public.public_demo_capacity WHERE singleton = true FOR UPDATE"
  );
}

async function consumePublicDemoNetworkRateLimit(
  client: PoolClient,
  subjectDigest: string,
  now: Date
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  if (!/^[a-f0-9]{64}$/.test(subjectDigest)) {
    throw new Error("The public demo network subject digest is invalid.");
  }
  const policies = [
    { kind: "hour", maximum: 3, durationMs: 3_600_000, start: startOfUtcHour(now) },
    { kind: "day", maximum: 10, durationMs: 86_400_000, start: startOfUtcDay(now) }
  ] as const;
  const rows: Array<{ kind: "hour" | "day"; count: number; expiresAt: Date }> = [];

  for (const policy of policies) {
    const expiresAt = new Date(policy.start.getTime() + policy.durationMs);
    await client.query(
      `INSERT INTO public.public_demo_rate_limits (
         subject_digest, window_kind, request_count, window_started_at, expires_at, updated_at
       ) VALUES ($1, $2, 0, $3, $4, $5)
       ON CONFLICT (subject_digest, window_kind) DO NOTHING`,
      [subjectDigest, policy.kind, policy.start, expiresAt, now]
    );
    const locked = await client.query<{
      request_count: number;
      expires_at: Date | string;
    }>(
      `SELECT request_count, expires_at
       FROM public.public_demo_rate_limits
       WHERE subject_digest = $1 AND window_kind = $2
       FOR UPDATE`,
      [subjectDigest, policy.kind]
    );
    let count = locked.rows[0]?.request_count;
    let effectiveExpiry = locked.rows[0]?.expires_at
      ? validDate(locked.rows[0].expires_at, "rate-limit expiry")
      : expiresAt;
    if (count === undefined) throw new Error("The public demo rate-limit bucket is unavailable.");
    if (effectiveExpiry.getTime() <= now.getTime()) {
      await client.query(
        `UPDATE public.public_demo_rate_limits
         SET request_count = 0,
             window_started_at = $3,
             expires_at = $4,
             updated_at = $5
         WHERE subject_digest = $1 AND window_kind = $2`,
        [subjectDigest, policy.kind, policy.start, expiresAt, now]
      );
      count = 0;
      effectiveExpiry = expiresAt;
    }
    rows.push({ kind: policy.kind, count, expiresAt: effectiveExpiry });
  }

  const denied = rows.filter((row) => {
    const maximum = row.kind === "hour" ? 3 : 10;
    return row.count >= maximum;
  });
  if (denied.length > 0) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        ...denied.map((row) => Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000))
      )
    };
  }
  for (const row of rows) {
    await client.query(
      `UPDATE public.public_demo_rate_limits
       SET request_count = request_count + 1, updated_at = $3
       WHERE subject_digest = $1 AND window_kind = $2`,
      [subjectDigest, row.kind, now]
    );
  }
  return { allowed: true };
}

async function deletePublicDemoArchive(archiveId: string, options: DatabaseOptions): Promise<void> {
  if (!/^demo-[a-f0-9]{32}$/.test(archiveId)) {
    throw new Error("Refusing to delete a non-demo archive.");
  }
  await withTransaction(options, async (client) => {
    const eligible = await client.query(
      `SELECT generation.archive_id
       FROM public.public_demo_generations AS generation
       WHERE generation.archive_id = $1
         AND (
           generation.state IN ('retired', 'failed')
           OR generation.state = 'cleaned'
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.public_demo_sessions AS session
           WHERE session.archive_id = generation.archive_id
             AND session.status IN ('active', 'provisioning')
         )
       FOR UPDATE`,
      [archiveId]
    );
    if (eligible.rows.length !== 1) {
      const existing = await client.query(
        "SELECT id FROM public.archives WHERE id = $1 FOR UPDATE",
        [archiveId]
      );
      if (existing.rows.length === 0) return;
      throw new Error("Refusing to delete a live or untracked demo archive.");
    }

    const deleted = await client.query(
      "DELETE FROM public.archives WHERE id = $1 AND dataset_mode = 'demo' RETURNING id",
      [archiveId]
    );
    if (deleted.rowCount === 0) {
      const unsafe = await client.query(
        "SELECT id FROM public.archives WHERE id = $1 FOR UPDATE",
        [archiveId]
      );
      if (unsafe.rows.length > 0) {
        throw new Error("Refusing to delete an archive outside the demo dataset.");
      }
    }
  });
}

function publicDemoArchiveId(): string {
  return `demo-${randomUUID().replaceAll("-", "")}`;
}

function startOfUtcHour(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), value.getUTCHours()
  ));
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function sessionState(row: PublicDemoSessionRow): PublicDemoSessionState {
  if (
    !row.token_digest
    || !row.status
    || row.reset_count === undefined
    || row.ai_attempts_used === undefined
    || row.created_at === undefined
  ) {
    throw new Error("The public demo session row is incomplete.");
  }
  return {
    sessionId: row.session_id,
    archiveId: row.archive_id,
    tokenDigest: row.token_digest,
    generation: row.generation,
    status: row.status,
    resetCount: row.reset_count,
    aiAttemptsUsed: row.ai_attempts_used,
    createdAt: validDate(row.created_at, "created time"),
    expiresAt: validDate(row.expires_at, "expiry")
  };
}

function sessionView(row: PublicDemoSessionRow): PublicDemoSessionView {
  return activeSessionView(sessionState(row));
}

function activeSessionView(session: PublicDemoSessionState): PublicDemoSessionView {
  if (session.status !== "active") throw new Error("The public demo session is not active.");
  return {
    sessionId: session.sessionId,
    archiveId: session.archiveId,
    generation: session.generation,
    expiresAt: session.expiresAt.toISOString(),
    status: "active",
    resetCount: session.resetCount,
    aiAttemptsRemaining: publicDemoSessionPolicy.aiAttemptsPerSession - session.aiAttemptsUsed
  };
}

function validDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`The public demo ${label} is invalid.`);
  return date;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function timestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("The public demo session expiry is invalid.");
  }
  return date.toISOString();
}

function nullableTimestamp(value: Date | string | null): string | null {
  return value === null ? null : timestamp(value);
}
