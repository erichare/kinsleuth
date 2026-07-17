import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  staticHoldingDeploymentMetadata,
  validatePublicDemoRollbackDeployment
} from "../lib/vercel-release-contract";

const ownership = {
  expectedOrgId: "team_kinresolve",
  expectedProjectId: "prj_kinresolve"
};

describe("public demo rollback deployment contract", () => {
  it("rejects a staged public-demo deployment as a rollback target", () => {
    const staged = runtimeDeployment({
      readyState: "INITIALIZING",
      readySubstate: "STAGED",
      errorCode: null,
      errorMessage: null
    });

    expect(() => validatePublicDemoRollbackDeployment(staged, {
      ...ownership,
      allowHolding: false
    })).toThrow(/READY/i);
  });

  it("accepts only a provenance-bound prior public demo release", () => {
    expect(validatePublicDemoRollbackDeployment(runtimeDeployment(), {
      ...ownership,
      allowHolding: false
    })).toMatchObject({ kind: "public-demo", status: "READY" });

    for (const meta of [
      { ...runtimeMetadata(), releaseRole: "candidate" },
      { ...runtimeMetadata(), datasetMode: "private" },
      { ...runtimeMetadata(), canonicalArchiveId: "other" },
      { ...runtimeMetadata(), githubCommitSha: "not-a-sha" },
      { ...runtimeMetadata(), githubRunId: "0" },
      { ...runtimeMetadata(), packageVersion: "latest" }
    ]) {
      expect(() => validatePublicDemoRollbackDeployment(runtimeDeployment({ meta }), {
        ...ownership,
        allowHolding: false
      })).toThrow(/public demo rollback/i);
    }
  });

  it("allows the exact pinned holding contract only for automatic safe fallback capture", () => {
    const holding = runtimeDeployment({
      id: "dpl_holding1234567890abcdef",
      meta: staticHoldingDeploymentMetadata
    });
    expect(validatePublicDemoRollbackDeployment(holding, {
      ...ownership,
      allowHolding: true
    })).toMatchObject({ kind: "holding" });
    expect(() => validatePublicDemoRollbackDeployment(holding, {
      ...ownership,
      allowHolding: false
    })).toThrow(/public demo rollback/i);
    expect(() => validatePublicDemoRollbackDeployment(runtimeDeployment({ meta: {} }), {
      ...ownership,
      allowHolding: true
    })).toThrow(/public demo rollback/i);
  });

  it("uses the strict rollback modes and proves every recovery promotion", () => {
    const workflow = readFileSync(path.join(
      process.cwd(),
      ".github/workflows/public-demo-release.yml"
    ), "utf8");

    expect(workflow).toContain('--meta "releaseRole=public-demo"');
    expect(workflow).toContain('--meta "datasetMode=demo"');
    expect(workflow).toContain('--meta "canonicalArchiveId=kinresolve-demo-public"');
    expect(workflow).toContain("scripts/validate-vercel-deployment.mjs demo-rollback-or-holding");
    expect(workflow).toContain('mode="demo-rollback"');
    expect(workflow).toContain("Prove the automatic rollback at the canonical hostname");
    expect(workflow).toContain("Prove the emergency holding fallback at the canonical hostname");
    expect(workflow).toContain("steps.rollback-proof.outcome != 'success'");
    expect(workflow).toContain("steps.holding-fallback-proof.outcome");
  });
});

function runtimeMetadata(): Record<string, string> {
  return {
    canonicalArchiveId: "kinresolve-demo-public",
    datasetMode: "demo",
    githubCommitSha: "a".repeat(40),
    githubRunAttempt: "2",
    githubRunId: "1234",
    packageVersion: "0.18.0",
    releaseRole: "public-demo",
    releaseTag: "v0.18.0"
  };
}

function runtimeDeployment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aliases: ["kinresolve-demo-current.vercel.app"],
    id: "dpl_demo1234567890abcdef",
    meta: runtimeMetadata(),
    ownerId: ownership.expectedOrgId,
    projectId: ownership.expectedProjectId,
    readyState: "READY",
    target: "production",
    url: "kinresolve-demo-current.vercel.app",
    ...overrides
  };
}
