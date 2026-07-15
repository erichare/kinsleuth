import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

const storeMocks = vi.hoisted(() => ({
  listIntegrationConnections: vi.fn(),
  createIntegrationConnection: vi.fn(),
  disconnectIntegrationConnection: vi.fn(),
  createIntegrationArtifact: vi.fn(),
  deleteIntegrationArtifact: vi.fn(),
  startSyncRun: vi.fn(),
  getLatestSyncRunForConnection: vi.fn(),
  getSyncRun: vi.fn(),
  getIntegrationSnapshot: vi.fn(),
  cancelSyncRun: vi.fn(),
  listSyncChanges: vi.fn(),
  applySyncRun: vi.fn(),
  rollbackSyncRun: vi.fn()
}));

vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/integrations/store", () => storeMocks);
vi.mock("@/lib/integrations/run-processor", () => ({
  applyPreparedIntegrationSyncRun: storeMocks.applySyncRun,
  rollbackAppliedIntegrationSyncRun: storeMocks.rollbackSyncRun
}));

import { GET as listConnections, POST as createConnection } from "@/app/api/integrations/route";
import { DELETE as disconnectConnection } from "@/app/api/integrations/[id]/route";
import {
  DELETE as deleteArtifact,
  POST as createArtifact
} from "@/app/api/integrations/[id]/artifacts/route";
import {
  GET as getLatestRun,
  POST as startRun
} from "@/app/api/integrations/[id]/sync-runs/route";
import { DELETE as cancelRun, GET as getRun } from "@/app/api/integration-runs/[id]/route";
import { GET as listChanges } from "@/app/api/integration-runs/[id]/changes/route";
import { POST as applyRun } from "@/app/api/integration-runs/[id]/apply/route";
import { POST as rollbackRun } from "@/app/api/integration-runs/[id]/rollback/route";

const ownerSession = {
  userId: "owner-1",
  email: "owner@example.test",
  name: "Archive Owner",
  role: "owner" as const,
  archiveId: "archive-from-session"
};

const connection = {
  id: "source-1",
  provider: "ancestry_export",
  authority: "ancestry",
  displayName: "Hartwell family on Ancestry",
  status: "active",
  capabilities: {
    snapshotImport: true,
    incrementalPull: false,
    media: false,
    oauth: false,
    writeback: false
  },
  remoteAccountId: "private-account-do-not-return",
  remoteTreeId: "private-tree-do-not-return",
  lastAppliedSnapshotId: "snapshot-1",
  lastRefreshedAt: "2026-07-14T18:30:00.000Z",
  disconnectedAt: "2026-07-14T18:31:00.000Z",
  createdAt: "2026-07-14T18:00:00.000Z",
  updatedAt: "2026-07-14T18:31:00.000Z"
};
const publicConnection = {
  id: connection.id,
  provider: connection.provider,
  authority: connection.authority,
  displayName: connection.displayName,
  status: connection.status,
  capabilities: connection.capabilities,
  lastRefreshedAt: connection.lastRefreshedAt
};

const artifact = {
  id: "artifact-1",
  connectionId: connection.id,
  fileName: "ancestry-tree.zip",
  contentType: "application/zip",
  size: 128,
  sha256: "b".repeat(64),
  artifactKey: "archives/archive-from-session/private/not-public",
  state: "staged",
  duplicate: false,
  createdAt: "2026-07-14T18:34:00.000Z",
  updatedAt: "2026-07-14T18:34:00.000Z"
};
const publicArtifact = {
  id: artifact.id,
  connectionId: artifact.connectionId,
  fileName: artifact.fileName,
  contentType: artifact.contentType,
  size: artifact.size,
  state: artifact.state,
  duplicate: artifact.duplicate,
  createdAt: artifact.createdAt,
  updatedAt: artifact.updatedAt
};

