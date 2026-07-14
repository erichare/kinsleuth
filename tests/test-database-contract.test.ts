import packageJson from "../package.json";
import { describe, expect, it } from "vitest";

import { validateReleaseUpgradeDatabase } from "@/lib/test-database-contract";

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
