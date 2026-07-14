import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import packageJson from "../package.json";
import { describe, expect, it } from "vitest";

import { validateReleaseUpgradeDatabase, validateTestDatabase } from "@/lib/test-database-contract";

describe("complete database test contract", () => {
  it("requires an explicit TEST_DATABASE_URL", () => {
    expect(() => validateTestDatabase({})).toThrow(/TEST_DATABASE_URL is required/i);
  });

  it("rejects invalid URLs and the application database", () => {
    expect(() => validateTestDatabase({ testDatabaseUrl: "not a URL" })).toThrow(/valid PostgreSQL URL/i);
    expect(() =>
      validateTestDatabase({
        testDatabaseUrl: "postgres://tester@localhost/shared",
        databaseUrl: "postgresql://app@127.0.0.1:5432/shared?sslmode=disable"
      })
    ).toThrow(/same database as DATABASE_URL/i);
    expect(() =>
      validateTestDatabase({
        testDatabaseUrl: "postgres://tester@localhost/%73hared",
        databaseUrl: "postgres://app@127.0.0.1:5432/shared"
      })
    ).toThrow(/same database as DATABASE_URL/i);
  });

  it("loads the normal local .env before checking database separation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kinresolve-test-database-"));
    const script = path.join(process.cwd(), "scripts", "require-test-database.mjs");
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      TEST_DATABASE_URL: "postgres://tester@localhost/shared"
    };
    delete environment.DATABASE_URL;

    try {
      writeFileSync(path.join(root, ".env"), "DATABASE_URL=postgres://app@127.0.0.1:5432/shared\n", "utf8");
      const result = spawnSync(process.execPath, ["--experimental-strip-types", script], {
        cwd: root,
        encoding: "utf8",
        env: environment
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/same database as DATABASE_URL/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a distinct PostgreSQL test database", () => {
    expect(() =>
      validateTestDatabase({
        testDatabaseUrl: "postgres://tester@localhost/test_database",
        databaseUrl: "postgres://app@localhost/application"
      })
    ).not.toThrow();
  });

  it("makes test:db fail closed and run the complete Vitest suite", () => {
    expect(packageJson.scripts["test:db"]).toBe(
      "node --experimental-strip-types scripts/require-test-database.mjs && vitest run --no-file-parallelism"
    );
  });
});

describe("release upgrade database contract", () => {
  it("requires an explicit release-upgrade database URL", () => {
    expect(() => validateReleaseUpgradeDatabase({})).toThrow(/TEST_RELEASE_UPGRADE_DATABASE_URL is required/i);
  });

  it("rejects invalid, non-PostgreSQL, and remote URLs", () => {
    expect(() => validateReleaseUpgradeDatabase({ releaseDatabaseUrl: "not a URL" })).toThrow(/valid PostgreSQL URL/i);
    expect(() => validateReleaseUpgradeDatabase({ releaseDatabaseUrl: "https://localhost/release" })).toThrow(/PostgreSQL URL/i);
    expect(() =>
      validateReleaseUpgradeDatabase({ releaseDatabaseUrl: "postgres://tester@example.com/release" })
    ).toThrow(/remote databases are refused/i);
  });

  it("recognizes the same loopback database across aliases and credentials", () => {
    expect(() =>
      validateReleaseUpgradeDatabase({
        releaseDatabaseUrl: "postgres://release-user:one@localhost:5432/shared_db?sslmode=disable",
        testDatabaseUrl: "postgresql://test-user:two@127.0.0.1/shared_db"
      })
    ).toThrow(/same database as TEST_DATABASE_URL/i);
  });

  it("rejects query parameters that override PostgreSQL connection routing", () => {
    expect(() =>
      validateReleaseUpgradeDatabase({
        releaseDatabaseUrl: "postgres://release-user@localhost/release_control?host=production.example.com"
      })
    ).toThrow(/connection query parameter.*host/i);
    expect(() =>
      validateReleaseUpgradeDatabase({
        releaseDatabaseUrl: "postgres://release-user@localhost/release_control?port=6543"
      })
    ).toThrow(/connection query parameter.*port/i);
  });

  it("accepts a distinct local control database", () => {
    expect(() =>
      validateReleaseUpgradeDatabase({
        releaseDatabaseUrl: "postgres://release-user:one@127.0.0.1:5432/release_control",
        testDatabaseUrl: "postgres://test-user:two@localhost:5432/test_database",
        databaseUrl: "postgres://app-user:three@localhost:5432/application"
      })
    ).not.toThrow();
  });

  it("makes the dedicated package command fail closed before Vitest", () => {
    expect(packageJson.scripts["test:release-upgrade"]).toMatch(
      /^node --experimental-strip-types scripts\/require-release-upgrade-database\.mjs && /
    );
  });
});
