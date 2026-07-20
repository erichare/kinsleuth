#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";

import { Pool } from "pg";

import { getDatabaseConnectionString, isDatabaseTransportVerified } from "../lib/connection-string.ts";
import {
  assertSupabaseDatabaseProjectBinding,
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "../lib/database-attestation.ts";

try {
  const [outputPath, ...unexpected] = process.argv.slice(2);
  if (!outputPath || unexpected.length > 0) {
    throw new Error("Usage: attest-recovery-runtime-database.mjs <output.json>.");
  }
  const adminUrl = required("RECOVERY_TARGET_DATABASE_URL");
  const runtimeUrl = required("RECOVERY_TARGET_RUNTIME_DATABASE_URL");
  const expectedIdentity = required("EXPECTED_DATABASE_IDENTITY");
  const expectedArchiveId = required("EXPECTED_ARCHIVE_ID");
  const targetProjectRef = required("RECOVERY_TARGET_SUPABASE_PROJECT_REF");
  if (!/^[a-z0-9]{20}$/.test(targetProjectRef)) {
    throw new Error("RECOVERY_TARGET_SUPABASE_PROJECT_REF is invalid.");
  }
  assertDistinctVerifiedConnections(adminUrl, runtimeUrl, targetProjectRef);

  const sessionName = `kinresolve-recovery-runtime-${randomUUID()}`;
  const adminPool = new Pool({ connectionString: getDatabaseConnectionString(adminUrl), max: 1 });
  const runtimePool = new Pool({
    connectionString: getDatabaseConnectionString(runtimeUrl),
    application_name: sessionName,
    max: 1
  });
  let runtimeClient;
  try {
    const adminIdentity = validateConfiguredDatabaseIdentity(
      expectedIdentity,
      await readDatabaseIdentity(adminPool)
    );
    const adminRoleResult = await adminPool.query("SELECT current_user::text AS role_name");
    const adminRole = roleName(adminRoleResult.rows[0]?.role_name, "migration role");

    runtimeClient = await runtimePool.connect();
    const runtimeResult = await runtimeClient.query(
      `WITH runtime_role AS (
         SELECT oid, rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
                rolreplication, rolcanlogin
         FROM pg_catalog.pg_roles
         WHERE rolname = current_user
       ), owner_roles AS (
         SELECT datdba AS oid FROM pg_catalog.pg_database WHERE datname = current_database()
         UNION
         SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'public'
       UNION
         SELECT relation.relowner
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
         UNION
         SELECT routine.proowner
         FROM pg_catalog.pg_proc AS routine
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
         WHERE namespace.nspname = 'public'
         UNION
         SELECT type_record.typowner
         FROM pg_catalog.pg_type AS type_record
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_record.typnamespace
         WHERE namespace.nspname = 'public'
       )
       SELECT runtime_role.rolname AS role_name,
              current_database()::text AS database_name,
              pg_backend_pid()::text AS backend_pid,
              runtime_role.rolsuper,
              runtime_role.rolbypassrls,
              runtime_role.rolcreatedb,
              runtime_role.rolcreaterole,
              runtime_role.rolreplication,
              runtime_role.rolcanlogin,
              EXISTS (
                SELECT 1
                FROM pg_catalog.pg_roles AS privileged_role
                WHERE privileged_role.oid <> runtime_role.oid
                  AND pg_catalog.pg_has_role(runtime_role.rolname, privileged_role.oid, 'MEMBER')
                  AND (
                    privileged_role.rolsuper
                    OR privileged_role.rolcreatedb
                    OR privileged_role.rolcreaterole
                    OR privileged_role.rolreplication
                    OR privileged_role.oid IN (SELECT oid FROM owner_roles)
                    OR privileged_role.rolname IN (
                      'pg_write_all_data',
                      'pg_execute_server_program',
                      'pg_write_server_files',
                      'pg_read_server_files',
                      'pg_signal_backend',
                      'pg_maintain',
                      'pg_checkpoint',
                      'pg_create_subscription'
                    )
                  )
              ) AS has_privileged_membership,
              EXISTS (
                SELECT 1 FROM owner_roles
                WHERE pg_catalog.pg_has_role(runtime_role.rolname, owner_roles.oid, 'MEMBER')
              ) AS has_owner_membership,
              (SELECT COUNT(*)::text
               FROM pg_catalog.pg_class AS relation
               JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
               WHERE namespace.nspname = 'public'
                 AND relation.relowner = runtime_role.oid) AS owned_public_relations,
              (SELECT database_record.datdba = runtime_role.oid
               FROM pg_catalog.pg_database AS database_record
               WHERE database_record.datname = current_database()) AS owns_database,
              (SELECT namespace.nspowner = runtime_role.oid
               FROM pg_catalog.pg_namespace AS namespace
               WHERE namespace.nspname = 'public') AS owns_public_schema,
              pg_catalog.has_table_privilege(
                runtime_role.rolname, 'public.release_write_fences', 'SELECT'
              ) AS release_fence_readable,
              pg_catalog.has_table_privilege(
                runtime_role.rolname,
                'public.release_write_fences',
                'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'
              ) AS release_fence_mutable,
              pg_catalog.has_schema_privilege(runtime_role.rolname, 'public', 'CREATE') AS public_schema_create
       FROM runtime_role`
    );
    if (runtimeResult.rows.length !== 1) {
      throw new Error("The recovery runtime credential does not resolve to exactly one database role.");
    }
    const runtime = runtimeResult.rows[0];
    const runtimeRole = roleName(runtime.role_name, "runtime role");
    if (runtimeRole === adminRole) {
      throw new Error("The recovery runtime and migration credentials must use distinct database roles.");
    }
    if (
      runtime.rolsuper !== false
      || typeof runtime.rolbypassrls !== "boolean"
      || runtime.rolcreatedb !== false
      || runtime.rolcreaterole !== false
      || runtime.rolreplication !== false
      || runtime.rolcanlogin !== true
      || runtime.has_privileged_membership !== false
      || runtime.has_owner_membership !== false
      || runtime.owns_database !== false
      || runtime.owns_public_schema !== false
      || runtime.release_fence_readable !== true
      || runtime.release_fence_mutable !== false
      || runtime.public_schema_create !== false
      || count(runtime.owned_public_relations) !== 0
    ) {
      throw new Error("The recovery runtime database role is privileged or owns restored data.");
    }

    const backendPid = count(runtime.backend_pid);
    const databaseName = databaseIdentifier(runtime.database_name);
    const observed = await adminPool.query(
      `SELECT 1
       FROM pg_catalog.pg_stat_activity
       WHERE pid = $1
         AND application_name = $2
         AND datname = $3
         AND usename = $4
         AND backend_type = 'client backend'`,
      [backendPid, sessionName, databaseName, runtimeRole]
    );
    if (observed.rows.length !== 1) {
      throw new Error("The migration connection cannot observe the exact live runtime session on its target database.");
    }
    await runtimeClient.query("BEGIN");
    try {
      // The representative write must satisfy the archive-scoped RLS mutation
      // policies once the recovery runtime role runs as NOBYPASSRLS, so the
      // rolled-back transaction pins the configured archive.
      await runtimeClient.query(
        "SELECT pg_catalog.set_config('kinresolve.archive_id', $1, true)",
        [expectedArchiveId]
      );
      const representativeWrite = await runtimeClient.query(
        `UPDATE public.archives
         SET updated_at = updated_at
         WHERE id = $1
         RETURNING id`,
        [expectedArchiveId]
      );
      if (representativeWrite.rows.length !== 1 || representativeWrite.rows[0]?.id !== expectedArchiveId) {
        throw new Error("The recovery runtime role cannot perform a representative policy-filtered application write.");
      }
    } finally {
      await runtimeClient.query("ROLLBACK");
    }

    await writeFile(outputPath, `${JSON.stringify({
      schemaVersion: 1,
      databaseIdentity: adminIdentity.fingerprint,
      databaseProviderId: targetProjectRef,
      runtimeRoleIdentitySha256: roleDigest(runtimeRole),
      credentialsDistinct: true,
      sameDatabaseSessionVerified: true,
      superuser: false,
      bypassRls: runtime.rolbypassrls,
      createDatabase: false,
      createRole: false,
      replication: false,
      privilegedMembership: false,
      ownerMembership: false,
      ownsDatabase: false,
      ownsPublicSchema: false,
      ownedPublicRelations: 0,
      releaseFenceReadable: true,
      releaseFenceMutable: false,
      publicSchemaCreate: false,
      representativeAppWriteRolledBack: true
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(outputPath, 0o600);
    console.log("Attested a distinct bounded-privilege runtime credential on the exact recovery target.");
  } finally {
    runtimeClient?.release();
    await Promise.all([adminPool.end(), runtimePool.end()]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery runtime database attestation failed.");
  process.exitCode = 1;
}

function assertDistinctVerifiedConnections(adminUrl, runtimeUrl, targetProjectRef) {
  if (!isDatabaseTransportVerified(adminUrl) || !isDatabaseTransportVerified(runtimeUrl)) {
    throw new Error("Recovery target database connections must use verified TLS.");
  }
  const admin = new URL(adminUrl);
  const runtime = new URL(runtimeUrl);
  if (admin.port === "6543" || runtime.port === "6543") {
    throw new Error("Recovery target database connections must not use a transaction pooler.");
  }
  if (adminUrl === runtimeUrl || !admin.username || !runtime.username || admin.username === runtime.username) {
    throw new Error("Recovery target migration and runtime credentials must be distinct.");
  }
  assertSupabaseDatabaseProjectBinding(adminUrl, targetProjectRef);
  assertSupabaseDatabaseProjectBinding(runtimeUrl, targetProjectRef);
}

function roleDigest(role) {
  return createHash("sha256")
    .update("kinresolve-recovery-runtime-role-v1\0", "utf8")
    .update(role, "utf8")
    .digest("hex");
}

function roleName(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 63 || /[\0\r\n]/u.test(value)) {
    throw new Error(`The recovery ${label} is invalid.`);
  }
  return value;
}

function databaseIdentifier(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 63 || /[\0\r\n]/u.test(value)) {
    throw new Error("The recovery runtime database name is invalid.");
  }
  return value;
}

function count(value) {
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value)) {
    throw new Error("A recovery runtime database count is invalid.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("A recovery runtime database count is unsafe.");
  return parsed;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
