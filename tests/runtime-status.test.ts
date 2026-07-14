import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { APP_VERSION } from "@/lib/app-version";
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
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(getStorageStatus()).toEqual({ configured: false });

    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    expect(getStorageStatus()).toEqual({ configured: true });
  });
});
