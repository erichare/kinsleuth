import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveApiAccess } from "@/lib/api-access";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

const mediaStoreMocks = vi.hoisted(() => ({
  listIntegrationMedia: vi.fn(),
  reclassifyIntegrationMedia: vi.fn(),
  streamIntegrationMedia: vi.fn()
}));

const integrationStoreMocks = vi.hoisted(() => ({
  startSyncRun: vi.fn()
}));

vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/integrations/media-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/integrations/media-store")>(),
  ...mediaStoreMocks
}));
vi.mock("@/lib/integrations/store", () => integrationStoreMocks);

import { GET as listMedia } from "@/app/api/integration-media/route";
import { PATCH as reclassifyMedia } from "@/app/api/integration-media/[id]/route";
import { GET as downloadMedia } from "@/app/api/integration-media/[id]/download/route";
import { POST as startSyncRun } from "@/app/api/integrations/[id]/sync-runs/route";
import { MEDIA_OWNERSHIP_ATTESTATION_VERSION } from "@/lib/integrations/media-store";

const ownerSession = {
  userId: "owner-1",
  email: "owner@example.test",
  name: "Archive Owner",
  role: "owner" as const,
  archiveId: "archive-from-session"
};

const media = {
  id: "integration-media-1",
  connectionId: "connection-1",
  snapshotId: "snapshot-1",
  runId: "run-1",
  artifactId: "artifact-1",
  provider: "family_tree_maker" as const,
  sourceGedcomPath: "media\\portrait.jpg",
  sourceNormalizedPath: "media/portrait.jpg",
  sourceArchivePath: "export/media/portrait.jpg",
  sourceArtifactSha256: "a".repeat(64),
  sha256: "b".repeat(64),
  mimeType: "image/jpeg",
  size: 5,
  licenseClass: "third_party_restricted" as const,
  privacy: "private" as const,
  publishable: false,
  aiEligible: false,
  rightsAcknowledgement: {
    version: "desktop-media-rights-v1",
    actorId: "owner-1",
    acknowledgedAt: "2026-07-14T20:00:00.000Z"
  },
  createdAt: "2026-07-14T20:01:00.000Z",
  updatedAt: "2026-07-14T20:01:00.000Z"
};
const publicMedia = {
  id: media.id,
  provider: media.provider,
  fileName: "portrait.jpg",
  mimeType: media.mimeType,
  size: media.size,
  licenseClass: media.licenseClass,
  privacy: media.privacy,
  publishable: media.publishable,
  aiEligible: media.aiEligible
};

beforeEach(() => {
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue(ownerSession);
  mediaStoreMocks.listIntegrationMedia.mockResolvedValue({ items: [media], nextCursor: null });
  mediaStoreMocks.reclassifyIntegrationMedia.mockResolvedValue({
    ...media,
    licenseClass: "user_owned",
    ownershipAttestation: {
      version: MEDIA_OWNERSHIP_ATTESTATION_VERSION,
      actorId: ownerSession.userId,
      attestedAt: "2026-07-14T20:02:00.000Z"
    }
  });
  mediaStoreMocks.streamIntegrationMedia.mockResolvedValue({
    media,
    body: (async function* () {
      yield Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    })()
  });
  integrationStoreMocks.startSyncRun.mockResolvedValue({
    id: "run-1",
    connectionId: "connection-1",
    status: "queued"
  });
});