const pendingRun = {
  id: "run-1",
  connectionId: connection.id,
  status: "queued",
  createdAt: "2026-07-14T18:35:00.000Z"
};
const publicPendingRun = {
  id: pendingRun.id,
  connectionId: pendingRun.connectionId,
  status: pendingRun.status,
  backupAvailable: false
};

const incomingSnapshot = {
  id: "snapshot-incoming-1",
  connectionId: connection.id,
  artifactKey: "archives/archive-from-session/integrations/source-1/snapshot-incoming-1",
  sha256: "a".repeat(64),
  parserVersion: "gedcom-v1",
  counts: {
    people: 12,
    families: 4,
    sources: 3,
    citations: 8,
    notes: 2,
    media: 5,
    missingMedia: 1,
    ambiguousMedia: 1,
    unsupported: 1
  },
  warnings: ["One unsupported top-level GEDCOM record was retained verbatim."],
  sourceMetadata: {
    unsupportedRecords: [{ type: "_LOG", externalId: "@X1@" }],
    missingMedia: [{ gedcomPath: "records/missing-page.jpg" }],
    ambiguousMedia: [{
      gedcomPath: "portrait.jpg",
      archivePaths: ["media/portrait.jpg", "photos/portrait.jpg"]
    }],
    unsupportedTags: {
      total: 3,
      tags: [{ tag: "_MYSTERY", count: 3 }],
      truncated: false
    },
    entityManifest: [{ entityType: "person", localEntityId: "private-person-1" }],
    entityValues: { "person:@I1@": { displayName: "Private Synthetic Person" } },
    fileName: "private-tree-name.ged"
  },
  createdAt: "2026-07-14T18:36:00.000Z"
};

beforeEach(() => {
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue(ownerSession);
  storeMocks.listIntegrationConnections.mockResolvedValue([connection]);
  storeMocks.createIntegrationConnection.mockResolvedValue(connection);
  storeMocks.disconnectIntegrationConnection.mockResolvedValue(undefined);
  storeMocks.createIntegrationArtifact.mockResolvedValue(artifact);
  storeMocks.deleteIntegrationArtifact.mockResolvedValue(undefined);
  storeMocks.startSyncRun.mockResolvedValue(pendingRun);
  storeMocks.getLatestSyncRunForConnection.mockResolvedValue(pendingRun);
  storeMocks.getSyncRun.mockResolvedValue(pendingRun);
  storeMocks.getIntegrationSnapshot.mockResolvedValue(incomingSnapshot);
  storeMocks.cancelSyncRun.mockResolvedValue({ ...pendingRun, status: "cancel_requested" });
  storeMocks.listSyncChanges.mockResolvedValue({
    items: [
      {
        id: "change-1",
        runId: "run-1",
        classification: "deletion",
        proposedAction: "keep_local",
        entityType: "person",
        baseHash: "a".repeat(64),
        localHash: "b".repeat(64),
        incomingHash: "c".repeat(64),
        resolutionPayload: {}
      }
    ],
    nextCursor: "cursor-2",
    summary: {
      total: 9,
      filtered: 1,
      unresolved: 3,
      byClassification: {
        remote_only: 2,
        local_only: 1,
        same: 1,
        conflict: 3,
        deletion: 2
      }
    }
  });
  storeMocks.applySyncRun.mockResolvedValue({ ...pendingRun, status: "applied" });
  storeMocks.rollbackSyncRun.mockResolvedValue({ ...pendingRun, status: "rolled_back" });
});

