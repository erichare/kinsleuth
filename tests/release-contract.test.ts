import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadReleaseContractFiles,
  validateLoginRedirect,
  validateReleaseContract,
  type ReleaseContractInput
} from "@/lib/release-contract";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function validInput(overrides: Partial<ReleaseContractInput> = {}): ReleaseContractInput {
  return {
    releaseTag: "v0.17.4",
    packageVersion: "0.17.4",
    releaseCommit: "0123456789abcdef0123456789abcdef01234567",
    checkedOutCommit: "0123456789abcdef0123456789abcdef01234567",
    releaseIsOnMain: true,
    project: {
      projectId: "prj_kinresolve",
      orgId: "team_kinresolve",
      settings: { framework: "nextjs" }
    },
    expectedProjectId: "prj_kinresolve",
    expectedOrgId: "team_kinresolve",
    productionEnvironment: {
      DATABASE_URL: "postgresql://app:secret@database.example.com:6543/kinresolve?sslmode=require",
      DATABASE_POOL_MAX: "2",
      DATABASE_AUTO_MIGRATE: "false",
      AUTH_SECRET: "auth-secret-that-is-at-least-32-characters",
      APP_BASE_URL: "https://app.kinresolve.com",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_release_contract_value",
      CRON_SECRET: "cron-secret-that-is-at-least-32-characters"
    },
    ...overrides
  };
}

