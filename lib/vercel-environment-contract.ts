import { hostedCapabilityEnvironmentNames } from "./hosted-capability-names.ts";

export const requiredSensitiveProductionEnvironmentNames = [
  "AUTH_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "CRON_SECRET",
  "DATABASE_URL",
  "KINRESOLVE_API_CURSOR_SECRET",
  "KINRESOLVE_BETA_PRIVACY_HMAC_SECRET",
  "KINRESOLVE_OBSERVABILITY_INGEST_SECRET",
  "KINRESOLVE_OBSERVABILITY_PROBE_SECRET",
  "RELEASE_FENCE_SECRET",
  "RESEND_API_KEY"
] as const;

export const betaApplicationSensitiveEnvironmentName =
  "KINRESOLVE_BETA_APPLICATION_HMAC_SECRET" as const;

export const requiredReadableProductionEnvironmentNames = [
  "APP_BASE_URL",
  "DATABASE_AUTO_MIGRATE",
  "DATABASE_POOL_MAX",
  "KINRESOLVE_BETA_BOUNDARY_SHA256",
  "KINRESOLVE_BETA_BOUNDARY_URL",
  "KINRESOLVE_BETA_BOUNDARY_VERSION",
  "KINRESOLVE_BETA_LEGAL_STATUS",
  "KINRESOLVE_BETA_OPERATOR_AUDIENCE",
  "KINRESOLVE_BETA_OPERATOR_KEY_ID",
  "KINRESOLVE_BETA_OPERATOR_PUBLIC_KEY_SPKI",
  "KINRESOLVE_BETA_PARTICIPATION_TERMS_SHA256",
  "KINRESOLVE_BETA_PARTICIPATION_TERMS_URL",
  "KINRESOLVE_BETA_PARTICIPATION_TERMS_VERSION",
  "KINRESOLVE_BETA_PRIVACY_NOTICE_SHA256",
  "KINRESOLVE_BETA_PRIVACY_NOTICE_URL",
  "KINRESOLVE_BETA_PRIVACY_NOTICE_VERSION",
  "KINRESOLVE_BETA_APPLICATIONS_ENABLED",
  "KINRESOLVE_API_V1_ENABLED",
  "KINRESOLVE_DEPLOYMENT_MODE",
  "KINRESOLVE_DATASET_MODE",
  "KINRESOLVE_DATABASE_IDENTITY",
  "KINRESOLVE_EXPORT_REFRESH_ENABLED",
  "KINRESOLVE_GUIDED_RESEARCH_ENABLED",
  "KINRESOLVE_OBJECT_STORAGE_BACKEND",
  "KINRESOLVE_OBJECT_STORAGE_IDENTITY",
  "KINRESOLVE_OBSERVABILITY_ENDPOINT",
  "KINRESOLVE_SCHEDULED_WRITES_ENABLED",
  "KINRESOLVE_TRANSACTIONAL_EMAIL_FROM",
  "KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER",
  "KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO",
  ...hostedCapabilityEnvironmentNames,
  "KINSLEUTH_ALLOW_SIGNUPS",
  "KINSLEUTH_ARCHIVE_ID"
] as const;

export const publicDemoSensitiveProductionEnvironmentNames = [
  "AI_API_KEY",
  "AUTH_SECRET",
  "CRON_SECRET",
  "DATABASE_URL",
  "KINRESOLVE_DEMO_CANARY_SECRET",
  "KINRESOLVE_DEMO_PRIVACY_HMAC_SECRET",
  "KINRESOLVE_OBSERVABILITY_PROBE_SECRET"
] as const;

export const publicDemoReadableProductionEnvironmentNames = [
  "AI_API_MODE",
  "AI_BASE_URL",
  "AI_CHAT_MODEL",
  "APP_BASE_URL",
  "DATABASE_AUTO_MIGRATE",
  "KINSLEUTH_ARCHIVE_ID",
  "KINSLEUTH_ALLOW_SIGNUPS",
  "KINRESOLVE_API_V1_ENABLED",
  "KINRESOLVE_DATABASE_IDENTITY",
  "KINRESOLVE_DATASET_MODE",
  "KINRESOLVE_DEPLOYMENT_MODE",
  "KINRESOLVE_DNA_ENABLED",
  "KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED",
  "KINRESOLVE_EXTERNAL_AI_ENABLED",
  "KINRESOLVE_PACKAGE_MEDIA_ENABLED",
  "KINRESOLVE_PLAIN_GEDCOM_ENABLED",
  "KINRESOLVE_PUBLIC_ARCHIVE_ENABLED",
  "KINRESOLVE_PUBLIC_DEMO_ENABLED",
  "KINRESOLVE_PUBLIC_DEMO_ORIGIN",
  "KINRESOLVE_PUBLIC_PUBLISHING_ENABLED",
  "KINRESOLVE_SCHEDULED_WRITES_ENABLED"
] as const;

