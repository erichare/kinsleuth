import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { readDatabaseIdentity } from "@/lib/database-attestation";
import { runPendingMigrations } from "@/lib/migrations";
import {
  betaOperationsRuntimeGrantContract,
  buildBetaOperationsGrantStatements,
  grantAndAttestBetaOperationsRuntimeRole,
  protectedRuntimeTableContract,
  validateBetaOperationsPrivilegeRows
} from "@/lib/runtime-database-grants";

const scratchDirectories: string[] = [];
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function privilegeRow(tableName: string, overrides: Record<string, unknown> = {}) {
  const managed = betaOperationsRuntimeGrantContract.some(({ table }) => table === tableName);
  return {
    table_name: tableName,
    select: true,
    insert: managed,
    update: managed,
    delete: false,
    truncate: false,
    references: false,
    trigger: false,
    maintain: false,
    select_grant_option: false,
    insert_grant_option: false,
    update_grant_option: false,
    delete_grant_option: false,
    truncate_grant_option: false,
    references_grant_option: false,
    trigger_grant_option: false,
    maintain_grant_option: false,
    select_column_only: false,
    insert_column_only: false,
    update_column_only: false,
    references_column_only: false,
    select_column_grant_option: false,
    insert_column_grant_option: false,
    update_column_grant_option: false,
    references_column_grant_option: false,
    ...overrides
  };
}

function validPrivilegeRows() {
  return [
    ...betaOperationsRuntimeGrantContract.map(({ table }) => privilegeRow(table)),
    ...protectedRuntimeTableContract.map((table) => privilegeRow(table))
  ];
}

describe("beta operations runtime database grants", () => {
  it("takes the runtime credential only from the parsed pulled Vercel environment", () => {
    const script = readFileSync(
      path.join(process.cwd(), "scripts", "grant-beta-operations-runtime-role.mjs"),
      "utf8"
    );
    expect(script).toContain("files.productionEnvironment.DATABASE_URL");
    expect(script).toContain("process.env.MIGRATION_DATABASE_URL");
    expect(script).not.toContain("process.env.DATABASE_URL");
    expect(script).not.toMatch(/\bsource\b.*\.env\.production\.local/);
  });

  it("contains only the exact required DML and never builds protected-table statements", () => {
    expect(betaOperationsRuntimeGrantContract).toEqual([
      { table: "beta_data_operations", privileges: ["SELECT", "INSERT", "UPDATE"] },
      { table: "beta_worker_heartbeats", privileges: ["SELECT", "INSERT", "UPDATE"] }
    ]);
    const statements = buildBetaOperationsGrantStatements('runtime "role"');
    expect(statements).toEqual([
      'REVOKE ALL PRIVILEGES ON TABLE public."beta_data_operations" FROM "runtime ""role"""',
      'GRANT SELECT, INSERT, UPDATE ON TABLE public."beta_data_operations" TO "runtime ""role"""',
      'REVOKE ALL PRIVILEGES ON TABLE public."beta_worker_heartbeats" FROM "runtime ""role"""',
      'GRANT SELECT, INSERT, UPDATE ON TABLE public."beta_worker_heartbeats" TO "runtime ""role"""'
    ]);
    expect(statements.join("\n")).not.toMatch(/release_write_fences|schema_migrations/);
    expect(statements.join("\n")).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bREFERENCES\b|\bTRIGGER\b|\bMAINTAIN\b/);
  });

  it("accepts only the exact managed and protected privilege posture", () => {
    expect(validateBetaOperationsPrivilegeRows(validPrivilegeRows())).toEqual([
      expect.objectContaining({ table: "beta_data_operations", select: true, insert: true, update: true }),
      expect.objectContaining({ table: "beta_worker_heartbeats", select: true, insert: true, update: true }),
      expect.objectContaining({ table: "release_write_fences", select: true, insert: false, update: false }),
      expect.objectContaining({ table: "schema_migrations", select: true, insert: false, update: false })
    ]);
    expect(() => validateBetaOperationsPrivilegeRows(
      validPrivilegeRows().filter(({ table_name }) => table_name !== "beta_data_operations")
    )).toThrow(/inventory is incomplete/i);
    expect(() => validateBetaOperationsPrivilegeRows(
      validPrivilegeRows().map((row) => row.table_name === "beta_data_operations"
        ? { ...row, delete: true }
        : row)
    )).toThrow(/exact checked-in table privileges/i);
    expect(() => validateBetaOperationsPrivilegeRows(
      validPrivilegeRows().map((row) => row.table_name === "beta_worker_heartbeats"
        ? { ...row, select_grant_option: true }
        : row)
    )).toThrow(/must not hold table grant options/i);
    expect(() => validateBetaOperationsPrivilegeRows(
      validPrivilegeRows().map((row) => row.table_name === "schema_migrations"
        ? { ...row, update: true }
        : row)
    )).toThrow(/exact checked-in table privileges/i);
    expect(() => validateBetaOperationsPrivilegeRows(
      validPrivilegeRows().map((row) => row.table_name === "beta_data_operations"
        ? { ...row, references_column_only: true }
        : row)
    )).toThrow(/separate column privilege paths/i);
  });

  it("keeps pulled dotenv and driver details out of CLI failures", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kinresolve-runtime-grants-"));
    scratchDirectories.push(root);
    mkdirSync(path.join(root, ".vercel"), { recursive: true });
    const sentinel = "do-not-print-this-runtime-grant-secret";
    writeFileSync(
      path.join(root, ".vercel", ".env.production.local"),
      `DATABASE_URL='${sentinel}\n`,
      "utf8"
    );
    const result = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-strip-types",
        path.join(process.cwd(), "scripts", "grant-beta-operations-runtime-role.mjs"),
        path.join(root, "attestation.json")
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: `postgres://migrator:${sentinel}@localhost/postgres`
        }
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Beta operations runtime grant attestation failed.\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel);
  });
});

