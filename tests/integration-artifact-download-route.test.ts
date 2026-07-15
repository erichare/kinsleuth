import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveApiAccess } from "@/lib/api-access";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));
const artifactStoreMocks = vi.hoisted(() => ({
  streamIntegrationArtifact: vi.fn()
}));

vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/integrations/artifact-store", () => artifactStoreMocks);

import { GET } from "@/app/api/integrations/[id]/artifacts/[artifactId]/download/route";

const ownerSession = {
  userId: "owner-alpha",
  email: "owner-alpha@example.test",
  name: "Alpha Owner",
  role: "owner" as const,
  archiveId: "archive-alpha"
};
const bytes = Buffer.from("PK synthetic original import package");
const artifact = {
  id: "artifact-1",
  connectionId: "connection-alpha",
  fileName: "../../family r\u00e9sum\u00e9.zip",
  contentType: "text/html",
  size: bytes.length,
  state: "ready",
  duplicate: false,
  createdAt: "2026-07-14T20:00:00.000Z",
  updatedAt: "2026-07-14T20:00:00.000Z"
};

beforeEach(() => {
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue(ownerSession);
  artifactStoreMocks.streamIntegrationArtifact.mockResolvedValue({
    artifact,
    body: (async function* () {
      yield bytes;
    })()
  });
});

describe("integration artifact download route", () => {
  it("registers the download as imports:manage", () => {
    expect(resolveApiAccess(
      "/api/integrations/connection-alpha/artifacts/artifact-1/download",
      "GET"
    )).toEqual({ kind: "permission", permission: "imports:manage" });
  });

  it("streams the original bytes with attachment-only hardening", async () => {
    const response = await GET(
      new Request("https://kinresolve.example/api/integrations/connection-alpha/artifacts/artifact-1/download"),
      routeContext("connection-alpha", "artifact-1")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"family r_sum_.zip\"; filename*=UTF-8''family%20r%C3%A9sum%C3%A9.zip"
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(artifactStoreMocks.streamIntegrationArtifact).toHaveBeenCalledWith(
      "connection-alpha",
      "artifact-1",
      { archiveId: "archive-alpha" }
    );
    expect(JSON.stringify([...response.headers])).not.toContain("archives/");
  });

  it("does not disclose an artifact from another archive or its object key", async () => {
    artifactStoreMocks.streamIntegrationArtifact.mockRejectedValueOnce(Object.assign(
      new Error("archives/archive-beta/integration-artifacts/private-key"),
      { code: "NOT_FOUND" }
    ));

    const response = await GET(
      new Request("https://kinresolve.example/api/integrations/connection-beta/artifacts/artifact-beta/download"),
      routeContext("connection-beta", "artifact-beta")
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Import package not found" });
    expect(artifactStoreMocks.streamIntegrationArtifact).toHaveBeenCalledWith(
      "connection-beta",
      "artifact-beta",
      { archiveId: "archive-alpha" }
    );
  });

  it("denies viewers before opening private storage", async () => {
    authMocks.getSessionContext.mockResolvedValueOnce({ ...ownerSession, role: "viewer" });

    const response = await GET(
      new Request("https://kinresolve.example/api/integrations/connection-alpha/artifacts/artifact-1/download"),
      routeContext("connection-alpha", "artifact-1")
    );

    expect(response.status).toBe(403);
    expect(artifactStoreMocks.streamIntegrationArtifact).not.toHaveBeenCalled();
  });
});

function routeContext(id: string, artifactId: string) {
  return { params: Promise.resolve({ id, artifactId }) };
}
