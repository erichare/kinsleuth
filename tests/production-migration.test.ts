import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import packageJson from "../package.json";
import {
  computeDatabaseIdentity,
  databaseIdentityQuery
} from "@/lib/database-attestation";
import {
  runProductionMigrationLedgerVerification,
  runProductionMigrations,
  validateProductionMigrationEnvironment,
  validateProductionMigrationLedger,
  validateProductionMigrationLedgerPrefix
} from "@/lib/production-migration";
import { migrationLedgerSha256 } from "@/lib/release-readiness";

const archiveId = "kinresolve-pilot-01";
const catalogIdentity = {
  system_identifier: "7543210987654321098",
  database_oid: "16384",
  database_name: "postgres"
};
const databaseIdentity = computeDatabaseIdentity({
  systemIdentifier: catalogIdentity.system_identifier,
  databaseOid: catalogIdentity.database_oid,
  databaseName: catalogIdentity.database_name
}).fingerprint;
const localMigrationUrl = "postgresql://migrator:secret@postgres:5432/postgres";

function environment(connectionString = localMigrationUrl) {
  return {
    MIGRATION_DATABASE_URL: connectionString,
    EXPECTED_ARCHIVE_ID: archiveId,
    KINRESOLVE_DATABASE_IDENTITY: databaseIdentity
  };
}

function environmentWithEvidence(versions: string[], connectionString = localMigrationUrl) {
  return {
    ...environment(connectionString),
    EXPECTED_MIGRATION_PREFIX_COUNT: String(versions.length),
    EXPECTED_MIGRATION_PREFIX_LEDGER_SHA256: migrationLedgerSha256(versions)
  };
}

function queryFixture(input: {
  ledger?: string[];
  archiveMatches?: boolean;
  identity?: typeof catalogIdentity;
  ledgerExists?: boolean;
} = {}) {
  const ledger = input.ledger ?? ["001_initial"];
  return vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === databaseIdentityQuery) {
      return { rows: [input.identity ?? catalogIdentity] };
    }
    if (sql.includes("to_regclass('public.archives')")) {
      return {
        rows: [{
          archives_exists: true,
          ledger_exists: input.ledgerExists ?? true
        }]
      };
    }
    if (sql.includes("FROM public.archives WHERE id = $1")) {
      expect(values).toEqual([archiveId]);
      return { rows: input.archiveMatches === false ? [] : [{ id: archiveId }] };
    }
    if (sql.includes("SELECT version FROM schema_migrations")) {
      return { rows: ledger.map((version) => ({ version })) };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
}

