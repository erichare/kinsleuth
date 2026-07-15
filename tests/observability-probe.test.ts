import { afterEach, describe, expect, it } from "vitest";

import {
  authenticateObservabilityProbe,
  isObservabilityProbeConfigured
} from "@/lib/observability-probe";

const originalEnvironment = { ...process.env };
const probeSecret = "p".repeat(48);

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("observability probe authentication", () => {
  it("accepts only the dedicated fixed-format bearer secret", () => {
    process.env.KINRESOLVE_OBSERVABILITY_PROBE_SECRET = probeSecret;

    expect(isObservabilityProbeConfigured()).toBe(true);
    expect(authenticateObservabilityProbe(request(probeSecret))).toBe(true);
    expect(authenticateObservabilityProbe(request("q".repeat(48)))).toBe(false);
    expect(authenticateObservabilityProbe(new Request("https://app.kinresolve.com/api/internal/health")))
      .toBe(false);
  });

  it.each([
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
  ])("rejects a probe secret reused from %s", (name) => {
    process.env.KINRESOLVE_OBSERVABILITY_PROBE_SECRET = probeSecret;
    process.env[name] = probeSecret;

    expect(isObservabilityProbeConfigured()).toBe(false);
    expect(authenticateObservabilityProbe(request(probeSecret))).toBe(false);
  });

  it("fails closed for malformed configuration and authorization", () => {
    process.env.KINRESOLVE_OBSERVABILITY_PROBE_SECRET = "too-short";

    expect(isObservabilityProbeConfigured()).toBe(false);
    expect(authenticateObservabilityProbe(request("too-short"))).toBe(false);

    process.env.KINRESOLVE_OBSERVABILITY_PROBE_SECRET = probeSecret;
    expect(authenticateObservabilityProbe(new Request(
      "https://app.kinresolve.com/api/internal/health",
      { headers: { authorization: `Basic ${probeSecret}` } }
    ))).toBe(false);
  });

  it("rejects a well-formed bearer value of a different length without throwing", () => {
    process.env.KINRESOLVE_OBSERVABILITY_PROBE_SECRET = probeSecret;
    const differentLength = request("q".repeat(47));

    expect(() => authenticateObservabilityProbe(differentLength)).not.toThrow();
    expect(authenticateObservabilityProbe(differentLength)).toBe(false);
  });
});

function request(secret: string): Request {
  return new Request("https://app.kinresolve.com/api/internal/health", {
    headers: { authorization: `Bearer ${secret}` }
  });
}
