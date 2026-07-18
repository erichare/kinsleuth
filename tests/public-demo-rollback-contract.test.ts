import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  staticHoldingDeploymentMetadata,
  validateHoldingRecordDeployment,
  validatePublicDemoCandidateDeployment,
  validatePublicDemoRollbackDeployment
} from "../lib/vercel-release-contract";

const ownership = {
  expectedOrgId: "team_kinresolve",
  expectedProjectId: "prj_kinresolve"
};

const candidateExpectations = {
  ...ownership,
  appBaseUrl: "https://demo.kinresolve.com",
  expectedGithubCommitSha: "a".repeat(40),
  expectedGithubRunAttempt: "2",
  expectedGithubRunId: "1234",
  expectedPackageVersion: "0.18.0",
  expectedReleaseTag: "v0.18.0",
  previousDeploymentId: "dpl_previous1234567890abcdef"
};

describe("public demo rollback deployment contract", () => {
  it("rejects a staged public-demo deployment as a rollback target", () => {
    const staged = runtimeDeployment({
      readySubstate: "STAGED",
      errorCode: null,
      errorMessage: null
    });

    expect(() => validatePublicDemoRollbackDeployment(staged, {
      ...ownership,
      allowHolding: false
    })).toThrow(/PROMOTED|public demo rollback/i);
    expect(validatePublicDemoCandidateDeployment(staged, candidateExpectations)).toMatchObject({
      id: "dpl_demo1234567890abcdef",
      status: "READY"
    });
  });

  it("accepts a staged candidate only with exact public-demo identity metadata", () => {
    expect(() => validatePublicDemoCandidateDeployment(
      runtimeDeployment(),
      candidateExpectations
    )).toThrow(/STAGED/i);
    for (const meta of [
      { ...runtimeMetadata(), releaseRole: "candidate" },
      { ...runtimeMetadata(), datasetMode: "private" },
      { ...runtimeMetadata(), canonicalArchiveId: "other" }
    ]) {
      expect(() => validatePublicDemoCandidateDeployment(runtimeDeployment({
        meta,
        readySubstate: "STAGED"
      }), candidateExpectations)).toThrow(/public demo candidate/i);
    }
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
    expect(() => validateHoldingRecordDeployment(runtimeDeployment({
      id: "dpl_holding1234567890abcdef",
      meta: staticHoldingDeploymentMetadata,
      readySubstate: "STAGED"
    }), {
      ...ownership,
      approvedHoldingDeploymentId: "dpl_holding1234567890abcdef"
    })).toThrow(/PROMOTED/i);
    expect(() => validatePublicDemoRollbackDeployment(holding, {
      ...ownership,
      allowHolding: false
    })).toThrow(/public demo rollback/i);
    expect(() => validatePublicDemoRollbackDeployment(runtimeDeployment({ meta: {} }), {
      ...ownership,
      allowHolding: true
    })).toThrow(/public demo rollback/i);
  });

  it("uses the strict candidate and rollback modes with idempotent exact-target restoration", () => {
    const workflow = readFileSync(path.join(
      process.cwd(),
      ".github/workflows/public-demo-release.yml"
    ), "utf8");

    expect(workflow).toContain('--meta "releaseRole=public-demo"');
    expect(workflow).toContain('--meta "datasetMode=demo"');
    expect(workflow).toContain('--meta "canonicalArchiveId=kinresolve-demo-public"');
    expect(workflow).toContain("scripts/validate-vercel-deployment.mjs holding-record");
    expect(workflow).toContain("scripts/validate-vercel-deployment.mjs demo-candidate");
    expect(workflow).not.toContain("scripts/validate-vercel-deployment.mjs demo-rollback-or-holding");
    expect(workflow).toContain('mode="demo-rollback"');
    expect(workflow).toContain("Prove the automatic rollback at the canonical hostname");
    expect(workflow).toContain("Prove the emergency holding fallback at the canonical hostname");
    expect(workflow).toContain("steps.rollback-proof.outcome != 'success'");
    expect(workflow).toContain("steps.holding-fallback-proof.outcome");
    expect(workflow.match(
      /vercel promote "\$CANDIDATE_DEPLOYMENT_URL" --yes --timeout=5m/g
    )).toHaveLength(1);
    expect(workflow.match(
      /vercel rollback "\$PREVIOUS_DEPLOYMENT_URL" --yes --timeout=5m/g
    )).toHaveLength(1);
    expect(workflow.match(
      /vercel rollback "\$ROLLBACK_DEPLOYMENT_URL" --yes --timeout=5m/g
    )).toHaveLength(1);
    expect(workflow.match(
      /vercel rollback "\$HOLDING_DEPLOYMENT_URL" --yes --timeout=5m/g
    )).toHaveLength(2);
    expect(workflow).not.toMatch(
      /vercel promote "\$(?:PREVIOUS|ROLLBACK|HOLDING)_DEPLOYMENT_URL"/
    );
    expect(workflow.match(/vercel rollback /g)).toHaveLength(4);
    expect(workflow.match(/vercel promote /g)).toHaveLength(1);

    const candidateStep = workflowStep(workflow, "Fetch and validate the exact candidate record");
    expect(candidateStep).toContain("scripts/validate-vercel-deployment.mjs demo-candidate");
    expect(candidateStep).not.toContain("scripts/validate-vercel-deployment.mjs demo-rollback");
    const targetStep = workflowStep(
      workflow,
      "Fetch and validate the requested rollback or holding deployment"
    );
    expect(targetStep).toContain('mode="demo-rollback"');
    expect(targetStep).toContain('scripts/validate-vercel-deployment.mjs "$mode"');

    for (const [stepName, command, targetBinding] of [
      [
        "Roll back a failed promotion to the previously validated deployment",
        'vercel rollback "$PREVIOUS_DEPLOYMENT_URL" --yes --timeout=5m',
        "CANDIDATE_DEPLOYMENT_ID: ${{ steps.previous.outputs.deployment_id }}"
      ],
      [
        "Fail closed to the pinned holding page if rollback cannot be proved",
        'vercel rollback "$HOLDING_DEPLOYMENT_URL" --yes --timeout=5m',
        "CANDIDATE_DEPLOYMENT_ID: ${{ steps.holding.outputs.deployment_id }}"
      ],
      [
        "Roll back to the validated prior demo deployment",
        'vercel rollback "$ROLLBACK_DEPLOYMENT_URL" --yes --timeout=5m',
        "CANDIDATE_DEPLOYMENT_ID: ${{ steps.target.outputs.deployment_id }}"
      ],
      [
        "Roll back to the pinned static holding deployment",
        'vercel rollback "$HOLDING_DEPLOYMENT_URL" --yes --timeout=5m',
        "CANDIDATE_DEPLOYMENT_ID: ${{ steps.target.outputs.deployment_id }}"
      ]
    ]) {
      const step = workflowStep(workflow, stepName);
      const firstCheck = step.indexOf("target_is_current \"$RUNNER_TEMP/");
      const restore = step.indexOf(command);
      const secondCheck = step.indexOf("target_is_current \"$RUNNER_TEMP/", firstCheck + 1);
      expect(step).toContain("scripts/validate-vercel-deployment.mjs promoted");
      expect(step).toContain(targetBinding);
      expect(firstCheck).toBeGreaterThan(-1);
      expect(restore).toBeGreaterThan(firstCheck);
      expect(secondCheck).toBeGreaterThan(restore);
      expect(step).toContain("became current during restoration");
    }
  });
});

function workflowStep(workflow: string, name: string): string {
  const marker = `- name: ${name}`;
  const start = workflow.indexOf(marker);
  expect(start, `missing workflow step: ${name}`).toBeGreaterThan(-1);
  const end = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, end === -1 ? workflow.length : end);
}

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
    readySubstate: "PROMOTED",
    target: "production",
    url: "kinresolve-demo-current.vercel.app",
    ...overrides
  };
}
