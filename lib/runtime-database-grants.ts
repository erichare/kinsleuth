import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import { getDatabaseConnectionString } from "./connection-string.ts";
import {
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "./database-attestation.ts";
import {
  attestRuntimeDatabaseRole,
  runtimeDatabaseRoleIdentitySha256,
  runtimeDatabaseRoleQuery,
  validateRuntimeDatabaseRoleRow
} from "./runtime-database-role-attestation.ts";

export const betaOperationsRuntimeGrantContract = [
  {
    table: "beta_data_operations",
    privileges: ["SELECT", "INSERT", "UPDATE"]
  },
  {
    table: "beta_worker_heartbeats",
    privileges: ["SELECT", "INSERT", "UPDATE"]
  }
] as const;

export const protectedRuntimeTableContract = [
  "release_write_fences",
  "schema_migrations"
] as const;

const allContractTables = [
  ...betaOperationsRuntimeGrantContract.map(({ table }) => table),
  ...protectedRuntimeTableContract
];
const grantLockKey = "4865392810451201014";

type RuntimeGrantInput = {
  runtimeDatabaseUrl: string;
  migrationDatabaseUrl: string;
  expectedDatabaseIdentity: string;
  expectedArchiveId: string;
};

type RawPrivilegeRow = Record<string, unknown>;

export type RuntimeTablePrivilegeAttestation = {
  table: string;
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  truncate: boolean;
  references: boolean;
  trigger: boolean;
  maintain: boolean;
  grantOptions: false;
};

export type BetaOperationsRuntimeGrantAttestation = {
  schemaVersion: 1;
  grantContract: "beta-operations-v1";
  databaseIdentity: string;
  runtimeRoleIdentitySha256: string;
  credentialsDistinct: true;
  sameDatabaseSessionVerified: true;
  safeRuntimeRoleReattested: true;
  databaseCreate: false;
  publicSchemaUsage: true;
  publicSchemaCreate: false;
  managedTablePrivileges: RuntimeTablePrivilegeAttestation[];
  protectedTablePrivileges: RuntimeTablePrivilegeAttestation[];
  exactPrivilegesAttested: true;
  representativeAppWriteRolledBack: true;
  persistentDataMutation: false;
};

export async function grantAndAttestBetaOperationsRuntimeRole(
  input: RuntimeGrantInput
): Promise<BetaOperationsRuntimeGrantAttestation> {
  // This first gate proves the pulled runtime credential is a distinct, safe
  // role on the configured physical database before any ACL is changed.
  const before = await attestRuntimeDatabaseRole(input);
  const sessionName = `kinresolve-runtime-grant-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const migrationPool = new Pool({
    connectionString: getDatabaseConnectionString(input.migrationDatabaseUrl.trim()),
    max: 1
  });
  const runtimePool = new Pool({
    application_name: sessionName,
    connectionString: getDatabaseConnectionString(input.runtimeDatabaseUrl.trim()),
    max: 1
  });
  migrationPool.on("error", () => undefined);
  runtimePool.on("error", () => undefined);

  let migrationClient: PoolClient | undefined;
  let runtimeClient: PoolClient | undefined;
  let grantTransactionOpen = false;
  try {
    migrationClient = await migrationPool.connect();
    runtimeClient = await runtimePool.connect();

    const databaseIdentity = validateConfiguredDatabaseIdentity(
      input.expectedDatabaseIdentity,
      await readDatabaseIdentity(migrationClient)
    );
    if (databaseIdentity.fingerprint !== before.databaseIdentity) {
      throw new Error("The runtime grant database identity changed after the safety attestation.");
    }

    const migrationSession = await migrationClient.query(
      `SELECT current_user::text AS role_name,
              session_user::text AS session_role_name,
              database_record.oid::text AS database_oid,
              current_database()::text AS database_name
       FROM pg_catalog.pg_database AS database_record
       WHERE database_record.datname = current_database()`
    );
    const runtimeSession = await runtimeClient.query(
      `SELECT current_user::text AS role_name,
              session_user::text AS session_role_name,
              database_record.oid::text AS database_oid,
              current_database()::text AS database_name,
              pg_catalog.pg_backend_pid()::text AS backend_pid
       FROM pg_catalog.pg_database AS database_record
       WHERE database_record.datname = current_database()`
    );
    if (migrationSession.rows.length !== 1 || runtimeSession.rows.length !== 1) {
      throw new Error("The runtime grant sessions could not be attested.");
    }

    const migrationRoleName = safeIdentifier(
      migrationSession.rows[0]?.role_name,
      "migration database role"
    );
    const migrationSessionRoleName = safeIdentifier(
      migrationSession.rows[0]?.session_role_name,
      "migration session database role"
    );
    const runtimeRoleName = safeIdentifier(
      runtimeSession.rows[0]?.role_name,
      "runtime database role"
    );
    const runtimeSessionRoleName = safeIdentifier(
      runtimeSession.rows[0]?.session_role_name,
      "runtime session database role"
    );
    if (
      migrationRoleName !== migrationSessionRoleName
      || runtimeRoleName !== runtimeSessionRoleName
      || runtimeRoleName === migrationRoleName
    ) {
      throw new Error("The runtime grant requires distinct direct database roles.");
    }
    if (runtimeDatabaseRoleIdentitySha256(runtimeRoleName) !== before.runtimeRoleIdentitySha256) {
      throw new Error("The runtime database role changed after the safety attestation.");
    }

    const migrationDatabaseOid = safeInteger(
      migrationSession.rows[0]?.database_oid,
      "migration database OID"
    );
    const runtimeDatabaseOid = safeInteger(
      runtimeSession.rows[0]?.database_oid,
      "runtime database OID"
    );
    const migrationDatabaseName = safeIdentifier(
      migrationSession.rows[0]?.database_name,
      "migration database name"
    );
    const runtimeDatabaseName = safeIdentifier(
      runtimeSession.rows[0]?.database_name,
      "runtime database name"
    );
    const runtimeBackendPid = safeInteger(
      runtimeSession.rows[0]?.backend_pid,
      "runtime database backend PID"
    );
    if (
      migrationDatabaseOid !== runtimeDatabaseOid
      || migrationDatabaseName !== runtimeDatabaseName
    ) {
      throw new Error("The runtime and migration credentials do not reach the same database.");
    }

    const liveSession = await migrationClient.query(
      `SELECT 1
       FROM pg_catalog.pg_stat_activity
       WHERE pid = $1
         AND datid = $2::oid
         AND datname = $3
         AND application_name = $4
         AND usename = $5
         AND backend_type = 'client backend'`,
      [runtimeBackendPid, runtimeDatabaseOid, runtimeDatabaseName, sessionName, runtimeRoleName]
    );
    if (liveSession.rows.length !== 1) {
      throw new Error("The migration connection cannot observe the exact runtime grant session.");
    }

    const runtimeRole = await migrationClient.query(
      `SELECT oid::text AS role_oid
       FROM pg_catalog.pg_roles
       WHERE rolname = $1`,
      [runtimeRoleName]
    );
    if (runtimeRole.rows.length !== 1) {
      throw new Error("The runtime database role disappeared before grants were applied.");
    }
    const runtimeRoleOid = safeInteger(runtimeRole.rows[0]?.role_oid, "runtime database role OID");
    const migrationRole = await migrationClient.query(
      `SELECT oid::text AS role_oid
       FROM pg_catalog.pg_roles
       WHERE rolname = $1`,
      [migrationRoleName]
    );
    if (migrationRole.rows.length !== 1) {
      throw new Error("The migration database role disappeared before grants were applied.");
    }
    const migrationRoleOid = safeInteger(
      migrationRole.rows[0]?.role_oid,
      "migration database role OID"
    );
    const runtimeSafety = await runtimeClient.query(runtimeDatabaseRoleQuery, [migrationRoleOid]);
    if (runtimeSafety.rows.length !== 1) {
      throw new Error("The runtime database role safety posture could not be re-read.");
    }
    const runtimePosture = validateRuntimeDatabaseRoleRow(
      runtimeSafety.rows[0],
      migrationRoleName
    );
    if (
      runtimePosture.roleName !== runtimeRoleName
      || runtimePosture.databaseOid !== runtimeDatabaseOid
      || runtimePosture.databaseName !== runtimeDatabaseName
      || runtimePosture.backendPid !== runtimeBackendPid
    ) {
      throw new Error("The runtime database role safety session changed before the grant.");
    }

    await migrationClient.query("BEGIN");
    grantTransactionOpen = true;
    await migrationClient.query("SELECT pg_catalog.pg_advisory_xact_lock($1::bigint)", [grantLockKey]);
    await assertContractRelations(migrationClient);
    for (const statement of buildBetaOperationsGrantStatements(runtimeRoleName)) {
      await migrationClient.query(statement);
    }
    const transactionPrivileges = validateBetaOperationsPrivilegeRows(
      (await readRuntimePrivilegeRows(migrationClient, runtimeRoleOid)).rows
    );
    await assertRuntimeSchemaPosture(migrationClient, runtimeRoleOid);
    await migrationClient.query("COMMIT");
    grantTransactionOpen = false;

    // Re-open the full safety gate and independently query the runtime session
    // after commit. The release cannot proceed on a partial or stale ACL view.
    const after = await attestRuntimeDatabaseRole(input);
    if (
      after.databaseIdentity !== before.databaseIdentity
      || after.runtimeRoleIdentitySha256 !== before.runtimeRoleIdentitySha256
    ) {
      throw new Error("The runtime database target changed during grant attestation.");
    }
    const committedPrivileges = validateBetaOperationsPrivilegeRows(
      (await readRuntimePrivilegeRows(runtimeClient, runtimeRoleOid)).rows
    );
    await assertRuntimeSchemaPosture(runtimeClient, runtimeRoleOid);
    if (JSON.stringify(committedPrivileges) !== JSON.stringify(transactionPrivileges)) {
      throw new Error("The committed runtime privileges differ from the transactional attestation.");
    }

    return {
      schemaVersion: 1,
      grantContract: "beta-operations-v1",
      databaseIdentity: after.databaseIdentity,
      runtimeRoleIdentitySha256: after.runtimeRoleIdentitySha256,
      credentialsDistinct: true,
      sameDatabaseSessionVerified: true,
      safeRuntimeRoleReattested: true,
      databaseCreate: false,
      publicSchemaUsage: true,
      publicSchemaCreate: false,
      managedTablePrivileges: committedPrivileges.filter(({ table }) =>
        betaOperationsRuntimeGrantContract.some((entry) => entry.table === table)
      ),
      protectedTablePrivileges: committedPrivileges.filter(({ table }) =>
        protectedRuntimeTableContract.some((entry) => entry === table)
      ),
      exactPrivilegesAttested: true,
      representativeAppWriteRolledBack: true,
      persistentDataMutation: false
    };
  } finally {
    if (grantTransactionOpen && migrationClient) {
      try {
        await migrationClient.query("ROLLBACK");
      } catch {
        // The caller still fails closed and the CLI never renders driver details.
      }
    }
    runtimeClient?.release();
    migrationClient?.release();
    await Promise.allSettled([migrationPool.end(), runtimePool.end()]);
  }
}

export function buildBetaOperationsGrantStatements(runtimeRoleName: string): string[] {
  const quotedRole = quoteIdentifier(safeIdentifier(runtimeRoleName, "runtime database role"));
  return betaOperationsRuntimeGrantContract.flatMap(({ table, privileges }) => {
    const quotedTable = quoteIdentifier(table);
    return [
      `REVOKE ALL PRIVILEGES ON TABLE public.${quotedTable} FROM ${quotedRole}`,
      `GRANT ${privileges.join(", ")} ON TABLE public.${quotedTable} TO ${quotedRole}`
    ];
  });
}

export function validateBetaOperationsPrivilegeRows(
  rows: RawPrivilegeRow[]
): RuntimeTablePrivilegeAttestation[] {
  const byTable = new Map(rows.map((row) => [safeIdentifier(row.table_name, "runtime grant table"), row]));
  if (rows.length !== allContractTables.length || byTable.size !== allContractTables.length) {
    throw new Error("The runtime grant privilege inventory is incomplete.");
  }

  return allContractTables.map((table) => {
    const row = byTable.get(table);
    if (!row) throw new Error("The runtime grant privilege inventory is incomplete.");
    const managed = betaOperationsRuntimeGrantContract.some((entry) => entry.table === table);
    const expected = {
      select: true,
      insert: managed,
      update: managed,
      delete: false,
      truncate: false,
      references: false,
      trigger: false,
      maintain: false
    };
    for (const [privilege, expectedValue] of Object.entries(expected)) {
      if (row[privilege] !== expectedValue) {
        throw new Error("The runtime database role does not have the exact checked-in table privileges.");
      }
      if (row[`${privilege}_grant_option`] !== false) {
        throw new Error("The runtime database role must not hold table grant options.");
      }
    }
    for (const field of [
      "select_column_only",
      "insert_column_only",
      "update_column_only",
      "references_column_only",
      "select_column_grant_option",
      "insert_column_grant_option",
      "update_column_grant_option",
      "references_column_grant_option"
    ]) {
      if (row[field] !== false) {
        throw new Error("The runtime database role must not hold separate column privilege paths.");
      }
    }
    return {
      table,
      ...expected,
      grantOptions: false
    };
  });
}

async function readRuntimePrivilegeRows(client: PoolClient, runtimeRoleOid: number) {
  const versionResult = await client.query<{ server_version_num: string }>(
    "SELECT current_setting('server_version_num') AS server_version_num"
  );
  const serverVersion = safeInteger(
    versionResult.rows[0]?.server_version_num,
    "PostgreSQL server version"
  );
  // PostgreSQL resolves has_table_privilege's privilege-name argument before
  // CASE evaluation, so merely placing MAINTAIN in a dead PG16 branch still
  // raises "unrecognized privilege type". Build only one of these two static
  // expressions after the attested server-version read.
  const maintainPrivilege = serverVersion >= 170_000
    ? `pg_catalog.bool_or(pg_catalog.has_table_privilege(
         accessible_roles.role_oid, relation.oid, 'MAINTAIN'
       ))`
    : "false";
  const maintainGrantOption = serverVersion >= 170_000
    ? `pg_catalog.bool_or(pg_catalog.has_table_privilege(
         accessible_roles.role_oid, relation.oid, 'MAINTAIN WITH GRANT OPTION'
       ))`
    : "false";
  return client.query(
    `WITH accessible_roles(role_oid) AS (
       SELECT candidate.oid
       FROM pg_catalog.pg_roles AS candidate
       WHERE candidate.oid = $1::oid
          OR pg_catalog.pg_has_role($1::oid, candidate.oid, 'MEMBER')
     ), expected_tables(table_name) AS (
       SELECT pg_catalog.unnest($2::text[])
     )
     SELECT expected_tables.table_name,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'SELECT'
            )) AS select,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'INSERT'
            )) AS insert,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'UPDATE'
            )) AS update,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'DELETE'
            )) AS delete,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'TRUNCATE'
            )) AS truncate,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'REFERENCES'
            )) AS references,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'TRIGGER'
            )) AS trigger,
            ${maintainPrivilege} AS maintain,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'SELECT WITH GRANT OPTION'
            )) AS select_grant_option,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'INSERT WITH GRANT OPTION'
            )) AS insert_grant_option,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'UPDATE WITH GRANT OPTION'
            )) AS update_grant_option,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'DELETE WITH GRANT OPTION'
            )) AS delete_grant_option,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'TRUNCATE WITH GRANT OPTION'
            )) AS truncate_grant_option,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'REFERENCES WITH GRANT OPTION'
            )) AS references_grant_option,
            pg_catalog.bool_or(pg_catalog.has_table_privilege(
              accessible_roles.role_oid, relation.oid, 'TRIGGER WITH GRANT OPTION'
            )) AS trigger_grant_option,
            ${maintainGrantOption} AS maintain_grant_option
            , pg_catalog.bool_or(
                pg_catalog.has_any_column_privilege(
                  accessible_roles.role_oid, relation.oid, 'SELECT'
                ) AND NOT pg_catalog.has_table_privilege(
                  accessible_roles.role_oid, relation.oid, 'SELECT'
                )
              ) AS select_column_only
            , pg_catalog.bool_or(
                pg_catalog.has_any_column_privilege(
                  accessible_roles.role_oid, relation.oid, 'INSERT'
                ) AND NOT pg_catalog.has_table_privilege(
                  accessible_roles.role_oid, relation.oid, 'INSERT'
                )
              ) AS insert_column_only
            , pg_catalog.bool_or(
                pg_catalog.has_any_column_privilege(
                  accessible_roles.role_oid, relation.oid, 'UPDATE'
                ) AND NOT pg_catalog.has_table_privilege(
                  accessible_roles.role_oid, relation.oid, 'UPDATE'
                )
              ) AS update_column_only
            , pg_catalog.bool_or(
                pg_catalog.has_any_column_privilege(
                  accessible_roles.role_oid, relation.oid, 'REFERENCES'
                ) AND NOT pg_catalog.has_table_privilege(
                  accessible_roles.role_oid, relation.oid, 'REFERENCES'
                )
              ) AS references_column_only
            , pg_catalog.bool_or(pg_catalog.has_any_column_privilege(
                accessible_roles.role_oid, relation.oid, 'SELECT WITH GRANT OPTION'
              )) AS select_column_grant_option
            , pg_catalog.bool_or(pg_catalog.has_any_column_privilege(
                accessible_roles.role_oid, relation.oid, 'INSERT WITH GRANT OPTION'
              )) AS insert_column_grant_option
            , pg_catalog.bool_or(pg_catalog.has_any_column_privilege(
                accessible_roles.role_oid, relation.oid, 'UPDATE WITH GRANT OPTION'
              )) AS update_column_grant_option
            , pg_catalog.bool_or(pg_catalog.has_any_column_privilege(
                accessible_roles.role_oid, relation.oid, 'REFERENCES WITH GRANT OPTION'
              )) AS references_column_grant_option
     FROM expected_tables
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = 'public'
     JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid
      AND relation.relname = expected_tables.table_name
      AND relation.relkind IN ('r', 'p')
     CROSS JOIN accessible_roles
     GROUP BY expected_tables.table_name, relation.oid
     ORDER BY expected_tables.table_name COLLATE "C" ASC`,
    [runtimeRoleOid, allContractTables]
  );
}

async function assertContractRelations(client: PoolClient): Promise<void> {
  const result = await client.query(
    `SELECT relation.relname AS table_name
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
       AND relation.relname = ANY($1::text[])
     ORDER BY relation.relname COLLATE "C" ASC`,
    [allContractTables]
  );
  const actual = result.rows.map((row) => row.table_name);
  const expected = [...allContractTables].sort((left, right) => left.localeCompare(right, "en"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("The runtime grant relation contract is incomplete.");
  }
}

async function assertRuntimeSchemaPosture(client: PoolClient, runtimeRoleOid: number): Promise<void> {
  const result = await client.query(
    `SELECT pg_catalog.has_schema_privilege($1::oid, 'public', 'USAGE') AS schema_usage,
            EXISTS (
              SELECT 1
              FROM pg_catalog.pg_roles AS candidate
              WHERE (candidate.oid = $1::oid
                  OR pg_catalog.pg_has_role($1::oid, candidate.oid, 'MEMBER'))
                AND pg_catalog.has_schema_privilege(candidate.oid, 'public', 'CREATE')
            ) AS schema_create,
            EXISTS (
              SELECT 1
              FROM pg_catalog.pg_roles AS candidate
              WHERE (candidate.oid = $1::oid
                  OR pg_catalog.pg_has_role($1::oid, candidate.oid, 'MEMBER'))
                AND pg_catalog.has_database_privilege(
                  candidate.oid, current_database(), 'CREATE'
                )
            ) AS database_create,
            EXISTS (
              SELECT 1
              FROM pg_catalog.pg_class AS relation
              JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
              WHERE namespace.nspname = 'public'
                AND pg_catalog.pg_has_role($1::oid, relation.relowner, 'MEMBER')
            ) AS relation_ownership
     `,
    [runtimeRoleOid]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1
    || row?.schema_usage !== true
    || row?.schema_create !== false
    || row?.database_create !== false
    || row?.relation_ownership !== false
  ) {
    throw new Error("The runtime role schema or relation-ownership posture is unsafe.");
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

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