function thrownMessage(callback: () => unknown): string {
  try {
    callback();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected validation to fail.");
}

describe("production migration safety", () => {
  it("requires the dedicated migration URL and both release-cell identities", () => {
    expect(() => validateProductionMigrationEnvironment({})).toThrow(/MIGRATION_DATABASE_URL is required/i);
    expect(() => validateProductionMigrationEnvironment({
      MIGRATION_DATABASE_URL: localMigrationUrl,
      KINRESOLVE_DATABASE_IDENTITY: databaseIdentity
    })).toThrow(/EXPECTED_ARCHIVE_ID/i);
    expect(() => validateProductionMigrationEnvironment({
      MIGRATION_DATABASE_URL: localMigrationUrl,
      EXPECTED_ARCHIVE_ID: archiveId
    })).toThrow(/KINRESOLVE_DATABASE_IDENTITY.*SHA-256/i);
  });

  it("accepts a local direct connection and upgrades Supabase direct/session TLS to verify-full", () => {
    expect(validateProductionMigrationEnvironment(environment())).toEqual({
      connectionString: localMigrationUrl,
      hostname: "postgres",
      databaseName: "postgres"
    });

    for (const connectionString of [
      "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=disable",
      "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
    ]) {
      const target = validateProductionMigrationEnvironment(environment(connectionString));
      const parsed = new URL(target.connectionString);
      expect(parsed.searchParams.get("sslmode")).toBe("verify-full");
      expect(parsed.searchParams.get("sslrootcert")).toContain("supabase-prod-ca-2021.crt");
    }
  });

  it("rejects unsafe targets and routing overrides without echoing credentials", () => {
    const secret = "migration-secret-never-log";
    for (const value of [
      `not-a-url-${secret}`,
      `https://migrator:${secret}@db.example.com/kinresolve`,
      `postgresql:///kinresolve?password=${secret}`,
      `postgresql://migrator:${secret}@db.example.com`,
      `postgresql://migrator:${secret}@db.example.com/kinresolve`,
      `postgresql://migrator:${secret}@db.example.com/kinresolve?sslmode=disable`,
      `postgresql://migrator:${secret}@db.example.com/kinresolve?host=other.example.com`
    ]) {
      const message = thrownMessage(() => validateProductionMigrationEnvironment(environment(value)));
      expect(message).not.toContain(secret);
    }
  });

  it("refuses the transaction pooler but accepts an explicitly verified remote connection", () => {
    expect(() => validateProductionMigrationEnvironment(environment(
      "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
    ))).toThrow(/transaction pooler/i);

    expect(() => validateProductionMigrationEnvironment(environment(
      "postgresql://migrator:secret@db.example.com:5432/kinresolve?sslmode=verify-full&sslrootcert=%2Ftmp%2Fca.pem"
    ))).not.toThrow();
  });

  it("accepts only an exact final ledger and an exact ordered preflight prefix", () => {
    const expected = ["001_initial", "002_search_unaccent", "003_auth_accounts"];
    expect(validateProductionMigrationLedger(expected, expected)).toEqual({ migrationCount: 3 });
    expect(validateProductionMigrationLedgerPrefix(expected, ["001_initial"])).toEqual({ migrationCount: 1 });
    expect(validateProductionMigrationLedgerPrefix(expected, [])).toEqual({ migrationCount: 0 });

    expect(() => validateProductionMigrationLedger(expected, expected.slice(0, 2)))
      .toThrow(/does not exactly match/i);
    expect(() => validateProductionMigrationLedgerPrefix(expected, ["002_search_unaccent"]))
      .toThrow(/approved release-policy prefix/i);
    expect(() => validateProductionMigrationLedgerPrefix(expected, ["001_initial", "999_unapproved"]))
      .toThrow(/approved release-policy prefix/i);
  });

  it("attests identity, archive, and ledger prefix before invoking migration code", async () => {
    const query = queryFixture({ ledger: ["001_initial"] });
    const pool = { query, end: vi.fn(async () => undefined) };
    const migrate = vi.fn(async () => ({
      applied: ["002_search_unaccent"],
      alreadyApplied: ["001_initial"]
    }));
    const log = vi.fn();

    await expect(runProductionMigrations({
      environment: environmentWithEvidence(["001_initial"]),
      expectedVersions: ["001_initial", "002_search_unaccent"],
      createPool: () => pool,
      migrate,
      log
    })).resolves.toEqual({
      applied: ["002_search_unaccent"],
      alreadyApplied: ["001_initial"]
    });

    expect(migrate).toHaveBeenCalledOnce();
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      databaseIdentityQuery,
      expect.stringContaining("to_regclass('public.archives')"),
      expect.stringContaining("FROM public.archives WHERE id = $1"),
      'SELECT version FROM schema_migrations ORDER BY version COLLATE "C" ASC'
    ]);
    expect(pool.end).toHaveBeenCalledOnce();
    expect(log.mock.calls).toEqual([
      ["Verified production migration preflight: approved ledger prefix and expected archive identity."],
      ["applied 002_search_unaccent"],
      ["Applied 1 migration(s); 1 already recorded."]
    ]);
  });

  it("refuses to migrate when production no longer matches the exact evidenced recovery prefix", async () => {
    for (const migrationEnvironment of [
      environmentWithEvidence(["001_initial", "002_search_unaccent"]),
      { ...environment(), EXPECTED_MIGRATION_PREFIX_COUNT: "1" },
      {
        ...environment(),
        EXPECTED_MIGRATION_PREFIX_COUNT: "1",
        EXPECTED_MIGRATION_PREFIX_LEDGER_SHA256: "f".repeat(64)
      }
    ]) {
      const pool = {
        query: queryFixture({ ledger: ["001_initial"] }),
        end: vi.fn(async () => undefined)
      };
      const migrate = vi.fn(async () => ({ applied: [], alreadyApplied: ["001_initial"] }));
      await expect(runProductionMigrations({
        environment: migrationEnvironment,
        expectedVersions: ["001_initial", "002_search_unaccent"],
        createPool: () => pool,
        migrate,
        log: vi.fn()
      })).rejects.toThrow(/^Production migration preflight failed\.$/);
      expect(migrate).not.toHaveBeenCalled();
    }
  });

  it("accepts an exact full-ledger evidenced prefix as a no-op first-cutover migration", async () => {
    const versions = ["001_initial", "013_release_write_fence"];
    const pool = {
      query: queryFixture({ ledger: versions }),
      end: vi.fn(async () => undefined)
    };
    const migrate = vi.fn(async () => ({ applied: [], alreadyApplied: versions }));

    await expect(runProductionMigrations({
      environment: environmentWithEvidence(versions),
      expectedVersions: versions,
      createPool: () => pool,
      migrate,
      log: vi.fn()
    })).resolves.toEqual({ applied: [], alreadyApplied: versions });
    expect(migrate).toHaveBeenCalledOnce();
  });

  it.each([
    ["database identity", { identity: { ...catalogIdentity, database_oid: "16385" } }],
    ["archive identity", { archiveMatches: false }],
    ["ledger order", { ledger: ["002_search_unaccent"] }]
  ])("fails the %s preflight without invoking migration", async (_label, fixture) => {
    const pool = { query: queryFixture(fixture), end: vi.fn(async () => undefined) };
    const migrate = vi.fn(async () => ({ applied: [], alreadyApplied: [] }));

    await expect(runProductionMigrations({
      environment: environment(),
      expectedVersions: ["001_initial", "002_search_unaccent"],
      createPool: () => pool,
      migrate,
      log: vi.fn()
    })).rejects.toThrow(/^Production migration preflight failed\.$/);
    expect(migrate).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("closes the pool and replaces execution failures with a secret-free error", async () => {
    const secret = "driver-error-secret-never-log";
    const pool = { query: queryFixture(), end: vi.fn(async () => undefined) };
    try {
      await runProductionMigrations({
        environment: environment(),
        expectedVersions: ["001_initial"],
        createPool: () => pool,
        migrate: async () => { throw new Error(secret); },
        log: vi.fn()
      });
      throw new Error("Expected migration execution to fail.");
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).toBe("Production migration failed.");
      expect(String(error)).not.toContain(secret);
    }
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("surfaces only the allowlisted syscall code when the preflight cannot reach the database", async () => {
    const secret = "connection-secret-never-log";
    const refused = new AggregateError(
      [Object.assign(new Error(`connect ECONNREFUSED 10.0.0.9:5432 ${secret}`), { code: "ECONNREFUSED" })],
      ""
    );
    const pool = {
      query: vi.fn(async () => { throw refused; }),
      end: vi.fn(async () => undefined)
    };
    const migrate = vi.fn(async () => ({ applied: [], alreadyApplied: [] }));

    const failure = await runProductionMigrations({
      environment: environment(),
      expectedVersions: ["001_initial"],
      createPool: () => pool,
      migrate,
      log: vi.fn()
    }).then(
      () => { throw new Error("Expected the preflight to fail."); },
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "Production migration preflight failed: cannot reach the configured database (ECONNREFUSED)."
    );
    expect((failure as Error & { code?: string }).code).toBe("ECONNREFUSED");
    expect(String(failure)).not.toContain(secret);
    expect(String(failure)).not.toContain("10.0.0.9");
    expect(migrate).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("labels a connection drop during migration execution with only the syscall code", async () => {
    const pool = { query: queryFixture(), end: vi.fn(async () => undefined) };

    await expect(runProductionMigrations({
      environment: environment(),
      expectedVersions: ["001_initial"],
      createPool: () => pool,
      migrate: async () => {
        throw Object.assign(new Error("read ECONNRESET by 10.0.0.9"), { code: "ECONNRESET" });
      },
      log: vi.fn()
    })).rejects.toMatchObject({
      message: "Production migration failed: cannot reach the configured database (ECONNRESET).",
      code: "ECONNRESET"
    });
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("keeps non-connection driver failures fully opaque", async () => {
    const secret = "auth-secret-never-log";
    const pool = {
      query: vi.fn(async () => {
        throw Object.assign(new Error(`password authentication failed ${secret}`), { code: "28P01" });
      }),
      end: vi.fn(async () => undefined)
    };

    const failure = await runProductionMigrations({
      environment: environment(),
      expectedVersions: ["001_initial"],
      createPool: () => pool,
      migrate: vi.fn(async () => ({ applied: [], alreadyApplied: [] })),
      log: vi.fn()
    }).then(
      () => { throw new Error("Expected the preflight to fail."); },
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Production migration preflight failed.");
    expect((failure as Error & { code?: string }).code).toBeUndefined();
    expect(String(failure)).not.toContain(secret);
  });

  it("labels an unreachable database during ledger verification with only the syscall code", async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new AggregateError([Object.assign(new Error(""), { code: "ENOTFOUND" })], "");
      }),
      end: vi.fn(async () => undefined)
    };

    await expect(runProductionMigrationLedgerVerification({
      environment: environment(),
      expectedVersions: ["001_initial"],
      createPool: () => pool,
      log: vi.fn()
    })).rejects.toMatchObject({
      message: "Production migration ledger verification failed: cannot reach the configured database (ENOTFOUND).",
      code: "ENOTFOUND"
    });
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("attests the same cell before exact post-migration ledger verification", async () => {
    const query = queryFixture({ ledger: ["001_initial", "002_search_unaccent"] });
    const pool = { query, end: vi.fn(async () => undefined) };
    const log = vi.fn();

    await expect(runProductionMigrationLedgerVerification({
      environment: environment(),
      expectedVersions: ["001_initial", "002_search_unaccent"],
      createPool: () => pool,
      log
    })).resolves.toEqual({ migrationCount: 2 });
    expect(pool.end).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "Verified production migration ledger: 2 expected migration(s) applied."
    );
  });

  it("keeps self-hosted migration separate and exposes dedicated production commands", async () => {
    expect(packageJson.scripts["db:migrate"]).toBe("node --experimental-strip-types scripts/migrate.mjs");
    expect(packageJson.scripts["db:migrate:production"]).toContain("scripts/migrate-production.mjs");
    expect(packageJson.scripts["db:migrations:verify-production"]).toContain("verify-production-migrations.mjs");
    expect(packageJson.scripts["db:identity"]).toContain("database-identity.mjs");

    const productionScript = await readFile(path.join(process.cwd(), "scripts", "migrate-production.mjs"), "utf8");
    expect(productionScript).toContain("loadReleasePolicy");
    expect(productionScript).toContain("runProductionMigrations");
    expect(productionScript).toContain("runPendingMigrations");
  });
});
