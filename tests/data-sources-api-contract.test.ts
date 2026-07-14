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
  getSyncRun: vi.fn(),
  cancelSyncRun: vi.fn(),
  listSyncChanges: vi.fn(),
  applySyncRun: vi.fn(),
  rollbackSyncRun: vi.fn()
}));

vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/integrations/store", () => storeMocks);

import { GET as listConnections, POST as createConnection } from "@/app/api/integrations/route";
import { DELETE as disconnectConnection } from "@/app/api/integrations/[id]/route";
import {
  DELETE as deleteArtifact,
  POST as createArtifact
} from "@/app/api/integrations/[id]/artifacts/route";
import { POST as startRun } from "@/app/api/integrations/[id]/sync-runs/route";
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
  lastAppliedSnapshotId: "snapshot-1",
  lastRefreshedAt: "2026-07-14T18:30:00.000Z"
};

const artifact = {
  id: "artifact-1",
  connectionId: connection.id,
  fileName: "ancestry-tree.zip",
  contentType: "application/zip",
  size: 128,
  state: "staged"
};

const pendingRun = {
  id: "run-1",
  connectionId: connection.id,
  status: "queued",
  createdAt: "2026-07-14T18:35:00.000Z"
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
  storeMocks.getSyncRun.mockResolvedValue(pendingRun);
  storeMocks.cancelSyncRun.mockResolvedValue({ ...pendingRun, status: "cancel_requested" });
  storeMocks.listSyncChanges.mockResolvedValue({
    items: [
      {
        id: "change-1",
        classification: "deletion",
        proposedAction: "keep_local",
        entityType: "person"
      }
    ],
    nextCursor: "cursor-2"
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
    await expect(response.json()).resolves.toEqual({ items: [connection] });
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
    await expect(response.json()).resolves.toEqual({ connection });
    expect(storeMocks.createIntegrationConnection).toHaveBeenCalledWith(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Hartwell family on Ancestry"
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
    await expect(response.json()).resolves.toEqual({ artifact });
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

describe("POST /api/integrations/[id]/sync-runs", () => {
  it("queues an asynchronous refresh for a staged artifact", async () => {
    const response = await startRun(
      jsonRequest("/api/integrations/source-1/sync-runs", { artifactId: "artifact-1" }, "POST"),
      connectionContext()
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ run: pendingRun });
    expect(storeMocks.startSyncRun).toHaveBeenCalledWith(
      "source-1",
      { artifactId: "artifact-1" },
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
    await expect(response.json()).resolves.toEqual({ run: pendingRun });
    expect(storeMocks.getSyncRun).toHaveBeenCalledWith("run-1", {
      archiveId: ownerSession.archiveId
    });
  });

  it("requests cancellation without pretending the worker has stopped", async () => {
    const response = await cancelRun(
      request("/api/integration-runs/run-1", "DELETE"),
      runContext()
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      run: { ...pendingRun, status: "cancel_requested" }
    });
    expect(storeMocks.cancelSyncRun).toHaveBeenCalledWith("run-1", {
      archiveId: ownerSession.archiveId
    });
  });

  it("redacts unexpected database and family details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    storeMocks.getSyncRun.mockRejectedValue(
      new Error("postgres://researcher:hunter2@db.internal/Riemer-private")
    );

    const response = await getRun(request("/api/integration-runs/run-1"), runContext());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(body.error).toBeTruthy();
    expect(body.error).not.toMatch(/hunter2|Riemer|db\.internal/i);
  });
});

describe("GET /api/integration-runs/[id]/changes", () => {
  it("returns a bounded cursor page and keeps remote deletions local by default", async () => {
    const response = await listChanges(
      request("/api/integration-runs/run-1/changes?limit=25&cursor=cursor-1"),
      runContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "change-1",
          classification: "deletion",
          proposedAction: "keep_local",
          entityType: "person"
        }
      ],
      nextCursor: "cursor-2"
    });
    expect(storeMocks.listSyncChanges).toHaveBeenCalledWith(
      "run-1",
      { cursor: "cursor-1", limit: 25 },
      { archiveId: ownerSession.archiveId }
    );
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
      run: { ...pendingRun, status: "applied" }
    });
    expect(storeMocks.applySyncRun).toHaveBeenCalledWith(
      "run-1",
      { idempotencyKey: "apply-run-1-v1", resolutions },
      { archiveId: ownerSession.archiveId }
    );
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
      run: { ...pendingRun, status: "rolled_back" }
    });
    expect(storeMocks.rollbackSyncRun).toHaveBeenCalledWith(
      "run-1",
      { idempotencyKey: "rollback-run-1-v1" },
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
