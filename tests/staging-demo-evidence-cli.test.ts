import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scratch: string[] = [];
const sha = "0123456789abcdef0123456789abcdef01234567";

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("staging demo candidate evidence CLI", () => {
  it("creates one mode-0600 attempt-bound candidate evidence document", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-demo-evidence-"));
    scratch.push(directory);
    const evidencePath = path.join(directory, "staging-demo-candidate-evidence.json");
    const result = spawnSync(process.execPath, [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/create-staging-demo-candidate-evidence.mjs",
      evidencePath
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "erichare/kinresolve",
        RELEASE_RUN_ID: "29470000001",
        RELEASE_RUN_ATTEMPT: "1",
        RELEASE_COMMIT: sha,
        RELEASE_VERSION: "0.18.0",
        CANDIDATE_DEPLOYMENT_ID: "dpl_StagingCandidate123456789"
      }
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(await readFile(evidencePath, "utf8"))).toEqual({
      schemaVersion: 1,
      kind: "kinresolve-staging-demo-candidate-v1",
      repository: "erichare/kinresolve",
      workflowPath: ".github/workflows/vercel-release.yml",
      runId: "29470000001",
      runAttempt: "1",
      headSha: sha,
      releaseVersion: "0.18.0",
      candidateDeploymentId: "dpl_StagingCandidate123456789"
    });
    expect((await stat(evidencePath)).mode & 0o777).toBe(0o600);
  });
});