describe("Data Sources authorization", () => {
  const protectedOperations = [
    ["list connections", () => listConnections(request("/api/integrations"))],
    ["create a connection", () => createConnection(jsonRequest("/api/integrations", {}, "POST"))],
    ["disconnect a connection", () => disconnectConnection(request("/api/integrations/source-1", "DELETE"), connectionContext())],
    ["stage an artifact", () => createArtifact(jsonRequest("/api/integrations/source-1/artifacts", {}, "POST"), connectionContext())],
    ["delete an artifact", () => deleteArtifact(jsonRequest("/api/integrations/source-1/artifacts", {}, "DELETE"), connectionContext())],
    ["start a refresh", () => startRun(jsonRequest("/api/integrations/source-1/sync-runs", {}, "POST"), connectionContext())],
    ["resume a refresh", () => getLatestRun(request("/api/integrations/source-1/sync-runs"), connectionContext())],
    ["read a refresh", () => getRun(request("/api/integration-runs/run-1"), runContext())],
    ["cancel a refresh", () => cancelRun(request("/api/integration-runs/run-1", "DELETE"), runContext())],
    ["list changes", () => listChanges(request("/api/integration-runs/run-1/changes"), runContext())],
    ["apply a refresh", () => applyRun(jsonRequest("/api/integration-runs/run-1/apply", {}, "POST"), runContext())],
    ["roll back a refresh", () => rollbackRun(jsonRequest("/api/integration-runs/run-1/rollback", {}, "POST"), runContext())]
  ] as const;

  it.each(protectedOperations)("requires imports:manage to %s", async (_label, invoke) => {
    authMocks.getSessionContext.mockResolvedValue({ ...ownerSession, role: "viewer" });

    const response = await invoke();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Permission denied" });
    for (const storeMock of Object.values(storeMocks)) {
      expect(storeMock).not.toHaveBeenCalled();
    }
  });
});

