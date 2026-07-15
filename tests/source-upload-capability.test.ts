import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "@/lib/models";

const workspaceMocks = vi.hoisted(() => ({
  readWorkspace: vi.fn(async (): Promise<{ sources: SourceDocument[] }> => ({ sources: [] })),
  saveSourceDocument: vi.fn(async (input) => ({ id: "source-1", ...input }))
}));

vi.mock("@/lib/workspace-store", () => workspaceMocks);
vi.mock("@/lib/auth-session", () => ({
  getSessionContext: vi.fn(async () => ({
    userId: "owner-1",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    archiveId: "archive-pilot"
  }))
}));

import { GET, POST } from "@/app/api/uploads/route";

const hostedEnvironment = {
  KINRESOLVE_DEPLOYMENT_MODE: "hosted",
  KINRESOLVE_DATASET_MODE: "pilot",
  KINRESOLVE_DNA_ENABLED: "false",
  KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
  KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
  KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
  KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
  KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
  KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
} as const;

beforeEach(() => {
  for (const [name, value] of Object.entries(hostedEnvironment)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("hosted source upload capability", () => {
  it("omits retained binary metadata from hosted source reads when uploads are disabled", async () => {
    workspaceMocks.readWorkspace.mockResolvedValueOnce({
      sources: [{
        id: "source-legacy-binary",
        title: "Harbor register",
        sourceType: "Register",
        fileName: "private-family-record.pdf",
        storageKey: "uploads/sources/private-family-record.pdf",
        mimeType: "application/pdf",
        size: 12_345,
        transcript: "Amalia Bellandi arrived in 1892.",
        privacy: "private",
        confidence: 0.8,
        createdAt: "2026-07-14T00:00:00.000Z"
      }]
    });

    const response = await GET(new Request("https://app.kinresolve.com/api/uploads"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{
      id: "source-legacy-binary",
      title: "Harbor register",
      sourceType: "Register",
      transcript: "Amalia Bellandi arrived in 1892.",
      privacy: "private",
      confidence: 0.8,
      createdAt: "2026-07-14T00:00:00.000Z"
    }]);
  });

  it("rejects multipart before parsing when binary evidence is disabled", async () => {
    const request = new Request("https://app.kinresolve.com/api/uploads", {
      method: "POST",
      body: new FormData()
    });
    const formData = vi.spyOn(request, "formData");

    const response = await POST(request);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(formData).not.toHaveBeenCalled();
    expect(workspaceMocks.saveSourceDocument).not.toHaveBeenCalled();
  });

  it("accepts transcript-only JSON without binary metadata", async () => {
    const response = await POST(new Request("https://app.kinresolve.com/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Harbor register transcript",
        sourceType: "Register",
        transcript: "Amalia Bellandi arrived in 1892.",
        privacy: "private",
        confidence: "0.8"
      })
    }));

    expect(response.status).toBe(201);
    expect(workspaceMocks.saveSourceDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Harbor register transcript",
        transcript: "Amalia Bellandi arrived in 1892.",
        fileName: undefined,
        storageKey: undefined
      }),
      { archiveId: "archive-pilot" }
    );
  });
});
