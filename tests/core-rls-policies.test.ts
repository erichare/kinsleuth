import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabasePools, withTransaction } from "@/lib/db";
import { withRlsArchiveScope, withRlsMaintenanceMode } from "@/lib/db-rls";
import { runPendingMigrations } from "@/lib/migrations";
import { publicDemoNoticeVersion } from "@/lib/public-demo-contract";
import {
  cleanupPublicDemoSessions,
  drainPublicDemoSessionsForRelease,
  endPublicDemoSession,
  recordPublicDemoEvent,
  startPublicDemoSession
} from "@/lib/public-demo-session-store";
import {
  buildBetaOperationsGrantStatements,
  protectedRuntimeTableContract
} from "@/lib/runtime-database-grants";
import { addCaseTask, createCase, recordCaseTaskOutcome } from "@/lib/workspace-store";
import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

// A dedicated non-owner NOBYPASSRLS login provisioned with the same table
// privileges as the production runtime-role contract: the baseline loop from
// docs/production-runtime-database-role.md (SELECT/INSERT/UPDATE/DELETE on
// every application table, SELECT-only on the protected tables) plus the
// reviewed beta-operations reconciliation from lib/runtime-database-grants.
const restrictedRoleName = "kinresolve_rls_test_runtime";
const restrictedPassword = randomUUID().replaceAll("-", "");

function restrictedDatabaseUrl(): string {
  const url = new URL(databaseUrl!);
  url.username = restrictedRoleName;
  url.password = restrictedPassword;
  return url.toString();
}

async function dropRestrictedRole(pool: Pool): Promise<void> {
  await pool.query(
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${restrictedRoleName}') THEN
         EXECUTE 'DROP OWNED BY ${restrictedRoleName}';
         EXECUTE 'DROP ROLE ${restrictedRoleName}';
       END IF;
     END
     $$`
  );
}

async function provisionRestrictedRole(pool: Pool): Promise<void> {
  await dropRestrictedRole(pool);
  await pool.query(
    `CREATE ROLE ${restrictedRoleName}
       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
       PASSWORD '${restrictedPassword}'`
  );
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${restrictedRoleName}`);
  // Mirror the external provisioning checklist: broad table DML on every
  // application table, never on the protected tables.
  const protectedList = protectedRuntimeTableContract
    .map((table) => `'${table}'`)
    .join(", ");
  await pool.query(
    `DO $$
     DECLARE relation_name text;
     BEGIN
       FOR relation_name IN
         SELECT format('%I.%I', n.nspname, c.relname)
         FROM pg_catalog.pg_class AS c
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind IN ('r', 'p')
           AND c.relname NOT IN (${protectedList})
       LOOP
         EXECUTE format(
           'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO ${restrictedRoleName}',
           relation_name
         );
       END LOOP;
     END
     $$`
  );
  for (const table of protectedRuntimeTableContract) {
    await pool.query(`REVOKE ALL ON TABLE public."${table}" FROM ${restrictedRoleName}`);
    await pool.query(`GRANT SELECT ON TABLE public."${table}" TO ${restrictedRoleName}`);
  }
  // Reconcile the seven runtime-managed tables through the same reviewed
  // statement builder the release workflow uses.
  for (const statement of buildBetaOperationsGrantStatements(restrictedRoleName)) {
    await pool.query(statement);
  }
}

async function insertPersonAs(
  client: PoolClient,
  archiveId: string,
  personId: string
): Promise<void> {
  await client.query(
    `INSERT INTO public.people (id, archive_id, slug, display_name)
     VALUES ($1, $2, $3, 'RLS Test Person')`,
    [personId, archiveId, `rls-test-${personId}`]
  );
}