describe("GET and POST /api/integrations", () => {
  it("lists only the session archive's remembered data sources", async () => {
    const response = await listConnections(request("/api/integrations"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [publicConnection] });
    expect(storeMocks.listIntegrationConnections).toHaveBeenCalledWith({
      archiveId: ownerSession.archiveId
    });
  });

  it("creates a connection with server-owned capabilities", async () => {
    const response = await createConnection(
      jsonRequest("/api/integrations", {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Hartwell family on Ancestry"
      }, "POST")
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ connection: publicConnection });
    expect(storeMocks.createIntegrationConnection).toHaveBeenCalledWith(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Hartwell family on Ancestry"
      },
      { archiveId: ownerSession.archiveId }
    );
  });

  it("records an authoritative editor independently of the export provider", async () => {
    const selectedConnection = { ...connection, authority: "rootsmagic" };
    storeMocks.createIntegrationConnection.mockResolvedValueOnce(selectedConnection);

    const response = await createConnection(
      jsonRequest("/api/integrations", {
        provider: "ancestry_export",
        authority: "rootsmagic",
        displayName: "Hartwell research export"
      }, "POST")
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      connection: { ...publicConnection, authority: "rootsmagic" }
    });
    expect(storeMocks.createIntegrationConnection).toHaveBeenCalledWith(
      {
        provider: "ancestry_export",
        authority: "rootsmagic",
        displayName: "Hartwell research export"
      },
      { archiveId: ownerSession.archiveId }
    );
  });

  it.each([
    { provider: "ancestry_api", authority: "ancestry", displayName: "Unauthorized partner API" },
    { provider: "ancestry_export", authority: "browser_scrape", displayName: "Scraped tree" },
    { provider: "gedcom", authority: "generic", displayName: " " }
  ])("rejects an unsupported or incomplete connection", async (body) => {
    const response = await createConnection(jsonRequest("/api/integrations", body, "POST"));

    expect(response.status).toBe(400);
    expect(storeMocks.createIntegrationConnection).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/integrations/[id]", () => {
  it("disconnects only within the session archive without deleting imported research", async () => {
    const response = await disconnectConnection(
      request("/api/integrations/source-1", "DELETE"),
      connectionContext()
    );

    expect(response.status).toBe(204);
    expect(storeMocks.disconnectIntegrationConnection).toHaveBeenCalledWith("source-1", {
      archiveId: ownerSession.archiveId
    });
  });

  it("does not reveal a connection from another archive", async () => {
    storeMocks.disconnectIntegrationConnection.mockRejectedValue(
      Object.assign(new Error("source-1 belongs to archive-private"), { code: "NOT_FOUND" })
    );

    const response = await disconnectConnection(
      request("/api/integrations/source-1", "DELETE"),
      connectionContext()
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Data source not found" });
  });
});

describe("POST and DELETE /api/integrations/[id]/artifacts", () => {
  it("accepts an Ancestry ZIP as a private staged artifact", async () => {
    const form = new FormData();
    form.set("file", new File(["PK synthetic ZIP bytes"], "ancestry-tree.zip", {
      type: "application/zip"
    }));

    const response = await createArtifact(
      new Request("https://kinresolve.example/api/integrations/source-1/artifacts", {
        method: "POST",
        body: form
      }),
      connectionContext()
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ artifact: publicArtifact });
    expect(storeMocks.createIntegrationArtifact).toHaveBeenCalledOnce();
    const [connectionId, input, options] = storeMocks.createIntegrationArtifact.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { archiveId: string }
    ];
    expect(connectionId).toBe("source-1");
    expect(input).toMatchObject({
      fileName: "ancestry-tree.zip",
      contentType: "application/zip"
    });
    expect(options).toEqual({ archiveId: ownerSession.archiveId });
  });

  it("binds multipart desktop-media acknowledgement fields to the authenticated actor", async () => {
    const form = new FormData();
    form.set("file", new File(["PK synthetic ZIP bytes"], "ftm-tree.zip", {
      type: "application/zip"
    }));
    form.set("mediaRightsAcknowledgementAccepted", "true");
    form.set("mediaRightsAcknowledgementVersion", "desktop-media-rights-v1");

    const response = await createArtifact(
      new Request("https://kinresolve.example/api/integrations/source-1/artifacts", {
        method: "POST",
        body: form
      }),
      connectionContext()
    );

    expect(response.status).toBe(201);
    expect(storeMocks.createIntegrationArtifact).toHaveBeenCalledWith(
      "source-1",
      expect.objectContaining({
        mediaRightsAcknowledgement: {
          accepted: true,
          version: "desktop-media-rights-v1",
          actorId: ownerSession.userId
        }
      }),
      { archiveId: ownerSession.archiveId }
    );
  });

  it("rejects executable content before staging", async () => {
    const form = new FormData();
    form.set("file", new File(["MZ"], "tree.exe", { type: "application/x-msdownload" }));

    const response = await createArtifact(
      new Request("https://kinresolve.example/api/integrations/source-1/artifacts", {
        method: "POST",
        body: form
      }),
      connectionContext()
    );

    expect(response.status).toBe(415);
    expect(storeMocks.createIntegrationArtifact).not.toHaveBeenCalled();
  });

  it("does not stage a multipart artifact when the provider rollout is disabled", async () => {
    storeMocks.createIntegrationArtifact.mockRejectedValueOnce(
      Object.assign(new Error("disabled"), { code: "FEATURE_DISABLED" })
    );
    const form = new FormData();
    form.set("file", new File(["0 HEAD\n0 TRLR"], "tree.ged", { type: "text/plain" }));

    const response = await createArtifact(
      new Request("https://kinresolve.example/api/integrations/source-1/artifacts", {
        method: "POST",
        body: form
      }),
      connectionContext()
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "This data-source import is not enabled" });
  });

  it("abandons a staged artifact without accepting a client storage key", async () => {
    const response = await deleteArtifact(
      jsonRequest("/api/integrations/source-1/artifacts", { artifactId: "artifact-1" }, "DELETE"),
      connectionContext()
    );

    expect(response.status).toBe(204);
    expect(storeMocks.deleteIntegrationArtifact).toHaveBeenCalledWith(
      "source-1",
      "artifact-1",
      { archiveId: ownerSession.archiveId }
    );
  });
});