describeIfDatabase("beta operations runtime grants against PostgreSQL", () => {
  it("repairs only the two post-migration tables and re-attests exact effective access", async () => {
    const suffix = `${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const roleName = `kr_runtime_grant_${suffix}`;
    const extraRoleName = `kr_extra_${suffix}`;
    const archiveId = `kr_grant_archive_${suffix}`;
    const password = `kr-test-${randomUUID().replaceAll("-", "")}`;
    const quotedRole = quoteIdentifier(roleName);
    const quotedExtraRole = quoteIdentifier(extraRoleName);
    const pool = new Pool({ connectionString: databaseUrl!, max: 2 });
    let roleCreated = false;
    let extraRoleCreated = false;

    try {
      await runPendingMigrations(pool);
      const databaseResult = await pool.query<{ database_name: string }>(
        "SELECT current_database()::text AS database_name"
      );
      const databaseName = databaseResult.rows[0]?.database_name;
      if (!databaseName) throw new Error("The disposable runtime grant database is unavailable.");

      await pool.query(
        `CREATE ROLE ${quotedRole}
         LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT BYPASSRLS
         PASSWORD ${quoteLiteral(password)}`
      );
      roleCreated = true;
      await pool.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quotedRole}`);
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
      await pool.query(`REVOKE CREATE ON SCHEMA public FROM ${quotedRole}`);
      await pool.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole}`
      );
      await pool.query(`REVOKE ALL ON TABLE public.release_write_fences FROM ${quotedRole}`);
      await pool.query(`GRANT SELECT ON TABLE public.release_write_fences TO ${quotedRole}`);
      await pool.query(`REVOKE ALL ON TABLE public.schema_migrations FROM ${quotedRole}`);
      await pool.query(`GRANT SELECT ON TABLE public.schema_migrations TO ${quotedRole}`);
      for (const { table } of betaOperationsRuntimeGrantContract) {
        await pool.query(`REVOKE ALL ON TABLE public.${quoteIdentifier(table)} FROM ${quotedRole}`);
      }
      await pool.query(
        `INSERT INTO public.archives (id, name, slug, dataset_mode)
         VALUES ($1, 'Runtime grant fixture', $2, 'pilot')`,
        [archiveId, `${archiveId}-slug`]
      );

      const identity = await readDatabaseIdentity(pool);
      const runtimeUrl = new URL(databaseUrl!);
      runtimeUrl.username = roleName;
      runtimeUrl.password = password;
      await pool.query(`CREATE ROLE ${quotedExtraRole} NOLOGIN`);
      extraRoleCreated = true;
      await pool.query(`GRANT ${quotedExtraRole} TO ${quotedRole}`);
      await pool.query(
        `GRANT DELETE ON TABLE public.beta_data_operations TO ${quotedExtraRole}`
      );
      await expect(grantAndAttestBetaOperationsRuntimeRole({
        runtimeDatabaseUrl: runtimeUrl.toString(),
        migrationDatabaseUrl: databaseUrl!,
        expectedDatabaseIdentity: identity.fingerprint,
        expectedArchiveId: archiveId
      })).rejects.toThrow(/exact checked-in table privileges/i);
      await expect(pool.query<{ can_select: boolean }>(
        `SELECT pg_catalog.has_table_privilege($1, 'public.beta_data_operations', 'SELECT')
           AS can_select`,
        [roleName]
      )).resolves.toMatchObject({ rows: [{ can_select: false }] });
      await pool.query(`REVOKE ${quotedExtraRole} FROM ${quotedRole}`);
      await pool.query(`DROP OWNED BY ${quotedExtraRole}`);
      await pool.query(`DROP ROLE ${quotedExtraRole}`);
      extraRoleCreated = false;

      const receipt = await grantAndAttestBetaOperationsRuntimeRole({
        runtimeDatabaseUrl: runtimeUrl.toString(),
        migrationDatabaseUrl: databaseUrl!,
        expectedDatabaseIdentity: identity.fingerprint,
        expectedArchiveId: archiveId
      });

      expect(receipt).toMatchObject({
        schemaVersion: 1,
        grantContract: "beta-operations-v1",
        databaseIdentity: identity.fingerprint,
        credentialsDistinct: true,
        sameDatabaseSessionVerified: true,
        safeRuntimeRoleReattested: true,
        databaseCreate: false,
        publicSchemaUsage: true,
        publicSchemaCreate: false,
        exactPrivilegesAttested: true,
        representativeAppWriteRolledBack: true,
        persistentDataMutation: false
      });
      expect(receipt.managedTablePrivileges).toHaveLength(2);
      expect(receipt.protectedTablePrivileges).toHaveLength(2);

      const runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });
      try {
        await expect(runtimePool.query(
          `INSERT INTO public.beta_worker_heartbeats
             (archive_id, worker_kind, last_outcome, last_request_id, last_started_at)
           VALUES ($1, 'retention-cleanup', 'running', $2::uuid, now())`,
          [archiveId, randomUUID()]
        )).resolves.toMatchObject({ rowCount: 1 });
        await expect(runtimePool.query(
          "DELETE FROM public.beta_worker_heartbeats WHERE archive_id = $1",
          [archiveId]
        )).rejects.toThrow();
      } finally {
        await runtimePool.end();
      }
    } finally {
      await pool.query("DELETE FROM public.beta_worker_heartbeats WHERE archive_id = $1", [archiveId])
        .catch(() => undefined);
      await pool.query("DELETE FROM public.archives WHERE id = $1", [archiveId]).catch(() => undefined);
      if (extraRoleCreated) {
        await pool.query(`REVOKE ${quotedExtraRole} FROM ${quotedRole}`).catch(() => undefined);
        await pool.query(`DROP OWNED BY ${quotedExtraRole}`).catch(() => undefined);
        await pool.query(`DROP ROLE ${quotedExtraRole}`).catch(() => undefined);
      }
      if (roleCreated) {
        await pool.query(`DROP OWNED BY ${quotedRole}`);
        await pool.query(`DROP ROLE ${quotedRole}`);
      }
      await pool.end();
    }
  });
});

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("Unsafe PostgreSQL test identifier.");
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  if (!/^[A-Za-z0-9-]{16,128}$/.test(value)) throw new Error("Unsafe PostgreSQL test literal.");
  return `'${value}'`;
}
