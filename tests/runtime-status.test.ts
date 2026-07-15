import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { APP_VERSION } from "@/lib/app-version";
import { hostedGedcomFileLimitBytes, hostedGedcomPersonLimit } from "@/lib/hosted-capabilities";
import { getAIStatus, getRuntimeStatus, getStorageStatus } from "@/lib/runtime-status";

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
  });

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
    expect(getStorageStatus()).toEqual({ configured: false });

    process.env.KINRESOLVE_OBJECT_STORAGE_BACKEND = "vercel-blob";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    expect(getStorageStatus()).toEqual({ configured: true });

    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.KINRESOLVE_OBJECT_STORAGE_BACKEND = "s3";
    process.env.S3_BUCKET = "kinresolve-private";
    expect(getStorageStatus()).toEqual({ configured: true });

    process.env.S3_ACCESS_KEY_ID = "partial-credential";
    expect(getStorageStatus()).toEqual({ configured: false });

    process.env.S3_SECRET_ACCESS_KEY = "matching-secret";
    expect(getStorageStatus()).toEqual({ configured: true });
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
    KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
  });
}
