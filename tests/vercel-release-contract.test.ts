import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseVercelDeploymentJson,
  validateCandidateDeployment,
  validateContainmentCanonicalDeployment,
  validateHoldingDeployment,
  validatePreviousDeployment,
  validatePromotedDeployment,
  type CandidateDeploymentExpectations,
  type DeploymentOwnershipExpectations,
  type PromotedDeploymentExpectations
} from "@/lib/vercel-release-contract";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

const ownership: DeploymentOwnershipExpectations = {
  expectedProjectId: "prj_kinresolve",
  expectedOrgId: "team_kinresolve"
};

const candidateExpectations: CandidateDeploymentExpectations = {
  ...ownership,
  appBaseUrl: "https://app.kinresolve.com",
  expectedGithubCommitSha: "0123456789abcdef0123456789abcdef01234567",
  expectedGithubRunAttempt: "2",
  expectedGithubRunId: "1234567890",
  expectedReleaseTag: "v0.18.0",
  expectedPackageVersion: "0.18.0",
  previousDeploymentId: "dpl_previous1234567890abcdef"
};

const promotedExpectations: PromotedDeploymentExpectations = {
  ...ownership,
  appBaseUrl: "https://app.kinresolve.com",
  canonicalLookupHostname: "app.kinresolve.com",
  candidateDeploymentId: "dpl_candidate1234567890abcdef"
};

const holdingExpectations = {
  ...ownership,
  appBaseUrl: "https://app.kinresolve.com",
  canonicalLookupHostname: "app.kinresolve.com",
  approvedHoldingDeploymentId: "dpl_holding1234567890abcdef"
};

const staticHoldingMetadata = {
  releaseRole: "kinresolve-static-holding-v1",
  databaseAccess: "none",
  rollbackPolicy: "forward-only",
  packageVersion: "holding-v1"
};

function deployment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "dpl_candidate1234567890abcdef",
    url: "kinresolve-candidate-a1b2c3-team.vercel.app",
    readyState: "READY",
    target: "production",
    projectId: "prj_kinresolve",
    ownerId: "team_kinresolve",
    aliases: ["kinresolve-git-main-team.vercel.app"],
    meta: {
      githubCommitSha: "0123456789abcdef0123456789abcdef01234567",
      githubRunAttempt: "2",
      githubRunId: "1234567890",
      releaseTag: "v0.18.0",
      packageVersion: "0.18.0"
    },
    ...overrides
  };
}

