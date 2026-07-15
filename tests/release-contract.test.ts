import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
    expectedAppBaseUrl: "https://app.kinresolve.com",
    expectedDatasetMode: "pilot",
    expectedScheduledWritesEnabled: true,
    expectedArchiveId: "pilot-household-01",
    productionEnvironment: {
      DATABASE_POOL_MAX: "2",
      DATABASE_AUTO_MIGRATE: "false",
      APP_BASE_URL: "https://app.kinresolve.com",
      KINRESOLVE_BETA_BOUNDARY_SHA256: "c".repeat(64),
      KINRESOLVE_BETA_BOUNDARY_URL: "https://kinresolve.com/legal/private-beta-boundary",
      KINRESOLVE_BETA_BOUNDARY_VERSION: "private-beta-boundary-v1",
      KINRESOLVE_BETA_LEGAL_STATUS: "approved",
      KINRESOLVE_BETA_OPERATOR_AUDIENCE: "https://app.kinresolve.com",
      KINRESOLVE_BETA_OPERATOR_KEY_ID: "beta-operator-1",
      KINRESOLVE_BETA_OPERATOR_PUBLIC_KEY_SPKI: "MCowBQYDK2VwAyEAaTQgaCV2zdRSKERDMqDsUoaycbh8weTsGwWsAm29Oas",
      KINRESOLVE_BETA_PARTICIPATION_TERMS_SHA256: "d".repeat(64),
      KINRESOLVE_BETA_PARTICIPATION_TERMS_URL: "https://kinresolve.com/legal/private-beta-terms",
      KINRESOLVE_BETA_PARTICIPATION_TERMS_VERSION: "private-beta-terms-v1",
      KINRESOLVE_BETA_PRIVACY_NOTICE_SHA256: "e".repeat(64),
      KINRESOLVE_BETA_PRIVACY_NOTICE_URL: "https://kinresolve.com/legal/private-beta-privacy",
      KINRESOLVE_BETA_PRIVACY_NOTICE_VERSION: "private-beta-privacy-v1",
      KINRESOLVE_DEPLOYMENT_MODE: "hosted",
      KINRESOLVE_DATASET_MODE: "pilot",
      KINRESOLVE_DATABASE_IDENTITY: "a".repeat(64),
      KINRESOLVE_EXPORT_REFRESH_ENABLED: "true",
      KINRESOLVE_GUIDED_RESEARCH_ENABLED: "true",
      KINRESOLVE_OBJECT_STORAGE_BACKEND: "vercel-blob",
      KINRESOLVE_OBJECT_STORAGE_IDENTITY: "b".repeat(64),
      KINRESOLVE_OBSERVABILITY_ENDPOINT: "https://events.example.test/kinresolve",
      KINRESOLVE_SCHEDULED_WRITES_ENABLED: "true",
      KINRESOLVE_TRANSACTIONAL_EMAIL_FROM: "Kin Resolve <beta@kinresolve.com>",
      KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER: "resend",
      KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO: "beta@kinresolve.com",
      KINRESOLVE_DNA_ENABLED: "false",
      KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
      KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
      KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
      KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
      KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
      KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true",
      KINSLEUTH_ALLOW_SIGNUPS: "false",
      KINSLEUTH_ARCHIVE_ID: "pilot-household-01"
    },
    ...overrides
  };
}