// These credentials authorize release, recovery, or provider-control operations.
// They must remain step-scoped GitHub secrets and must never be configured as
// user-managed Vercel project environment entries. (Vercel may expose its own
// designated automation-bypass system variable independently.) Keep this list explicit so legitimate
// application credentials such as DATABASE_URL, RELEASE_FENCE_SECRET, and
// CRON_SECRET are not rejected by a broad prefix rule.
export const forbiddenWorkflowOnlyEnvironmentNames = [
  "ADMIN_DATABASE_URL",
  "DATABASE_ADMIN_URL",
  "DATABASE_IDENTITY_URL",
  "DIRECT_DATABASE_URL",
  "GH_TOKEN",
  "GITHUB_PAT",
  "GITHUB_TOKEN",
  "MIGRATION_DATABASE_URL",
  "KINRESOLVE_BUILD_COMMIT_SHA",
  "KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8",
  "RECOVERY_AGE_IDENTITY",
  "RECOVERY_AUTH_SECRET",
  "RECOVERY_BACKUP_S3_ACCESS_KEY_ID",
  "RECOVERY_BACKUP_S3_SECRET_ACCESS_KEY",
  "RECOVERY_BLOB_READ_WRITE_TOKEN",
  "RECOVERY_DATABASE_URL",
  "RECOVERY_SOURCE_DATABASE_URL",
  "RECOVERY_TARGET_BLOB_READ_WRITE_TOKEN",
  "RECOVERY_TARGET_DATABASE_URL",
  "RECOVERY_TARGET_RUNTIME_DATABASE_URL",
  "RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN",
  "RELEASE_FENCE_DATABASE_URL",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_TOKEN"
] as const;

type EnvironmentMetadata = {
  key: string;
  type: string;
  target: string[];
  gitBranch?: string;
  customEnvironmentIds: string[];
};

const forbiddenNames = new Set<string>(forbiddenWorkflowOnlyEnvironmentNames);

export type VercelEnvironmentContractOptions = Readonly<{
  expectedBetaApplicationsEnabled?: boolean;
  profile?: "hosted-beta" | "public-demo";
}>;

export function validateVercelEnvironmentContract(
  value: unknown,
  options: VercelEnvironmentContractOptions = {}
): {
  readableSettings: number;
  sensitiveSettings: number;
} {
  const profile = options.profile ?? "hosted-beta";
  if (profile !== "hosted-beta" && profile !== "public-demo") {
    throw new Error("The Vercel environment profile is invalid.");
  }
  const expectedBetaApplicationsEnabled = options.expectedBetaApplicationsEnabled ?? false;
  if (typeof expectedBetaApplicationsEnabled !== "boolean") {
    throw new Error("The expected beta-application setting must be boolean.");
  }
  if (profile === "public-demo" && expectedBetaApplicationsEnabled) {
    throw new Error("The public demo environment cannot enable beta-application intake.");
  }
  const requiredSensitiveNames: readonly string[] = profile === "public-demo"
    ? publicDemoSensitiveProductionEnvironmentNames
    : expectedBetaApplicationsEnabled
      ? [...requiredSensitiveProductionEnvironmentNames, betaApplicationSensitiveEnvironmentName]
      : requiredSensitiveProductionEnvironmentNames;
  const requiredReadableNames: readonly string[] = profile === "public-demo"
    ? publicDemoReadableProductionEnvironmentNames
    : requiredReadableProductionEnvironmentNames;
  const requiredNames = new Set<string>([
    ...requiredSensitiveNames,
    ...requiredReadableNames
  ]);
  const inspectedNames = new Set<string>([
    ...requiredNames,
    ...(profile === "hosted-beta" ? [betaApplicationSensitiveEnvironmentName] : [])
  ]);
  const entries = parseEntries(value);
  const requiredEntries = new Map<string, EnvironmentMetadata>();

  for (const entry of entries) {
    const key = typeof entry === "object" && entry !== null && "key" in entry
      ? (entry as { key?: unknown }).key
      : undefined;
    if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error("Vercel environment metadata contains an invalid environment-variable name.");
    }
    if (forbiddenNames.has(key)) {
      throw new Error(`Vercel environment metadata contains forbidden workflow-only setting ${key}.`);
    }
    if (profile === "public-demo" && !inspectedNames.has(key)) {
      throw new Error(`Vercel public demo environment contains unexpected setting ${key}.`);
    }
    if (!inspectedNames.has(key)) continue;
    if (requiredEntries.has(key)) {
      throw new Error(`Vercel environment metadata contains a duplicate ${key} assignment.`);
    }
    requiredEntries.set(key, parseEntry(entry, key));
  }

  const missing = [...requiredNames].filter((name) => !requiredEntries.has(name));
  if (missing.length > 0) {
    throw new Error(`Vercel environment metadata is missing required production settings: ${missing.join(", ")}.`);
  }

  for (const name of [
    ...requiredSensitiveNames,
    ...(profile === "hosted-beta" && requiredEntries.has(betaApplicationSensitiveEnvironmentName)
      ? [betaApplicationSensitiveEnvironmentName]
      : [])
  ]) {
    const entry = requiredEntries.get(name);
    if (!entry) continue;
    validateProductionOnly(entry);
    if (entry.type !== "sensitive") {
      throw new Error(`${name} must use the Vercel Sensitive environment-variable type.`);
    }
  }

  for (const name of requiredReadableNames) {
    const entry = requiredEntries.get(name)!;
    validateProductionOnly(entry);
    if (entry.type === "sensitive") {
      throw new Error(`${name} must remain readable so its exact production value can be validated.`);
    }
    if (entry.type !== "encrypted" && entry.type !== "plain") {
      throw new Error(`${name} must use a readable Vercel environment-variable type.`);
    }
  }

  return {
    readableSettings: requiredReadableNames.length,
    sensitiveSettings: requiredSensitiveNames.length
      + Number(
        profile === "hosted-beta"
        && !expectedBetaApplicationsEnabled
        && requiredEntries.has(betaApplicationSensitiveEnvironmentName)
      )
  };
}