describe("Vercel release deployment contract", () => {
  it("captures a safe READY production deployment from the expected project and organization", () => {
    expect(validatePreviousDeployment(deployment(), ownership)).toEqual({
      id: "dpl_candidate1234567890abcdef",
      url: "https://kinresolve-candidate-a1b2c3-team.vercel.app",
      status: "READY"
    });

    expect(validatePreviousDeployment({
      ...deployment(),
      id: undefined,
      uid: "dpl_candidate1234567890abcdef",
      readyState: undefined,
      state: "READY",
      aliases: undefined,
      alias: ["kinresolve-git-main-team.vercel.app"]
    }, ownership)).toMatchObject({ status: "READY" });
  });

  it.each([
    ["state", { readyState: "BUILDING" }, /READY/i],
    ["target", { target: "preview" }, /production/i],
    ["project", { projectId: "prj_other" }, /project/i],
    ["organization", { ownerId: "team_other" }, /organization/i]
  ])("rejects the wrong deployment %s", (_label, override, message) => {
    expect(() => validatePreviousDeployment(deployment(override), ownership)).toThrow(message);
  });

  it.each([
    ["http://kinresolve-candidate-a1b2c3-team.vercel.app", /HTTPS/i],
    ["https://kinresolve-candidate-a1b2c3-team.vercel.app/private", /origin/i],
    ["https://kinresolve.example.com", /generated Vercel/i],
    ["https://app.kinresolve.com", /generated Vercel/i],
    ["https://user:password@kinresolve-candidate-a1b2c3-team.vercel.app", /origin/i]
  ])("rejects an unsafe generated deployment URL %s", (url, message) => {
    expect(() => validatePreviousDeployment(deployment({ url }), ownership)).toThrow(message);
  });

  it("accepts a new candidate only when provenance metadata matches exactly", () => {
    expect(validateCandidateDeployment(deployment(), candidateExpectations)).toEqual({
      id: "dpl_candidate1234567890abcdef",
      url: "https://kinresolve-candidate-a1b2c3-team.vercel.app",
      status: "READY"
    });
  });

  it("accepts only the explicitly approved holding deployment returned by the canonical hostname lookup", () => {
    const holding = deployment({
      id: holdingExpectations.approvedHoldingDeploymentId,
      meta: staticHoldingMetadata
    });
    expect(validateHoldingDeployment(holding, holdingExpectations)).toMatchObject({
      id: holdingExpectations.approvedHoldingDeploymentId,
      status: "READY"
    });
    expect(() => validateHoldingDeployment(deployment(), holdingExpectations))
      .toThrow(/approved holding deployment/i);
    expect(() => validateHoldingDeployment(holding, {
      ...holdingExpectations,
      appBaseUrl: "https://other.example.com"
    })).toThrow(/lookup hostname/i);
  });

  it.each([
    "other.example.com",
    "https://app.kinresolve.com",
    "app.kinresolve.com/path",
    "app.kinresolve.com?query=true",
    "APP.KINRESOLVE.COM"
  ])("rejects an unbound canonical lookup hostname %s", (canonicalLookupHostname) => {
    expect(() => validateHoldingDeployment(deployment({
      id: holdingExpectations.approvedHoldingDeploymentId,
      meta: staticHoldingMetadata
    }), {
      ...holdingExpectations,
      canonicalLookupHostname
    })).toThrow(/lookup hostname/i);
  });

  it.each([
    ["releaseRole", "candidate"],
    ["databaseAccess", "runtime"],
    ["rollbackPolicy", "code-rollback"],
    ["packageVersion", "0.17.4"]
  ])("rejects a holding deployment without the static %s contract", (name, value) => {
    expect(() => validateHoldingDeployment(deployment({
      id: holdingExpectations.approvedHoldingDeploymentId,
      meta: { ...staticHoldingMetadata, [name]: value }
    }), holdingExpectations)).toThrow(new RegExp(name, "i"));
  });

  it.each([
    ["githubCommitSha", "fedcba9876543210fedcba9876543210fedcba98"],
    ["githubRunId", "1234567891"],
    ["githubRunAttempt", "3"],
    ["releaseTag", "v0.18.1"],
    ["packageVersion", "0.18.1"]
  ])("rejects candidate metadata with the wrong %s", (name, value) => {
    const original = deployment().meta as Record<string, unknown>;
    expect(() => validateCandidateDeployment(deployment({
      meta: { ...original, [name]: value }
    }), candidateExpectations)).toThrow(new RegExp(name, "i"));
  });

  it("rejects a candidate that already owns the canonical application alias", () => {
    expect(() => validateCandidateDeployment(deployment({
      aliases: ["kinresolve-candidate-a1b2c3-team.vercel.app", "app.kinresolve.com"]
    }), candidateExpectations)).toThrow(/canonical.*alias/i);

    expect(() => validateCandidateDeployment(deployment({
      alias: ["https://app.kinresolve.com"],
      aliases: undefined
    }), candidateExpectations)).toThrow(/canonical.*alias/i);
  });

  it("rejects using the previous deployment as its own rollback candidate", () => {
    expect(() => validateCandidateDeployment(deployment({
      id: candidateExpectations.previousDeploymentId
    }), candidateExpectations)).toThrow(/different from the previous deployment/i);
  });

  it("requires the canonical hostname lookup to resolve to the exact promoted candidate", () => {
    const promoted = deployment();
    expect(validatePromotedDeployment(promoted, promotedExpectations)).toEqual({
      id: "dpl_candidate1234567890abcdef",
      url: "https://kinresolve-candidate-a1b2c3-team.vercel.app",
      status: "READY"
    });

    expect(() => validatePromotedDeployment(deployment({
      id: "dpl_unexpected1234567890abcdef"
    }), promotedExpectations)).toThrow(/exact candidate/i);
    expect(() => validatePromotedDeployment(promoted, {
      ...promotedExpectations,
      canonicalLookupHostname: "demo.kinresolve.com"
    })).toThrow(/lookup hostname/i);
  });

  it("contains only when the canonical deployment belongs to the exact failed run attempt", () => {
    const expectations = {
      ...ownership,
      appBaseUrl: candidateExpectations.appBaseUrl,
      canonicalLookupHostname: "app.kinresolve.com",
      approvedHoldingDeploymentId: holdingExpectations.approvedHoldingDeploymentId,
      expectedGithubCommitSha: candidateExpectations.expectedGithubCommitSha,
      expectedGithubRunAttempt: candidateExpectations.expectedGithubRunAttempt,
      expectedGithubRunId: candidateExpectations.expectedGithubRunId
    };
    expect(validateContainmentCanonicalDeployment(
      deployment(),
      expectations
    )).toMatchObject({ containmentRequired: true, state: "source-release" });

    const original = deployment().meta as Record<string, unknown>;
    expect(validateContainmentCanonicalDeployment(deployment({
      meta: { ...original, githubRunAttempt: "3" }
    }), expectations)).toMatchObject({ containmentRequired: false, state: "other-release" });

    expect(validateContainmentCanonicalDeployment(deployment({
      id: holdingExpectations.approvedHoldingDeploymentId,
      meta: staticHoldingMetadata
    }), expectations)).toMatchObject({ containmentRequired: false, state: "holding" });
    expect(() => validateContainmentCanonicalDeployment(deployment(), {
      ...expectations,
      canonicalLookupHostname: "demo.kinresolve.com"
    })).toThrow(/lookup hostname/i);
  });

  it("fails closed for CLI-only inspect JSON that omits REST ownership and metadata", () => {
    const cliInspectShape = {
      id: "dpl_candidate1234567890abcdef",
      name: "kinresolve",
      url: "kinresolve-candidate-a1b2c3-team.vercel.app",
      target: "production",
      readyState: "READY",
      aliases: [],
      contextName: "kinresolve-team"
    };

    expect(() => validateCandidateDeployment(cliInspectShape, candidateExpectations)).toThrow(/project/i);
  });

  it("rejects malformed, non-object, and ambiguous deployment JSON", () => {
    expect(() => parseVercelDeploymentJson("{not-json")).toThrow(/valid JSON/i);
    expect(() => parseVercelDeploymentJson("[]")).toThrow(/JSON object/i);
    expect(() => validatePreviousDeployment(deployment({
      uid: "dpl_conflicting1234567890abcdef"
    }), ownership)).toThrow(/ambiguous.*ID/i);
  });

  it.each(["previous", "holding", "candidate", "promoted"] as const)(
    "validates %s mode through the nonsecret CLI contract",
    async (mode) => {
      const root = await mkdtemp(path.join(tmpdir(), "kinresolve-vercel-contract-"));
      scratchDirectories.push(root);
      const fixturePath = path.join(root, "deployment.json");
      const fixture = mode === "holding"
          ? deployment({
              id: holdingExpectations.approvedHoldingDeploymentId,
              meta: staticHoldingMetadata
            })
          : deployment();
      await writeFile(fixturePath, JSON.stringify(fixture), "utf8");

      const result = runCli(mode, fixturePath);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const expectedId = mode === "holding"
        ? holdingExpectations.approvedHoldingDeploymentId
        : "dpl_candidate1234567890abcdef";
      expect(result.stdout.trim().split("\n")).toEqual([
        `deployment_id=${expectedId}`,
        "deployment_url=https://kinresolve-candidate-a1b2c3-team.vercel.app",
        "deployment_status=READY"
      ]);
    }
  );

  it("appends validated deployment outputs without truncating existing workflow output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kinresolve-vercel-contract-"));
    scratchDirectories.push(root);
    const fixturePath = path.join(root, "deployment.json");
    const outputPath = path.join(root, "github-output.txt");
    await writeFile(fixturePath, JSON.stringify(deployment()), "utf8");
    await writeFile(outputPath, "existing=value\n", "utf8");

    const result = runCli("candidate", fixturePath, { GITHUB_OUTPUT: outputPath });

    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(outputPath, "utf8")).toBe(
      "existing=value\n" + result.stdout
    );
  });

  it("never leaks deployment JSON or a secret marker from CLI failures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kinresolve-vercel-contract-"));
    scratchDirectories.push(root);
    const fixturePath = path.join(root, "deployment.json");
    const marker = "secret-marker-must-never-leak";
    await writeFile(fixturePath, JSON.stringify(deployment({
      meta: {
        ...(deployment().meta as Record<string, unknown>),
        githubCommitSha: marker,
        unexpectedSecret: marker
      }
    })), "utf8");

    const result = runCli("candidate", fixturePath);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/githubCommitSha/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
  });

  it.each(["holding", "containment", "promoted"] as const)(
    "requires %s mode to receive the exact canonical lookup hostname",
    async (mode) => {
      const root = await mkdtemp(path.join(tmpdir(), "kinresolve-vercel-contract-"));
      scratchDirectories.push(root);
      const fixturePath = path.join(root, "deployment.json");
      const fixture = mode === "holding"
        ? deployment({
            id: holdingExpectations.approvedHoldingDeploymentId,
            meta: staticHoldingMetadata
          })
        : deployment();
      await writeFile(fixturePath, JSON.stringify(fixture), "utf8");

      const missing = runCli(mode, fixturePath, {}, null);
      const wrong = runCli(mode, fixturePath, {}, "demo.kinresolve.com");

      expect(missing.status).toBe(1);
      expect(missing.stderr).toMatch(/usage|lookup hostname/i);
      expect(wrong.status).toBe(1);
      expect(wrong.stderr).toMatch(/lookup hostname/i);
    }
  );
});

