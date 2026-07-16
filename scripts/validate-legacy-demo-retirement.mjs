#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const expectedWorkflowName = "Operate Kin Resolve synthetic staging demo session";
const expectedWorkflowPath = ".github/workflows/staging-demo-session.yml";
const activeStatuses = Object.freeze(["queued", "in_progress", "waiting", "requested", "pending"]);
const maximumResponseBytes = 256 * 1024;
const timeoutMs = 20_000;

export async function validateLegacyDemoRetirement(
  environment = process.env,
  fetchImplementation = globalThis.fetch
) {
  if (typeof fetchImplementation !== "function") throw retirementError();
  const configuration = resolveConfiguration(environment);
  const workflow = await requestJson(
    `${configuration.apiOrigin}/repos/${configuration.repository}/actions/workflows/${configuration.workflowId}`,
    configuration,
    fetchImplementation
  );
  if (
    String(workflow?.id) !== configuration.workflowId
    || workflow?.name !== expectedWorkflowName
    || workflow?.path !== expectedWorkflowPath
    || workflow?.state !== "disabled_manually"
  ) {
    throw retirementError();
  }

  for (const status of activeStatuses) {
    const runs = await requestJson(
      `${configuration.apiOrigin}/repos/${configuration.repository}/actions/workflows/${configuration.workflowId}/runs?status=${status}&per_page=1`,
      configuration,
      fetchImplementation
    );
    if (
      runs?.total_count !== 0
      || !Array.isArray(runs.workflow_runs)
      || runs.workflow_runs.length !== 0
    ) {
      throw new Error("The retired staging demo workflow still has an active run.");
    }
  }
  return Object.freeze({ workflowId: configuration.workflowId, state: "disabled_manually" });
}

function resolveConfiguration(environment) {
  if (environment.GITHUB_API_URL !== "https://api.github.com") throw retirementError();
  const repository = environment.GITHUB_REPOSITORY;
  const workflowId = environment.KINRESOLVE_STAGING_DEMO_WORKFLOW_ID;
  const token = environment.GH_TOKEN;
  if (
    typeof repository !== "string"
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)
    || typeof workflowId !== "string"
    || !/^[1-9][0-9]{0,19}$/.test(workflowId)
    || typeof token !== "string"
    || token.trim() !== token
    || /[\s\u0000-\u001f\u007f]/u.test(token)
    || token.length < 20
    || token.length > 256
  ) {
    throw retirementError();
  }
  return Object.freeze({
    apiOrigin: environment.GITHUB_API_URL,
    repository,
    workflowId,
    token
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
    throw retirementError();
  }
  return boundedJson(response);
}

async function boundedJson(response) {
  if (!response.body) throw retirementError();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumResponseBytes) throw retirementError();
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
    throw retirementError();
  }
}

function retirementError() {
  return new Error("The legacy staging demo retirement contract failed.");
}

async function main() {
  if (process.argv.length !== 2) throw retirementError();
  await validateLegacyDemoRetirement();
  console.log("Legacy staging demo workflow retirement verified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Legacy staging demo workflow retirement validation failed.");
    process.exitCode = 1;
  });
}
