#!/usr/bin/env node
import { assessReleaseSafetyQueue } from "../lib/release-safety-queue.ts";

const workflowFiles = {
  release: "vercel-release.yml",
  recovery: "recovery-evidence.yml",
  holding: "vercel-holding.yml",
  demo: "staging-demo-session.yml",
  publicDemo: "public-demo-release.yml",
  containment: "release-containment.yml",
  cleanup: "recovery-cleanup.yml",
  holdingSafety: "holding-safety.yml",
  demoSafety: "staging-demo-safety.yml"
};
const safetyContractEpoch = "2026-07-14T00:00:00Z";

try {
  const token = required("GH_TOKEN");
  const repository = repositoryName(required("GITHUB_REPOSITORY"));
  const currentSource = currentSourceName(required("RELEASE_SAFETY_CURRENT_WORKFLOW"));
  const currentRunId = integer(required("GITHUB_RUN_ID"), "GITHUB_RUN_ID", 20);
  const currentRunAttempt = Number(integer(required("GITHUB_RUN_ATTEMPT"), "GITHUB_RUN_ATTEMPT", 10));
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  const [
    releaseRuns,
    recoveryRuns,
    holdingRuns,
    demoRuns,
    containmentRuns,
    cleanupRuns,
    holdingSafetyRuns,
    demoSafetyRuns,
    currentSourceRunDocument
  ] = await Promise.all([
    workflowRuns(repository, workflowFiles.release, "workflow_dispatch", headers),
    workflowRuns(repository, workflowFiles.recovery, "workflow_dispatch", headers),
    workflowRuns(repository, workflowFiles.holding, "workflow_dispatch", headers),
    workflowRuns(repository, workflowFiles.demo, "workflow_dispatch", headers),
    workflowRuns(repository, workflowFiles.containment, "workflow_run", headers),
    workflowRuns(repository, workflowFiles.cleanup, "workflow_run", headers),
    workflowRuns(repository, workflowFiles.holdingSafety, "workflow_run", headers),
    workflowRuns(repository, workflowFiles.demoSafety, "workflow_run", headers),
    apiJson(
      `${apiBase()}/repos/${repository}/actions/runs/${currentRunId}`,
      headers,
      "current source workflow run"
    )
  ]);
  const priorCurrentRunAttempts = [];
  if (currentRunAttempt > 1) {
    for (let attempt = 1; attempt < currentRunAttempt; attempt += 1) {
      priorCurrentRunAttempts.push({
        source: currentSource,
        run: await apiJson(
          `${apiBase()}/repos/${repository}/actions/runs/${currentRunId}/attempts/${attempt}`,
          headers,
          "prior workflow run attempt"
        )
      });
    }
  }

  const assessment = assessReleaseSafetyQueue({
    releaseRuns,
    recoveryRuns,
    holdingRuns,
    demoRuns,
    containmentRuns,
    cleanupRuns,
    holdingSafetyRuns,
    demoSafetyRuns,
    currentSourceRun: {
      source: currentSource,
      expectedRepository: repository,
      expectedRunId: currentRunId,
      expectedRunAttempt: String(currentRunAttempt),
      run: currentSourceRunDocument
    },
    priorCurrentRunAttempts
  });
  if (!assessment.safe) {
    const receipt = assessment.issues
      .map((issue) => `${issue.kind}:${issue.source}:${issue.runId}:${issue.runAttempt}`)
      .join(", ");
    throw new Error(`Release safety work is unresolved (${receipt}).`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      "## Kin Resolve release safety queue\n\n- Prior failed release containment: resolved\n- Prior failed recovery cleanup: resolved\n- Prior failed holding auto-assignment repair: resolved\n- Prior failed staging demo closure: resolved\n",
      "utf8"
    );
  }
  console.log("Verified that no prior release containment, recovery cleanup, holding repair, or demo closure is unresolved.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release safety queue validation failed.");
  process.exitCode = 1;
}

async function workflowRuns(repository, workflow, event, headers) {
  const all = [];
  let expectedTotal;
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({
      event,
      created: `>=${safetyContractEpoch}`,
      per_page: "100",
      page: String(page)
    });
    const document = await apiJson(
      `${apiBase()}/repos/${repository}/actions/workflows/${workflow}/runs?${query}`,
      headers,
      `${workflow} workflow runs`
    );
    if (!isObject(document) || !Number.isSafeInteger(document.total_count) || document.total_count < 0
        || !Array.isArray(document.workflow_runs)) {
      throw new Error(`The ${workflow} workflow run response is malformed.`);
    }
    expectedTotal ??= document.total_count;
    if (document.total_count !== expectedTotal) {
      throw new Error(`The ${workflow} workflow run list changed during pagination.`);
    }
    all.push(...document.workflow_runs);
    if (all.length >= expectedTotal) break;
  }
  if (expectedTotal === undefined || all.length !== expectedTotal) {
    throw new Error(`The ${workflow} workflow run history exceeds the bounded safety audit.`);
  }
  return { total_count: expectedTotal, workflow_runs: all };
}

async function apiJson(url, headers, label) {
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error(`Unable to query ${label}.`);
  }
  if (!response.ok) throw new Error(`GitHub did not return the required ${label}.`);
  try {
    return await response.json();
  } catch {
    throw new Error(`GitHub returned malformed ${label}.`);
  }
}

function apiBase() {
  const value = process.env.RELEASE_SAFETY_API_BASE_URL?.trim();
  if (!value) return "https://api.github.com";
  if (process.env.NODE_ENV !== "test") throw new Error("A custom GitHub API origin is allowed only in tests.");
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== value) {
    throw new Error("The GitHub API test origin is invalid.");
  }
  return value;
}

function repositoryName(value) {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value)) {
    throw new Error("GITHUB_REPOSITORY is malformed.");
  }
  return value;
}

function currentSourceName(value) {
  if (!["release", "recovery", "holding", "demo", "public-demo"].includes(value)) {
    throw new Error("RELEASE_SAFETY_CURRENT_WORKFLOW is malformed.");
  }
  return value;
}

function integer(value, label, maxDigits) {
  if (!new RegExp(`^[1-9][0-9]{0,${maxDigits - 1}}$`).test(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
