#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import {
  validatePulledVercelEnvironmentContract,
  validateVercelEnvironmentContract
} from "../lib/vercel-environment-contract.ts";

try {
  const [metadataFilePath, pulledEnvironmentFilePath = ".vercel/.env.production.local", ...unexpectedArguments] =
    process.argv.slice(2);
  if (!metadataFilePath || unexpectedArguments.length > 0) {
    throw new Error(
      "Usage: validate-vercel-environment.mjs <metadata-json-file> [pulled-environment-file]."
    );
  }

  let document;
  try {
    document = JSON.parse(await readFile(metadataFilePath, "utf8"));
  } catch {
    throw new Error("Vercel environment metadata file is missing or invalid.");
  }

  let pulledEnvironment;
  try {
    pulledEnvironment = await readFile(pulledEnvironmentFilePath, "utf8");
  } catch {
    throw new Error("Pulled Vercel production environment file is missing or invalid.");
  }

  const expectedBetaApplicationsEnabled = process.env.EXPECTED_BETA_APPLICATIONS_ENABLED === undefined
    ? false
    : requiredBoolean("EXPECTED_BETA_APPLICATIONS_ENABLED");
  const profile = process.env.EXPECTED_VERCEL_ENVIRONMENT_PROFILE ?? "hosted-beta";
  if (profile !== "hosted-beta" && profile !== "public-demo") {
    throw new Error("EXPECTED_VERCEL_ENVIRONMENT_PROFILE must be hosted-beta or public-demo.");
  }
  const result = validateVercelEnvironmentContract(document, {
    expectedBetaApplicationsEnabled,
    profile
  });
  const pulledResult = validatePulledVercelEnvironmentContract(pulledEnvironment);
  console.log(
    `Vercel production environment verified: ${result.readableSettings} readable settings and `
      + `${result.sensitiveSettings} Sensitive credentials; ${pulledResult.settings} pulled settings contain no `
      + "workflow-only credentials."
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Vercel environment validation failed.");
  process.exitCode = 1;
}

function requiredBoolean(name) {
  const value = process.env[name];
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be exactly true or false.`);
  }
  return value === "true";
}