describeIfDatabase("core row-level-security policies", () => {
  let ownerPool: Pool;
  let restrictedPool: Pool;
  let previousAutoMigrate: string | undefined;
  const archiveA = `test-rls-a-${randomUUID().slice(0, 8)}`;
  const archiveB = `test-rls-b-${randomUUID().slice(0, 8)}`;
  const trackedArchiveIds = [archiveA, archiveB];

  beforeAll(async () => {
    // The production runtime role never runs migrations, and the restricted
    // login cannot CREATE in the public schema; the owner migrates up front.
    previousAutoMigrate = process.env.DATABASE_AUTO_MIGRATE;
    process.env.DATABASE_AUTO_MIGRATE = "false";
    ownerPool = new Pool({ connectionString: databaseUrl, max: 3 });
    await runPendingMigrations(ownerPool);
    await provisionRestrictedRole(ownerPool);
    restrictedPool = new Pool({ connectionString: restrictedDatabaseUrl(), max: 3 });

    const restrictedOptions = { databaseUrl: restrictedDatabaseUrl() };
    await provisionTestArchive({ ...restrictedOptions, archiveId: archiveA }, "empty");
    await provisionTestArchive({ ...restrictedOptions, archiveId: archiveB }, "empty");
  }, 120_000);

  afterAll(async () => {
    if (previousAutoMigrate === undefined) {
      delete process.env.DATABASE_AUTO_MIGRATE;
    } else {
      process.env.DATABASE_AUTO_MIGRATE = previousAutoMigrate;
    }
    await restrictedPool?.end();
    await closeDatabasePools();
    if (ownerPool) {
      await ownerPool.query(
        "DELETE FROM public.archives WHERE id = ANY($1::text[])",
        [trackedArchiveIds]
      );
      await dropRestrictedRole(ownerPool);
      await ownerPool.end();
    }
  });

  it("attests the restricted role is a non-owner NOBYPASSRLS login", async () => {
    const posture = await restrictedPool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    expect(posture.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const enforced = await restrictedPool.query<{ rls_active: boolean }>(
      `SELECT row_security_active('public.people') AS rls_active`
    );
    expect(enforced.rows[0]?.rls_active).toBe(true);
  });

  it("admits INSERT, UPDATE, and DELETE on a core table when the transaction pins the matching archive", async () => {
    const personId = `person-rls-${randomUUID().slice(0, 8)}`;
    const client = await restrictedPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('kinresolve.archive_id', $1, true)", [archiveA]);
      await insertPersonAs(client, archiveA, personId);
      const updated = await client.query(
        "UPDATE public.people SET notes = 'updated' WHERE archive_id = $1 AND id = $2",
        [archiveA, personId]
      );
      expect(updated.rowCount).toBe(1);
      const deleted = await client.query(
        "DELETE FROM public.people WHERE archive_id = $1 AND id = $2",
        [archiveA, personId]
      );
      expect(deleted.rowCount).toBe(1);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  it("rejects INSERT with a mismatched or absent archive setting and hides rows from unscoped UPDATE/DELETE", async () => {
    // Seed one row through the matching scope first.
    const personId = `person-rls-${randomUUID().slice(0, 8)}`;
    const client = await restrictedPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('kinresolve.archive_id', $1, true)", [archiveA]);
      await insertPersonAs(client, archiveA, personId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    // Mismatched scope: the INSERT violates the row-level security policy.
    const mismatch = await restrictedPool.connect();
    try {
      await mismatch.query("BEGIN");
      await mismatch.query("SELECT set_config('kinresolve.archive_id', $1, true)", [archiveB]);
      await expect(
        insertPersonAs(mismatch, archiveA, `person-rls-${randomUUID().slice(0, 8)}`)
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await mismatch.query("ROLLBACK").catch(() => undefined);
      mismatch.release();
    }

    // Absent scope: INSERT violates the policy; UPDATE and DELETE cannot see
    // any row through the archive-scoped USING clause, so they change nothing.
    await expect(
      restrictedPool.query(
        `INSERT INTO public.people (id, archive_id, slug, display_name)
         VALUES ($1, $2, $3, 'RLS Test Person')`,
        [`person-rls-${randomUUID().slice(0, 8)}`, archiveA, `rls-test-${randomUUID().slice(0, 8)}`]
      )
    ).rejects.toThrow(/row-level security/i);
    const unscopedUpdate = await restrictedPool.query(
      "UPDATE public.people SET notes = 'blocked' WHERE archive_id = $1 AND id = $2",
      [archiveA, personId]
    );
    expect(unscopedUpdate.rowCount).toBe(0);
    const unscopedDelete = await restrictedPool.query(
      "DELETE FROM public.people WHERE archive_id = $1 AND id = $2",
      [archiveA, personId]
    );
    expect(unscopedDelete.rowCount).toBe(0);

    // The row is untouched; clean it up through the matching scope.
    const survivor = await restrictedPool.query<{ notes: string | null }>(
      "SELECT notes FROM public.people WHERE archive_id = $1 AND id = $2",
      [archiveA, personId]
    );
    expect(survivor.rows).toHaveLength(1);
    expect(survivor.rows[0]?.notes).toBeNull();
    await withTransaction(
      withRlsArchiveScope({ databaseUrl: restrictedDatabaseUrl() }, archiveA),
      (client) => client.query("DELETE FROM public.people WHERE archive_id = $1 AND id = $2", [archiveA, personId])
    );
  });

  it("keeps SELECT unscoped for the server role", async () => {
    const rows = await restrictedPool.query<{ id: string }>(
      "SELECT id FROM public.archives WHERE id = ANY($1::text[]) ORDER BY id",
      [trackedArchiveIds]
    );
    expect(rows.rows.map((row) => row.id)).toEqual([...trackedArchiveIds].sort());
  });

  it("admits cross-archive system work only in maintenance mode", async () => {
    const personA = `person-rls-${randomUUID().slice(0, 8)}`;
    const personB = `person-rls-${randomUUID().slice(0, 8)}`;
    const restrictedOptions = { databaseUrl: restrictedDatabaseUrl() };
    await withTransaction(withRlsArchiveScope(restrictedOptions, archiveA), (client) =>
      insertPersonAs(client, archiveA, personA)
    );
    await withTransaction(withRlsArchiveScope(restrictedOptions, archiveB), (client) =>
      insertPersonAs(client, archiveB, personB)
    );

    // A single-archive scope cannot touch both archives...
    const scoped = await withTransaction(
      withRlsArchiveScope(restrictedOptions, archiveA),
      (client) => client.query(
        "UPDATE public.people SET notes = 'sweep' WHERE id = ANY($1::text[])",
        [[personA, personB]]
      )
    );
    expect(scoped.rowCount).toBe(1);

    // ...while maintenance mode performs the cross-archive sweep and cleanup.
    const swept = await withTransaction(withRlsMaintenanceMode(restrictedOptions), (client) =>
      client.query(
        "UPDATE public.people SET notes = 'sweep' WHERE id = ANY($1::text[])",
        [[personA, personB]]
      )
    );
    expect(swept.rowCount).toBe(2);
    const cleaned = await withTransaction(withRlsMaintenanceMode(restrictedOptions), (client) =>
      client.query("DELETE FROM public.people WHERE id = ANY($1::text[])", [[personA, personB]])
    );
    expect(cleaned.rowCount).toBe(2);
  });

  it("runs the full public demo lifecycle under the restricted role", async () => {
    const restrictedOptions = { databaseUrl: restrictedDatabaseUrl() };
    const now = new Date();

    // Provision + start (canary skips the shared network rate-limit budget).
    const started = await startPublicDemoSession(
      {
        noticeVersion: publicDemoNoticeVersion,
        networkSubjectDigest: "a".repeat(64),
        isCanary: true,
        now
      },
      restrictedOptions
    );
    expect(started.kind).toBe("created");
    if (started.kind !== "created") throw new Error("unreachable");
    const { rawToken, session } = started;
    const archiveRow = await restrictedPool.query(
      "SELECT dataset_mode FROM public.archives WHERE id = $1",
      [session.archiveId]
    );
    expect(archiveRow.rows[0]?.dataset_mode).toBe("demo");

    // Record a guided-research outcome in the demo archive.
    const storeOptions = { ...restrictedOptions, archiveId: session.archiveId };
    const researchCase = await createCase(
      {
        title: "RLS lifecycle case",
        question: "Does the restricted role complete the demo lifecycle?"
      },
      storeOptions
    );
    const createdTask = await addCaseTask(
      researchCase.id,
      { title: "Verify the archive-scoped policies" },
      storeOptions
    );
    const outcome = await recordCaseTaskOutcome(
      researchCase.id,
      createdTask.task.id,
      {
        requestId: `request-${randomUUID()}`,
        expectedTaskUpdatedAt: createdTask.task.updatedAt ?? "",
        outcome: "found",
        note: "The restricted role recorded this fictional outcome.",
        actorId: `demo:${session.sessionId}`,
        actorName: "Demo Guest"
      },
      storeOptions
    );
    expect(outcome.applied).toBe(true);
    await recordPublicDemoEvent(
      { sessionId: session.sessionId, eventName: "outcome_completed", now },
      restrictedOptions
    );

    // End the session, age it out, and clean up under the restricted role.
    const ended = await endPublicDemoSession(rawToken, { now }, restrictedOptions);
    expect(ended.ended).toBe(true);
    const drain = await drainPublicDemoSessionsForRelease({ now }, restrictedOptions);
    expect(drain.sessionsDrained).toBeGreaterThanOrEqual(0);
    const cleanup = await cleanupPublicDemoSessions({ now, limit: 100 }, restrictedOptions);
    expect(cleanup.archivesCleaned).toBeGreaterThanOrEqual(1);

    // The demo archive row and its cascaded core rows are gone.
    const remaining = await restrictedPool.query(
      "SELECT id FROM public.archives WHERE id = $1",
      [session.archiveId]
    );
    expect(remaining.rows).toHaveLength(0);
    const corePeople = await restrictedPool.query(
      "SELECT id FROM public.people WHERE archive_id = $1",
      [session.archiveId]
    );
    expect(corePeople.rows).toHaveLength(0);

    // Remove the session bookkeeping row so repeated runs stay bounded.
    await ownerPool.query(
      "DELETE FROM public.public_demo_sessions WHERE id = $1::uuid",
      [session.sessionId]
    );
  }, 60_000);
});
