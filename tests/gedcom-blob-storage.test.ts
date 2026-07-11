import { afterEach, describe, expect, it, vi } from "vitest";

const blobMocks = vi.hoisted(() => ({
  get: vi.fn(),
  head: vi.fn(),
  del: vi.fn(),
  list: vi.fn()
}));

vi.mock("@vercel/blob", () => blobMocks);

import { cleanupStaleGedcomUploads, deleteStagedGedcomUploads, readStagedGedcomUpload } from "@/lib/gedcom/blob-storage";

const pathname = "gedcom-imports/17d9a2d4-f3c0-4c0f-a291-2de3a33f418a/family.ged";
const content = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 TRLR";

afterEach(() => {
  vi.clearAllMocks();
});

describe("GEDCOM Blob storage", () => {
  it("reads a matching private staged upload", async () => {
    blobMocks.head.mockResolvedValue({ pathname, etag: '"etag-1"', size: content.length, contentType: "text/plain; charset=utf-8" });
    blobMocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Blob([content]).stream(),
      blob: { pathname, etag: 'W/"etag-1"', size: 0, contentType: "text/plain; charset=utf-8" }
    });

    await expect(readStagedGedcomUpload({ pathname, etag: '"etag-1"', size: content.length })).resolves.toEqual({
      content,
      charset: "utf-8",
      warnings: []
    });
    expect(blobMocks.get).toHaveBeenCalledWith(pathname, { access: "private", useCache: false });
  });

  it("rejects a changed upload before parsing it", async () => {
    blobMocks.head.mockResolvedValue({ pathname, etag: "different", size: content.length, contentType: "text/plain" });

    await expect(readStagedGedcomUpload({ pathname, etag: "etag-1", size: content.length })).rejects.toThrow(/changed after it was selected/);
    expect(blobMocks.get).not.toHaveBeenCalled();
  });

  it("does not resolve arbitrary Blob paths", async () => {
    await expect(readStagedGedcomUpload({ pathname: "other/private.ged", etag: "etag-1", size: 100 })).rejects.toThrow(/Invalid GEDCOM upload path/);
    expect(blobMocks.get).not.toHaveBeenCalled();
  });

  it("deduplicates paths before cleanup", async () => {
    blobMocks.del.mockResolvedValue(undefined);

    await deleteStagedGedcomUploads([pathname, pathname, undefined]);

    expect(blobMocks.del).toHaveBeenCalledWith([pathname]);
  });

  it("removes abandoned uploads older than one day", async () => {
    blobMocks.list.mockResolvedValue({
      blobs: [
        { pathname, uploadedAt: new Date("2026-07-07T00:00:00.000Z") },
        { pathname: pathname.replace("family.ged", "recent.ged"), uploadedAt: new Date("2026-07-09T11:30:00.000Z") }
      ],
      hasMore: false
    });
    blobMocks.del.mockResolvedValue(undefined);

    await expect(cleanupStaleGedcomUploads(new Date("2026-07-09T12:00:00.000Z"))).resolves.toBe(1);
    expect(blobMocks.del).toHaveBeenCalledWith([pathname]);
  });
});
