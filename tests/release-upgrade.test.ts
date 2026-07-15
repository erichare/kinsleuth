import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { V0174_INITIAL_SHA256 } from "@/lib/migration-history";
import { runPendingMigrations } from "@/lib/migrations";
import { replacePersonFacts, upsertCaseRow, upsertPeopleRows, upsertTaskRow } from "@/lib/store/rows";
import { validateReleaseUpgradeDatabase } from "@/lib/test-database-contract";

const releaseDatabaseUrl = process.env.TEST_RELEASE_UPGRADE_DATABASE_URL;
const archiveScopedTables = [
  "people",
  "person_facts",
  "import_snapshots",
  "raw_records",
  "workspace_backups",
  "sources",
  "research_cases",
  "hypotheses",
  "evidence_items",
  "tasks",
  "dna_matches",
  "dna_hypotheses",
  "embeddings",
  "ai_runs"
] as const;

function historicalInitialSql(): string {
  const contents = execFileSync("git", ["show", "v0.17.4:db/migrations/001_initial.sql"], {
    cwd: process.cwd(),
    maxBuffer: 2 * 1024 * 1024
  });
  const checksum = createHash("sha256").update(contents).digest("hex");
  if (checksum !== V0174_INITIAL_SHA256) {
    throw new Error(`v0.17.4 001_initial.sql checksum mismatch: expected ${V0174_INITIAL_SHA256}, received ${checksum}.`);
  }
  return contents.toString("utf8");
}

function derivedDatabaseUrl(controlUrl: string, databaseName: string): string {
  const url = new URL(controlUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createScratchDatabase(
  controlPool: Pool,
  controlUrl: string,
  label: string,
  trackedDatabases: Set<string>
): Promise<{ name: string; url: string; pool: Pool }> {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20);
  const name = `kr_upgrade_${process.pid}_${safeLabel}_${randomBytes(4).toString("hex")}`;
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error("Generated an invalid release rehearsal database name.");
  }
  await controlPool.query(`CREATE DATABASE "${name}"`);
  trackedDatabases.add(name);
  const url = derivedDatabaseUrl(controlUrl, name);
  return { name, url, pool: new Pool({ connectionString: url, max: 4 }) };
}