export function validatePulledVercelEnvironmentContract(contents: string): {
  settings: number;
} {
  if (typeof contents !== "string") {
    throw new Error("The pulled Vercel production environment file is invalid.");
  }

  const names = new Set<string>();
  let activeQuote: "'" | '"' | undefined;

  for (const line of contents.split(/\r?\n/)) {
    if (activeQuote) {
      const closing = findClosingQuote(line, activeQuote, 0);
      if (closing === -1) continue;
      if (!/^\s*(?:#.*)?$/.test(line.slice(closing + 1))) {
        throw new Error("The pulled Vercel production environment file could not be parsed.");
      }
      activeQuote = undefined;
      continue;
    }

    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!assignment) {
      throw new Error("The pulled Vercel production environment file could not be parsed.");
    }
    const [, name, rawValue] = assignment;
    if (forbiddenNames.has(name)) {
      throw new Error(`The pulled Vercel production environment contains forbidden workflow-only setting ${name}.`);
    }
    if (names.has(name)) {
      throw new Error(`The pulled Vercel production environment contains duplicate ${name} assignments.`);
    }
    names.add(name);

    const value = rawValue.trimStart();
    const quote = value[0];
    if (quote !== "'" && quote !== '"') continue;
    const closing = findClosingQuote(value, quote, 1);
    if (closing === -1) {
      activeQuote = quote;
    } else if (!/^\s*(?:#.*)?$/.test(value.slice(closing + 1))) {
      throw new Error("The pulled Vercel production environment file could not be parsed.");
    }
  }

  if (activeQuote) {
    throw new Error("The pulled Vercel production environment file could not be parsed.");
  }

  return { settings: names.size };
}

function findClosingQuote(value: string, quote: "'" | '"', start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] !== quote) continue;
    if (quote === "'") return index;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

function parseEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (
    typeof value === "object"
    && value !== null
    && "envs" in value
    && Array.isArray((value as { envs?: unknown }).envs)
  ) {
    const response = value as { envs: unknown[]; pagination?: unknown };
    validateCompletePage(response.pagination, response.envs.length);
    return response.envs;
  }
  throw new Error("Vercel environment metadata must contain an envs array.");
}

function validateCompletePage(value: unknown, entryCount: number): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Vercel environment metadata pagination is invalid.");
  }
  const pagination = value as Record<string, unknown>;
  const next = pagination.next;
  const count = pagination.count;
  if (
    (next !== undefined && next !== null)
    || (count !== undefined && (
      typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > entryCount
    ))
  ) {
    throw new Error("Vercel environment metadata must be a complete, unpaginated response.");
  }
}

function parseEntry(value: unknown, key: string): EnvironmentMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Vercel environment metadata for ${key} is invalid.`);
  }
  const entry = value as Record<string, unknown>;
  const type = entry.type;
  const target = typeof entry.target === "string" ? [entry.target] : entry.target;
  const customEnvironmentIds = entry.customEnvironmentIds ?? [];
  if (
    typeof type !== "string"
    || !Array.isArray(target)
    || !target.every((item): item is string => typeof item === "string")
    || !Array.isArray(customEnvironmentIds)
    || !customEnvironmentIds.every((item): item is string => typeof item === "string")
    || (entry.gitBranch !== undefined && entry.gitBranch !== null && typeof entry.gitBranch !== "string")
  ) {
    throw new Error(`Vercel environment metadata for ${key} is invalid.`);
  }
  return {
    key,
    type: type.toLowerCase(),
    target,
    ...(typeof entry.gitBranch === "string" && entry.gitBranch ? { gitBranch: entry.gitBranch } : {}),
    customEnvironmentIds
  };
}

function validateProductionOnly(entry: EnvironmentMetadata): void {
  if (entry.target.length !== 1 || entry.target[0] !== "production") {
    throw new Error(`${entry.key} must target production only.`);
  }
  if (entry.gitBranch) {
    throw new Error(`${entry.key} must not use a branch-specific production assignment.`);
  }
  if (entry.customEnvironmentIds.length > 0) {
    throw new Error(`${entry.key} must not share a production assignment with a custom environment.`);
  }
}
