import type { DatasetMode } from "./hosted-config";

type HealthValidationInput = {
  status: number;
  contentType: string | null;
  body: string;
  expectedReleaseCommit: string;
  expectedVersion: string;
  expectedDatasetMode: DatasetMode;
  expectedDatabaseIdentity: string;
  expectedScheduledWritesEnabled?: boolean;
  requireOperationalDiagnostics?: boolean;
};

type HtmlValidationInput = {
  status: number;
  contentType: string | null;
  body: string;
};

export const releaseSmokeRequests = [
  { path: "/login", method: "GET", expectation: "html" },
  { path: "/api/internal/health", method: "GET", expectation: "authenticated-health" },
  { path: "/app", method: "GET", expectation: "canonical-login-redirect" },
  { path: "/api/people", method: "GET", expectation: "anonymous-denial" },
  { path: "/api/cron/integration-jobs", method: "GET", expectation: "unsigned-cron-denial" },
  { path: "/api/auth/session", method: "GET", expectation: "anonymous-session" }
] as const;

const cohortOneCapabilities = {
  dna: false,
  externalAi: false,
  publicArchive: false,
  publicPublishing: false,
  evidenceBinaryUploads: false,
  packageMedia: false,
  plainGedcom: true
} as const;

const operationalWorkerKinds = new Set([
  "import-upload-cleanup",
  "integration-jobs",
  "retention-cleanup"
]);
const workerOutcomes = new Set(["failed", "missing", "running", "succeeded"]);
const freshnessValues = new Set(["critical", "healthy", "warning"]);
const workerFailureCodes = new Set([
  "AUTHORIZATION_ERROR",
  "CONFIGURATION_ERROR",
  "DATABASE_ERROR",
  "NETWORK_ERROR",
  "STORAGE_ERROR",
  "TEST_ALERT",
  "TIMEOUT",
  "UNEXPECTED_ERROR"
]);

const requiredPrivateHeaders = {
  "content-security-policy": undefined,
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "x-robots-tag": "noindex, nofollow, noarchive"
} as const;

export function validateStaticHoldingHealth(input: { status: number }): void {
  if (input.status !== 404) {
    throw new Error(`The static holding deployment health route must return HTTP 404; received ${input.status}.`);
  }
}

