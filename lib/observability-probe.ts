import { timingSafeEqual } from "node:crypto";

const secretPattern = /^[A-Za-z0-9_-]{43,128}$/;

export function authenticateObservabilityProbe(request: Request): boolean {
  const expected = process.env.KINRESOLVE_OBSERVABILITY_PROBE_SECRET?.trim();
  if (!expected || !secretPattern.test(expected) || reusedSecret(expected)) return false;
  const authorization = request.headers.get("authorization");
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!secretPattern.test(provided)) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length
    && timingSafeEqual(providedBytes, expectedBytes);
}

export function isObservabilityProbeConfigured(): boolean {
  const value = process.env.KINRESOLVE_OBSERVABILITY_PROBE_SECRET?.trim();
  return Boolean(value && secretPattern.test(value) && !reusedSecret(value));
}

function reusedSecret(value: string): boolean {
  return [
    "AI_API_KEY",
    "AUTH_SECRET",
    "BLOB_READ_WRITE_TOKEN",
    "CRON_SECRET",
    "DATABASE_IDENTITY_URL",
    "DATABASE_URL",
    "KINRESOLVE_BETA_PRIVACY_HMAC_SECRET",
    "KINRESOLVE_OBSERVABILITY_INGEST_SECRET",
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
  ].some((name) => process.env[name]?.trim() === value);
}
