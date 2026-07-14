#!/usr/bin/env node
import { loadReleaseContractFiles, validateLoginRedirect } from "../lib/release-contract.ts";

try {
  const deploymentUrl = process.env.DEPLOYMENT_URL;
  const location = process.env.APP_LOCATION;
  if (!deploymentUrl || !location) {
    throw new Error("DEPLOYMENT_URL and APP_LOCATION are required for redirect validation.");
  }
  const files = await loadReleaseContractFiles({ repositoryRoot: process.cwd() });
  const appBaseUrl = files.productionEnvironment.APP_BASE_URL;
  if (!appBaseUrl) {
    throw new Error("APP_BASE_URL is missing from the pulled production environment.");
  }
  validateLoginRedirect({ deploymentUrl, appBaseUrl, location });
  console.log("Production login redirect verified.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
