import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { describeProvisioningFailure, resolveProvisioningMode } from "@/scripts/provision-archive-command";

describe("archive provisioning command", () => {
  it.each(["empty", "demo", "pilot"] as const)("accepts an explicit --mode %s", (datasetMode) => {
    expect(resolveProvisioningMode(["--mode", datasetMode], {})).toBe(datasetMode);
  });

  it("accepts an explicitly configured dataset mode", () => {
    expect(
      resolveProvisioningMode([], {
        KINRESOLVE_DEPLOYMENT_MODE: "hosted",
        KINRESOLVE_DATASET_MODE: "pilot"
      })
    ).toBe("pilot");
  });

  it("requires an explicit mode instead of inheriting the self-hosted demo default", () => {
    expect(() => resolveProvisioningMode([], {})).toThrow(/explicit.*mode/i);
  });

  it("rejects invalid arguments and configuration disagreement", () => {
    expect(() => resolveProvisioningMode(["demo"], {})).toThrow(/--mode/i);
    expect(() => resolveProvisioningMode(["--mode", "seed"], {})).toThrow(/empty, demo, or pilot/i);
    expect(() => resolveProvisioningMode(["--mode"], {})).toThrow(/value/i);
    expect(() =>
      resolveProvisioningMode(["--mode", "demo"], {
        KINRESOLVE_DEPLOYMENT_MODE: "hosted",
        KINRESOLVE_DATASET_MODE: "pilot"
      })
    ).toThrow(/configured.*pilot.*requested.*demo/i);
  });

  it("publishes one package command through the plain JavaScript launcher", async () => {
    const [packageSource, launcherSource] = await Promise.all([
      readFile("package.json", "utf8"),
      readFile("scripts/provision-archive.mjs", "utf8")
    ]);
    const packageJson = JSON.parse(packageSource) as { scripts: Record<string, string> };

    expect(packageJson.scripts["archive:provision"]).toBe("node scripts/provision-archive.mjs");
    expect(launcherSource).toContain('"--import", "tsx", "scripts/provision-archive-command.ts"');
  });

  it("reports abnormal launcher outcomes instead of exiting silently", async () => {
    const launcherSource = await readFile("scripts/provision-archive.mjs", "utf8");

    expect(launcherSource).toContain("Unable to start the Kin Resolve archive provisioning command");
    expect(launcherSource).toContain("terminated by");
  });
});

describe("archive provisioning failure messages", () => {
  const databaseUrl = "postgres://kinsleuth:do-not-print@localhost:5432/kinsleuth";

  it("explains an unreachable database even when the AggregateError message is empty", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const error = new AggregateError([refused], "");

    const message = describeProvisioningFailure(error, databaseUrl);

    expect(message).toContain("Cannot reach DATABASE_URL at localhost:5432/kinsleuth (ECONNREFUSED)");
    expect(message).toContain("docker compose up -d postgres");
  });

  it.each(["ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH"])("explains a %s connection failure", (code) => {
    const message = describeProvisioningFailure(Object.assign(new Error(""), { code }), databaseUrl);

    expect(message).toContain(`Cannot reach DATABASE_URL at localhost:5432/kinsleuth (${code})`);
  });

  it("explains a pg connection timeout that carries no error code", () => {
    const message = describeProvisioningFailure(new Error("timeout exceeded when trying to connect"), databaseUrl);

    expect(message).toContain("Cannot reach DATABASE_URL at localhost:5432/kinsleuth (connection timeout)");
  });

  it("points a missing schema at the migration runner", () => {
    const error = Object.assign(new Error('relation "archives" does not exist'), { code: "42P01" });

    expect(describeProvisioningFailure(error, databaseUrl)).toBe(
      "Schema missing at localhost:5432/kinsleuth — run npm run db:migrate first."
    );
  });

  it("explains a missing database and bad credentials", () => {
    const missingDatabase = Object.assign(new Error('database "kinsleuth" does not exist'), { code: "3D000" });
    const badPassword = Object.assign(new Error("password authentication failed"), { code: "28P01" });

    expect(describeProvisioningFailure(missingDatabase, databaseUrl)).toContain("Database missing at localhost:5432/kinsleuth");
    expect(describeProvisioningFailure(missingDatabase, databaseUrl)).toContain("npm run db:migrate");
    expect(describeProvisioningFailure(badPassword, databaseUrl)).toContain("Database authentication failed");
  });

  it("never echoes DATABASE_URL credentials", () => {
    const errors = [
      Object.assign(new Error(""), { code: "ECONNREFUSED" }),
      Object.assign(new Error(""), { code: "42P01" }),
      Object.assign(new Error(""), { code: "28P01" })
    ];

    for (const error of errors) {
      expect(describeProvisioningFailure(error, databaseUrl)).not.toContain("do-not-print");
    }
  });

  it("keeps validation messages verbatim and never returns an empty line", () => {
    const validation = new Error("DATABASE_URL is required for archive provisioning.");
    expect(describeProvisioningFailure(validation, undefined)).toBe(validation.message);

    expect(describeProvisioningFailure(new Error(""), databaseUrl)).toMatch(/failed without an error message/);
    expect(describeProvisioningFailure(null, databaseUrl).trim()).not.toBe("");
  });

  it("falls back to a generic target for unparseable DATABASE_URL values", () => {
    const error = Object.assign(new Error(""), { code: "ECONNREFUSED" });

    expect(describeProvisioningFailure(error, "not a url")).toContain("the database configured in DATABASE_URL");
    expect(describeProvisioningFailure(error, undefined)).toContain("the database configured in DATABASE_URL");
  });
});

describe("archive provisioning command process", () => {
  const command = path.join(process.cwd(), "scripts", "provision-archive-command.ts");
  const launcher = path.join(process.cwd(), "scripts", "provision-archive.mjs");

  function run(script: string, environment: Record<string, string | undefined>) {
    return spawnSync(process.execPath, ["--import", "tsx", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { PATH: process.env.PATH, NODE_ENV: "test", ...environment }
    });
  }

  it("prints one actionable line when DATABASE_URL is unreachable", { timeout: 30_000 }, () => {
    // Port 1 requires root to bind, so nothing listens there; a stopped
    // docker compose postgres produces the same ECONNREFUSED AggregateError.
    const result = spawnSync(process.execPath, ["--import", "tsx", command, "--mode", "demo"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DATABASE_URL: "postgres://kinsleuth:do-not-print@localhost:1/kinsleuth",
        KINSLEUTH_ARCHIVE_ID: "archive-default"
      }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot reach DATABASE_URL at localhost:1/kinsleuth");
    expect(result.stderr).not.toContain("do-not-print");
  });

  it("surfaces command stderr and the exit code through the launcher", { timeout: 30_000 }, () => {
    const result = run(launcher, {});

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is required for archive provisioning.");
  });
});
