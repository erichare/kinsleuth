#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const expectedWorkflowName = "Product CI";
const expectedWorkflowPath = ".github/workflows/ci.yml";
const expectedGateName = "Product release contract";
const maximumResponseBytes = 512 * 1024;
const timeoutMs = 20_000;

export async function validatePublicDemoGithubReadiness(
  environment = process.env,
  fetchImplementation = globalThis.fetch
) {
  if (typeof fetchImplementation !== "function") throw readinessError();
  const configuration = configurationFrom(environment);
  const workflow = await requestJson(
    `${configuration.apiOrigin}/repos/${configuration.repository}/actions/workflows/${configuration.workflowId}`,
    configuration,
    fetchImplementation
  );
  if (
    String(workflow?.id) !== configuration.workflowId
    || workflow?.name !== expectedWorkflowName
    || workflow?.path !== expectedWorkflowPath
    || workflow?.state !== "active"
  ) {
    throw readinessError();
  }

  const query = new URLSearchParams({
    branch: "main",
    event: "push",
    head_sha: configuration.releaseCommit,
    per_page: "100",
    status: "success"
  });
  const runs = await requestJson(
    `${configuration.apiOrigin}/repos/${configuration.repository}/actions/workflows/${configuration.workflowId}/runs?${query}`,
    configuration,
    fetchImplementation
  );
  const run = validatedRun(runs, configuration);
  const jobs = await requestJson(
    `${configuration.apiOrigin}/repos/${configuration.repository}/actions/runs/${run.id}/attempts/${run.runAttempt}/jobs?per_page=100`,
    configuration,
    fetchImplementation
  );
  validateGateJob(jobs, run, configuration.releaseCommit);

  for (const severity of ["high", "critical"]) {
    const alerts = await requestJson(
      `${configuration.apiOrigin}/repos/${configuration.repository}/code-scanning/alerts?state=open&severity=${severity}&per_page=100`,
      configuration,
      fetchImplementation
    );
    if (!Array.isArray(alerts)) throw readinessError();
    if (alerts.length !== 0) {
      throw new Error("An open high-severity public demo security alert blocks release.");
    }
  }

  return Object.freeze({ runId: run.id, runAttempt: run.runAttempt, gate: "success" });
}

function validatedRun(document, configuration) {
  if (
    !isObject(document)
    || !Number.isSafeInteger(document.total_count)
    || document.total_count < 1
    || document.total_count > 100
    || !Array.isArray(document.workflow_runs)
    || document.workflow_runs.length !== document.total_count
  ) {
    throw readinessError();
  }
  const runs = document.workflow_runs.filter((run) =>
    isObject(run)
    && positiveInteger(run.id)
    && positiveInteger(run.run_attempt)
    && String(run.workflow_id) === configuration.workflowId
    && run.name === expectedWorkflowName
    && run.path === expectedWorkflowPath
    && run.event === "push"
    && run.head_branch === "main"
    && run.head_sha === configuration.releaseCommit
    && run.status === "completed"
    && run.conclusion === "success"
    && isObject(run.head_repository)
    && run.head_repository.full_name === configuration.repository
  );
  if (runs.length !== document.workflow_runs.length) throw readinessError();
  const selected = runs.reduce((latest, candidate) =>
    latest === undefined || candidate.id > latest.id ? candidate : latest
  , undefined);
  if (!selected) throw readinessError();
  return Object.freeze({ id: selected.id, runAttempt: selected.run_attempt });
}

function validateGateJob(document, run, releaseCommit) {
  if (
    !isObject(document)
    || !Number.isSafeInteger(document.total_count)
    || document.total_count < 1
    || document.total_count > 100
    || !Array.isArray(document.jobs)
    || document.jobs.length !== document.total_count
  ) {
    throw readinessError();
  }
  const gateJobs = document.jobs.filter((job) => isObject(job) && job.name === expectedGateName);
  if (gateJobs.length !== 1) throw readinessError();
  const gate = gateJobs[0];
  if (
    !positiveInteger(gate.id)
    || gate.run_id !== run.id
    || gate.run_attempt !== run.runAttempt
    || gate.head_sha !== releaseCommit
    || gate.status !== "completed"
    || gate.conclusion !== "success"
  ) {
    throw readinessError();
  }
}

function configurationFrom(environment) {
  if (environment.GITHUB_API_URL !== "https://api.github.com") throw readinessError();
  const repository = environment.GITHUB_REPOSITORY;
  const workflowId = environment.PRODUCT_CI_WORKFLOW_ID;
  const releaseCommit = environment.RELEASE_COMMIT;
  const token = environment.GH_TOKEN;
  if (
    typeof repository !== "string"
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)
    || typeof workflowId !== "string"
    || !/^[1-9][0-9]{0,19}$/.test(workflowId)
    || typeof releaseCommit !== "string"
    || !/^[a-f0-9]{40}$/.test(releaseCommit)
    || typeof token !== "string"
    || token.trim() !== token
    || /[\s\u0000-\u001f\u007f]/u.test(token)
    || token.length < 20
    || token.length > 256
  ) {
    throw readinessError();
  }
  return Object.freeze({
    apiOrigin: environment.GITHUB_API_URL,
    releaseCommit,
    repository,
    token,
    workflowId
  });
}

async function requestJson(url, configuration, fetchImplementation) {
  const response = await fetchImplementation(url, {
    cache: "no-store",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${configuration.token}`,
      "x-github-api-version": "2022-11-28"
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (
    response.status !== 200
    || response.redirected
    || response.headers.has("location")
    || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")
  ) {
    throw readinessError();
  }
  return boundedJson(response);
}

async function boundedJson(response) {
  if (!response.body) throw readinessError();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumResponseBytes) throw readinessError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw readinessError();
  }
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readinessError() {
  return new Error("The public demo GitHub release readiness contract failed.");
}

async function main() {
  if (process.argv.length !== 2) throw readinessError();
  const result = await validatePublicDemoGithubReadiness();
  console.log(`Public demo GitHub readiness verified for run ${result.runId} attempt ${result.runAttempt}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Public demo GitHub release readiness validation failed.");
    process.exitCode = 1;
  });
}
