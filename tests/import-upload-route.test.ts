import { afterEach, describe, expect, it, vi } from "vitest";

const uploadMocks = vi.hoisted(() => ({
  handleUpload: vi.fn(async (input: {
    body: {
      type: string;
      payload: { pathname: string; clientPayload: string | null; multipart: boolean };
    };
    onBeforeGenerateToken: (
      pathname: string,
      clientPayload: string | null,
      multipart: boolean
    ) => Promise<unknown>;
  }) => {
    await input.onBeforeGenerateToken(
      input.body.payload.pathname,
      input.body.payload.clientPayload,
      input.body.payload.multipart
    );
    return { type: input.body.type, clientToken: "test-token" };
  })
}));
const storageMocks = vi.hoisted(() => ({
  cleanupStaleGedcomUploadsForArchive: vi.fn(),
  deleteStagedGedcomUploads: vi.fn()
}));
const nextServerMocks = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock("@vercel/blob/client", () => uploadMocks);
vi.mock("@/lib/gedcom/blob-storage", () => storageMocks);
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: nextServerMocks.after
}));
vi.mock("@/lib/auth-session", () => ({
  getSessionContext: vi.fn(async () => ({
    userId: "owner-alpha",
    email: "owner-alpha@example.com",
    name: "Alpha Owner",
    role: "owner",
    archiveId: "archive-alpha"
  }))
}));

import { GET, POST } from "@/app/api/imports/uploads/route";

const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const uploadId = "17d9a2d4-f3c0-4c0f-a291-2de3a33f418a";

afterEach(() => {
  vi.clearAllMocks();
  if (originalBlobToken === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  }
});

describe("legacy staged GEDCOM upload route", () => {
  it("returns the archive namespace from the authenticated session", async () => {
    const response = await GET(new Request("https://kinresolve.example/api/imports/uploads"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ archiveId: "archive-alpha" });
  });

  it("refuses to mint an upload token for another archive's path", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
    const response = await POST(uploadRequest("archive-beta"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "GEDCOM upload path does not match its metadata"
    });
  });

  it("preserves token issuance for the authenticated archive", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";

    const response = await POST(uploadRequest("archive-alpha"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: "blob.generate-client-token",
      clientToken: "test-token"
    });
    expect(uploadMocks.handleUpload).toHaveBeenCalledOnce();
    expect(nextServerMocks.after).toHaveBeenCalledOnce();

    const cleanup = nextServerMocks.after.mock.calls[0]?.[0];
    await cleanup();

    expect(storageMocks.cleanupStaleGedcomUploadsForArchive).toHaveBeenCalledWith("archive-alpha");
  });
});

function uploadRequest(archiveId: string): Request {
  return new Request("https://kinresolve.example/api/imports/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: {
        pathname: `gedcom-imports/${archiveId}/${uploadId}/family.ged`,
        multipart: false,
        clientPayload: JSON.stringify({
          uploadId,
          originalName: "family.ged",
          size: 1024
        })
      }
    })
  });
}