describe("GET and POST /api/integrations/[id]/sync-runs", () => {
  it("returns the connection's latest run for reload recovery", async () => {
    const response = await getLatestRun(
      request("/api/integrations/source-1/sync-runs"),
      connectionContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: publicPendingRun });
    expect(storeMocks.getLatestSyncRunForConnection).toHaveBeenCalledWith("source-1", {
      archiveId: ownerSession.archiveId
    });
  });

  it("returns null when a remembered source has never been refreshed", async () => {
    storeMocks.getLatestSyncRunForConnection.mockResolvedValue(undefined);

    const response = await getLatestRun(
      request("/api/integrations/source-1/sync-runs"),
      connectionContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: null });
  });

  it("projects the browser run without internal audit, request-hash, or actor fields", async () => {
    storeMocks.getLatestSyncRunForConnection.mockResolvedValue({
      ...pendingRun,
      artifactId: "artifact-1",
      backupId: "private-backup-1",
      applyRequestHash: "a".repeat(64),
      rollbackRequestHash: "b".repeat(64),
      rolledBackBy: "private-actor-1",
      mediaRightsAcknowledgement: {
        version: "desktop-media-rights-v1",
        actorId: "private-actor-2",
        acknowledgedAt: "2026-07-14T18:35:01.000Z"
      }
    });

    const response = await getLatestRun(
      request("/api/integrations/source-1/sync-runs"),
      connectionContext()
    );
    const payload = await response.json();

    expect(payload).toEqual({
      run: {
        ...publicPendingRun,
        artifactId: "artifact-1",
        backupAvailable: true
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/backupId|requestHash|rolledBackBy|actorId|acknowledgedAt/i);
  });

  it("queues a refresh and persists the declared authoritative editor", async () => {
    const response = await startRun(
      jsonRequest("/api/integrations/source-1/sync-runs", {
        artifactId: "artifact-1",
        declaredAuthority: "family_tree_maker"
      }, "POST"),
      connectionContext()
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ run: publicPendingRun });
    expect(storeMocks.startSyncRun).toHaveBeenCalledWith(
      "source-1",
      { artifactId: "artifact-1", declaredAuthority: "family_tree_maker" },
      { archiveId: ownerSession.archiveId }
    );
  });

  it("returns 409 when another refresh is already active", async () => {
    storeMocks.startSyncRun.mockRejectedValue(
      Object.assign(new Error("run-private is already parsing"), { code: "ACTIVE_RUN" })
    );

    const response = await startRun(
      jsonRequest("/api/integrations/source-1/sync-runs", { artifactId: "artifact-1" }, "POST"),
      connectionContext()
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "A refresh is already active for this data source"
    });
  });
});

