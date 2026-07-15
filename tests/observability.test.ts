import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureOperationalError,
  createOperationalEvent,
  emitOperationalEvent,
  operationalErrorCode,
  type OperationalEventInput
} from "@/lib/observability";

const originalEnvironment = { ...process.env };
const marker = "PRIVATE_PERSON_NAME_AND_DATABASE_PASSWORD";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  process.env = { ...originalEnvironment };
  delete process.env.KINRESOLVE_BUILD_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = "b".repeat(40);
  delete process.env.KINRESOLVE_OBSERVABILITY_ENDPOINT;
  delete process.env.KINRESOLVE_OBSERVABILITY_INGEST_SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
});

describe("privacy-safe operational events", () => {
  it("serializes only allowlisted fields and drops malformed sensitive values", () => {
    const payload = createOperationalEvent({
      event: "api_error",
      severity: "error",
      code: `INVALID_${marker}`,
      durationMs: -1,
      operationType: marker,
      requestId: marker,
      route: `/app?person=${marker}`,
      workerKind: marker,
      error: new Error(marker),
      message: marker,
      url: `https://app.kinresolve.com/app?secret=${marker}`
    } as unknown as OperationalEventInput, new Date("2026-07-15T18:00:00.000Z"));

    expect(payload).toEqual({
      schemaVersion: 1,
      event: "api_error",
      severity: "error",
      release: "b".repeat(40),
      environment: "test",
      occurredAt: "2026-07-15T18:00:00.000Z"
    });
    expect(Object.isFrozen(payload)).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(marker);
  });

  it("prefers the exact build-bound commit and ignores malformed fallbacks", () => {
    process.env.KINRESOLVE_BUILD_COMMIT_SHA = "c".repeat(40);
    expect(createOperationalEvent({ event: "api_error", severity: "error" }).release)
      .toBe("c".repeat(40));

    process.env.KINRESOLVE_BUILD_COMMIT_SHA = marker;
    expect(createOperationalEvent({ event: "api_error", severity: "error" }).release)
      .toBe("b".repeat(40));
  });

  it("extracts only a bounded fixed-format error code", () => {
    expect(operationalErrorCode({ code: "DATABASE_ERROR", message: marker }))
      .toBe("DATABASE_ERROR");
    expect(operationalErrorCode({ code: "DATABASE_UNAVAILABLE", message: marker }))
      .toBe("UNEXPECTED_ERROR");
    expect(operationalErrorCode({ code: `BAD_${marker}`, message: marker }))
      .toBe("UNEXPECTED_ERROR");
    expect(operationalErrorCode(new Error(marker))).toBe("UNEXPECTED_ERROR");
    expect(operationalErrorCode(marker)).toBe("UNEXPECTED_ERROR");
  });

  it("delivers a redacted payload without logging the source error", async () => {
    process.env.KINRESOLVE_OBSERVABILITY_ENDPOINT = "https://telemetry.example.invalid/v1/events";
    process.env.KINRESOLVE_OBSERVABILITY_INGEST_SECRET = "t".repeat(48);
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sourceError = Object.assign(new Error(marker), { code: "DATABASE_ERROR" });

    const payload = await captureOperationalError({
      event: "api_error",
      requestId,
      route: "/api/cases"
    }, sourceError, {
      fetchImplementation,
      now: new Date("2026-07-15T18:01:00.000Z")
    });

    expect(payload).toMatchObject({
      event: "api_error",
      severity: "error",
      code: "DATABASE_ERROR",
      requestId,
      route: "/api/cases"
    });
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(payload);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchImplementation.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("https://telemetry.example.invalid/v1/events");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${"t".repeat(48)}`);
    expect(JSON.parse(String(init.body))).toEqual(payload);
    expect(String(init.body)).not.toContain(marker);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(marker);
  });

  it("isolates tracker failures unless an operator explicitly requires delivery", async () => {
    process.env.KINRESOLVE_OBSERVABILITY_ENDPOINT = "https://telemetry.example.invalid/events";
    process.env.KINRESOLVE_OBSERVABILITY_INGEST_SECRET = "t".repeat(48);
    const fetchImplementation = vi.fn().mockRejectedValue(new Error(marker));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(emitOperationalEvent({
      event: "api_error",
      severity: "error",
      code: "UNEXPECTED_ERROR",
      route: "/api/cases"
    }, { fetchImplementation })).resolves.toMatchObject({ event: "api_error" });

    await expect(emitOperationalEvent({
      event: "operator_test_alert",
      severity: "error",
      code: "TEST_ALERT",
      route: "/api/operator/observability"
    }, { fetchImplementation, requireDelivery: true }))
      .rejects.toThrow("Operational event delivery failed.");
  });

  it.each([
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
  ])("never sends a reused production credential from %s to the event sink", async (name) => {
    process.env.KINRESOLVE_OBSERVABILITY_ENDPOINT = "https://telemetry.example.invalid/events";
    process.env.KINRESOLVE_OBSERVABILITY_INGEST_SECRET = "t".repeat(48);
    process.env[name] = "t".repeat(48);
    const fetchImplementation = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(emitOperationalEvent({
      event: "operator_test_alert",
      severity: "error",
      code: "TEST_ALERT"
    }, { fetchImplementation, requireDelivery: true })).rejects.toThrow(/not configured/i);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
