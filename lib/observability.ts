import { APP_VERSION } from "./app-version";

export const operationalEventNames = [
  "api_error",
  "browser_unhandled_error",
  "case_created",
  "deletion_completed",
  "deletion_requested",
  "export_completed",
  "import_applied",
  "import_completed",
  "import_rolled_back",
  "import_staged",
  "integration_worker_failed",
  "invite_accepted",
  "operator_test_alert",
  "retention_cleanup_completed",
  "worker_failed",
  "worker_started",
  "worker_succeeded"
] as const;

export type OperationalEventName = (typeof operationalEventNames)[number];
export type OperationalSeverity = "error" | "info" | "warning";
export type OperationalWorkerKind =
  | "import-upload-cleanup"
  | "integration-jobs"
  | "retention-cleanup";

export type OperationalEventInput = {
  event: OperationalEventName;
  severity: OperationalSeverity;
  code?: string;
  durationMs?: number;
  operationType?: "deletion-request" | "research-export";
  requestId?: string;
  route?: string;
  workerKind?: OperationalWorkerKind;
};

export type OperationalEventPayload = Readonly<{
  schemaVersion: 1;
  event: OperationalEventName;
  severity: OperationalSeverity;
  release: string;
  environment: "development" | "preview" | "production" | "test";
  occurredAt: string;
  code?: string;
  durationMs?: number;
  operationType?: "deletion-request" | "research-export";
  requestId?: string;
  route?: string;
  workerKind?: OperationalWorkerKind;
}>;

type EmitOptions = {
  fetchImplementation?: typeof fetch;
  now?: Date;
  requireDelivery?: boolean;
};

const eventNameSet = new Set<string>(operationalEventNames);
const severitySet = new Set<string>(["error", "info", "warning"]);
const workerKindSet = new Set<string>([
  "import-upload-cleanup",
  "integration-jobs",
  "retention-cleanup"
]);
const operationTypeSet = new Set<string>(["deletion-request", "research-export"]);
const operationalCodeSet = new Set([
  "AUTHORIZATION_ERROR",
  "CONFIGURATION_ERROR",
  "DATABASE_ERROR",
  "NETWORK_ERROR",
  "STORAGE_ERROR",
  "TEST_ALERT",
  "TIMEOUT",
  "UNEXPECTED_ERROR"
]);
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const routeTemplatePattern = /^\/[a-z0-9/_\-[\].]{1,160}$/;
const maximumTrackerResponseTimeMs = 2_000;

export function createOperationalEvent(
  input: OperationalEventInput,
  now = new Date()
): OperationalEventPayload {
  if (!eventNameSet.has(input.event) || !severitySet.has(input.severity)) {
    throw new Error("Operational event name or severity is invalid.");
  }

  const payload: OperationalEventPayload = Object.freeze({
    schemaVersion: 1,
    event: input.event,
    severity: input.severity,
    release: safeRelease(),
    environment: deploymentEnvironment(),
    occurredAt: now.toISOString(),
    ...(validCode(input.code) ? { code: input.code } : {}),
    ...(validDuration(input.durationMs) ? { durationMs: Math.round(input.durationMs) } : {}),
    ...(input.operationType && operationTypeSet.has(input.operationType)
      ? { operationType: input.operationType }
      : {}),
    ...(input.requestId && requestIdPattern.test(input.requestId)
      ? { requestId: input.requestId.toLowerCase() }
      : {}),
    ...(input.route && routeTemplatePattern.test(input.route) && !input.route.includes("..")
      ? { route: input.route }
      : {}),
    ...(input.workerKind && workerKindSet.has(input.workerKind)
      ? { workerKind: input.workerKind }
      : {})
  });

  return payload;
}

export function operationalErrorCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== "string") return "UNEXPECTED_ERROR";
  const code = error.code.trim().toUpperCase();
  if (code === "ETIMEDOUT" || code === "TIMEOUT") return "TIMEOUT";
  if (["EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ENOTFOUND", "NETWORK_ERROR"]
    .includes(code)) return "NETWORK_ERROR";
  if (code === "CONFIG_INVALID" || code === "MISCONFIGURED") return "CONFIGURATION_ERROR";
  if (/^[0-9A-Z]{5}$/.test(code)) return "DATABASE_ERROR";
  return operationalCodeSet.has(code) ? code : "UNEXPECTED_ERROR";
}