describe("GET and DELETE /api/integration-runs/[id]", () => {
  it("returns current parsing and review status", async () => {
    const response = await getRun(request("/api/integration-runs/run-1"), runContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: publicPendingRun, report: null });
    expect(storeMocks.getSyncRun).toHaveBeenCalledWith("run-1", {
      archiveId: ownerSession.archiveId
    });
    expect(storeMocks.getIntegrationSnapshot).not.toHaveBeenCalled();
  });

  it("returns the incoming snapshot report within the session archive", async () => {
    const reviewRun = {
      ...pendingRun,
      status: "review_ready",
      incomingSnapshotId: incomingSnapshot.id
    };
    storeMocks.getSyncRun.mockResolvedValue(reviewRun);

    const response = await getRun(request("/api/integration-runs/run-1"), runContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      run: {
        ...publicPendingRun,
        status: "review_ready"
      },
      report: {
        counts: incomingSnapshot.counts,
        warnings: incomingSnapshot.warnings,
        limits: {
          warnings: { total: 1, returned: 1, truncated: false },
          unsupportedRecords: { total: 1, returned: 1, truncated: false },
          missingMedia: { total: 1, returned: 1, truncated: false },
          ambiguousMedia: { total: 1, returned: 1, truncated: false }
        },
        sourceMetadata: {
          unsupportedRecords: incomingSnapshot.sourceMetadata.unsupportedRecords,
          missingMedia: incomingSnapshot.sourceMetadata.missingMedia,
          ambiguousMedia: incomingSnapshot.sourceMetadata.ambiguousMedia.map((item) => ({
            ...item,
            archivePathCount: item.archivePaths.length
          })),
          unsupportedTags: incomingSnapshot.sourceMetadata.unsupportedTags
        }
      }
    });
    expect(JSON.stringify(body)).not.toMatch(
      /entityManifest|entityValues|Private Synthetic Person|private-tree-name/i
    );
    expect(storeMocks.getIntegrationSnapshot).toHaveBeenCalledWith(incomingSnapshot.id, {
      archiveId: ownerSession.archiveId
    });
  });

  it("bounds every variable-length snapshot report while returning explicit totals", async () => {
    const many = Array.from({ length: 205 }, (_, index) => ({ index }));
    storeMocks.getSyncRun.mockResolvedValue({
      ...pendingRun,
      status: "review_ready",
      incomingSnapshotId: incomingSnapshot.id
    });
    storeMocks.getIntegrationSnapshot.mockResolvedValue({
      ...incomingSnapshot,
      warnings: many.map(({ index }) => index === 0 ? "x".repeat(1_200) : `Synthetic warning ${index}`),
      sourceMetadata: {
        unsupportedRecords: many.map(({ index }) => ({
          type: `_SYNTHETIC_${index}`,
          externalId: `@X${index}@`,
          raw: "private raw GEDCOM must not leave the server"
        })),
        missingMedia: many.map(({ index }) => ({
          gedcomPath: `private/missing-${index}.jpg`,
          normalizedPath: `private/missing-${index}.jpg`,
          content: "private binary metadata"
        })),
        ambiguousMedia: many.map(({ index }) => ({
          gedcomPath: `private/ambiguous-${index}.jpg`,
          normalizedPath: `private/ambiguous-${index}.jpg`,
          archivePaths: Array.from({ length: 25 }, (_, pathIndex) => `candidate-${pathIndex}.jpg`),
          objectKey: "private object key"
        }))
      }
    });

    const response = await getRun(request("/api/integration-runs/run-1"), runContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.report.warnings).toHaveLength(200);
    expect(body.report.sourceMetadata.unsupportedRecords).toHaveLength(200);
    expect(body.report.sourceMetadata.missingMedia).toHaveLength(200);
    expect(body.report.sourceMetadata.ambiguousMedia).toHaveLength(200);
    expect(body.report.warnings[0]).toHaveLength(1_000);
    expect(body.report.sourceMetadata.ambiguousMedia[0]).toEqual({
      gedcomPath: "private/ambiguous-0.jpg",
      normalizedPath: "private/ambiguous-0.jpg",
      archivePaths: Array.from({ length: 20 }, (_, pathIndex) => `candidate-${pathIndex}.jpg`),
      archivePathCount: 25
    });
    expect(JSON.stringify(body.report.sourceMetadata)).not.toMatch(/raw GEDCOM|binary metadata|object key/i);
    expect(body.report.limits).toEqual({
      warnings: { total: 205, returned: 200, truncated: true },
      unsupportedRecords: { total: 205, returned: 200, truncated: true },
      missingMedia: { total: 205, returned: 200, truncated: true },
      ambiguousMedia: { total: 205, returned: 200, truncated: true }
    });
  });

  it("requests cancellation without pretending the worker has stopped", async () => {
    const response = await cancelRun(
      request("/api/integration-runs/run-1", "DELETE"),
      runContext()
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      run: { ...publicPendingRun, status: "cancel_requested" }
    });
    expect(storeMocks.cancelSyncRun).toHaveBeenCalledWith("run-1", {
      archiveId: ownerSession.archiveId
    });
  });

  it("redacts unexpected database and family details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    storeMocks.getSyncRun.mockRejectedValue(
      new Error("postgres://researcher:hunter2@db.internal/synthetic-private")
    );

    const response = await getRun(request("/api/integration-runs/run-1"), runContext());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(body.error).toBeTruthy();
    expect(body.error).not.toMatch(/hunter2|synthetic-private|db\.internal/i);
  });
});

