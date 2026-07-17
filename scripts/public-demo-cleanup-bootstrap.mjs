#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { closeDatabasePools } from "../lib/db.ts";
import {
  cleanupPublicDemoSessions,
  drainPublicDemoSessionsForRelease,
  readPublicDemoDiagnostics
} from "../lib/public-demo-session-store.ts";
import { readRuntimeDatabaseRoleIdentitySha256 } from "../lib/runtime-database-role-identity.ts";

const maximumCleanupAgeMs = 10 * 60 * 1000;
const maximumClockSkewMs = 60 * 1000;
// A normal lifecycle lease lasts four minutes. Observe through that boundary
// without competing with the live scheduler, while staying inside the
// workflow step's five-minute timeout.
const liveCleanupPollAttempts = 49;
const liveCleanupPollDelayMs = 5_000;
// Bound holding cleanup to 100 mutation batches plus one explicit zero-result
// proof batch. The workflow's five-minute timeout remains the outer wall-clock
// bound for slow batches.
const holdingCleanupBatchLimit = 100;
const maximumHoldingCleanupBatches = 101;

const defaultOperations = Object.freeze({
  cleanup: cleanupPublicDemoSessions,
  drain: drainPublicDemoSessionsForRelease,
  readDiagnostics: readPublicDemoDiagnostics,
  readRuntimeRoleIdentity: readRuntimeDatabaseRoleIdentitySha256,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
});

export async function runPublicDemoCleanupBootstrap(
  environment = process.env,
  operations = defaultOperations,
  clock = () => new Date()
) {
  const configuration = resolveConfiguration(environment);
  if (
    typeof operations?.cleanup !== "function"
    || typeof operations?.drain !== "function"
    || typeof operations?.readDiagnostics !== "function"
    || typeof operations?.readRuntimeRoleIdentity !== "function"
    || typeof operations?.sleep !== "function"
    || typeof clock !== "function"
  ) {
    throw bootstrapError();
  }
  const databaseOptions = { databaseUrl: configuration.runtimeDatabaseUrl };
  const roleIdentity = await operations.readRuntimeRoleIdentity(databaseOptions);
  if (roleIdentity !== configuration.expectedRuntimeRoleIdentitySha256) {
    throw bootstrapError();
  }

  if (configuration.rollbackKind === "public-demo") {
    for (let attempt = 1; attempt <= liveCleanupPollAttempts; attempt += 1) {
      const observedAt = validNow(clock());
      const diagnostics = await operations.readDiagnostics({ now: observedAt }, databaseOptions);
      const state = cleanupState(diagnostics, observedAt);
      if (state === "healthy") return Object.freeze({ bootstrapped: false });
      if (state !== "running" || attempt === liveCleanupPollAttempts) throw bootstrapError();
      await operations.sleep(liveCleanupPollDelayMs);
    }
    throw bootstrapError();
  }

  const drainAt = validNow(clock());
  const drainResult = await operations.drain({ now: drainAt }, databaseOptions);
  if (!validDrainResult(drainResult)) throw bootstrapError();
  let cleanupCompleted = false;
  for (let attempt = 1; attempt <= maximumHoldingCleanupBatches; attempt += 1) {
    const cleanupAt = validNow(clock());
    const result = await operations.cleanup(
      { limit: holdingCleanupBatchLimit, now: cleanupAt },
      databaseOptions
    );
    if (
      !validCleanupResult(result)
      || result.archivesCleaned > holdingCleanupBatchLimit
    ) {
      throw bootstrapError();
    }
    if (result.archivesCleaned === 0) {
      cleanupCompleted = true;
      break;
    }
  }
  if (!cleanupCompleted) throw bootstrapError();
  const observedAt = validNow(clock());
  const diagnostics = await operations.readDiagnostics({ now: observedAt }, databaseOptions);
  if (
    cleanupState(diagnostics, observedAt) !== "healthy"
    || !emptyCapacity(diagnostics)
  ) {
    throw bootstrapError();
  }
  return Object.freeze({ bootstrapped: true });
}

function resolveConfiguration(environment) {
  if (
    environment.DATABASE_AUTO_MIGRATE !== "false"
    || environment.KINRESOLVE_DATASET_MODE !== "demo"
    || environment.KINRESOLVE_PUBLIC_DEMO_ENABLED !== "true"
  ) {
    throw new Error("The protected public demo cleanup profile is invalid.");
  }
  const rollbackKind = environment.ROLLBACK_KIND;
  if (rollbackKind !== "holding" && rollbackKind !== "public-demo") {
    throw new Error("ROLLBACK_KIND must be holding or public-demo.");
  }
  const runtimeDatabaseUrl = requiredValue(
    environment.PUBLIC_DEMO_RUNTIME_DATABASE_URL,
    "PUBLIC_DEMO_RUNTIME_DATABASE_URL"
  );
  const expectedRuntimeRoleIdentitySha256 = environment.EXPECTED_RUNTIME_ROLE_IDENTITY_SHA256;
  if (
    typeof expectedRuntimeRoleIdentitySha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(expectedRuntimeRoleIdentitySha256)
  ) {
    throw new Error("EXPECTED_RUNTIME_ROLE_IDENTITY_SHA256 is required.");
  }
  return Object.freeze({ rollbackKind, runtimeDatabaseUrl, expectedRuntimeRoleIdentitySha256 });
}

function validNow(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw bootstrapError();
  return value;
}

function requiredValue(value, name) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function cleanupState(diagnostics, now) {
  const cleanup = objectValue(diagnostics?.cleanup);
  if (!cleanup || typeof cleanup.leaseHeld !== "boolean") throw bootstrapError();
  const startedAt = timestamp(cleanup.lastStartedAt);
  const completedAt = timestamp(cleanup.lastCompletedAt);
  const failedAt = timestamp(cleanup.lastFailedAt);
  if (cleanup.leaseHeld) return "running";
  if (failedAt !== null && (completedAt === null || failedAt > completedAt)) return "failed";
  if (startedAt !== null && (completedAt === null || startedAt > completedAt)) return "interrupted";
  if (completedAt === null) return "missing";
  const age = now.getTime() - completedAt;
  return age >= -maximumClockSkewMs && age <= maximumCleanupAgeMs ? "healthy" : "stale";
}

function timestamp(value) {
  if (value === null) return null;
  if (typeof value !== "string") throw bootstrapError();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw bootstrapError();
  return parsed;
}

function validCleanupResult(value) {
  const result = objectValue(value);
  if (!result) return false;
  const keys = ["archivesCleaned", "eventsDeleted", "expired", "staleProvisioningRecovered"];
  return sameKeys(result, keys) && keys.every((key) => nonnegativeInteger(result[key]));
}

function validDrainResult(value) {
  const result = objectValue(value);
  if (!result) return false;
  const keys = ["aiAttemptsClosed", "sessionsDrained"];
  return sameKeys(result, keys) && keys.every((key) => nonnegativeInteger(result[key]));
}

function emptyCapacity(diagnostics) {
  const capacity = objectValue(diagnostics?.capacity);
  return capacity?.active === 0
    && capacity.provisioning === 0
    && capacity.available === 25;
}

function objectValue(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function sameKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function bootstrapError() {
  return new Error("The protected public demo cleanup bootstrap failed.");
}

async function main() {
  if (process.argv.length !== 2) throw new Error("Unexpected cleanup bootstrap arguments.");
  try {
    await runPublicDemoCleanupBootstrap();
    console.log("Protected public demo cleanup bootstrap passed.");
  } finally {
    await closeDatabasePools();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Protected public demo cleanup bootstrap failed.");
    process.exitCode = 1;
  });
}
