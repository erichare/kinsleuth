import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { runPendingMigrations } from "@/lib/migrations";
import { publicDemoNoticeVersion } from "@/lib/public-demo-contract";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const now = new Date("2026-07-20T12:00:00.000Z");

describeIfDatabase("public demo notice-version database constraint", () => {
  let pool: Pool;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    await runPendingMigrations(pool);
  });

  afterEach(async () => {
    if (sessionIds.length > 0) {
      await pool.query(
        "DELETE FROM public.public_demo_sessions WHERE id = ANY($1::uuid[])",
        [sessionIds.splice(0)]
      );
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertSession(noticeVersion: string): Promise<string> {
    const sessionId = randomUUID();
    sessionIds.push(sessionId);
    await pool.query(
      `INSERT INTO public.public_demo_sessions (
         id, token_digest, archive_id, generation, status, notice_version,
         reset_count, ai_attempts_used, is_canary, created_at, expires_at, updated_at
       ) VALUES (
         $1::uuid, $2, $3, 1, 'active', $4,
         0, 0, false, $5, $5::timestamptz + interval '24 hours', $5
       )`,
      [
        sessionId,
        randomBytes(32).toString("hex"),
        `demo-${randomBytes(16).toString("hex")}`,
        noticeVersion,
        now
      ]
    );
    return sessionId;
  }

  it("accepts a session insert with the current contract notice version", async () => {
    expect(publicDemoNoticeVersion).toBe("public-demo-2026-07-20");
    const sessionId = await insertSession(publicDemoNoticeVersion);

    const stored = await pool.query<{ notice_version: string }>(
      "SELECT notice_version FROM public.public_demo_sessions WHERE id = $1::uuid",
      [sessionId]
    );
    expect(stored.rows).toEqual([{ notice_version: "public-demo-2026-07-20" }]);
  });

  it("keeps rows accepted under the previous 2026-07-16 notice valid", async () => {
    // Migration 021 widened the CHECK instead of replacing the version, so a
    // row recorded under the pre-Plausible notice still satisfies the schema.
    const sessionId = await insertSession("public-demo-2026-07-16");

    const stored = await pool.query<{ notice_version: string }>(
      "SELECT notice_version FROM public.public_demo_sessions WHERE id = $1::uuid",
      [sessionId]
    );
    expect(stored.rows).toEqual([{ notice_version: "public-demo-2026-07-16" }]);
  });

  it("rejects any notice version outside the two accepted notices", async () => {
    await expect(insertSession("public-demo-2026-07-21")).rejects.toThrow(
      /public_demo_sessions_notice_version_check/
    );
  });
});
