#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const expected = [
  ["public-json-health", "/api/health", null, 200, "application/json", "public-health-v1"],
  ["login-page", "/login", null, 200, "text/html", "private-beta-login-v1"],
  ["anonymous-app-redirect", "/app", null, 307, null, "canonical-login-redirect-v1"],
  ["anonymous-api-denial", "/api/people", null, 401, "application/json", "private-api-denial-v1"],
  ["unsigned-cron-denial", "/api/cron/integration-jobs", null, 401, "application/json", "unsigned-cron-denial-v1"],
  ["protected-readiness", "/api/internal/health", "KINRESOLVE_OBSERVABILITY_PROBE_SECRET", 200, "application/json", "protected-readiness-v1"],
  ["worker-heartbeats", "/api/internal/health", "KINRESOLVE_OBSERVABILITY_PROBE_SECRET", 200, "application/json", "worker-heartbeats-v1"],
  ["durable-job-lag", "/api/internal/health", "KINRESOLVE_OBSERVABILITY_PROBE_SECRET", 200, "application/json", "durable-job-lag-v1"]
];
const fields = [
  "bodyContract",
  "consecutiveFailures",
  "credentialEnvironmentVariable",
  "expectedContentType",
  "expectedStatus",
  "id",
  "intervalSeconds",
  "maximumResponseBytes",
  "method",
  "path",
  "redirectPolicy",
  "severity"
];

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) throw new Error("Usage: validate-monitor-contract.mjs [contract.json].");
  const contractPath = arguments_[0]
    ? path.resolve(arguments_[0])
    : path.join(process.cwd(), "config", "production-monitors.json");
  const document = JSON.parse(await readFile(contractPath, "utf8"));
  exactObject(document, ["monitors", "originEnvironmentVariable", "schemaVersion"], "root");
  if (
    document.schemaVersion !== 1
    || document.originEnvironmentVariable !== "PRODUCTION_APP_BASE_URL"
    || !Array.isArray(document.monitors)
    || document.monitors.length !== expected.length
  ) throw new Error("The production monitor root contract is invalid.");

  for (const [index, monitor] of document.monitors.entries()) {
    exactObject(monitor, fields, `monitor ${index + 1}`);
    const [id, pathname, credential, status, contentType, bodyContract] = expected[index];
    if (
      monitor.id !== id
      || monitor.path !== pathname
      || monitor.method !== "GET"
      || monitor.credentialEnvironmentVariable !== credential
      || monitor.redirectPolicy !== "error"
      || JSON.stringify(monitor.expectedStatus) !== JSON.stringify([status])
      || monitor.expectedContentType !== contentType
      || monitor.bodyContract !== bodyContract
      || !["SEV-0", "SEV-1"].includes(monitor.severity)
      || !integerBetween(monitor.intervalSeconds, 60, 86_400)
      || !integerBetween(monitor.maximumResponseBytes, 1_024, 262_144)
      || !integerBetween(monitor.consecutiveFailures, 1, 3)
      || !/^\/[a-z0-9/_-]{1,160}$/.test(monitor.path)
      || monitor.path.includes("//")
    ) throw new Error(`Production monitor ${index + 1} does not match its reviewed contract.`);
  }
  const serialized = JSON.stringify(document);
  if (/https?:|bearer|authorization|cookie|token|password/i.test(serialized)) {
    throw new Error("The production monitor contract contains a URL or credential-shaped value.");
  }
  console.log(`Verified ${expected.length} privacy-safe production monitor contracts.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Production monitor validation failed.");
  process.exitCode = 1;
}

function exactObject(value, expectedFields, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The production monitor ${label} must be an object.`);
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expectedFields].sort())) {
    throw new Error(`The production monitor ${label} fields are invalid.`);
  }
}

function integerBetween(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