async function dropScratchDatabase(controlPool: Pool, name: string, trackedDatabases: Set<string>): Promise<void> {
  if (!trackedDatabases.has(name) || !/^kr_upgrade_[a-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing to drop untracked release rehearsal database: ${name}.`);
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const connections = await controlPool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = $1",
      [name]
    );
    if (connections.rows[0].count === 0) {
      await controlPool.query(`DROP DATABASE IF EXISTS "${name}"`);
      trackedDatabases.delete(name);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Release rehearsal database ${name} still has active connections after its pool was closed.`);
}

async function installV0174(pool: Pool, options: { recordInitialMigration: boolean }): Promise<void> {
  // v0.17.4 executed 001 directly and did not have a migration ledger. The
  // recorded variant models databases that later adopted the current runner
  // before the immutable-history repair landed.
  await pool.query(historicalInitialSql());
  if (options.recordInitialMigration) {
    await pool.query(
      "CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    await pool.query("INSERT INTO schema_migrations (version) VALUES ('001_initial')");
  }
}

async function applyRecordedMigration(pool: Pool, fileName: string): Promise<void> {
  const version = fileName.replace(/\.sql$/, "");
  const sql = await readFile(path.join(process.cwd(), "db", "migrations", fileName), "utf8");
  await pool.query("BEGIN");
  try {
    await pool.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    await pool.query(sql);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function seedLegacyRows(pool: Pool): Promise<void> {
  await pool.query(
    "INSERT INTO users (id, email, display_name, role) VALUES ('legacy-user', 'legacy@example.test', 'Legacy User', 'owner')"
  );

  for (const suffix of ["a", "b"]) {
    const archiveId = `archive-${suffix}`;
    await pool.query("INSERT INTO archives (id, name, slug) VALUES ($1, $2, $3)", [archiveId, `Archive ${suffix}`, `archive-${suffix}`]);
    await pool.query("INSERT INTO people (id, archive_id, slug, display_name) VALUES ($1, $2, $3, $4)", [
      `p-${suffix}`,
      archiveId,
      `person-${suffix}`,
      `Person ${suffix}`
    ]);
    await pool.query("INSERT INTO person_facts (id, archive_id, person_id, fact_type) VALUES ($1, $2, $3, 'BIRT')", [
      `pf-${suffix}`,
      archiveId,
      `p-${suffix}`
    ]);
    await pool.query(
      "INSERT INTO import_snapshots (id, archive_id, source_name, checksum) VALUES ($1, $2, $3, $4)",
      [`import-${suffix}`, archiveId, `family-${suffix}.ged`, `checksum-${suffix}`]
    );
    await pool.query(
      "INSERT INTO raw_records (id, archive_id, import_id, record_type, raw_text, checksum) VALUES ($1, $2, $3, 'INDI', $4, $5)",
      [`raw-${suffix}`, archiveId, `import-${suffix}`, `0 @I${suffix}@ INDI`, `raw-checksum-${suffix}`]
    );
    await pool.query(
      "INSERT INTO workspace_backups (id, archive_id, reason, storage_key) VALUES ($1, $2, 'release rehearsal', $3)",
      [`backup-${suffix}`, archiveId, `backups/${suffix}.json`]
    );
    await pool.query("INSERT INTO sources (id, archive_id, title) VALUES ($1, $2, $3)", [
      `source-${suffix}`,
      archiveId,
      `Source ${suffix}`
    ]);
    await pool.query("INSERT INTO research_cases (id, archive_id, title, question) VALUES ($1, $2, $3, $4)", [
      `case-${suffix}`,
      archiveId,
      `Case ${suffix}`,
      `Who is person ${suffix}?`
    ]);
    await pool.query("INSERT INTO hypotheses (id, archive_id, case_id, statement, status) VALUES ($1, $2, $3, $4, 'rejected')", [
      `hypothesis-${suffix}`,
      archiveId,
      `case-${suffix}`,
      `Hypothesis ${suffix}`
    ]);
    await pool.query(
      "INSERT INTO evidence_items (id, archive_id, case_id, title, evidence_type, summary) VALUES ($1, $2, $3, $4, 'record', $5)",
      [`evidence-${suffix}`, archiveId, `case-${suffix}`, `Evidence ${suffix}`, `Summary ${suffix}`]
    );
    await pool.query("INSERT INTO tasks (id, archive_id, case_id, title, status) VALUES ($1, $2, $3, $4, 'done')", [
      `task-${suffix}`,
      archiveId,
      `case-${suffix}`,
      suffix === "a" ? "Éric's Groß Ærø Łódź search" : `Task ${suffix}`
    ]);
    await pool.query("INSERT INTO dna_matches (id, archive_id, display_name, total_cm) VALUES ($1, $2, $3, 42)", [
      `match-${suffix}`,
      archiveId,
      `Match ${suffix}`
    ]);
    await pool.query(
      "INSERT INTO dna_hypotheses (id, archive_id, dna_match_id, likely_branch, likely_generation, explanation) VALUES ($1, $2, $3, 'unknown', 'unknown', $4)",
      [`dna-hypothesis-${suffix}`, archiveId, `match-${suffix}`, `Explanation ${suffix}`]
    );
    await pool.query("INSERT INTO embeddings (id, archive_id, entity_type, entity_id, content) VALUES ($1, $2, 'person', $3, $4)", [
      `embedding-${suffix}`,
      archiveId,
      `p-${suffix}`,
      `Content ${suffix}`
    ]);
    await pool.query(
      "INSERT INTO ai_runs (id, archive_id, question, answer, status) VALUES ($1, $2, $3, $4, 'ready')",
      [`ai-run-${suffix}`, archiveId, `Question ${suffix}`, `Answer ${suffix}`]
    );
  }
}

async function exerciseCompositeKeyWriters(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const duplicatePerson = {
      id: "p-a",
      slug: "person-a-in-b",
      displayName: "Person A in archive B",
      livingStatus: "unknown" as const,
      privacy: "private" as const,
      published: false,
      relatives: [],
      facts: [
        {
          id: "pf-a",
          type: "BIRT",
          value: "archive B duplicate",
          confidence: 0.75,
          privacy: "private" as const
        }
      ]
    };
    const duplicateCase = {
      id: "case-a",
      title: "Case A in archive B",
      question: "Does the composite case key work?",
      status: "active" as const,
      focus: "release rehearsal",
      privacy: "private" as const,
      hypotheses: [],
      evidence: [],
      tasks: []
    };

    await upsertPeopleRows(client, "archive-b", [duplicatePerson], 0);
    await replacePersonFacts(client, "archive-b", [duplicatePerson]);
    await upsertCaseRow(client, "archive-b", duplicateCase, 0);
    await upsertTaskRow(client, "archive-b", "case-a", { id: "task-a", title: "Archive B task", status: "todo" }, 0);

    await upsertPeopleRows(client, "archive-b", [{ ...duplicatePerson, displayName: "Updated duplicate" }], 1);
    await upsertCaseRow(client, "archive-b", { ...duplicateCase, title: "Updated duplicate case" }, 1);
  } finally {
    client.release();
  }

  await expect(pool.query("SELECT archive_id FROM people WHERE id = 'p-a' ORDER BY archive_id")).resolves.toMatchObject({
    rows: [{ archive_id: "archive-a" }, { archive_id: "archive-b" }]
  });
  await expect(pool.query("SELECT archive_id FROM tasks WHERE id = 'task-a' ORDER BY archive_id")).resolves.toMatchObject({
    rows: [{ archive_id: "archive-a" }, { archive_id: "archive-b" }]
  });
}

async function catalogSnapshot(pool: Pool): Promise<Record<string, unknown[]>> {
  const [columns, constraints, indexes, rowSecurity, policies, functions, extensions, grants, defaultPrivileges] = await Promise.all([
    pool.query(`
      SELECT namespace.nspname AS schema_name, class.relname AS table_name, attribute.attname AS column_name,
        attribute.attnum AS ordinal_position, format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
        attribute.attnotnull AS not_null, pg_get_expr(default_value.adbin, default_value.adrelid) AS default_expression
      FROM pg_attribute attribute
      JOIN pg_class class ON class.oid = attribute.attrelid
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      LEFT JOIN pg_attrdef default_value ON default_value.adrelid = class.oid AND default_value.adnum = attribute.attnum
      WHERE namespace.nspname = 'public' AND class.relkind IN ('r', 'p')
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
      ORDER BY namespace.nspname, class.relname, attribute.attnum
    `),
    pool.query(`
      SELECT relation.relname AS table_name, constraint_record.conname AS constraint_name,
        constraint_record.contype AS constraint_type,
        pg_get_constraintdef(constraint_record.oid, true) AS definition,
        constraint_record.convalidated AS validated,
        constraint_record.condeferrable AS deferrable,
        constraint_record.condeferred AS initially_deferred
      FROM pg_constraint constraint_record
      JOIN pg_class relation ON relation.oid = constraint_record.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
      ORDER BY relation.relname, constraint_record.conname
    `),
    pool.query(`
      SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
      FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname
    `),
    pool.query(`
      SELECT class.relname AS table_name, class.relrowsecurity AS enabled, class.relforcerowsecurity AS forced
      FROM pg_class class JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public' AND class.relkind IN ('r', 'p') ORDER BY class.relname
    `),
    pool.query(`
      SELECT tablename AS table_name, policyname AS policy_name, permissive, roles, cmd, qual, with_check
      FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname
    `),
    pool.query(`
      SELECT routine.proname AS function_name,
        pg_get_function_identity_arguments(routine.oid) AS arguments,
        pg_get_function_result(routine.oid) AS result,
        routine.provolatile AS volatility,
        routine.prosecdef AS security_definer,
        pg_get_functiondef(routine.oid) AS definition
      FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public' ORDER BY routine.proname, arguments
    `),
    pool.query(`
      SELECT extension.extname AS extension_name, namespace.nspname AS schema_name, extension.extversion AS version
      FROM pg_extension extension JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
      ORDER BY extension.extname
    `),
    pool.query(`
      SELECT grantee, table_name, privilege_type, is_grantable
      FROM information_schema.table_privileges WHERE table_schema = 'public'
      ORDER BY grantee, table_name, privilege_type
    `),
    pool.query(`
      SELECT owner.rolname AS owner, namespace.nspname AS schema_name, default_acl.defaclobjtype AS object_type,
        privilege.grantee::regrole::text AS grantee, privilege.privilege_type, privilege.is_grantable
      FROM pg_default_acl default_acl
      JOIN pg_roles owner ON owner.oid = default_acl.defaclrole
      LEFT JOIN pg_namespace namespace ON namespace.oid = default_acl.defaclnamespace
      CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) privilege
      WHERE namespace.nspname = 'public'
      ORDER BY owner.rolname, namespace.nspname, default_acl.defaclobjtype, grantee, privilege.privilege_type
    `)
  ]);

  return {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    rowSecurity: rowSecurity.rows,
    policies: policies.rows,
    functions: functions.rows,
    extensions: extensions.rows,
    grants: grants.rows,
    defaultPrivileges: defaultPrivileges.rows
  };
}

async function archiveKeySnapshot(pool: Pool): Promise<unknown[]> {
  const result = await pool.query(
    `SELECT relation.relname AS table_name, constraint_record.conname AS constraint_name,
       constraint_record.contype AS constraint_type, pg_get_constraintdef(constraint_record.oid, true) AS definition
     FROM pg_constraint constraint_record
     JOIN pg_class relation ON relation.oid = constraint_record.conrelid
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relname = ANY($1::text[])
       AND constraint_record.contype IN ('p', 'f', 'u')
     ORDER BY relation.relname, constraint_record.conname`,
    [archiveScopedTables]
  );
  return result.rows;
}

async function expectMigration004Unrecorded(pool: Pool): Promise<void> {
  const recorded = await pool.query("SELECT version FROM schema_migrations WHERE version = '004_archive_scoped_keys'");
  expect(recorded.rows).toHaveLength(0);
}

describe.skipIf(!releaseDatabaseUrl)("v0.17.4 release upgrade", () => {
  const trackedDatabases = new Set<string>();
  let controlPool: Pool;
  let pool: Pool;
  let scratchDatabaseName: string;
  let scratchDatabaseUrl: string;
  let controlInitialized = false;
  let scratchInitialized = false;

  beforeAll(() => {
    validateReleaseUpgradeDatabase({
      releaseDatabaseUrl,
      testDatabaseUrl: process.env.TEST_DATABASE_URL,
      databaseUrl: process.env.DATABASE_URL
    });
    controlPool = new Pool({ connectionString: releaseDatabaseUrl, max: 2 });
    controlInitialized = true;
  });

  beforeEach(async () => {
    scratchInitialized = false;
    const scratch = await createScratchDatabase(controlPool, releaseDatabaseUrl!, "scenario", trackedDatabases);
    scratchDatabaseName = scratch.name;
    scratchDatabaseUrl = scratch.url;
    pool = scratch.pool;
    scratchInitialized = true;
  });

  afterEach(async () => {
    if (!scratchInitialized) {
      return;
    }
    await pool.end();
    await dropScratchDatabase(controlPool, scratchDatabaseName, trackedDatabases);
    scratchInitialized = false;
  });

  afterAll(async () => {
    if (!controlInitialized) {
      return;
    }
    for (const name of [...trackedDatabases]) {
      await dropScratchDatabase(controlPool, name, trackedDatabases);
    }
    await controlPool.end();
  });

  it("upgrades the exact unrecorded v0.17.4 install without data loss and matches a fresh catalog", async () => {
    await installV0174(pool, { recordInitialMigration: false });
    await seedLegacyRows(pool);

    const result = await runPendingMigrations(pool);

    expect(result.applied).toEqual([
      "001_initial",
      "002_search_unaccent",
      "003_auth_accounts",
      "004_archive_scoped_keys",
      "005_guided_research_loop",
      "006_integration_sources",
      "007_integration_change_filters",
      "008_integration_upload_intents",
      "009_integration_media_objects",
      "010_integration_media_write_claims",
      "011_integration_change_search",
      "012_archive_dataset_mode",
      "013_release_write_fence",
      "014_beta_invitations",
      "015_beta_operations"
    ]);
    for (const table of archiveScopedTables) {
      const count = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
      expect(count.rows[0].count, table).toBe("2");
    }
    await expect(pool.query("SELECT email FROM legacy_users")).resolves.toMatchObject({
      rows: [{ email: "legacy@example.test" }]
    });
    await exerciseCompositeKeyWriters(pool);
    await expect(
      pool.query(
        "SELECT status, decisions, updated_at FROM hypotheses WHERE archive_id = 'archive-a' AND id = 'hypothesis-a'"
      )
    ).resolves.toMatchObject({ rows: [{ status: "rejected", decisions: [], updated_at: null }] });
    await expect(
      pool.query(
        "SELECT status, outcomes, completed_at, work_fingerprint FROM tasks WHERE archive_id = 'archive-a' AND id = 'task-a'"
      )
    ).resolves.toMatchObject({
      rows: [{ status: "done", outcomes: [], completed_at: null, work_fingerprint: "eric s gro r odz search" }]
    });
    await expect(
      pool.query("SELECT id, dataset_mode, demo_fixture_version FROM archives ORDER BY id")
    ).resolves.toMatchObject({
      rows: [
        { id: "archive-a", dataset_mode: "pilot", demo_fixture_version: null },
        { id: "archive-b", dataset_mode: "pilot", demo_fixture_version: null }
      ]
    });
    await pool.query(
      "INSERT INTO tasks (id, archive_id, case_id, title, status, sort_order) VALUES ('old-writer-task', 'archive-a', 'case-a', 'Old writer task', 'todo', 99)"
    );
    await pool.query(
      "UPDATE tasks SET status = 'done' WHERE archive_id = 'archive-a' AND case_id = 'case-a' AND id = 'old-writer-task'"
    );
    await pool.query(
      "INSERT INTO hypotheses (id, archive_id, case_id, statement, confidence, status, sort_order) VALUES ('old-writer-hypothesis', 'archive-a', 'case-a', 'Old writer hypothesis', 0.5, 'supported', 99)"
    );
    const upgradedCatalog = await catalogSnapshot(pool);

    const fresh = await createScratchDatabase(controlPool, releaseDatabaseUrl!, "fresh", trackedDatabases);
    let freshCatalog: Record<string, unknown[]>;
    try {
      await runPendingMigrations(fresh.pool);
      freshCatalog = await catalogSnapshot(fresh.pool);
    } finally {
      await fresh.pool.end();
      await dropScratchDatabase(controlPool, fresh.name, trackedDatabases);
    }

    expect(upgradedCatalog).toEqual(freshCatalog);
  });

  it("upgrades a legacy schema even when 001 is already recorded and therefore skipped", async () => {
    await installV0174(pool, { recordInitialMigration: true });
    await seedLegacyRows(pool);

    const result = await runPendingMigrations(pool);

    expect(result.alreadyApplied).toContain("001_initial");
    expect(result.applied).toEqual([
      "002_search_unaccent",
      "003_auth_accounts",
      "004_archive_scoped_keys",
      "005_guided_research_loop",
      "006_integration_sources",
      "007_integration_change_filters",
      "008_integration_upload_intents",
      "009_integration_media_objects",
      "010_integration_media_write_claims",
      "011_integration_change_search",
      "012_archive_dataset_mode",
      "013_release_write_fence",
      "014_beta_invitations",
      "015_beta_operations"
    ]);
    await exerciseCompositeKeyWriters(pool);
    await expect(pool.query("SELECT count(*)::integer AS count FROM legacy_users")).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("is a no-op when the desired key state is already present", async () => {
    await runPendingMigrations(pool);
    const before = await archiveKeySnapshot(pool);
    const migration = await readFile(path.join(process.cwd(), "db", "migrations", "004_archive_scoped_keys.sql"), "utf8");

    await pool.query("BEGIN");
    await pool.query(migration);
    await pool.query(migration);
    await pool.query("COMMIT");

    expect(await archiveKeySnapshot(pool)).toEqual(before);
  });

  it("rejects a partially converted key state and rolls the migration back", async () => {
    await installV0174(pool, { recordInitialMigration: true });
    await seedLegacyRows(pool);
    await pool.query("ALTER TABLE sources DROP CONSTRAINT sources_pkey");
    await pool.query("ALTER TABLE sources ADD PRIMARY KEY (archive_id, id)");
    const before = await archiveKeySnapshot(pool);

    await expect(runPendingMigrations(pool)).rejects.toThrow(/004_archive_scoped_keys.*(partial|mixed|unexpected)/i);

    expect(await archiveKeySnapshot(pool)).toEqual(before);
    await expectMigration004Unrecorded(pool);
  });

  it("rejects a legacy global-id unique index even when it has included columns", async () => {
    await installV0174(pool, { recordInitialMigration: true });
    await seedLegacyRows(pool);
    await pool.query("CREATE UNIQUE INDEX sources_global_id_unique ON sources (id) INCLUDE (archive_id)");

    await expect(runPendingMigrations(pool)).rejects.toThrow(/004_archive_scoped_keys.*unexpected archive-key uniqueness/i);

    await expectMigration004Unrecorded(pool);
    await expect(pool.query("SELECT to_regclass('sources_global_id_unique') AS name")).resolves.toMatchObject({
      rows: [{ name: "sources_global_id_unique" }]
    });
  });

  it("rejects a redundant composite unique index even when its key order is reversed", async () => {
    await installV0174(pool, { recordInitialMigration: true });
    await seedLegacyRows(pool);
    await pool.query("CREATE UNIQUE INDEX sources_reversed_composite_unique ON sources (id, archive_id)");

    await expect(runPendingMigrations(pool)).rejects.toThrow(/004_archive_scoped_keys.*unexpected archive-key uniqueness/i);

    await expectMigration004Unrecorded(pool);
    await expect(pool.query("SELECT to_regclass('sources_reversed_composite_unique') AS name")).resolves.toMatchObject({
      rows: [{ name: "sources_reversed_composite_unique" }]
    });
  });

  it("rejects cross-archive legacy references and rolls the migration back", async () => {
    await installV0174(pool, { recordInitialMigration: true });
    await seedLegacyRows(pool);
    await pool.query(
      "INSERT INTO person_facts (id, archive_id, person_id, fact_type) VALUES ('pf-cross', 'archive-b', 'p-a', 'BIRT')"
    );
    const before = await archiveKeySnapshot(pool);

    await expect(runPendingMigrations(pool)).rejects.toThrow(/004_archive_scoped_keys.*cross-archive/i);

    expect(await archiveKeySnapshot(pool)).toEqual(before);
    await expectMigration004Unrecorded(pool);
    await expect(pool.query("SELECT id FROM person_facts WHERE id = 'pf-cross'")).resolves.toMatchObject({ rows: [{ id: "pf-cross" }] });
  });

  it("fails within the bounded timeout when a reader holds a conflicting table lock", async () => {
    await installV0174(pool, { recordInitialMigration: true });
    await seedLegacyRows(pool);
    await applyRecordedMigration(pool, "002_search_unaccent.sql");
    await applyRecordedMigration(pool, "003_auth_accounts.sql");
    const holder = await pool.connect();
    const contender = new Pool({ connectionString: scratchDatabaseUrl, max: 1 });

    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM people LIMIT 1");
      const startedAt = Date.now();

      await expect(runPendingMigrations(contender)).rejects.toThrow(/004_archive_scoped_keys.*lock timeout/i);

      expect(Date.now() - startedAt).toBeLessThan(15_000);
      await expectMigration004Unrecorded(pool);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await contender.end();
    }
  }, 20_000);
});