describe("integration media route access", () => {
  it.each([
    ["/api/integration-media", "GET"],
    ["/api/integration-media/integration-media-1", "PATCH"],
    ["/api/integration-media/integration-media-1/download", "GET"]
  ] as const)("registers %s %s as imports:manage", (path, method) => {
    expect(resolveApiAccess(path, method)).toEqual({
      kind: "permission",
      permission: "imports:manage"
    });
  });

  it("lists metadata only within the session archive without exposing object keys", async () => {
    const response = await listMedia(new Request("http://localhost/api/integration-media?pageSize=25"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ items: [publicMedia], nextCursor: null });
    expect(JSON.stringify(payload)).not.toMatch(
      /objectKey|snapshotId|runId|artifactId|sourceArchivePath|sha256|rightsAcknowledgement|ownershipAttestation|actorId/i
    );
    expect(mediaStoreMocks.listIntegrationMedia).toHaveBeenCalledWith(
      { cursor: undefined, pageSize: 25 },
      { archiveId: ownerSession.archiveId }
    );
  });

  it("forwards the private media cursor and returns the next projected page cursor", async () => {
    mediaStoreMocks.listIntegrationMedia.mockResolvedValueOnce({
      items: [media],
      nextCursor: "integration-media-2"
    });

    const response = await listMedia(new Request(
      "http://localhost/api/integration-media?pageSize=25&cursor=integration-media-1"
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [publicMedia],
      nextCursor: "integration-media-2"
    });
    expect(mediaStoreMocks.listIntegrationMedia).toHaveBeenCalledWith(
      { cursor: "integration-media-1", pageSize: 25 },
      { archiveId: ownerSession.archiveId }
    );
  });

  it("streams authenticated media with private hardening headers", async () => {
    const response = await downloadMedia(
      new Request("http://localhost/api/integration-media/integration-media-1/download"),
      mediaContext()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toContain("portrait.jpg");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));
    expect(mediaStoreMocks.streamIntegrationMedia).toHaveBeenCalledWith("integration-media-1", {
      archiveId: ownerSession.archiveId
    });
  });

  it("requires the current explicit ownership attestation to reclassify media", async () => {
    const response = await reclassifyMedia(
      jsonRequest("http://localhost/api/integration-media/integration-media-1", {
        licenseClass: "user_owned",
        ownershipAttestation: {
          accepted: true,
          version: MEDIA_OWNERSHIP_ATTESTATION_VERSION
        }
      }),
      mediaContext()
    );

    expect(response.status).toBe(200);
    expect(mediaStoreMocks.reclassifyIntegrationMedia).toHaveBeenCalledWith(
      "integration-media-1",
      {
        attestationVersion: MEDIA_OWNERSHIP_ATTESTATION_VERSION,
        attestedBy: ownerSession.userId
      },
      { archiveId: ownerSession.archiveId }
    );
    await expect(response.json()).resolves.toEqual({
      media: {
        ...publicMedia,
        licenseClass: "user_owned"
      }
    });

    const rejected = await reclassifyMedia(
      jsonRequest("http://localhost/api/integration-media/integration-media-1", {
        licenseClass: "user_owned",
        ownershipAttestation: { accepted: false, version: MEDIA_OWNERSHIP_ATTESTATION_VERSION }
      }),
      mediaContext()
    );
    expect(rejected.status).toBe(400);
  });

  it("denies callers without imports:manage before touching media storage", async () => {
    authMocks.getSessionContext.mockResolvedValue({ ...ownerSession, role: "viewer" });

    const response = await listMedia(new Request("http://localhost/api/integration-media"));

    expect(response.status).toBe(403);
    expect(mediaStoreMocks.listIntegrationMedia).not.toHaveBeenCalled();
  });

  it("binds the versioned desktop-media rights acknowledgement to the authenticated actor", async () => {
    const response = await startSyncRun(
      new Request("http://localhost/api/integrations/connection-1/sync-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactId: "artifact-1",
          mediaRightsAcknowledgement: {
            accepted: true,
            version: "desktop-media-rights-v1"
          }
        })
      }),
      { params: Promise.resolve({ id: "connection-1" }) }
    );

    expect(response.status).toBe(202);
    expect(integrationStoreMocks.startSyncRun).toHaveBeenCalledWith(
      "connection-1",
      {
        artifactId: "artifact-1",
        mediaRightsAcknowledgement: {
          accepted: true,
          version: "desktop-media-rights-v1",
          actorId: ownerSession.userId
        }
      },
      { archiveId: ownerSession.archiveId }
    );

    const rejected = await startSyncRun(
      new Request("http://localhost/api/integrations/connection-1/sync-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactId: "artifact-1",
          mediaRightsAcknowledgement: {
            accepted: true,
            version: "obsolete-rights-v0"
          }
        })
      }),
      { params: Promise.resolve({ id: "connection-1" }) }
    );
    expect(rejected.status).toBe(400);
  });
});

function mediaContext() {
  return { params: Promise.resolve({ id: "integration-media-1" }) };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