export function validateReleaseHealth(input: HealthValidationInput): {
  version: string;
  datasetMode: DatasetMode;
  scheduledWritesEnabled: boolean;
} {
  if (input.status !== 200) {
    throw new Error(`Release health must return HTTP 200; received ${input.status}.`);
  }
  if (!input.contentType?.toLowerCase().startsWith("application/json")) {
    throw new Error("Release health must return JSON, not an HTML holding or protection page.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch (error) {
    throw new Error("Release health body is not valid JSON.", { cause: error });
  }
  const health = record(parsed, "Release health");
  if (health.status !== "ok") throw new Error("Release health status must be ok.");
  if (health.product !== "KinSleuth") throw new Error("Release health product identity is invalid.");
  if (health.version !== input.expectedVersion) throw new Error("Release health version does not match the candidate.");
  validateReleaseCommit(health, input.expectedReleaseCommit);

  const database = record(health.database, "Release health database");
  for (const field of ["configured", "connected", "provisioned", "datasetModeMatches"] as const) {
    if (database[field] !== true) throw new Error(`Release health database ${field} must be true.`);
  }
  validateDatabaseIdentityFields(database, input.expectedDatabaseIdentity);
  if (
    database.datasetMode !== input.expectedDatasetMode
    || database.expectedDatasetMode !== input.expectedDatasetMode
  ) {
    throw new Error("Release health database dataset mode does not match the release target.");
  }

  const storage = record(health.storage, "Release health storage");
  if (
    storage.configured !== true
    || storage.identityConfigured !== true
    || storage.identityVerified !== true
  ) {
    throw new Error("Release health private storage identity must be configured and verified.");
  }

  const capabilities = record(health.capabilities, "Release health capabilities");
  if (capabilities.valid !== true) throw new Error("Release health capability configuration must be valid.");
  if (capabilities.deploymentMode !== "hosted") throw new Error("Release health deployment mode must be hosted.");
  if (capabilities.datasetMode !== input.expectedDatasetMode) {
    throw new Error("Release health capability dataset mode does not match the release target.");
  }
  for (const [name, expected] of Object.entries(cohortOneCapabilities)) {
    if (capabilities[name] !== expected) {
      throw new Error(`Release health capability ${name} does not match cohort one.`);
    }
  }
  if (capabilities.gedcomFileLimitBytes !== 10 * 1024 * 1024) {
    throw new Error("Release health GEDCOM file limit does not match cohort one.");
  }
  if (capabilities.gedcomPersonLimit !== 40_000) {
    throw new Error("Release health GEDCOM person limit does not match cohort one.");
  }

  const scheduledWrites = record(health.scheduledWrites, "Release health scheduled writes");
  if (
    scheduledWrites.valid !== true
    || scheduledWrites.configured !== true
    || typeof scheduledWrites.enabled !== "boolean"
  ) {
    throw new Error("Release health scheduled-write configuration must be explicit and valid.");
  }
  if (
    input.expectedScheduledWritesEnabled !== undefined
    && scheduledWrites.enabled !== input.expectedScheduledWritesEnabled
  ) {
    throw new Error("Release health scheduled-write value does not match the release cell.");
  }

  if (input.requireOperationalDiagnostics) validateOperationalDiagnostics(health);

  return {
    version: input.expectedVersion,
    datasetMode: input.expectedDatasetMode,
    scheduledWritesEnabled: scheduledWrites.enabled
  };
}

function validateOperationalDiagnostics(health: Record<string, unknown>): void {
  if (!Array.isArray(health.workers) || health.workers.length !== operationalWorkerKinds.size) {
    throw new Error("Release health operational workers must contain the exact worker set.");
  }
  const observedKinds = new Set<string>();
  for (const value of health.workers) {
    const worker = record(value, "Release health operational worker");
    const expectedFields = new Set(["ageSeconds", "freshness", "outcome", "workerKind"]);
    if (worker.lastFailureCode !== undefined) expectedFields.add("lastFailureCode");
    requireExactFields(worker, expectedFields, "Release health operational worker");
    if (
      typeof worker.workerKind !== "string"
      || !operationalWorkerKinds.has(worker.workerKind)
      || observedKinds.has(worker.workerKind)
      || typeof worker.outcome !== "string"
      || !workerOutcomes.has(worker.outcome)
      || typeof worker.freshness !== "string"
      || !freshnessValues.has(worker.freshness)
      || (worker.outcome === "missing"
        ? worker.ageSeconds !== null
        : !isNonnegativeInteger(worker.ageSeconds))
      || (worker.lastFailureCode !== undefined && (
        typeof worker.lastFailureCode !== "string"
        || !workerFailureCodes.has(worker.lastFailureCode)
      ))
    ) {
      throw new Error("Release health operational worker diagnostics are malformed.");
    }
    observedKinds.add(worker.workerKind);
  }

  const jobLag = record(health.jobLag, "Release health operational job lag");
  requireExactFields(jobLag, new Set([
    "eligibleCount",
    "eligibleCountCapped",
    "freshness",
    "oldestEligibleAgeSeconds",
    "recentFailedCount",
    "recentFailedCountCapped"
  ]), "Release health operational job lag");
  if (
    !isBoundedCount(jobLag.eligibleCount)
    || typeof jobLag.eligibleCountCapped !== "boolean"
    || (jobLag.oldestEligibleAgeSeconds !== null
      && !isNonnegativeInteger(jobLag.oldestEligibleAgeSeconds))
    || !isBoundedCount(jobLag.recentFailedCount)
    || typeof jobLag.recentFailedCountCapped !== "boolean"
    || typeof jobLag.freshness !== "string"
    || !freshnessValues.has(jobLag.freshness)
  ) {
    throw new Error("Release health operational job lag diagnostics are malformed.");
  }
}

function requireExactFields(
  value: Record<string, unknown>,
  expected: Set<string>,
  label: string
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((field) => !expected.has(field))) {
    throw new Error(`${label} fields are malformed.`);
  }
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedCount(value: unknown): value is number {
  return isNonnegativeInteger(value) && value <= 1_000;
}

export function validateReleaseDatabaseIdentity(input: {
  status: number;
  contentType: string | null;
  body: string;
  expectedReleaseCommit: string;
  expectedVersion: string;
  expectedDatabaseIdentity: string;
}): { databaseIdentity: string } {
  if (input.status !== 200 && input.status !== 503) {
    throw new Error(`Release identity probe must return HTTP 200 or 503; received ${input.status}.`);
  }
  if (!input.contentType?.toLowerCase().startsWith("application/json")) {
    throw new Error("Release identity probe must return JSON.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch (error) {
    throw new Error("Release identity body is not valid JSON.", { cause: error });
  }
  const health = record(parsed, "Release identity health");
  if (health.product !== "KinSleuth" || health.version !== input.expectedVersion) {
    throw new Error("Release identity product or version does not match the candidate.");
  }
  validateReleaseCommit(health, input.expectedReleaseCommit);
  const database = record(health.database, "Release identity database");
  validateDatabaseIdentityFields(database, input.expectedDatabaseIdentity);
  return { databaseIdentity: input.expectedDatabaseIdentity };
}

function validateReleaseCommit(health: Record<string, unknown>, expectedReleaseCommit: string): void {
  if (!/^[a-f0-9]{40}$/.test(expectedReleaseCommit)) {
    throw new Error("The expected release commit is invalid.");
  }
  if (health.releaseCommitSha !== expectedReleaseCommit) {
    throw new Error("Release health commit does not match the exact candidate artifact.");
  }
}

function validateDatabaseIdentityFields(
  database: Record<string, unknown>,
  expectedDatabaseIdentity: string
): void {
  if (!/^[a-f0-9]{64}$/.test(expectedDatabaseIdentity)) {
    throw new Error("The expected release database identity is invalid.");
  }
  if (
    database.identityConfigured !== true
    || database.identityMatchesConfigured !== true
    || database.transportVerified !== true
    || database.identity !== expectedDatabaseIdentity
  ) {
    throw new Error("Release health database identity or transport does not match the release cell.");
  }
}

export function validatePrivateReleaseHeaders(headers: Headers): void {
  for (const [name, expected] of Object.entries(requiredPrivateHeaders)) {
    const actual = headers.get(name);
    if (!actual) throw new Error(`Required release header ${name} is missing.`);
    if (expected !== undefined && actual !== expected) {
      throw new Error(`Required release header ${name} has an unexpected value.`);
    }
  }

  const contentSecurityPolicy = headers.get("content-security-policy")!;
  if (contentSecurityPolicy.includes("'unsafe-eval'")) {
    throw new Error("Production Content-Security-Policy must not allow unsafe-eval.");
  }
  for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) {
    if (!contentSecurityPolicy.includes(directive)) {
      throw new Error(`Production Content-Security-Policy must include ${directive}.`);
    }
  }
}

export function validateReleaseHtml(input: HtmlValidationInput): void {
  if (input.status !== 200) throw new Error(`Release login must return HTTP 200; received ${input.status}.`);
  if (!input.contentType?.toLowerCase().startsWith("text/html")) {
    throw new Error("Release login must return HTML.");
  }
  if (!/Kin Resolve/i.test(input.body)) {
    throw new Error("Release login HTML does not contain the Kin Resolve product identity.");
  }
  if (!/(?:private beta|invitation-only hosted beta)/i.test(input.body)) {
    throw new Error("Release login HTML does not contain the private beta boundary.");
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}
