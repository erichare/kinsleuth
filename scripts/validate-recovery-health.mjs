#!/usr/bin/env node
import { chmod, writeFile } from "node:fs/promises";

import { validateReleaseHealth } from "../lib/release-smoke.ts";

try {
  const [outputPath, ...unexpected] = process.argv.slice(2);
  if (!outputPath || unexpected.length > 0) {
    throw new Error("Usage: validate-recovery-health.mjs <output.json>.");
  }
  const origin = loopbackOrigin(required("RECOVERY_APP_ORIGIN"));
  const response = await fetch(new URL("/api/internal/health", origin), {
    redirect: "error",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${required("KINRESOLVE_OBSERVABILITY_PROBE_SECRET")}`
    },
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.text();
  validateReleaseHealth({
    status: response.status,
    contentType: response.headers.get("content-type"),
    body,
    expectedReleaseCommit: gitSha(required("RELEASE_COMMIT")),
    expectedVersion: required("RELEASE_VERSION"),
    expectedDatasetMode: "pilot",
    expectedDatabaseIdentity: required("RECOVERY_TARGET_DATABASE_IDENTITY"),
    requireOperationalDiagnostics: true
  });
  await writeFile(outputPath, `${JSON.stringify({ status: "pass", checkedAt: new Date().toISOString() }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(outputPath, 0o600);
  console.log("Validated the restored candidate application and health contract.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Restored application health validation failed.");
  process.exitCode = 1;
}

function loopbackOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("RECOVERY_APP_ORIGIN is invalid.");
  }
  if (
    parsed.protocol !== "http:"
    || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("RECOVERY_APP_ORIGIN must be an HTTP loopback origin.");
  }
  return parsed;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function gitSha(value) {
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new Error("RELEASE_COMMIT must be a full lowercase Git SHA.");
  }
  return value;
}
