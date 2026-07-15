import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import { getDatabaseConnectionString, isDatabaseTransportVerified } from "./connection-string.ts";
import {
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "./database-attestation.ts";

export const runtimeDatabaseRoleQuery = `WITH runtime_role AS (
  SELECT oid, rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
         rolreplication, rolcanlogin
  FROM pg_catalog.pg_roles
  WHERE rolname = current_user
), owner_roles AS (
  SELECT 'database'::text AS object_kind, database_record.datdba AS oid
  FROM pg_catalog.pg_database AS database_record
  WHERE database_record.datname = current_database()
  UNION ALL
  SELECT 'schema', namespace.nspowner
  FROM pg_catalog.pg_namespace AS namespace
  WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'relation', relation.relowner
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'function', routine.proowner
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'type', type_record.typowner
  FROM pg_catalog.pg_type AS type_record
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_record.typnamespace
  WHERE namespace.nspname = 'public'
)
SELECT runtime_role.rolname AS role_name,
       session_user::text AS session_role_name,
       current_database()::text AS database_name,
       (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_oid,
       pg_catalog.pg_backend_pid()::text AS backend_pid,
       runtime_role.rolsuper,
       runtime_role.rolbypassrls,
       runtime_role.rolcreatedb,
       runtime_role.rolcreaterole,
       runtime_role.rolreplication,
       runtime_role.rolcanlogin,
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_roles AS candidate
         WHERE candidate.rolname = 'pg_write_all_data'
           AND pg_catalog.pg_has_role(runtime_role.oid, candidate.oid, 'MEMBER')
       ) AS pg_write_all_data_membership,
       pg_catalog.pg_has_role(runtime_role.oid, $1::oid, 'MEMBER') AS migration_role_membership,
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_roles AS candidate
         WHERE pg_catalog.pg_has_role(runtime_role.oid, candidate.oid, 'MEMBER')
           AND (
             candidate.rolsuper
             OR candidate.rolcreatedb
             OR candidate.rolcreaterole
             OR candidate.rolreplication
             OR candidate.rolname IN (
               'pg_execute_server_program',
               'pg_write_server_files',
               'pg_read_server_files',
               'pg_signal_backend',
               'pg_checkpoint',
               'pg_maintain',
               'rds_superuser',
               'supabase_admin'
             )
             OR candidate.rolname ~* '(^|[_-])(admin|owner|migrator?|migration)([_-]|$)'
           )
       ) AS admin_membership,
       EXISTS (
         SELECT 1 FROM owner_roles
         WHERE object_kind = 'database'
           AND pg_catalog.pg_has_role(runtime_role.oid, owner_roles.oid, 'MEMBER')
       ) AS owns_database,
       EXISTS (
         SELECT 1 FROM owner_roles
         WHERE object_kind = 'schema'
           AND pg_catalog.pg_has_role(runtime_role.oid, owner_roles.oid, 'MEMBER')
       ) AS owns_public_schema,
       EXISTS (
         SELECT 1 FROM owner_roles
         WHERE object_kind = 'relation'
           AND pg_catalog.pg_has_role(runtime_role.oid, owner_roles.oid, 'MEMBER')
       ) AS owns_public_relations,
       EXISTS (
         SELECT 1 FROM owner_roles
         WHERE object_kind = 'function'
           AND pg_catalog.pg_has_role(runtime_role.oid, owner_roles.oid, 'MEMBER')
       ) AS owns_public_functions,
       EXISTS (
         SELECT 1 FROM owner_roles
         WHERE object_kind = 'type'
           AND pg_catalog.pg_has_role(runtime_role.oid, owner_roles.oid, 'MEMBER')
       ) AS owns_public_types,
       pg_catalog.has_schema_privilege(runtime_role.oid, 'public', 'CREATE') AS public_schema_create,
       pg_catalog.has_table_privilege(runtime_role.oid, 'public.release_write_fences', 'SELECT')
         AS release_fence_select,
       pg_catalog.has_table_privilege(runtime_role.oid, 'public.release_write_fences', 'INSERT')
         AS release_fence_insert,
       pg_catalog.has_table_privilege(runtime_role.oid, 'public.release_write_fences', 'UPDATE')
         AS release_fence_update,
       pg_catalog.has_table_privilege(runtime_role.oid, 'public.release_write_fences', 'DELETE')
         AS release_fence_delete,
       pg_catalog.has_table_privilege(runtime_role.oid, 'public.release_write_fences', 'TRUNCATE')
         AS release_fence_truncate,
       pg_catalog.has_table_privilege(runtime_role.oid, 'public.release_write_fences', 'TRIGGER')
         AS release_fence_trigger,
       pg_catalog.has_table_privilege(runtime_role.oid, 'public.release_write_fences', 'REFERENCES')
         AS release_fence_references
FROM runtime_role`;

export type RuntimeDatabaseRoleAttestation = {
  schemaVersion: 1;
  databaseIdentity: string;
  runtimeRoleIdentitySha256: string;
  credentialsDistinct: true;
  sameDatabaseSessionVerified: true;
  superuser: false;
  bypassRls: boolean;
  createDatabase: false;
  createRole: false;
  replication: false;
  pgWriteAllDataMembership: false;
  migrationRoleMembership: false;
  adminMembership: false;
  ownsDatabase: false;
  ownsPublicSchema: false;
  ownsPublicRelations: false;
  ownsPublicFunctions: false;
  ownsPublicTypes: false;
  publicSchemaCreate: false;
  releaseFenceSelect: true;
  releaseFenceInsert: false;
  releaseFenceUpdate: false;
  releaseFenceDelete: false;
  releaseFenceTruncate: false;
  releaseFenceTrigger: false;
  releaseFenceReferences: false;
  representativeAppWriteRolledBack: true;
  persistentMutation: false;
};

export type RuntimeDatabaseRolePosture = {
  roleName: string;
  databaseName: string;
  databaseOid: number;
  backendPid: number;
  bypassRls: boolean;
};

export function runtimeDatabaseRoleIdentitySha256(roleName: string): string {
  const validatedRoleName = safeIdentifier(roleName, "runtime database role");
  return createHash("sha256")
    .update("kinresolve-runtime-database-role-v1\0", "utf8")
    .update(validatedRoleName, "utf8")
    .digest("hex");
}

type AttestationInput = {
  runtimeDatabaseUrl: string;
  migrationDatabaseUrl: string;
  expectedDatabaseIdentity: string;
  expectedArchiveId: string;
};

const restrictedFalseFields = [
  "rolsuper",
  "rolcreatedb",
  "rolcreaterole",
  "rolreplication",
  "pg_write_all_data_membership",
  "migration_role_membership",
  "admin_membership",
  "owns_database",
  "owns_public_schema",
  "owns_public_relations",
  "owns_public_functions",
  "owns_public_types",
  "public_schema_create",
  "release_fence_insert",
  "release_fence_update",
  "release_fence_delete",
  "release_fence_truncate",
  "release_fence_trigger",
  "release_fence_references"
] as const;

export function validateRuntimeDatabaseRoleRow(
  row: Record<string, unknown>,
  migrationRoleName: string
): RuntimeDatabaseRolePosture {
  const roleName = safeIdentifier(row.role_name, "runtime database role");
  const sessionRoleName = safeIdentifier(row.session_role_name, "runtime session database role");
  if (sessionRoleName !== roleName) {
    throw new Error("The runtime credential must not enter through a more privileged session role.");
  }
  if (roleName === migrationRoleName) {
    throw new Error("The runtime and migration credentials must resolve to distinct database roles.");
  }
  if (typeof row.rolbypassrls !== "boolean") {
    throw new Error("The runtime database role BYPASSRLS posture could not be attested.");
  }
  if (row.rolcanlogin !== true || row.release_fence_select !== true) {
    throw new Error("The runtime database role is missing required bounded application access.");
  }
  if (restrictedFalseFields.some((field) => row[field] !== false)) {
    throw new Error("The runtime database role has a prohibited privilege, membership, or ownership path.");
  }
  return {
    roleName,
    databaseName: safeIdentifier(row.database_name, "runtime database name"),
    databaseOid: safeInteger(row.database_oid, "runtime database OID"),
    backendPid: safeInteger(row.backend_pid, "runtime backend PID"),
    bypassRls: row.rolbypassrls
  };
}

export async function attestRuntimeDatabaseRole(
  input: AttestationInput
): Promise<RuntimeDatabaseRoleAttestation> {
  const runtimeDatabaseUrl = input.runtimeDatabaseUrl.trim();
  const migrationDatabaseUrl = input.migrationDatabaseUrl.trim();
  if (
    !runtimeDatabaseUrl
    || !migrationDatabaseUrl
    || runtimeDatabaseUrl === migrationDatabaseUrl
    || !isDatabaseTransportVerified(runtimeDatabaseUrl)
    || !isDatabaseTransportVerified(migrationDatabaseUrl)
  ) {
    throw new Error("Runtime and migration database connections must be distinct and use verified transport.");
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(input.expectedArchiveId)) {
    throw new Error("The expected archive identifier is invalid.");
  }

  const sessionName = `kinresolve-role-attest-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const migrationPool = new Pool({
    connectionString: getDatabaseConnectionString(migrationDatabaseUrl),
    max: 1
  });
  const runtimePool = new Pool({
    application_name: sessionName,
    connectionString: getDatabaseConnectionString(runtimeDatabaseUrl),
    max: 1
  });
  // Idle-client errors otherwise become uncaught EventEmitter errors whose
  // default rendering can expose connection metadata in CI logs.
  migrationPool.on("error", () => undefined);
  runtimePool.on("error", () => undefined);
  let runtimeClient: PoolClient | undefined;
  let transactionOpen = false;
  try {
    const databaseIdentity = validateConfiguredDatabaseIdentity(
      input.expectedDatabaseIdentity,
      await readDatabaseIdentity(migrationPool)
    );
    const migrationResult = await migrationPool.query(
      `SELECT current_user::text AS role_name,
              session_user::text AS session_role_name,
              database_record.oid::text AS database_oid,
              current_database()::text AS database_name
       FROM pg_catalog.pg_database AS database_record
       WHERE database_record.datname = current_database()`
    );
    if (migrationResult.rows.length !== 1) {
      throw new Error("The migration database session could not be attested.");
    }
    const migrationRoleName = safeIdentifier(migrationResult.rows[0]?.role_name, "migration database role");
    const migrationSessionRoleName = safeIdentifier(
      migrationResult.rows[0]?.session_role_name,
      "migration session database role"
    );
    if (migrationSessionRoleName !== migrationRoleName) {
      throw new Error("The migration credential must connect as its attested database role.");
    }
    const migrationRoleOidResult = await migrationPool.query(
      "SELECT oid::text AS role_oid FROM pg_catalog.pg_roles WHERE rolname = current_user"
    );
    if (migrationRoleOidResult.rows.length !== 1) {
      throw new Error("The migration database role could not be attested.");
    }
    const migrationRoleOid = safeInteger(
      migrationRoleOidResult.rows[0]?.role_oid,
      "migration database role OID"
    );
    const migrationDatabaseOid = safeInteger(
      migrationResult.rows[0]?.database_oid,
      "migration database OID"
    );
    const migrationDatabaseName = safeIdentifier(
      migrationResult.rows[0]?.database_name,
      "migration database name"
    );

    runtimeClient = await runtimePool.connect();
    await runtimeClient.query("BEGIN");
    transactionOpen = true;
    const runtimeResult = await runtimeClient.query(runtimeDatabaseRoleQuery, [migrationRoleOid]);
    if (runtimeResult.rows.length !== 1) {
      throw new Error("The runtime credential does not resolve to exactly one database role.");
    }
    const posture = validateRuntimeDatabaseRoleRow(runtimeResult.rows[0], migrationRoleName);
    if (posture.databaseOid !== migrationDatabaseOid || posture.databaseName !== migrationDatabaseName) {
      throw new Error("The runtime and migration credentials do not reach the same database.");
    }

    const observed = await migrationPool.query(
      `SELECT 1
       FROM pg_catalog.pg_stat_activity
       WHERE pid = $1
         AND datid = $2::oid
         AND datname = $3
         AND application_name = $4
         AND usename = $5
         AND backend_type = 'client backend'`,
      [posture.backendPid, posture.databaseOid, posture.databaseName, sessionName, posture.roleName]
    );
    if (observed.rows.length !== 1) {
      throw new Error("The migration connection cannot observe the exact live runtime database session.");
    }

    const before = await runtimeClient.query(
      `SELECT xmin::text AS row_version, updated_at::text AS updated_at
       FROM public.archives
       WHERE id = $1
       FOR UPDATE`,
      [input.expectedArchiveId]
    );
    if (before.rows.length !== 1) {
      throw new Error("The representative application row is missing or inaccessible.");
    }
    const representativeWrite = await runtimeClient.query(
      `UPDATE public.archives
       SET updated_at = clock_timestamp()
       WHERE id = $1
       RETURNING id`,
      [input.expectedArchiveId]
    );
    if (representativeWrite.rows.length !== 1 || representativeWrite.rows[0]?.id !== input.expectedArchiveId) {
      throw new Error("The runtime role cannot perform a representative application write.");
    }
    await runtimeClient.query("ROLLBACK");
    transactionOpen = false;

    const after = await migrationPool.query(
      `SELECT xmin::text AS row_version, updated_at::text AS updated_at
       FROM public.archives
       WHERE id = $1`,
      [input.expectedArchiveId]
    );
    if (
      after.rows.length !== 1
      || before.rows[0]?.row_version !== after.rows[0]?.row_version
      || before.rows[0]?.updated_at !== after.rows[0]?.updated_at
    ) {
      throw new Error("The representative application write did not prove zero persistent mutation.");
    }

    return {
      schemaVersion: 1,
      databaseIdentity: databaseIdentity.fingerprint,
      runtimeRoleIdentitySha256: runtimeDatabaseRoleIdentitySha256(posture.roleName),
      credentialsDistinct: true,
      sameDatabaseSessionVerified: true,
      superuser: false,
      bypassRls: posture.bypassRls,
      createDatabase: false,
      createRole: false,
      replication: false,
      pgWriteAllDataMembership: false,
      migrationRoleMembership: false,
      adminMembership: false,
      ownsDatabase: false,
      ownsPublicSchema: false,
      ownsPublicRelations: false,
      ownsPublicFunctions: false,
      ownsPublicTypes: false,
      publicSchemaCreate: false,
      releaseFenceSelect: true,
      releaseFenceInsert: false,
      releaseFenceUpdate: false,
      releaseFenceDelete: false,
      releaseFenceTruncate: false,
      releaseFenceTrigger: false,
      releaseFenceReferences: false,
      representativeAppWriteRolledBack: true,
      persistentMutation: false
    };
  } finally {
    if (transactionOpen && runtimeClient) {
      try {
        await runtimeClient.query("ROLLBACK");
      } catch {
        // The caller still fails closed; cleanup errors must not expose connection details.
      }
    }
    runtimeClient?.release();
    await Promise.allSettled([migrationPool.end(), runtimePool.end()]);
  }
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 63 || /[\0\r\n]/u.test(value)) {
    throw new Error(`The ${label} is invalid.`);
  }
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value)) {
    throw new Error(`The ${label} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`The ${label} is unsafe.`);
  return parsed;
}
