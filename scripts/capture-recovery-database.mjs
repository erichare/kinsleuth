#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";

import { Pool } from "pg";

import { getDatabaseConnectionString, isDatabaseTransportVerified } from "../lib/connection-string.ts";
import { readDatabaseIdentity, validateConfiguredDatabaseIdentity } from "../lib/database-attestation.ts";
import {
  demoPurgeProductManifestSha256
} from "../lib/demo-purge.ts";
import { readDemoPurgeProductManifests } from "../lib/demo-purge-product-manifest.ts";
import {
  validateProductionMigrationLedger,
  validateProductionMigrationLedgerPrefix
} from "../lib/production-migration.ts";
import { loadReleasePolicy } from "../lib/release-policy.ts";

const [outputPath, ...unexpected] = process.argv.slice(2);

try {
  if (!outputPath || unexpected.length > 0) {
    throw new Error("Usage: capture-recovery-database.mjs <output.json>.");
  }
  const databaseUrl = required("RECOVERY_DATABASE_URL");
  const expectedIdentity = required("EXPECTED_DATABASE_IDENTITY");
  const expectedArchiveId = required("EXPECTED_ARCHIVE_ID");
  const expectedFenceId = required("RECOVERY_FENCE_ID");
  const expectedReleaseCommit = required("RELEASE_COMMIT");
  const capturePhase = process.env.RECOVERY_DATABASE_CAPTURE_PHASE?.trim() || "candidate-final";
  if (!["source-prefix", "restored-prefix", "candidate-final"].includes(capturePhase)) {
    throw new Error("RECOVERY_DATABASE_CAPTURE_PHASE is invalid.");
  }
  const fenceActivatedAt = timestamp(required("FENCE_ACTIVATED_AT"));
  const requireStragglerProof = boolean(required("RECOVERY_REQUIRE_STRAGGLER_PROOF"));
  if (!isDatabaseTransportVerified(databaseUrl)) {
    throw new Error("The recovery database connection must use verified TLS.");
  }
  if (new URL(databaseUrl).port === "6543") {
    throw new Error("The recovery database connection must not use a transaction pooler.");
  }

  const policy = await loadReleasePolicy({ repositoryRoot: process.cwd() });
  const migrationVersions = policy.migrations.map((migration) => migration.file.replace(/\.sql$/, ""));
  const pool = new Pool({ connectionString: getDatabaseConnectionString(databaseUrl), max: 1 });
  try {
    const identity = validateConfiguredDatabaseIdentity(expectedIdentity, await readDatabaseIdentity(pool));
    const archives = await pool.query('SELECT id FROM public.archives ORDER BY id COLLATE "C"');
    if (archives.rows.length !== 1 || archives.rows[0]?.id !== expectedArchiveId) {
      throw new Error("The recovery database must contain exactly the expected production archive.");
    }

    const catalog = await pool.query(
      "SELECT to_regclass('public.durable_jobs') IS NOT NULL AS jobs_exists, "
      + "to_regclass('public.integration_upload_intents') IS NOT NULL AS intents_exists, "
      + "to_regclass('public.release_write_fences') IS NOT NULL AS fence_exists, "
      + "to_regclass('public.schema_migrations') IS NOT NULL AS ledger_exists"
    );
    const catalogRow = catalog.rows[0];
    if (
      catalogRow?.jobs_exists !== true
      || catalogRow.intents_exists !== true
      || catalogRow.fence_exists !== true
      || catalogRow.ledger_exists !== true
    ) {
      throw new Error("The recovery database is missing required current-schema tables.");
    }

    const ledger = await pool.query('SELECT version FROM public.schema_migrations ORDER BY version COLLATE "C"');
    const appliedVersions = ledger.rows.map((row) => row.version);
    if (capturePhase === "candidate-final") {
      validateProductionMigrationLedger(migrationVersions, appliedVersions);
    } else {
      validateProductionMigrationLedgerPrefix(migrationVersions, appliedVersions);
      if (!appliedVersions.includes("013_release_write_fence")) {
        throw new Error(
          "Recovery source and pre-migration restore prefixes must include 013_release_write_fence."
        );
      }
    }

    const activeFence = await pool.query(
      `SELECT fence_id, release_commit_sha, activated_at
       FROM public.release_write_fences
       WHERE state = 'active'`
    );
    if (
      activeFence.rows.length !== 1
      || activeFence.rows[0]?.fence_id !== expectedFenceId
      || activeFence.rows[0]?.release_commit_sha !== expectedReleaseCommit
      || new Date(activeFence.rows[0]?.activated_at).toISOString() !== fenceActivatedAt
    ) {
      throw new Error("The recovery database does not contain the exact active release fence.");
    }

    const work = await pool.query(
      `WITH visibility AS (
         SELECT pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER') AS read_all_stats
       )
       SELECT
         (SELECT COUNT(*)::text FROM public.durable_jobs
          WHERE state = 'running' AND lease_expires_at > clock_timestamp()) AS active_job_leases,
         (SELECT COUNT(*)::text FROM public.integration_upload_intents
          WHERE status = 'pending' AND expires_at > clock_timestamp()) AS unexpired_upload_intents,
         (SELECT COUNT(*)::text
          FROM pg_catalog.pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND backend_type = 'client backend'
            AND xact_start IS NOT NULL
            AND xact_start <= $1::timestamptz) AS straggler_transactions,
         visibility.read_all_stats,
         (SELECT COUNT(*)::text
          FROM pg_catalog.pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND backend_type = 'client backend'
            AND usename IS DISTINCT FROM current_user) AS other_role_sessions
       FROM visibility`,
      [fenceActivatedAt]
    );
    const activeJobLeases = count(work.rows[0]?.active_job_leases, "active job lease count");
    const unexpiredUploadIntents = count(
      work.rows[0]?.unexpired_upload_intents,
      "unexpired upload intent count"
    );
    const stragglerTransactions = count(
      work.rows[0]?.straggler_transactions,
      "straggler transaction count"
    );
    const otherRoleSessions = count(work.rows[0]?.other_role_sessions, "other-role session count");
    const stragglerVisibilityVerified = work.rows[0]?.read_all_stats === true || otherRoleSessions === 0;
    if (requireStragglerProof && !stragglerVisibilityVerified) {
      throw new Error(
        "The recovery database role cannot see transaction timestamps for every client session."
      );
    }
    const databaseManifestSha256 = await databaseManifest(pool);
    const databaseProductManifestSha256 = demoPurgeProductManifestSha256(
      await readDemoPurgeProductManifests(pool, expectedArchiveId)
    );

    await writePrivateJson(outputPath, {
      capturePhase,
      databaseIdentity: identity.fingerprint,
      archiveId: expectedArchiveId,
      fenceId: expectedFenceId,
      releaseCommitSha: expectedReleaseCommit,
      fenceActivatedAt,
      migrationVersions,
      activeJobLeases,
      unexpiredUploadIntents,
      stragglerTransactions,
      stragglerVisibilityVerified,
      candidateSemanticsVerified: capturePhase === "candidate-final",
      manifestSha256: databaseManifestSha256,
      demoPurgeProductManifestSha256: databaseProductManifestSha256
    });
    console.log("Captured privacy-safe recovery database manifest.");
  } finally {
    await pool.end();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery database capture failed.");
  process.exitCode = 1;
}

async function databaseManifest(pool) {
  const hash = createHash("sha256");
  hash.update("kinresolve-recovery-database-manifest-v2\0", "utf8");

  const tableResult = await pool.query(
    `SELECT namespace.nspname AS schema_name, relation.relname AS table_name,
            relation.relrowsecurity, relation.relforcerowsecurity,
            COALESCE(array_to_string(relation.relacl, E'\\n'), '') AS acl
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
     ORDER BY namespace.nspname COLLATE "C", relation.relname COLLATE "C"`
  );
  for (const table of tableResult.rows) {
    const schemaName = safeIdentifier(table.schema_name, "table schema");
    const tableName = safeIdentifier(table.table_name, "table name");
    const qualified = `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
    hashField(hash, "table", `${schemaName}.${tableName}`);
    hashField(hash, "table-security", JSON.stringify({
      rowSecurity: table.relrowsecurity,
      forceRowSecurity: table.relforcerowsecurity,
      acl: table.acl
    }));

    const columns = await pool.query(
      `SELECT attribute.attnum, attribute.attname,
              pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
              attribute.attnotnull,
              pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) AS default_expression
       FROM pg_catalog.pg_attribute AS attribute
       LEFT JOIN pg_catalog.pg_attrdef AS default_value
         ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
       WHERE attribute.attrelid = $1::regclass
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
       ORDER BY attribute.attnum`,
      [`${schemaName}.${tableName}`]
    );
    hashField(hash, "columns", JSON.stringify(columns.rows));

    const constraints = await pool.query(
      `SELECT constraint_record.conname,
              pg_catalog.pg_get_constraintdef(constraint_record.oid, true) AS definition
       FROM pg_catalog.pg_constraint AS constraint_record
       WHERE constraint_record.conrelid = $1::regclass
       ORDER BY constraint_record.conname COLLATE "C"`,
      [`${schemaName}.${tableName}`]
    );
    hashField(hash, "constraints", JSON.stringify(constraints.rows));

    const indexes = await pool.query(
      `SELECT indexname, indexdef
       FROM pg_catalog.pg_indexes
       WHERE schemaname = $1 AND tablename = $2
       ORDER BY indexname COLLATE "C"`,
      [schemaName, tableName]
    );
    hashField(hash, "indexes", JSON.stringify(indexes.rows));

    const triggers = await pool.query(
      `SELECT trigger_record.tgname,
              pg_catalog.pg_get_triggerdef(trigger_record.oid, true) AS definition,
              trigger_record.tgenabled
       FROM pg_catalog.pg_trigger AS trigger_record
       WHERE trigger_record.tgrelid = $1::regclass
         AND NOT trigger_record.tgisinternal
       ORDER BY trigger_record.tgname COLLATE "C"`,
      [`${schemaName}.${tableName}`]
    );
    hashField(hash, "triggers", JSON.stringify(triggers.rows));

    const rows = await pool.query(
      `SELECT pg_catalog.to_jsonb(row_record)::text AS row_data
       FROM ${qualified} AS row_record
       ORDER BY pg_catalog.to_jsonb(row_record)::text COLLATE "C"`
    );
    hashField(hash, "row-count", String(rows.rows.length));
    for (const row of rows.rows) {
      if (typeof row.row_data !== "string") throw new Error("Recovery database row serialization failed.");
      hashField(hash, "row", row.row_data);
    }
  }

  const sequences = await pool.query(
    `SELECT sequences.schemaname, sequences.sequencename, sequences.start_value::text,
            sequences.min_value::text, sequences.max_value::text,
            increment_by::text, cycle, cache_size::text, last_value::text
     FROM pg_catalog.pg_sequences AS sequences
     WHERE sequences.schemaname = 'public'
     ORDER BY sequences.sequencename COLLATE "C"`
  );
  hashField(hash, "sequences", JSON.stringify(sequences.rows));

  const securitySurfaceQueries = [
    ["views", `SELECT schemaname, viewname AS name, definition
      FROM pg_catalog.pg_views WHERE schemaname = 'public'
      UNION ALL
      SELECT schemaname, matviewname AS name, definition
      FROM pg_catalog.pg_matviews WHERE schemaname = 'public'
      ORDER BY name COLLATE "C"`],
    ["policies", `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      FROM pg_catalog.pg_policies WHERE schemaname = 'public'
      ORDER BY tablename COLLATE "C", policyname COLLATE "C"`],
    ["functions", `SELECT namespace.nspname AS schema_name, routine.proname,
             pg_catalog.pg_get_function_identity_arguments(routine.oid) AS identity_arguments,
             routine.prokind, routine.prosecdef, routine.proleakproof,
             routine.provolatile, routine.proparallel, routine.proconfig,
             COALESCE(array_to_string(routine.proacl, E'\\n'), '') AS acl,
             pg_catalog.pg_get_functiondef(routine.oid) AS definition
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
        AND routine.prokind IN ('f', 'p')
      ORDER BY routine.proname COLLATE "C", identity_arguments COLLATE "C"`],
    ["routine-metadata", `SELECT namespace.nspname AS schema_name, routine.proname,
             pg_catalog.pg_get_function_identity_arguments(routine.oid) AS identity_arguments,
             pg_catalog.pg_get_function_result(routine.oid) AS result_type,
             routine.prokind, routine.prosecdef, routine.proleakproof,
             routine.provolatile, routine.proparallel, routine.proconfig,
             COALESCE(array_to_string(routine.proacl, E'\\n'), '') AS acl
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
      ORDER BY routine.proname COLLATE "C", identity_arguments COLLATE "C"`],
    ["extensions", `SELECT extension.extname, extension.extversion, namespace.nspname AS schema_name
      FROM pg_catalog.pg_extension AS extension
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = extension.extnamespace
      ORDER BY extension.extname COLLATE "C"`],
    ["schema-acl", `SELECT namespace.nspname,
             COALESCE(array_to_string(namespace.nspacl, E'\\n'), '') AS acl
      FROM pg_catalog.pg_namespace AS namespace
      WHERE namespace.nspname = 'public'`],
    ["sequence-acl", `SELECT relation.relname,
             COALESCE(array_to_string(relation.relacl, E'\\n'), '') AS acl
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'S'
      ORDER BY relation.relname COLLATE "C"`],
    ["non-table-relation-acl", `SELECT relation.relname, relation.relkind,
             COALESCE(array_to_string(relation.relacl, E'\\n'), '') AS acl
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind IN ('v', 'm', 'f')
      ORDER BY relation.relname COLLATE "C", relation.relkind`],
    ["type-acl", `SELECT type_record.typname,
             COALESCE(array_to_string(type_record.typacl, E'\\n'), '') AS acl
      FROM pg_catalog.pg_type AS type_record
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_record.typnamespace
      WHERE namespace.nspname = 'public'
      ORDER BY type_record.typname COLLATE "C"`],
    ["default-acl", `SELECT role_record.rolname, default_acl.defaclnamespace::regnamespace::text AS namespace_name,
             default_acl.defaclobjtype,
             COALESCE(array_to_string(default_acl.defaclacl, E'\\n'), '') AS acl
      FROM pg_catalog.pg_default_acl AS default_acl
      JOIN pg_catalog.pg_roles AS role_record ON role_record.oid = default_acl.defaclrole
      ORDER BY role_record.rolname COLLATE "C", namespace_name COLLATE "C", default_acl.defaclobjtype`],
    ["large-object-acl", `SELECT metadata.oid::text,
             COALESCE(array_to_string(metadata.lomacl, E'\\n'), '') AS acl
      FROM pg_catalog.pg_largeobject_metadata AS metadata
      ORDER BY metadata.oid`],
    ["large-object-data", `SELECT large_object.loid::text, large_object.pageno,
             encode(large_object.data, 'hex') AS data
      FROM pg_catalog.pg_largeobject AS large_object
      ORDER BY large_object.loid, large_object.pageno`]
  ];
  for (const [label, sql] of securitySurfaceQueries) {
    const result = await pool.query(sql);
    hashField(hash, label, JSON.stringify(result.rows));
  }
  return hash.digest("hex");
}

function hashField(hash, label, value) {
  const bytes = Buffer.from(value, "utf8");
  hash.update(label, "utf8");
  hash.update("\0", "utf8");
  hash.update(String(bytes.length), "utf8");
  hash.update("\0", "utf8");
  hash.update(bytes);
  hash.update("\0", "utf8");
}

function safeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) {
    throw new Error(`Recovery database ${label} is invalid.`);
  }
  return value;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function count(value, label) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`Recovery ${label} is invalid.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Recovery ${label} exceeds the safe integer range.`);
  return parsed;
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function boolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("RECOVERY_REQUIRE_STRAGGLER_PROOF must be exactly true or false.");
}

function timestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("FENCE_ACTIVATED_AT must be an exact UTC timestamp.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("FENCE_ACTIVATED_AT must be a real UTC timestamp.");
  }
  return value;
}
