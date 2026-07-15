import { describe, expect, it } from "vitest";
import {
  createGedcomUploadPath,
  maximumGedcomFileSizeBytes,
  parseGedcomUploadClientPayload,
  sanitizeGedcomFileName,
  shouldStageGedcomFiles,
  validateGedcomUploadPath,
  validateGedcomUploadRequest
} from "@/lib/gedcom/upload-policy";

const uploadId = "17d9a2d4-f3c0-4c0f-a291-2de3a33f418a";
const archiveId = "archive-alpha";
const otherArchiveId = "archive-beta";

describe("GEDCOM upload policy", () => {
  it("builds a private, randomized GEDCOM upload path", () => {
    expect(createGedcomUploadPath(archiveId, uploadId, "Family Tree (2026).GED")).toBe(
      "gedcom-imports/archive-alpha/17d9a2d4-f3c0-4c0f-a291-2de3a33f418a/Family-Tree-2026.GED"
    );
    expect(
      validateGedcomUploadPath(
        createGedcomUploadPath(archiveId, uploadId, "family.gedcom"),
        archiveId
      )
    ).toContain(uploadId);
  });

  it("rejects paths outside the GEDCOM staging prefix", () => {
    expect(() => validateGedcomUploadPath("other/private.ged", archiveId)).toThrow(/Invalid GEDCOM upload path/);
    expect(() => validateGedcomUploadPath(`gedcom-imports/${archiveId}/${uploadId}/family.pdf`, archiveId)).toThrow(/Invalid GEDCOM upload path/);
  });

  it("rejects a valid staged path from a different archive", () => {
    const pathname = createGedcomUploadPath(archiveId, uploadId, "family.ged");

    expect(() => validateGedcomUploadPath(pathname, otherArchiveId)).toThrow(/Invalid GEDCOM upload path/);
  });

  it("binds upload metadata to the exact generated path", () => {
    const payload = JSON.stringify({ uploadId, originalName: "family.ged", size: 10_500_000 });
    const pathname = createGedcomUploadPath(archiveId, uploadId, "family.ged");

    expect(validateGedcomUploadRequest(pathname, payload, archiveId)).toEqual({ uploadId, originalName: "family.ged", size: 10_500_000 });
    expect(() => validateGedcomUploadRequest(`${pathname}com`, payload, archiveId)).toThrow(/does not match/);
    expect(() => validateGedcomUploadRequest(pathname, payload, otherArchiveId)).toThrow(/does not match/);
  });

  it("enforces the configured file-size limit", () => {
    expect(() => parseGedcomUploadClientPayload(JSON.stringify({ uploadId, originalName: "family.ged", size: 0 }))).toThrow(/between 1 byte/);
    expect(() => parseGedcomUploadClientPayload(JSON.stringify({ uploadId, originalName: "family.ged", size: maximumGedcomFileSizeBytes + 1 }))).toThrow(/between 1 byte/);
  });

  it("stages files before the combined Vercel request approaches its limit", () => {
    const small = new File([new Uint8Array(1_500_000)], "small.ged");
    const medium = new File([new Uint8Array(2_100_000)], "medium.ged");

    expect(shouldStageGedcomFiles([small])).toBe(false);
    expect(shouldStageGedcomFiles([small, medium])).toBe(true);
  });

  it("sanitizes untrusted file names", () => {
    expect(sanitizeGedcomFileName("../../My family <final>.ged")).toBe("My-family-final.ged");
  });
});
