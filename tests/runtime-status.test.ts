import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { APP_VERSION } from "@/lib/app-version";
import { hostedGedcomFileLimitBytes, hostedGedcomPersonLimit } from "@/lib/hosted-capabilities";
import {
  getAIStatus,
  getRuntimeStatus,
  getStorageStatus,
  isRuntimeReady,
  type RuntimeStatus
} from "@/lib/runtime-status";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("runtime status", () => {
  it("uses package.json as the single application version source", () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it("reports AI provider defaults and API key presence", () => {
    process.env.KINRESOLVE_DEPLOYMENT_MODE = "self-hosted";
    delete process.env.AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_API_MODE;

    expect(getAIStatus()).toMatchObject({
      configured: false,
      baseUrl: "https://api.openai.com/v1",
      chatModel: "gpt-5-mini",
      embeddingModel: "text-embedding-3-small",
      mode: "responses"
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.AI_API_MODE = "chat";

    expect(getAIStatus()).toMatchObject({
      configured: true,
      mode: "chat"
    });
  });

  it("reports external AI as disabled when the capability is off even if API keys exist", () => {
    setPrivateBetaEnvironment();
    process.env.AI_API_KEY = "must-not-enable-ai";
    process.env.OPENAI_API_KEY = "must-not-enable-ai-either";

    expect(getAIStatus()).toMatchObject({
      enabled: false,
      configured: false
    });
  });

  it("exposes the effective non-secret capability manifest and hosted limits", async () => {
    setPrivateBetaEnvironment();
    delete process.env.DATABASE_URL;

    const status = await getRuntimeStatus();

    expect(status.capabilities).toEqual({
      valid: true,
      deploymentMode: "hosted",
      datasetMode: "pilot",
      dna: false,
      externalAi: false,
      publicArchive: false,
      publicPublishing: false,
      evidenceBinaryUploads: false,
      packageMedia: false,
      plainGedcom: true,
      gedcomFileLimitBytes: hostedGedcomFileLimitBytes,
      gedcomPersonLimit: hostedGedcomPersonLimit
    });
    expect(status.ai).toMatchObject({ enabled: false, configured: false });
    expect(status.api).toEqual({ enabled: false, configured: true });
    expect(status.scheduledWrites).toEqual({ valid: true, configured: true, enabled: true });
  });

  it("fails readiness closed when API v1 is enabled without a usable cursor secret", async () => {
    setPrivateBetaEnvironment();
    process.env.KINRESOLVE_API_V1_ENABLED = "true";
    delete process.env.KINRESOLVE_API_CURSOR_SECRET;
    delete process.env.DATABASE_URL;

    const status = await getRuntimeStatus();

    expect(status.api).toEqual({ enabled: true, configured: false });
    expect(isRuntimeReady(status)).toBe(false);
  });

  it("treats the storage-free hosted public demo capability profile as ready", () => {
    setPublicDemoEnvironment();
    const status: RuntimeStatus = {
      product: "KinSleuth",
      version: APP_VERSION,
      database: {
        configured: true,
        connected: true,
        identityConfigured: true,
        identity: "a".repeat(64),
        identityMatchesConfigured: true,
        transportVerified: true,
        archiveId: "kinresolve-demo-public",
        archiveName: "Hartwell–Mercer Family Archive",
        archiveTagline: "Fictional public demo",
        archiveCount: 1,
        peopleCount: 16,
        caseCount: 5,
        aiRunCount: 0,
        provisioned: true,
        datasetMode: "demo",
        expectedDatasetMode: "demo",
        datasetModeMatches: true,
        demoFixtureVersion: 3
      },
      ai: {
        enabled: true,
        configured: true,
        baseUrl: "https://api.openai.com/v1",
        chatModel: "gpt-5-mini",
        embeddingModel: "text-embedding-3-small",
        mode: "responses"
      },
      api: { enabled: false, configured: true },
      storage: {
        configured: false,
        identityConfigured: false,
        identityVerified: false
      },
      scheduledWrites: { valid: true, configured: true, enabled: true },
      capabilities: {
        valid: true,
        deploymentMode: "hosted",
        datasetMode: "demo",
        dna: true,
        externalAi: true,
        publicArchive: true,
        publicPublishing: false,
        evidenceBinaryUploads: false,
        packageMedia: false,
        plainGedcom: false,
        gedcomFileLimitBytes: null,
        gedcomPersonLimit: null
      }
    };

    expect(isRuntimeReady(status)).toBe(true);
  });

  it("exposes an explicit disabled staging value without treating it as invalid", async () => {
    setPrivateBetaEnvironment();
    process.env.KINRESOLVE_SCHEDULED_WRITES_ENABLED = "false";
    delete process.env.DATABASE_URL;

    const status = await getRuntimeStatus();

    expect(status.scheduledWrites).toEqual({ valid: true, configured: true, enabled: false });
  });

  it.each([undefined, "invalid"])(
    "fails closed for a hosted scheduled-write value of %s",
    async (value) => {
      setPrivateBetaEnvironment();
      if (value === undefined) delete process.env.KINRESOLVE_SCHEDULED_WRITES_ENABLED;
      else process.env.KINRESOLVE_SCHEDULED_WRITES_ENABLED = value;
      delete process.env.DATABASE_URL;

      const status = await getRuntimeStatus();

      expect(status.scheduledWrites).toEqual({
        valid: false,
        configured: value !== undefined,
        enabled: false
      });
    }
  );

  it("fails closed when a hosted capability configuration is invalid", async () => {
    setPrivateBetaEnvironment();
    delete process.env.KINRESOLVE_PACKAGE_MEDIA_ENABLED;
    process.env.DATABASE_URL = "postgresql://unused.invalid/kinresolve";

    const status = await getRuntimeStatus();

    expect(status.capabilities).toEqual({
      valid: false,
      deploymentMode: null,
      datasetMode: null,
      dna: false,
      externalAi: false,
      publicArchive: false,
      publicPublishing: false,
      evidenceBinaryUploads: false,
      packageMedia: false,
      plainGedcom: false,
      gedcomFileLimitBytes: null,
      gedcomPersonLimit: null
    });
    expect(status.database).toMatchObject({
      configured: true,
      connected: false,
      error: expect.stringMatching(/KINRESOLVE_PACKAGE_MEDIA_ENABLED.*required.*hosted/i)
    });
    expect(status.ai).toMatchObject({ enabled: false, configured: false });
  });

  it("reports a degraded database state when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;

    const status = await getRuntimeStatus();

    expect(status.product).toBe("KinSleuth");
    expect(status.database).toMatchObject({
      configured: false,
      connected: false,
      archiveId: "archive-default",
      error: "DATABASE_URL is not configured"
    });
    expect(status.version).toBe(packageJson.version);
  });

  it("reports whether private upload storage is configured", () => {
    delete process.env.KINRESOLVE_OBJECT_STORAGE_BACKEND;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    expect(getStorageStatus()).toEqual({
      configured: false,
      identityConfigured: false,
      identityVerified: false
    });

    process.env.KINRESOLVE_OBJECT_STORAGE_BACKEND = "vercel-blob";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    expect(getStorageStatus()).toEqual({
      configured: true,
      identityConfigured: false,
      identityVerified: false
    });

    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.KINRESOLVE_OBJECT_STORAGE_BACKEND = "s3";
    process.env.S3_BUCKET = "kinresolve-private";
    expect(getStorageStatus()).toEqual({
      configured: true,
      identityConfigured: false,
      identityVerified: false
    });

    process.env.S3_ACCESS_KEY_ID = "partial-credential";
    expect(getStorageStatus()).toEqual({
      configured: false,
      identityConfigured: false,
      identityVerified: false
    });

    process.env.S3_SECRET_ACCESS_KEY = "matching-secret";
    expect(getStorageStatus()).toEqual({
      configured: true,
      identityConfigured: false,
      identityVerified: false
    });
  });
});

function setPrivateBetaEnvironment() {
  Object.assign(process.env, {
    KINRESOLVE_DEPLOYMENT_MODE: "hosted",
    KINRESOLVE_DATASET_MODE: "pilot",
    KINRESOLVE_DNA_ENABLED: "false",
    KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
    KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
    KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
    KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
    KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
    KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true",
    KINRESOLVE_SCHEDULED_WRITES_ENABLED: "true"
  });
}

function setPublicDemoEnvironment() {
  Object.assign(process.env, {
    APP_BASE_URL: "https://demo.kinresolve.com",
    KINRESOLVE_DEPLOYMENT_MODE: "hosted",
    KINRESOLVE_DATASET_MODE: "demo",
    KINRESOLVE_DNA_ENABLED: "true",
    KINRESOLVE_EXTERNAL_AI_ENABLED: "true",
    KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "true",
    KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
    KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
    KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
    KINRESOLVE_PLAIN_GEDCOM_ENABLED: "false",
    KINRESOLVE_PUBLIC_DEMO_ENABLED: "true",
    KINRESOLVE_PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com",
    KINRESOLVE_SCHEDULED_WRITES_ENABLED: "true"
  });
  delete process.env.KINRESOLVE_OBJECT_STORAGE_BACKEND;
  delete process.env.KINRESOLVE_OBJECT_STORAGE_IDENTITY;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
}
