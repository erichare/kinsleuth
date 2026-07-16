#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";

import {
  parseVercelDeploymentJson,
  validateCandidateDeployment,
  validateContainmentCanonicalDeployment,
  validateHoldingDeployment,
  validatePreviousDeployment,
  validatePromotedDeployment
} from "../lib/vercel-release-contract.ts";

const modes = new Set(["previous", "holding", "candidate", "containment", "promoted"]);
const canonicalLookupModes = new Set(["holding", "containment", "promoted"]);

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function readDeploymentDocument(filePath) {
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error("Unable to read the Vercel deployment response file.", { cause: error });
  }
  return parseVercelDeploymentJson(contents);
}

function ownershipExpectations() {
  return {
    expectedProjectId: requiredEnvironment("VERCEL_PROJECT_ID"),
    expectedOrgId: requiredEnvironment("VERCEL_ORG_ID")
  };
}

try {
  const [mode, filePath, canonicalLookupHostname, ...unexpectedArguments] = process.argv.slice(2);
  const requiresCanonicalLookup = canonicalLookupModes.has(mode);
  if (
    !mode
    || !modes.has(mode)
    || !filePath
    || unexpectedArguments.length > 0
    || (requiresCanonicalLookup && !canonicalLookupHostname)
    || (!requiresCanonicalLookup && canonicalLookupHostname !== undefined)
  ) {
    throw new Error(
      "Usage: validate-vercel-deployment.mjs <previous|holding|candidate|containment|promoted> <json-file> [canonical-lookup-hostname]. The canonical lookup hostname is required only for holding, containment, and promoted modes."
    );
  }

  const document = await readDeploymentDocument(filePath);
  const ownership = ownershipExpectations();
  let result;
  if (mode === "previous") {
    result = validatePreviousDeployment(document, ownership);
  } else if (mode === "holding") {
    result = validateHoldingDeployment(document, {
      ...ownership,
      appBaseUrl: requiredEnvironment("APP_BASE_URL"),
      canonicalLookupHostname,
      approvedHoldingDeploymentId: requiredEnvironment("APPROVED_HOLDING_DEPLOYMENT_ID")
    });
  } else if (mode === "candidate") {
    result = validateCandidateDeployment(document, {
      ...ownership,
      appBaseUrl: requiredEnvironment("APP_BASE_URL"),
      expectedGithubCommitSha: requiredEnvironment("EXPECTED_GITHUB_COMMIT_SHA"),
      expectedGithubRunAttempt: requiredEnvironment("EXPECTED_GITHUB_RUN_ATTEMPT"),
      expectedGithubRunId: requiredEnvironment("EXPECTED_GITHUB_RUN_ID"),
      expectedReleaseTag: requiredEnvironment("RELEASE_TAG"),
      expectedPackageVersion: requiredEnvironment("PACKAGE_VERSION"),
      previousDeploymentId: requiredEnvironment("PREVIOUS_DEPLOYMENT_ID")
    });
  } else if (mode === "containment") {
    result = validateContainmentCanonicalDeployment(document, {
      ...ownership,
      appBaseUrl: requiredEnvironment("APP_BASE_URL"),
      canonicalLookupHostname,
      approvedHoldingDeploymentId: requiredEnvironment("APPROVED_HOLDING_DEPLOYMENT_ID"),
      expectedGithubCommitSha: requiredEnvironment("EXPECTED_GITHUB_COMMIT_SHA"),
      expectedGithubRunAttempt: requiredEnvironment("EXPECTED_GITHUB_RUN_ATTEMPT"),
      expectedGithubRunId: requiredEnvironment("EXPECTED_GITHUB_RUN_ID")
    });
  } else {
    result = validatePromotedDeployment(document, {
      ...ownership,
      appBaseUrl: requiredEnvironment("APP_BASE_URL"),
      canonicalLookupHostname,
      candidateDeploymentId: requiredEnvironment("CANDIDATE_DEPLOYMENT_ID")
    });
  }

  const outputs = [
    `deployment_id=${result.id}`,
    `deployment_url=${result.url}`,
    `deployment_status=${result.status}`,
    ...(mode === "containment" ? [
      `containment_required=${result.containmentRequired ? "true" : "false"}`,
      `canonical_state=${result.state}`
    ] : []),
    ""
  ].join("\n");
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, outputs, "utf8");
  }
  process.stdout.write(outputs);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown validation failure.";
  console.error(`Vercel deployment validation failed: ${message}`);
  process.exitCode = 1;
}
