#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { validatePublicDemoAiGatewayContract } from "../lib/public-demo-ai-gateway-contract.ts";

try {
  const [metadataFilePath, ...unexpectedArguments] = process.argv.slice(2);
  if (!metadataFilePath || unexpectedArguments.length > 0) {
    throw new Error("Usage: validate-public-demo-ai-gateway-key.mjs <metadata-json-file>.");
  }

  let document;
  try {
    document = JSON.parse(await readFile(metadataFilePath, "utf8"));
  } catch {
    throw new Error("AI Gateway key metadata file is missing or invalid.");
  }

  const budget = required("EXPECTED_AI_GATEWAY_MONTHLY_BUDGET_USD");
  if (!/^[1-9][0-9]{0,2}$/.test(budget)) {
    throw new Error("EXPECTED_AI_GATEWAY_MONTHLY_BUDGET_USD is invalid.");
  }
  const result = validatePublicDemoAiGatewayContract(document, {
    apiKeyId: required("EXPECTED_AI_GATEWAY_API_KEY_ID"),
    monthlyBudgetUsd: Number(budget),
    teamId: required("EXPECTED_AI_GATEWAY_TEAM_ID")
  });
  console.log(
    `Dedicated public demo AI Gateway key verified: $${result.monthlyBudgetUsd} monthly hard budget; `
      + `$${result.currentSpendUsd} current spend.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "AI Gateway key validation failed.");
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