describe("GET /api/integration-runs/[id]/changes", () => {
  it("returns a bounded cursor page and keeps remote deletions local by default", async () => {
    const response = await listChanges(
      request("/api/integration-runs/run-1/changes?limit=25&cursor=cursor-1"),
      runContext()
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      items: [
        {
          id: "change-1",
          classification: "deletion",
          proposedAction: "keep_local",
          entityType: "person",
          resolutionPayload: {}
        }
      ],
      nextCursor: "cursor-2",
      summary: {
        total: 9,
        filtered: 1,
        unresolved: 3,
        byClassification: {
          remote_only: 2,
          local_only: 1,
          same: 1,
          conflict: 3,
          deletion: 2
        }
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/baseHash|localHash|incomingHash|runId/i);
    expect(storeMocks.listSyncChanges).toHaveBeenCalledWith(
      "run-1",
      { cursor: "cursor-1", limit: 25 },
      { archiveId: ownerSession.archiveId }
    );
  });

  it("passes bounded server-side search and classification filters", async () => {
    const response = await listChanges(
      request("/api/integration-runs/run-1/changes?limit=50&query=vale&classification=conflict"),
      runContext()
    );

    expect(response.status).toBe(200);
    expect(storeMocks.listSyncChanges).toHaveBeenCalledWith(
      "run-1",
      { limit: 50, query: "vale", classification: "conflict" },
      { archiveId: ownerSession.archiveId }
    );
  });

  it.each([
    "/api/integration-runs/run-1/changes?classification=unknown",
    `/api/integration-runs/run-1/changes?query=${"x".repeat(161)}`
  ])("rejects an invalid change filter: %s", async (path) => {
    const response = await listChanges(request(path), runContext());

    expect(response.status).toBe(400);
    expect(storeMocks.listSyncChanges).not.toHaveBeenCalled();
  });

  it.each(["0", "101", "not-a-number"])("rejects an invalid page limit of %s", async (limit) => {
    const response = await listChanges(
      request(`/api/integration-runs/run-1/changes?limit=${limit}`),
      runContext()
    );

    expect(response.status).toBe(400);
    expect(storeMocks.listSyncChanges).not.toHaveBeenCalled();
  });
});

describe("POST /api/integration-runs/[id]/apply", () => {
  it("requires an idempotency key before any atomic apply", async () => {
    const response = await applyRun(
      jsonRequest("/api/integration-runs/run-1/apply", { resolutions: [] }, "POST"),
      runContext()
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Idempotency-Key header is required"
    });
    expect(storeMocks.applySyncRun).not.toHaveBeenCalled();
  });

  it("applies selected resolutions atomically and passes the key to the store", async () => {
    const resolutions = [{ changeId: "change-1", action: "keep_local" }];
    const response = await applyRun(
      jsonRequest(
        "/api/integration-runs/run-1/apply",
        { resolutions },
        "POST",
        { "Idempotency-Key": "apply-run-1-v1" }
      ),
      runContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: { ...publicPendingRun, status: "applied" }
    });
    expect(storeMocks.applySyncRun).toHaveBeenCalledWith(
      "run-1",
      { idempotencyKey: "apply-run-1-v1", resolutions },
      { archiveId: ownerSession.archiveId }
    );
  });

  it("passes an explicit ambiguous identity selection through the authenticated apply route", async () => {
    const resolutions = [{
      changeId: "change-ambiguous-1",
      action: "accept_incoming",
      localEntityId: "person-synthetic-candidate-2"
    }];
    const response = await applyRun(
      jsonRequest(
        "/api/integration-runs/run-1/apply",
        { resolutions },
        "POST",
        { "Idempotency-Key": "apply-run-1-identity-v1" }
      ),
      runContext()
    );

    expect(response.status).toBe(200);
    expect(storeMocks.applySyncRun).toHaveBeenCalledWith(
      "run-1",
      { idempotencyKey: "apply-run-1-identity-v1", resolutions },
      { archiveId: ownerSession.archiveId }
    );
  });

  it("passes only an explicit run-wide safe-incoming approval", async () => {
    const response = await applyRun(
      jsonRequest(
        "/api/integration-runs/run-1/apply",
        { resolutions: [], acceptAllSafeIncoming: true },
        "POST",
        { "Idempotency-Key": "apply-run-1-safe-incoming-v1" }
      ),
      runContext()
    );

    expect(response.status).toBe(200);
    expect(storeMocks.applySyncRun).toHaveBeenCalledWith(
      "run-1",
      {
        idempotencyKey: "apply-run-1-safe-incoming-v1",
        resolutions: [],
        acceptAllSafeIncoming: true
      },
      { archiveId: ownerSession.archiveId }
    );
  });

  it("rejects a non-boolean safe-incoming approval", async () => {
    const response = await applyRun(
      jsonRequest(
        "/api/integration-runs/run-1/apply",
        { resolutions: [], acceptAllSafeIncoming: "yes" },
        "POST",
        { "Idempotency-Key": "apply-run-1-invalid-safe-incoming-v1" }
      ),
      runContext()
    );

    expect(response.status).toBe(400);
    expect(storeMocks.applySyncRun).not.toHaveBeenCalled();
  });

  it("maps a changed baseline to a reviewable 409", async () => {
    storeMocks.applySyncRun.mockRejectedValue(
      Object.assign(new Error("person private-p1 changed locally"), { code: "STALE_BASELINE" })
    );

    const response = await applyRun(
      jsonRequest(
        "/api/integration-runs/run-1/apply",
        { resolutions: [] },
        "POST",
        { "Idempotency-Key": "apply-run-1-v1" }
      ),
      runContext()
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "The archive changed after this refresh was prepared; review the changes again"
    });
  });
});

