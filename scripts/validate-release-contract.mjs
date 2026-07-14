#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { loadReleaseContractFiles, validateReleaseContract } from "../lib/release-contract.ts";

function gitOutput(args, failureMessage) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(failureMessage);
  }
  return result.stdout.trim();
}

function releaseIsOnMain(releaseCommit) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", releaseCommit, "origin/main"], {
    stdio: "ignore"
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new Error("Unable to verify that the released revision is on origin/main.");
  }
  return result.status === 0;
}

try {
  const releaseTag = process.env.RELEASE_TAG;
  if (!releaseTag) {
    throw new Error("RELEASE_TAG is required.");
  }
  const files = await loadReleaseContractFiles({ repositoryRoot: process.cwd() });
  const releaseCommit = gitOutput(
    ["rev-parse", "--verify", `refs/tags/${releaseTag}^{commit}`],
    "Unable to resolve the stable release tag to a commit."
  );
  const checkedOutCommit = gitOutput(
    ["rev-parse", "--verify", "HEAD^{commit}"],
    "Unable to resolve the checked-out revision."
  );
  const result = validateReleaseContract({
    ...files,
    releaseTag,
    releaseCommit,
    checkedOutCommit,
    releaseIsOnMain: releaseIsOnMain(releaseCommit),
    expectedProjectId: process.env.VERCEL_PROJECT_ID,
    expectedOrgId: process.env.VERCEL_ORG_ID
  });
  console.log(`Stable release contract verified for v${result.version}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
