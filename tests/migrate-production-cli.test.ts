import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { describeMigrationFailure } from "@/lib/migration-failure";

const script = path.join(process.cwd(), "scripts", "migrate-production.mjs");

function runProductionMigrate(extraEnvironment: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, ["--experimental-strip-types", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ...extraEnvironment,
      NODE_ENV: "test"
    },
    timeout: 60_000
  });
}

// Binds an ephemeral loopback port and releases it so the production migrate
// CLI can be pointed at a port that is known to refuse connections.
async function reserveClosedPort(): Promise<number> {
  const server = net.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
  server.close();
  await once(server, "close");
  return port;
}

describe("describeMigrationFailure for production migrations", () => {
  const migrationDatabaseUrl = "postgres://kinresolve:do-not-print@db.internal:5432/kinresolve";

  it("names MIGRATION_DATABASE_URL and the redacted target for connection failures", () => {
    const refused = Object.assign(new Error(""), { code: "ECONNREFUSED" });
    const described = describeMigrationFailure(refused, migrationDatabaseUrl, "MIGRATION_DATABASE_URL");
    expect(described).toContain(
      "Cannot reach MIGRATION_DATABASE_URL at db.internal:5432/kinresolve (ECONNREFUSED)"
    );
    expect(described).toContain("fix MIGRATION_DATABASE_URL");
    expect(described).not.toContain("do-not-print");
  });

  it("names MIGRATION_DATABASE_URL when the URL is missing or unparseable", () => {
    const refused = Object.assign(new Error(""), { code: "ECONNREFUSED" });
    expect(describeMigrationFailure(refused, undefined, "MIGRATION_DATABASE_URL")).toContain(
      "the database configured in MIGRATION_DATABASE_URL"
    );
    expect(describeMigrationFailure(refused, "not a url", "MIGRATION_DATABASE_URL")).toContain(
      "the database configured in MIGRATION_DATABASE_URL"
    );
  });

  it("names MIGRATION_DATABASE_URL for missing databases and failed authentication", () => {
    expect(
      describeMigrationFailure(Object.assign(new Error("boom"), { code: "3D000" }), migrationDatabaseUrl, "MIGRATION_DATABASE_URL")
    ).toContain("fix MIGRATION_DATABASE_URL");
    expect(
      describeMigrationFailure(Object.assign(new Error("boom"), { code: "28P01" }), migrationDatabaseUrl, "MIGRATION_DATABASE_URL")
    ).toContain("check the MIGRATION_DATABASE_URL credentials");
  });

  it("still names DATABASE_URL when no variable name is given", () => {
    const refused = Object.assign(new Error(""), { code: "ECONNREFUSED" });
    expect(describeMigrationFailure(refused, undefined)).toContain(
      "the database configured in DATABASE_URL"
    );
  });

  it("passes the fixed production wrapper messages through unchanged", () => {
    for (const message of [
      "Production migration preflight failed.",
      "Production migration failed.",
      "Production migration ledger verification failed."
    ]) {
      expect(describeMigrationFailure(new Error(message), migrationDatabaseUrl, "MIGRATION_DATABASE_URL")).toBe(
        message
      );
    }
  });

  it("renders the redacted cannot-reach line for connection-classified wrapper failures", () => {
    const wrapped = Object.assign(
      new Error("Production migration preflight failed: cannot reach the configured database (ECONNREFUSED)."),
      { code: "ECONNREFUSED" }
    );
    const described = describeMigrationFailure(wrapped, migrationDatabaseUrl, "MIGRATION_DATABASE_URL");
    expect(described).toContain(
      "Cannot reach MIGRATION_DATABASE_URL at db.internal:5432/kinresolve (ECONNREFUSED)"
    );
    expect(described).not.toContain("do-not-print");
  });

  it("never returns a blank line for an empty-message failure", () => {
    const dualStackFailure = new AggregateError([Object.assign(new Error(""), { code: "EUNRECOGNIZED" })]);
    for (const failure of [new Error(""), dualStackFailure]) {
      const described = describeMigrationFailure(failure, migrationDatabaseUrl, "MIGRATION_DATABASE_URL");
      expect(described.trim()).not.toBe("");
      expect(described).toContain("without an error message");
    }
  });
});

describe("db:migrate:production CLI", () => {
  it("routes catch output through describeMigrationFailure", async () => {
    const productionScript = await readFile(script, "utf8");
    expect(productionScript).toContain(
      'describeMigrationFailure(error, process.env.MIGRATION_DATABASE_URL, "MIGRATION_DATABASE_URL")'
    );
    expect(productionScript).not.toContain("error instanceof Error ? error.message");
  });

  it("requires MIGRATION_DATABASE_URL before connecting", () => {
    const result = runProductionMigrate();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MIGRATION_DATABASE_URL is required for production migrations.");
  });

  it("prints an actionable, credential-free failure when the database is unreachable", async () => {
    const port = await reserveClosedPort();
    const result = runProductionMigrate({
      MIGRATION_DATABASE_URL: `postgres://kinresolve:do-not-print@localhost:${port}/kinresolve`,
      EXPECTED_ARCHIVE_ID: "kinresolve",
      KINRESOLVE_DATABASE_IDENTITY: "a".repeat(64)
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `Cannot reach MIGRATION_DATABASE_URL at localhost:${port}/kinresolve (ECONNREFUSED)`
    );
    expect(result.stderr).toContain("fix MIGRATION_DATABASE_URL");
    expect(result.stderr).not.toContain("Production migration preflight failed.");
    expect(result.stderr).not.toContain("do-not-print");
  });
});