function runCli(
  mode: "previous" | "holding" | "candidate" | "containment" | "promoted",
  fixturePath: string,
  environment: Record<string, string> = {},
  canonicalLookupHostname: string | null = ["holding", "containment", "promoted"].includes(mode)
    ? "app.kinresolve.com"
    : null
) {
  return spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/validate-vercel-deployment.mjs",
      mode,
      fixturePath,
      ...(canonicalLookupHostname === null ? [] : [canonicalLookupHostname])
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_PROJECT_ID: ownership.expectedProjectId,
        VERCEL_ORG_ID: ownership.expectedOrgId,
        APP_BASE_URL: candidateExpectations.appBaseUrl,
        EXPECTED_GITHUB_COMMIT_SHA: candidateExpectations.expectedGithubCommitSha,
        EXPECTED_GITHUB_RUN_ATTEMPT: candidateExpectations.expectedGithubRunAttempt,
        EXPECTED_GITHUB_RUN_ID: candidateExpectations.expectedGithubRunId,
        RELEASE_TAG: candidateExpectations.expectedReleaseTag,
        PACKAGE_VERSION: candidateExpectations.expectedPackageVersion,
        PREVIOUS_DEPLOYMENT_ID: candidateExpectations.previousDeploymentId,
        CANDIDATE_DEPLOYMENT_ID: promotedExpectations.candidateDeploymentId,
        APPROVED_HOLDING_DEPLOYMENT_ID: holdingExpectations.approvedHoldingDeploymentId,
        ...environment
      }
    }
  );
}