export async function captureOperationalError(
  input: Omit<OperationalEventInput, "code" | "severity"> & { severity?: "error" | "warning" },
  error: unknown,
  options: EmitOptions = {}
): Promise<OperationalEventPayload> {
  return emitOperationalEvent({
    ...input,
    severity: input.severity ?? "error",
    code: operationalErrorCode(error)
  }, options);
}

export async function emitOperationalEvent(
  input: OperationalEventInput,
  options: EmitOptions = {}
): Promise<OperationalEventPayload> {
  const payload = createOperationalEvent(input, options.now);
  logPayload(payload);

  const configuration = trackerConfiguration();
  if (!configuration) {
    if (options.requireDelivery) throw new Error("Operational event delivery is not configured.");
    return payload;
  }

  try {
    const response = await (options.fetchImplementation ?? fetch)(configuration.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${configuration.secret}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(maximumTrackerResponseTimeMs)
    });
    // Tracking is deliberately best effort. Provider failures must never
    // change the user request or worker outcome, and response bodies are not
    // read because they may contain provider diagnostics.
    if (!response.ok) {
      if (options.requireDelivery) throw new Error("Operational event delivery was rejected.");
      return payload;
    }
  } catch {
    if (options.requireDelivery) throw new Error("Operational event delivery failed.");
    return payload;
  }
  return payload;
}

function logPayload(payload: OperationalEventPayload): void {
  if (payload.severity === "error") {
    console.error(payload);
    return;
  }
  if (payload.severity === "warning") {
    console.warn(payload);
    return;
  }
  console.info(payload);
}

function trackerConfiguration(): { endpoint: string; secret: string } | null {
  const endpointValue = process.env.KINRESOLVE_OBSERVABILITY_ENDPOINT?.trim();
  const secret = process.env.KINRESOLVE_OBSERVABILITY_INGEST_SECRET?.trim();
  if (
    !endpointValue
    || !secret
    || !/^[A-Za-z0-9_-]{43,256}$/.test(secret)
    || reusedProductionCredential(secret)
  ) return null;

  try {
    const endpoint = new URL(endpointValue);
    if (
      endpoint.protocol !== "https:"
      || endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
    ) {
      return null;
    }
    return { endpoint: endpoint.toString(), secret };
  } catch {
    return null;
  }
}

function reusedProductionCredential(secret: string): boolean {
  return [
    "AI_API_KEY",
    "AUTH_SECRET",
    "BLOB_READ_WRITE_TOKEN",
    "CRON_SECRET",
    "DATABASE_IDENTITY_URL",
    "DATABASE_URL",
    "KINRESOLVE_BETA_PRIVACY_HMAC_SECRET",
    "KINRESOLVE_OBSERVABILITY_PROBE_SECRET",
    "KINSLEUTH_APP_PASSWORD",
    "MIGRATION_DATABASE_URL",
    "MINIO_ROOT_PASSWORD",
    "OPENAI_API_KEY",
    "PGPASSWORD",
    "RECOVERY_AGE_IDENTITY",
    "RECOVERY_BACKUP_S3_ACCESS_KEY_ID",
    "RECOVERY_BACKUP_S3_SECRET_ACCESS_KEY",
    "RECOVERY_TARGET_BLOB_READ_WRITE_TOKEN",
    "RECOVERY_TARGET_DATABASE_URL",
    "RECOVERY_TARGET_RUNTIME_DATABASE_URL",
    "RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN",
    "RELEASE_FENCE_DATABASE_URL",
    "RELEASE_FENCE_SECRET",
    "RESEND_API_KEY",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
    "VERCEL_TOKEN"
  ].some((name) => process.env[name]?.trim() === secret);
}

function validCode(value: string | undefined): value is string {
  return typeof value === "string" && operationalCodeSet.has(value);
}

function validDuration(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
}

function safeRelease(): string {
  return deploymentReleaseCommitSha() ?? `v${APP_VERSION}`;
}

export function deploymentReleaseCommitSha(): string | null {
  for (const candidate of [
    process.env.KINRESOLVE_BUILD_COMMIT_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA
  ]) {
    const release = candidate?.trim().toLowerCase();
    if (release && /^[a-f0-9]{40}$/.test(release)) return release;
  }
  return null;
}

function deploymentEnvironment(): OperationalEventPayload["environment"] {
  if (process.env.NODE_ENV === "test") return "test";
  const vercelEnvironment = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnvironment === "production" || vercelEnvironment === "preview") {
    return vercelEnvironment;
  }
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
