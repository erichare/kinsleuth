import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ getSessionContext: vi.fn() }));
const uploadMocks = vi.hoisted(() => ({
  stageDirectIntegrationUpload: vi.fn(),
  completeDirectIntegrationUpload: vi.fn()
}));

vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/integrations/direct-upload", () => uploadMocks);

import { POST as completeUpload } from "@/app/api/integrations/[id]/artifacts/complete/route";
import { POST as stageUpload } from "@/app/api/integrations/[id]/artifacts/stage/route";

const session = {
  userId: "owner-synthetic",
  email: "owner@example.test",
  name: "Synthetic Owner",
  role: "owner" as const,
  archiveId: "archive-from-session"
};
const artifact = {
  id: "artifact-opaque",
  connectionId: "source-1",
  fileName: "synthetic.ged",
  contentType: "text/plain",
  size: 15,
  sha256: "a".repeat(64),
  artifactKey: "archives/archive-from-session/private/never-public",
  state: "staged" as const,
  duplicate: false,
  createdAt: "2026-07-14T20:00:00.000Z",
  updatedAt: "2026-07-14T20:00:00.000Z"
};

beforeEach(() => {
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue(session);
  uploadMocks.stageDirectIntegrationUpload.mockResolvedValue({
    intent: {
      id: "intent-1",
      connectionId: "source-1",
      fileName: "synthetic.ged",
      contentType: "text/plain",
      size: 15,
      expiresAt: "2026-07-14T20:05:00.000Z"
    },
    upload: {
      strategy: "presigned_post",
      method: "POST",
      url: "https://private.example/presigned",
      fields: { key: "private-key", "Content-Type": "text/plain", policy: "signed" },
      expiresAt: "2026-07-14T20:05:00.000Z"
    }
  });
  uploadMocks.completeDirectIntegrationUpload.mockResolvedValue({ artifact, replayed: false });
});

describe("direct integration upload routes", () => {
  it("requires imports:manage for both stage and complete", async () => {
    authMocks.getSessionContext.mockResolvedValue({ ...session, role: "viewer" });

    const stageResponse = await stageUpload(jsonRequest("stage", {
      fileName: "synthetic.ged",
      contentType: "text/plain",
      size: 15
    }), context());
    const completeResponse = await completeUpload(jsonRequest("complete", { intentId: "intent-1" }), context());

    expect(stageResponse.status).toBe(403);
    expect(completeResponse.status).toBe(403);
    expect(uploadMocks.stageDirectIntegrationUpload).not.toHaveBeenCalled();
    expect(uploadMocks.completeDirectIntegrationUpload).not.toHaveBeenCalled();
  });

  it("stages from server-owned metadata without accepting an object key", async () => {
    const response = await stageUpload(jsonRequest("stage", {
      fileName: "synthetic.ged",
      contentType: "text/plain",
      size: 15
    }), context());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(uploadMocks.stageDirectIntegrationUpload).toHaveBeenCalledWith(
      "source-1",
      { fileName: "synthetic.ged", contentType: "text/plain", size: 15 },
      { archiveId: session.archiveId }
    );

    const rejected = await stageUpload(jsonRequest("stage", {
      fileName: "synthetic.ged",
      contentType: "text/plain",
      size: 15,
      storageKey: "archives/another/archive.ged"
    }), context());
    expect(rejected.status).toBe(400);
    expect(uploadMocks.stageDirectIntegrationUpload).toHaveBeenCalledTimes(1);
  });

  it("binds a current desktop-media acknowledgement to the authenticated actor", async () => {
    const response = await stageUpload(jsonRequest("stage", {
      fileName: "synthetic-ftm.zip",
      contentType: "application/zip",
      size: 1024,
      mediaRightsAcknowledgement: {
        accepted: true,
        version: "desktop-media-rights-v1",
        actorId: "forged-client-actor"
      }
    }), context());

    expect(response.status).toBe(201);
    expect(uploadMocks.stageDirectIntegrationUpload).toHaveBeenCalledWith(
      "source-1",
      {
        fileName: "synthetic-ftm.zip",
        contentType: "application/zip",
        size: 1024,
        mediaRightsAcknowledgement: {
          accepted: true,
          version: "desktop-media-rights-v1",
          actorId: session.userId
        }
      },
      { archiveId: session.archiveId }
    );

    const rejected = await stageUpload(jsonRequest("stage", {
      fileName: "synthetic-ftm.zip",
      contentType: "application/zip",
      size: 1024,
      mediaRightsAcknowledgement: { accepted: true, version: "obsolete-v0" }
    }), context());
    expect(rejected.status).toBe(400);
    expect(uploadMocks.stageDirectIntegrationUpload).toHaveBeenCalledTimes(1);
  });

  it("completes by opaque intent id and never exposes the private object identity", async () => {
    const response = await completeUpload(jsonRequest("complete", { intentId: "intent-1" }), context());
    const payload = await response.json() as { artifact: Record<string, unknown>; replayed: boolean };

    expect(response.status).toBe(200);
    expect(uploadMocks.completeDirectIntegrationUpload).toHaveBeenCalledWith(
      "source-1",
      "intent-1",
      { archiveId: session.archiveId }
    );
    expect(payload).toMatchObject({ replayed: false, artifact: { id: "artifact-opaque" } });
    expect(payload.artifact).not.toHaveProperty("artifactKey");
    expect(payload.artifact).not.toHaveProperty("sha256");

    const rejected = await completeUpload(jsonRequest("complete", {
      intentId: "intent-1",
      artifactKey: "archives/archive-from-session/private/forged"
    }), context());
    expect(rejected.status).toBe(400);
    expect(uploadMocks.completeDirectIntegrationUpload).toHaveBeenCalledTimes(1);
  });

  it("maps a disabled provider gate to a non-discoverable response", async () => {
    uploadMocks.stageDirectIntegrationUpload.mockRejectedValueOnce(
      Object.assign(new Error("disabled"), { code: "FEATURE_DISABLED" })
    );
    const response = await stageUpload(jsonRequest("stage", {
      fileName: "synthetic.ged",
      contentType: "text/plain",
      size: 15
    }), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "This data-source import is not enabled" });
  });

  it.each([
    ["CAPABILITY_DISABLED", 404],
    ["PLAIN_GEDCOM_REQUIRED", 415],
    ["GEDCOM_FILE_INVALID", 400],
    ["GEDCOM_FILE_TOO_LARGE", 413]
  ])("preserves safe hosted GEDCOM denial %s as HTTP %i", async (code, status) => {
    uploadMocks.stageDirectIntegrationUpload.mockRejectedValueOnce(
      Object.assign(new Error("private hosted denial detail"), { code })
    );

    const response = await stageUpload(jsonRequest("stage", {
      fileName: "synthetic.ged",
      contentType: "text/plain",
      size: 15
    }), context());

    expect(response.status).toBe(status);
    expect(await response.json()).toHaveProperty("error");
  });
});

function jsonRequest(action: "stage" | "complete", body: Record<string, unknown>) {
  return new Request(`https://kinresolve.example/api/integrations/source-1/artifacts/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function context() {
  return { params: Promise.resolve({ id: "source-1" }) };
}
