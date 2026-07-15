#!/usr/bin/env node
import {
  releaseSmokeRequests,
  validateReleaseDatabaseIdentity,
  validatePrivateReleaseHeaders,
  validateReleaseHealth,
  validateReleaseHtml,
  validateStaticHoldingHealth
} from "../lib/release-smoke.ts";
import { validateLoginRedirect } from "../lib/release-contract.ts";

const origin = strictOrigin(process.env.SMOKE_ORIGIN, "SMOKE_ORIGIN");
const appBaseUrl = strictOrigin(process.env.APP_BASE_URL, "APP_BASE_URL");
const expectedVersion = required(process.env.RELEASE_VERSION, "RELEASE_VERSION");
const expectedDatasetMode = datasetMode(process.env.KINRESOLVE_DATASET_MODE);
const expectedDatabaseIdentity = required(
  process.env.KINRESOLVE_DATABASE_IDENTITY,
  "KINRESOLVE_DATABASE_IDENTITY"
);
const phase = process.env.SMOKE_PHASE ?? "full";
if (phase !== "pre-migration" && phase !== "identity" && phase !== "full") {
  fail("SMOKE_PHASE must be pre-migration, identity, or full.");
}
const expectedReleaseCommit = phase === "pre-migration"
  ? undefined
  : gitSha(process.env.RELEASE_COMMIT, "RELEASE_COMMIT");
const expectedScheduledWritesEnabled = phase === "full"
  ? strictBoolean(
      process.env.KINRESOLVE_SCHEDULED_WRITES_ENABLED,
      "KINRESOLVE_SCHEDULED_WRITES_ENABLED"
    )
  : undefined;

try {
  const login = await request("/login", "GET");
  validateReleaseHtml(login);
  validatePrivateReleaseHeaders(login.headers);

  if (phase === "pre-migration") {
    validateStaticHoldingHealth(await request("/api/health", "GET"));
  } else if (phase === "identity") {
    const health = await request("/api/internal/health", "GET");
    validateReleaseDatabaseIdentity({
      ...health,
      expectedReleaseCommit,
      expectedVersion,
      expectedDatabaseIdentity
    });
  } else if (phase === "full") {
    const health = await request("/api/internal/health", "GET");
    validateReleaseHealth({
      ...health,
      expectedReleaseCommit,
      expectedVersion,
      expectedDatasetMode,
      expectedDatabaseIdentity,
      expectedScheduledWritesEnabled
    });

    const app = await request("/app", "GET");
    if (![302, 303, 307, 308].includes(app.status)) {
      throw new Error(`Protected application must redirect; received HTTP ${app.status}.`);
    }
    validateLoginRedirect({
      deploymentUrl: origin,
      appBaseUrl,
      location: app.headers.get("location") ?? ""
    });

    await requireJsonStatus("/api/people", 401);
    await requireJsonStatus("/api/cron/integration-jobs", 401);
    await requireJsonStatus("/api/auth/session", 200);
  }

  const declaredMethods = new Set(releaseSmokeRequests.map((entry) => entry.method));
  if ([...declaredMethods].some((method) => method !== "GET" && method !== "HEAD")) {
    throw new Error("Release smoke contract contains a mutating request method.");
  }
  const phaseLabel = phase === "full" ? "Full" : phase === "identity" ? "Identity" : "Pre-migration";
  console.log(`${phaseLabel} non-mutating release smoke passed.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function requireJsonStatus(pathname, expectedStatus) {
  const response = await request(pathname, "GET");
  if (response.status !== expectedStatus) {
    throw new Error(`${pathname} must return HTTP ${expectedStatus}; received ${response.status}.`);
  }
  if (!response.contentType?.toLowerCase().startsWith("application/json")) {
    throw new Error(`${pathname} must return JSON.`);
  }
  try {
    JSON.parse(response.body);
  } catch (error) {
    throw new Error(`${pathname} did not return valid JSON.`, { cause: error });
  }
}

async function request(pathname, method) {
  if (method !== "GET" && method !== "HEAD") {
    throw new Error("Release smoke requests must be non-mutating.");
  }
  const headers = new Headers();
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypassSecret) headers.set("x-vercel-protection-bypass", bypassSecret);
  if (pathname === "/api/internal/health") {
    headers.set(
      "authorization",
      `Bearer ${required(
        process.env.KINRESOLVE_OBSERVABILITY_PROBE_SECRET,
        "KINRESOLVE_OBSERVABILITY_PROBE_SECRET"
      )}`
    );
  }

  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const response = await fetch(new URL(pathname, origin), {
        method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000)
      });
      if (isRetryableStatus(response.status) && attempt < 10) {
        await response.arrayBuffer();
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        continue;
      }
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: method === "HEAD" ? "" : await response.text(),
        headers: response.headers
      };
    } catch (error) {
      lastError = error;
      if (attempt < 10) await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  throw new Error(`Release probe failed for ${pathname}.`, { cause: lastError });
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function strictOrigin(value, name) {
  const requiredValue = required(value, name);
  try {
    const url = new URL(requiredValue);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    fail(`${name} must be one HTTPS origin.`);
  }
}

function datasetMode(value) {
  if (value === "empty" || value === "demo" || value === "pilot") return value;
  fail("KINRESOLVE_DATASET_MODE must be empty, demo, or pilot.");
}

function required(value, name) {
  if (!value?.trim()) fail(`${name} is required.`);
  return value.trim();
}

function gitSha(value, name) {
  const normalized = required(value, name).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) fail(`${name} must be a full lowercase Git SHA.`);
  return normalized;
}

function strictBoolean(value, name) {
  const normalized = required(value, name).toLowerCase();
  if (normalized !== "true" && normalized !== "false") {
    fail(`${name} must be exactly true or false.`);
  }
  return normalized === "true";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