describe("stable release contract", () => {
  it("accepts a complete production contract without returning secret values", () => {
    expect(validateReleaseContract(validInput())).toEqual({
      version: "0.17.4",
      appOrigin: "https://app.kinresolve.com"
    });
  });

  it("rejects tag/version mismatch and tags outside main", () => {
    expect(() => validateReleaseContract(validInput({ releaseTag: "v0.17.5" }))).toThrow(/tag.*package version/i);
    expect(() => validateReleaseContract(validInput({ releaseIsOnMain: false }))).toThrow(/ancestor of origin\/main/i);
  });

  it("requires the released tag commit to be the checked-out revision", () => {
    expect(() =>
      validateReleaseContract(
        validInput({ checkedOutCommit: "fedcba9876543210fedcba9876543210fedcba98" })
      )
    ).toThrow(/tag commit.*checked-out revision/i);
  });

  it("requires the expected linked Vercel project and Next.js framework preset", () => {
    expect(() =>
      validateReleaseContract(
        validInput({
          project: {
            projectId: "prj_kinresolve",
            orgId: "team_kinresolve",
            settings: { framework: "other" }
          }
        })
      )
    ).toThrow(/framework.*nextjs/i);
    expect(() =>
      validateReleaseContract(validInput({ expectedProjectId: "prj_unrelated" }))
    ).toThrow(/project ID.*expected Vercel project/i);
    expect(() =>
      validateReleaseContract(validInput({ expectedOrgId: "team_unrelated" }))
    ).toThrow(/organization ID.*expected Vercel organization/i);
  });

  it("requires actual pulled values for every production setting", () => {
    const input = validInput();
    delete input.productionEnvironment.APP_BASE_URL;
    input.productionEnvironment.AUTH_SECRET = "";

    expect(() => validateReleaseContract(input)).toThrow(/missing required production settings.*APP_BASE_URL.*AUTH_SECRET/i);
  });

  it("requires disabled auto-migration, a valid pool size, and PostgreSQL", () => {
    expect(() =>
      validateReleaseContract(
        validInput({ productionEnvironment: { ...validInput().productionEnvironment, DATABASE_AUTO_MIGRATE: "true" } })
      )
    ).toThrow(/DATABASE_AUTO_MIGRATE.*false/i);
    expect(() =>
      validateReleaseContract(
        validInput({ productionEnvironment: { ...validInput().productionEnvironment, DATABASE_POOL_MAX: "zero" } })
      )
    ).toThrow(/DATABASE_POOL_MAX.*positive integer/i);
    expect(() =>
      validateReleaseContract(
        validInput({ productionEnvironment: { ...validInput().productionEnvironment, DATABASE_URL: "https://database.example.com" } })
      )
    ).toThrow(/DATABASE_URL.*PostgreSQL/i);
    expect(() =>
      validateReleaseContract(
        validInput({ productionEnvironment: { ...validInput().productionEnvironment, DATABASE_URL: "postgresql:///kinresolve" } })
      )
    ).toThrow(/DATABASE_URL.*host/i);
    expect(() =>
      validateReleaseContract(
        validInput({ productionEnvironment: { ...validInput().productionEnvironment, DATABASE_URL: "postgresql://database.example.com" } })
      )
    ).toThrow(/DATABASE_URL.*database name/i);
  });

  it("requires an HTTPS origin and rejects placeholder secrets without leaking them", () => {
    expect(() =>
      validateReleaseContract(
        validInput({ productionEnvironment: { ...validInput().productionEnvironment, APP_BASE_URL: "http://app.kinresolve.com/path" } })
      )
    ).toThrow(/APP_BASE_URL.*HTTPS origin/i);

    const marker = "replace-me-sensitive-marker";
    try {
      validateReleaseContract(
        validInput({ productionEnvironment: { ...validInput().productionEnvironment, CRON_SECRET: marker } })
      );
      throw new Error("Expected placeholder validation to fail.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/CRON_SECRET.*placeholder/i);
      expect(message).not.toContain(marker);
    }
  });

  it("loads and parses the expected pulled environment and project files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kinresolve-release-contract-"));
    scratchDirectories.push(root);
    await mkdir(path.join(root, ".vercel"), { recursive: true });
    await writeFile(
      path.join(root, ".vercel", ".env.production.local"),
      Object.entries(validInput().productionEnvironment)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join("\n"),
      "utf8"
    );
    await writeFile(path.join(root, ".vercel", "project.json"), JSON.stringify(validInput().project), "utf8");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.17.4" }), "utf8");

    await expect(loadReleaseContractFiles({ repositoryRoot: root })).resolves.toMatchObject({
      packageVersion: "0.17.4",
      project: { settings: { framework: "nextjs" } },
      productionEnvironment: { DATABASE_AUTO_MIGRATE: "false" }
    });
  });

  it("fails safely when the pulled production environment file is absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kinresolve-release-contract-"));
    scratchDirectories.push(root);

    await expect(loadReleaseContractFiles({ repositoryRoot: root })).rejects.toThrow(
      /pulled Vercel production environment file is missing/i
    );
  });

  it("rejects malformed and duplicate pulled production assignments", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kinresolve-release-contract-"));
    scratchDirectories.push(root);
    await mkdir(path.join(root, ".vercel"), { recursive: true });
    await writeFile(path.join(root, ".vercel", "project.json"), JSON.stringify(validInput().project), "utf8");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.17.4" }), "utf8");

    await writeFile(path.join(root, ".vercel", ".env.production.local"), "AUTH_SECRET='unterminated", "utf8");
    await expect(loadReleaseContractFiles({ repositoryRoot: root })).rejects.toThrow(/could not be parsed/i);

    await writeFile(
      path.join(root, ".vercel", ".env.production.local"),
      "AUTH_SECRET=first-value\nAUTH_SECRET=second-value\n",
      "utf8"
    );
    await expect(loadReleaseContractFiles({ repositoryRoot: root })).rejects.toThrow(/duplicate.*AUTH_SECRET/i);
  });

  it("accepts only the configured login redirect from the deployed application", () => {
    expect(() =>
      validateLoginRedirect({
        deploymentUrl: "https://kinresolve-release.vercel.app",
        appBaseUrl: "https://app.kinresolve.com",
        location: "https://app.kinresolve.com/login?next=%2Fapp"
      })
    ).not.toThrow();
    expect(() =>
      validateLoginRedirect({
        deploymentUrl: "https://kinresolve-release.vercel.app",
        appBaseUrl: "https://app.kinresolve.com",
        location: "https://attacker.example/login?next=%2Fapp"
      })
    ).toThrow(/configured APP_BASE_URL/i);
    expect(() =>
      validateLoginRedirect({
        deploymentUrl: "https://kinresolve-release.vercel.app",
        appBaseUrl: "https://app.kinresolve.com",
        location: "https://app.kinresolve.com/login?next=%2Fapp&unexpected=true"
      })
    ).toThrow(/exactly \/login\?next=\/app/i);
  });
});