describe("stable release contract", () => {
  it("accepts a complete production contract without returning secret values", () => {
    expect(validateReleaseContract(validInput())).toEqual({
      version: "0.17.4",
      appOrigin: "https://app.kinresolve.com",
      datasetMode: "pilot",
      archiveId: "pilot-household-01",
      databaseIdentity: "a".repeat(64),
      objectStorageIdentity: "b".repeat(64),
      scheduledWritesEnabled: true
    });
  });

  it("rejects tag/version mismatch and tags outside main", () => {
    expect(() => validateReleaseContract(validInput({ releaseTag: "v0.17.5" }))).toThrow(/tag.*package version/i);
    expect(() => validateReleaseContract(validInput({ releaseIsOnMain: false }))).toThrow(/ancestor of origin\/main/i);
  });

  it("requires a stable package version and canonical release commit identifiers", () => {
    expect(() =>
      validateReleaseContract(validInput({ packageVersion: "0.17.4-beta.1", releaseTag: "v0.17.4-beta.1" }))
    ).toThrow(/stable semantic version/i);
    expect(() =>
      validateReleaseContract(validInput({
        releaseCommit: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
        checkedOutCommit: "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
      }))
    ).toThrow(/release commit.*40-character lowercase/i);
    expect(() =>
      validateReleaseContract(validInput({ checkedOutCommit: "main" }))
    ).toThrow(/checked-out commit.*40-character lowercase/i);
  });

  it("requires the requested release commit to be the checked-out revision", () => {
    expect(() =>
      validateReleaseContract(
        validInput({ checkedOutCommit: "fedcba9876543210fedcba9876543210fedcba98" })
      )
    ).toThrow(/release commit.*checked-out revision/i);
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

  it("requires actual pulled values for every readable production setting", () => {
    const input = validInput();
    delete input.productionEnvironment.APP_BASE_URL;
    input.productionEnvironment.KINRESOLVE_OBJECT_STORAGE_BACKEND = "";

    expect(() => validateReleaseContract(input)).toThrow(
      /missing required production settings.*APP_BASE_URL.*KINRESOLVE_OBJECT_STORAGE_BACKEND/i
    );
  });

  it("requires disabled auto-migration, a valid pool size, and private Vercel Blob storage", () => {
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
        validInput({
          productionEnvironment: {
            ...validInput().productionEnvironment,
            KINRESOLVE_OBJECT_STORAGE_BACKEND: "s3"
          }
        })
      )
    ).toThrow(/KINRESOLVE_OBJECT_STORAGE_BACKEND.*vercel-blob/i);
  });

  it("requires the approved transactional sender and an Ed25519 operator identity", () => {
    for (const [name, value, pattern] of [
      ["KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER", "smtp", /provider.*resend/i],
      ["KINRESOLVE_TRANSACTIONAL_EMAIL_FROM", "Other <other@example.com>", /from.*beta@kinresolve\.com/i],
      ["KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO", "other@example.com", /reply_to.*beta@kinresolve\.com/i],
      ["KINRESOLVE_BETA_OPERATOR_KEY_ID", "bad key id", /operator.*public-key.*invalid/i],
      ["KINRESOLVE_BETA_OPERATOR_PUBLIC_KEY_SPKI", "not-a-key", /operator.*public-key.*invalid/i],
      ["KINRESOLVE_BETA_OPERATOR_AUDIENCE", "https://app.kinresolve.com/", /operator.*public-key.*invalid/i]
    ] as const) {
      expect(() => validateReleaseContract(validInput({
        productionEnvironment: {
          ...validInput().productionEnvironment,
          [name]: value
        }
      })), name).toThrow(pattern);
    }
  });

  it("binds the operator audience to the exact release-cell origin", () => {
    expect(() => validateReleaseContract(validInput({
      productionEnvironment: {
        ...validInput().productionEnvironment,
        KINRESOLVE_BETA_OPERATOR_AUDIENCE: "https://staging.kinresolve.com"
      }
    }))).toThrow(/operator_audience.*app_base_url/i);
  });

  it("requires approved, immutable legal metadata on the Kin Resolve origin", () => {
    for (const [name, value] of [
      ["KINRESOLVE_BETA_LEGAL_STATUS", "proposed"],
      ["KINRESOLVE_BETA_PARTICIPATION_TERMS_VERSION", "Terms v1"],
      ["KINRESOLVE_BETA_PRIVACY_NOTICE_SHA256", "A".repeat(64)],
      ["KINRESOLVE_BETA_BOUNDARY_URL", "https://example.com/legal/boundary"],
      ["KINRESOLVE_BETA_PARTICIPATION_TERMS_URL", "https://kinresolve.com/legal/terms?mutable=true"]
    ] as const) {
      expect(() => validateReleaseContract(validInput({
        productionEnvironment: {
          ...validInput().productionEnvironment,
          [name]: value
        }
      })), name).toThrow(/approved private-beta legal document contract.*invalid/i);
    }
  });

  it("requires an explicit hosted dataset and safe archive identity", () => {
    expect(() =>
      validateReleaseContract(
        validInput({
          productionEnvironment: {
            ...validInput().productionEnvironment,
            KINRESOLVE_DEPLOYMENT_MODE: "self-hosted"
          }
        })
      )
    ).toThrow(/KINRESOLVE_DEPLOYMENT_MODE.*hosted/i);
    expect(() =>
      validateReleaseContract(
        validInput({
          productionEnvironment: {
            ...validInput().productionEnvironment,
            KINRESOLVE_DATASET_MODE: "seed"
          }
        })
      )
    ).toThrow(/KINRESOLVE_DATASET_MODE.*empty, demo, or pilot/i);
    expect(() =>
      validateReleaseContract(
        validInput({
          productionEnvironment: {
            ...validInput().productionEnvironment,
            KINSLEUTH_ARCHIVE_ID: "../../other archive"
          }
        })
      )
    ).toThrow(/KINSLEUTH_ARCHIVE_ID.*safe/i);

    const missing = validInput();
    delete missing.productionEnvironment.KINRESOLVE_DATASET_MODE;
    expect(() => validateReleaseContract(missing)).toThrow(/missing required production settings.*KINRESOLVE_DATASET_MODE/i);

    expect(() => validateReleaseContract(validInput({
      expectedDatasetMode: "pilot",
      productionEnvironment: {
        ...validInput().productionEnvironment,
        KINRESOLVE_DATASET_MODE: "demo"
      }
    }))).toThrow(/KINRESOLVE_DATASET_MODE.*expected release cell/i);

    expect(() => validateReleaseContract(validInput({
      expectedArchiveId: "pilot-household-01",
      productionEnvironment: {
        ...validInput().productionEnvironment,
        KINSLEUTH_ARCHIVE_ID: "other-pilot"
      }
    }))).toThrow(/KINSLEUTH_ARCHIVE_ID.*expected release cell/i);
  });

  it("requires core guided-research and export workflows to stay enabled", () => {
    for (const name of ["KINRESOLVE_GUIDED_RESEARCH_ENABLED", "KINRESOLVE_EXPORT_REFRESH_ENABLED"] as const) {
      expect(() => validateReleaseContract(validInput({
        productionEnvironment: { ...validInput().productionEnvironment, [name]: "false" }
      })), name).toThrow(new RegExp(`${name}.*true`, "i"));
    }
  });

  it("requires the exact scheduled-write value assigned to each release cell", () => {
    expect(validateReleaseContract(validInput({
      expectedScheduledWritesEnabled: false,
      productionEnvironment: {
        ...validInput().productionEnvironment,
        KINRESOLVE_SCHEDULED_WRITES_ENABLED: "false"
      }
    })).scheduledWritesEnabled).toBe(false);

    for (const value of ["", "yes"] as const) {
      expect(() => validateReleaseContract(validInput({
        productionEnvironment: {
          ...validInput().productionEnvironment,
          KINRESOLVE_SCHEDULED_WRITES_ENABLED: value
        }
      }))).toThrow(/(?:missing required production settings: KINRESOLVE_SCHEDULED_WRITES_ENABLED|KINRESOLVE_SCHEDULED_WRITES_ENABLED.*true or false)/i);
    }

    expect(() => validateReleaseContract(validInput({
      expectedScheduledWritesEnabled: false
    }))).toThrow(/KINRESOLVE_SCHEDULED_WRITES_ENABLED.*false.*release cell/i);
  });

  it("requires a full lowercase database identity fingerprint", () => {
    for (const value of ["", "a".repeat(63), "A".repeat(64), "not-a-fingerprint"]) {
      expect(() => validateReleaseContract(validInput({
        productionEnvironment: {
          ...validInput().productionEnvironment,
          KINRESOLVE_DATABASE_IDENTITY: value
        }
      }))).toThrow(/(?:missing required production settings: KINRESOLVE_DATABASE_IDENTITY|KINRESOLVE_DATABASE_IDENTITY.*SHA-256)/i);
    }
  });

  it("requires a full lowercase object-storage identity fingerprint", () => {
    for (const value of ["", "a".repeat(63), "A".repeat(64), "not-a-fingerprint"]) {
      expect(() => validateReleaseContract(validInput({
        productionEnvironment: {
          ...validInput().productionEnvironment,
          KINRESOLVE_OBJECT_STORAGE_IDENTITY: value
        }
      }))).toThrow(/(?:missing required production settings: KINRESOLVE_OBJECT_STORAGE_IDENTITY|KINRESOLVE_OBJECT_STORAGE_IDENTITY.*SHA-256)/i);
    }
  });

  it("requires the exact cohort-one hosted capability manifest", () => {
    const missing = validInput();
    delete missing.productionEnvironment.KINRESOLVE_DNA_ENABLED;
    expect(() => validateReleaseContract(missing)).toThrow(
      /missing required production settings.*KINRESOLVE_DNA_ENABLED/i
    );

    for (const [name, unsafeValue] of [
      ["KINRESOLVE_DNA_ENABLED", "true"],
      ["KINRESOLVE_EXTERNAL_AI_ENABLED", "true"],
      ["KINRESOLVE_PUBLIC_ARCHIVE_ENABLED", "true"],
      ["KINRESOLVE_PUBLIC_PUBLISHING_ENABLED", "true"],
      ["KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED", "true"],
      ["KINRESOLVE_PACKAGE_MEDIA_ENABLED", "true"],
      ["KINRESOLVE_PLAIN_GEDCOM_ENABLED", "false"]
    ] as const) {
      expect(() => validateReleaseContract(validInput({
        productionEnvironment: { ...validInput().productionEnvironment, [name]: unsafeValue }
      })), name).toThrow(new RegExp(`${name}.*cohort-one`, "i"));
    }
  });

  it("requires hosted self-registration to be explicitly disabled", () => {
    expect(() => validateReleaseContract(validInput({
      productionEnvironment: { ...validInput().productionEnvironment, KINSLEUTH_ALLOW_SIGNUPS: "true" }
    }))).toThrow(/KINSLEUTH_ALLOW_SIGNUPS.*false/i);

    const missing = validInput();
    delete missing.productionEnvironment.KINSLEUTH_ALLOW_SIGNUPS;
    expect(() => validateReleaseContract(missing)).toThrow(
      /missing required production settings.*KINSLEUTH_ALLOW_SIGNUPS/i
    );
  });

  it("requires an HTTPS canonical origin", () => {
    expect(() =>
      validateReleaseContract(
        validInput({ productionEnvironment: { ...validInput().productionEnvironment, APP_BASE_URL: "http://app.kinresolve.com/path" } })
      )
    ).toThrow(/APP_BASE_URL.*HTTPS origin/i);

    expect(() =>
      validateReleaseContract(
        validInput({
          expectedAppBaseUrl: "https://app.kinresolve.com",
          productionEnvironment: {
            ...validInput().productionEnvironment,
            APP_BASE_URL: "https://other.kinresolve.com"
          }
        })
      )
    ).toThrow(/APP_BASE_URL.*expected canonical origin/i);

    expect(() =>
      validateReleaseContract(
        validInput({
          forbiddenAppBaseUrl: "https://app.kinresolve.com"
        })
      )
    ).toThrow(/APP_BASE_URL.*isolated.*forbidden/i);

  });

  it("rejects a Vercel project reserved for another release cell", () => {
    expect(() => validateReleaseContract(validInput({
      forbiddenProjectId: "prj_kinresolve"
    }))).toThrow(/project.*isolated.*forbidden/i);
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

  it("validates an intended tag that does not exist and appends only safe workflow outputs", async () => {
    const root = await createCandidateRepository();
    const outputPath = path.join(root.path, "github-output.txt");
    await writeFile(outputPath, "existing=value\n", "utf8");

    const result = runReleaseContractCli(root.path, {
      RELEASE_COMMIT: root.commit,
      RELEASE_TAG: "v0.17.4",
      GITHUB_OUTPUT: outputPath
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/candidate release contract verified/i);
    expect(result.stderr).toBe("");
    expect(await readFile(outputPath, "utf8")).toBe(
      "existing=value\n" +
      "app_base_url=https://app.kinresolve.com\n" +
      "dataset_mode=pilot\n" +
      "archive_id=pilot-household-01\n" +
      `database_identity=${"a".repeat(64)}\n` +
      `object_storage_identity=${"b".repeat(64)}\n` +
      "scheduled_writes_enabled=true\n" +
      "version=0.17.4\n"
    );
    expect(git(root.path, ["tag", "--list"]).stdout).toBe("");
  });

  it("rejects malformed or mismatched candidate commits before writing workflow outputs", async () => {
    const root = await createCandidateRepository();
    const outputPath = path.join(root.path, "github-output.txt");

    for (const releaseCommit of ["main", root.commit.toUpperCase(), "0".repeat(40)]) {
      await rm(outputPath, { force: true });
      const result = runReleaseContractCli(root.path, {
        RELEASE_COMMIT: releaseCommit,
        RELEASE_TAG: "v0.17.4",
        GITHUB_OUTPUT: outputPath
      });

      expect(result.status).toBe(1);
      await expect(readFile(outputPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});

async function createCandidateRepository(): Promise<{ path: string; commit: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "kinresolve-release-cli-"));
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

  expect(git(root, ["init", "--quiet"]).status).toBe(0);
  expect(git(root, ["config", "user.email", "release-contract@example.invalid"]).status).toBe(0);
  expect(git(root, ["config", "user.name", "Release Contract"]).status).toBe(0);
  expect(git(root, ["add", "."]).status).toBe(0);
  expect(git(root, ["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "candidate fixture"]).status).toBe(0);
  const commit = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  expect(git(root, ["update-ref", "refs/remotes/origin/main", commit]).status).toBe(0);
  return { path: root, commit };
}

function runReleaseContractCli(
  cwd: string,
  environment: Record<string, string>
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      path.join(process.cwd(), "scripts", "validate-release-contract.mjs")
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_PROJECT_ID: "prj_kinresolve",
        EXPECTED_VERCEL_PROJECT_ID: "prj_kinresolve",
        VERCEL_ORG_ID: "team_kinresolve",
        EXPECTED_SCHEDULED_WRITES_ENABLED: "true",
        ...environment
      }
    }
  );
}

function git(cwd: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}