describe("POST /api/integration-runs/[id]/rollback", () => {
  it("requires an idempotency key before restoring the pre-apply backup", async () => {
    const response = await rollbackRun(
      jsonRequest("/api/integration-runs/run-1/rollback", {}, "POST"),
      runContext()
    );

    expect(response.status).toBe(400);
    expect(storeMocks.rollbackSyncRun).not.toHaveBeenCalled();
  });

  it("rolls back through an explicit archive-scoped transaction", async () => {
    const response = await rollbackRun(
      jsonRequest(
        "/api/integration-runs/run-1/rollback",
        {},
        "POST",
        { "Idempotency-Key": "rollback-run-1-v1" }
      ),
      runContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: { ...publicPendingRun, status: "rolled_back" }
    });
    expect(storeMocks.rollbackSyncRun).toHaveBeenCalledWith(
      "run-1",
      { idempotencyKey: "rollback-run-1-v1", actorId: ownerSession.userId },
      { archiveId: ownerSession.archiveId }
    );
  });
});

function request(path: string, method: "GET" | "DELETE" = "GET"): Request {
  return new Request(`https://kinresolve.example${path}`, { method });
}

function jsonRequest(
  path: string,
  body: unknown,
  method: "POST" | "DELETE",
  headers: Record<string, string> = {}
): Request {
  return new Request(`https://kinresolve.example${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

function connectionContext() {
  return { params: Promise.resolve({ id: "source-1" }) };
}

function runContext() {
  return { params: Promise.resolve({ id: "run-1" }) };
}
