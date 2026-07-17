import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools } from "@/lib/db";
import { runPendingMigrations } from "@/lib/migrations";
import { publicDemoNoticeVersion } from "@/lib/public-demo-contract";
import {
  cleanupPublicDemoSessions,
  drainPublicDemoSessionsForRelease
} from "@/lib/public-demo-session-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const now = new Date("2026-07-17T12:00:00.000Z");

describeIfDatabase("public demo release drain database contract", () => {
  let pool: Pool;
  let sessionIds: string[];
  let archiveIds: string[];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
    await runPendingMigrations(pool);
  });

  beforeEach(async () => {
    sessionIds = [];
    archiveIds = [];
    await pool.query(
      `UPDATE public.public_demo_capacity
       SET cleanup_lease_owner = NULL,
           cleanup_lease_expires_at = NULL,
           last_cleanup_started_at = NULL,
           last_cleanup_completed_at = NULL,
           last_cleanup_failed_at = NULL,
           updated_at = clock_timestamp()
       WHERE singleton = true`
    );
  });

  afterEach(async () => {
    if (sessionIds.length > 0) {
      await pool.query(
        "DELETE FROM public.public_demo_sessions WHERE id = ANY($1::uuid[])",
        [sessionIds]
      );
    }
    if (archiveIds.length > 0) {
      await pool.query("DELETE FROM public.archives WHERE id = ANY($1::text[])", [archiveIds]);
    }
  });

  afterAll(async () => {
    await pool.end();
    await closeDatabasePools();
  });

  it("blocks fresh provisioning, then atomically drains and cleans aged lifecycle state", async () => {
    const sessionId = randomUUID();
    const archiveId = demoArchiveId();
    const attemptId = randomUUID();
    const createdAt = new Date(now.getTime() - 10 * 60_000);
    const freshAt = new Date(now.getTime() - 30_000);
    sessionIds.push(sessionId);

    await pool.query(
      `INSERT INTO public.public_demo_sessions (
         id, token_digest, archive_id, generation, status, notice_version,
         reset_count, ai_attempts_used, is_canary, created_at, expires_at, updated_at
       ) VALUES (
         $1::uuid, $2, $3, 1, 'provisioning', $4,
         0, 1, false, $5, $5::timestamptz + interval '24 hours', $6
       )`,
      [
        sessionId,
        randomBytes(32).toString("hex"),
        archiveId,
        publicDemoNoticeVersion,
        createdAt,
        freshAt
      ]
    );
    await pool.query(
      `INSERT INTO public.public_demo_generations (
         session_id, generation, archive_id, state, created_at
       ) VALUES ($1::uuid, 1, $2, 'provisioning', $3)`,
      [sessionId, archiveId, freshAt]
    );

    await expect(
      drainPublicDemoSessionsForRelease({ now }, { databaseUrl })
    ).rejects.toThrow(/in-flight provisioning/i);
    const blocked = await pool.query<{
      status: string;
      token_digest: string | null;
      generation_state: string;
    }>(
      `SELECT session.status, session.token_digest, generation.state AS generation_state
       FROM public.public_demo_sessions AS session
       JOIN public.public_demo_generations AS generation ON generation.session_id = session.id
       WHERE session.id = $1::uuid`,
      [sessionId]
    );
    expect(blocked.rows[0]).toMatchObject({
      status: "provisioning",
      generation_state: "provisioning"
    });
    expect(blocked.rows[0]?.token_digest).toMatch(/^[a-f0-9]{64}$/);

    const staleAt = new Date(now.getTime() - 3 * 60_000);
    await pool.query(
      "UPDATE public.public_demo_sessions SET updated_at = $2 WHERE id = $1::uuid",
      [sessionId, staleAt]
    );
    await pool.query(
      `UPDATE public.public_demo_generations
       SET created_at = $2
       WHERE session_id = $1::uuid AND generation = 1`,
      [sessionId, staleAt]
    );
    await pool.query(
      `INSERT INTO public.public_demo_ai_attempts (
         id, session_id, archive_id, generation, prompt_id, state,
         started_at, lease_expires_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, 1, 'case_next_steps', 'running',
         $4, $4::timestamptz + interval '5 minutes'
       )`,
      [attemptId, sessionId, archiveId, new Date(now.getTime() - 60_000)]
    );

    await expect(
      drainPublicDemoSessionsForRelease({ now }, { databaseUrl })
    ).resolves.toEqual({ sessionsDrained: 1, aiAttemptsClosed: 1 });
    const drained = await pool.query<{
      status: string;
      token_digest: string | null;
      ended_at: Date;
      generation_state: string;
      retired_at: Date;
      attempt_state: string;
      completed_at: Date;
    }>(
      `SELECT session.status, session.token_digest, session.ended_at,
         generation.state AS generation_state, generation.retired_at,
         attempt.state AS attempt_state, attempt.completed_at
       FROM public.public_demo_sessions AS session
       JOIN public.public_demo_generations AS generation ON generation.session_id = session.id
       JOIN public.public_demo_ai_attempts AS attempt ON attempt.session_id = session.id
       WHERE session.id = $1::uuid`,
      [sessionId]
    );
    expect(drained.rows[0]).toMatchObject({
      status: "ended",
      token_digest: null,
      generation_state: "retired",
      attempt_state: "failed"
    });
    expect(drained.rows[0]?.ended_at.getTime()).toBe(now.getTime());
    expect(drained.rows[0]?.retired_at.getTime()).toBe(now.getTime());
    expect(drained.rows[0]?.completed_at.getTime()).toBe(now.getTime());

    await cleanupPublicDemoSessions({
      now,
      leaseOwner: randomUUID()
    }, { databaseUrl });
    const cleaned = await pool.query<{ session_status: string; generation_state: string }>(
      `SELECT session.status AS session_status, generation.state AS generation_state
       FROM public.public_demo_sessions AS session
       JOIN public.public_demo_generations AS generation ON generation.session_id = session.id
       WHERE session.id = $1::uuid`,
      [sessionId]
    );
    expect(cleaned.rows[0]).toEqual({
      session_status: "cleaned",
      generation_state: "cleaned"
    });
  });

  it("reclaims a demo archive that appears behind already-cleaned lifecycle metadata", async () => {
    const sessionId = randomUUID();
    const archiveId = demoArchiveId();
    const createdAt = new Date(now.getTime() - 10 * 60_000);
    const retiredAt = new Date(now.getTime() - 5 * 60_000);
    sessionIds.push(sessionId);
    archiveIds.push(archiveId);

    await pool.query(
      `INSERT INTO public.public_demo_sessions (
         id, token_digest, archive_id, generation, status, notice_version,
         reset_count, ai_attempts_used, is_canary, created_at, expires_at, updated_at, ended_at
       ) VALUES (
         $1::uuid, NULL, $2, 1, 'ended', $3,
         0, 0, false, $4, $4::timestamptz + interval '24 hours', $5, $5
       )`,
      [sessionId, archiveId, publicDemoNoticeVersion, createdAt, retiredAt]
    );
    await pool.query(
      `INSERT INTO public.public_demo_generations (
         session_id, generation, archive_id, state, created_at, retired_at, cleaned_at
       ) VALUES ($1::uuid, 1, $2, 'cleaned', $3, $4, $4)`,
      [sessionId, archiveId, createdAt, retiredAt]
    );
    await pool.query(
      `INSERT INTO public.archives (
         id, name, tagline, slug, dataset_mode, demo_fixture_version
       ) VALUES ($1, 'Late synthetic archive', '', $2, 'demo', 1)`,
      [archiveId, `late-synthetic-${randomUUID()}`]
    );

    const result = await cleanupPublicDemoSessions({
      now,
      leaseOwner: randomUUID()
    }, { databaseUrl });

    expect(result.archivesCleaned).toBe(1);
    const archive = await pool.query("SELECT id FROM public.archives WHERE id = $1", [archiveId]);
    expect(archive.rows).toHaveLength(0);
  });
});

function demoArchiveId(): string {
  return `demo-${randomBytes(16).toString("hex")}`;
}
