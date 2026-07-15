#!/usr/bin/env node
import { chmod, writeFile } from "node:fs/promises";

import { loadReleaseContractFiles } from "../lib/release-contract.ts";
import { grantAndAttestBetaOperationsRuntimeRole } from "../lib/runtime-database-grants.ts";

try {
  const [outputPath, target, ...unexpected] = process.argv.slice(2);
  if (
    !outputPath
    || unexpected.length > 0
    || (target !== undefined && target !== "--recovery-target")
  ) throw new Error("Invalid runtime grant arguments.");

  const input = target === "--recovery-target"
    ? recoveryTargetInput()
    : await vercelProductionInput();

  const attestation = await grantAndAttestBetaOperationsRuntimeRole(input);
  await writeFile(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(outputPath, 0o600);
  console.log("Beta operations runtime grants applied and re-attested.");
} catch {
  // PostgreSQL and dotenv errors can contain credentials. The detailed library
  // failures remain testable, while protected CI receives only a fixed message.
  console.error("Beta operations runtime grant attestation failed.");
  process.exitCode = 1;
}

async function vercelProductionInput() {
  // Treat Vercel's pulled dotenv strictly as data. Shell-sourcing it would let
  // production secret bytes alter the release runner command stream.
  const files = await loadReleaseContractFiles({ repositoryRoot: process.cwd() });
  return {
    runtimeDatabaseUrl: requiredValue(files.productionEnvironment.DATABASE_URL),
    migrationDatabaseUrl: requiredValue(process.env.MIGRATION_DATABASE_URL),
    expectedDatabaseIdentity: requiredValue(
      files.productionEnvironment.KINRESOLVE_DATABASE_IDENTITY
    ),
    expectedArchiveId: requiredValue(files.productionEnvironment.KINSLEUTH_ARCHIVE_ID)
  };
}

function recoveryTargetInput() {
  // Recovery is an explicit opt-in target. Use only target-specific protected
  // credentials; never fall back to the production runtime or migration URL.
  return {
    runtimeDatabaseUrl: requiredValue(process.env.RECOVERY_TARGET_RUNTIME_DATABASE_URL),
    migrationDatabaseUrl: requiredValue(process.env.RECOVERY_TARGET_DATABASE_URL),
    expectedDatabaseIdentity: requiredValue(process.env.EXPECTED_DATABASE_IDENTITY),
    expectedArchiveId: requiredValue(process.env.EXPECTED_ARCHIVE_ID)
  };
}

function requiredValue(value) {
  const normalized = value?.trim();
  if (!normalized) throw new Error("A required runtime grant value is missing.");
  return normalized;
}
