#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";

import {
  createProductionBackupCleanupLease,
  validateProductionBackupCleanupLease,
  validateProductionBackupCleanupLeaseSource
} from "../lib/production-backup-cleanup-lease.ts";

try {
  const [mode, filePath, ...unexpected] = process.argv.slice(2);
  if (
    !mode
    || !filePath
    || unexpected.length > 0
    || !["create", "validate", "validate-source"].includes(mode)
  ) {
    throw new Error(
      "Usage: production-backup-cleanup-lease.mjs <create|validate|validate-source> <lease.json>."
    );
  }

  if (mode === "create") {
    const lease = createProductionBackupCleanupLease(expectations());
    await writeFile(filePath, `${JSON.stringify(lease, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await chmod(filePath, 0o600);
    console.log("Created the immutable production backup cleanup lease.");
  } else {
    const value = await json(filePath);
    if (mode === "validate-source") {
      validateProductionBackupCleanupLeaseSource(value, sourceExpectations());
    } else {
      validateProductionBackupCleanupLease(value, expectations());
    }
    console.log("Validated the immutable production backup cleanup lease.");
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Production backup cleanup lease validation failed."
  );
  process.exitCode = 1;
}

async function json(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("The production backup cleanup lease file is missing or invalid JSON.");
  }
}

function sourceExpectations() {
  return {
    sourceRunId: required("SOURCE_RUN_ID"),
    sourceRunAttempt: required("SOURCE_RUN_ATTEMPT"),
    sourceHeadSha: required("SOURCE_HEAD_SHA")
  };
}

function expectations() {
  return {
    ...sourceExpectations(),
    releaseCommit: required("RELEASE_COMMIT"),
    fenceId: required("RELEASE_FENCE_ID"),
    databaseIdentity: required("EXPECTED_DATABASE_IDENTITY")
  };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
