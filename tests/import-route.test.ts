import { afterEach, describe, expect, it, vi } from "vitest";

const blobMocks = vi.hoisted(() => ({
  get: vi.fn(),
  head: vi.fn(),
  del: vi.fn(),
  list: vi.fn()
}));
const workspaceMocks = vi.hoisted(() => ({
  applyPreparedGedcomImport: vi.fn()
}));

vi.mock("@vercel/blob", () => blobMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import { POST } from "@/app/api/imports/route";

const pathname = "gedcom-imports/17d9a2d4-f3c0-4c0f-a291-2de3a33f418a/family.ged";

afterEach(() => {
  vi.clearAllMocks();
});

describe("GEDCOM import route", () => {
  it("loads a private staged upload and bounds the returned diff", async () => {
    const content = [
      "0 HEAD",
      ...Array.from({ length: 20 }, (_, index) => `0 @I${index}@ INDI\n1 NAME Person ${index} /Test/`),
      "0 TRLR"
    ].join("\n");
    mockStagedContent(content);

    const response = await POST(importRequest({
      sourceName: "family.ged",
      currentUpload: { pathname, etag: "etag-1", size: Buffer.byteLength(content) },
      previousContent: "0 HEAD\n0 TRLR",
      apply: false
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshot.recordCount).toBe(22);
    expect(body.diff.records).toHaveLength(12);
    expect(body.diff.omittedRecords).toBe(10);
    expect(blobMocks.get).toHaveBeenCalledWith(pathname, { access: "private", useCache: false });
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("deletes the temporary private upload after a successful apply", async () => {
    const content = "0 HEAD\n0 @I1@ INDI\n1 NAME Test /Person/\n0 TRLR";
    mockStagedContent(content);
    blobMocks.del.mockResolvedValue(undefined);
    workspaceMocks.applyPreparedGedcomImport.mockResolvedValue({
      import: { id: "import-1", peopleImported: 1, sourcesImported: 0, rawRecordCount: 3 },
      backup: { id: "backup-1", storageKey: "postgres://workspace_backups/backup-1" },
      peopleImported: 1,
      sourcesImported: 0,
      rawRecordCount: 3
    });

    const response = await POST(importRequest({
      sourceName: "family.ged",
      currentUpload: { pathname, etag: "etag-1", size: Buffer.byteLength(content) },
      apply: true
    }));

    expect(response.status).toBe(201);
    expect(workspaceMocks.applyPreparedGedcomImport).toHaveBeenCalledOnce();
    expect(blobMocks.del).toHaveBeenCalledWith([pathname]);
  });

  it("rejects staged paths outside the private import prefix", async () => {
    const response = await POST(importRequest({
      sourceName: "family.ged",
      currentUpload: { pathname: "other/family.ged", etag: "etag-1", size: 100 },
      apply: false
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid GEDCOM upload path" });
    expect(blobMocks.get).not.toHaveBeenCalled();
  });

  it("decodes a UTF-16LE multipart upload using its byte-order mark", async () => {
    const gedcom = "0 HEAD\n1 CHAR UNICODE\n0 @I1@ INDI\n1 NAME José /Müller/\n0 TRLR";
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(gedcom, "utf16le")]);
    const formData = new FormData();
    formData.append("file", new File([bytes], "utf16-family.ged", { type: "text/plain" }));

    const response = await POST(new Request("https://kinsleuth.example/api/imports", { method: "POST", body: formData }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshot.recordCount).toBe(3);
    expect(body.snapshot.summary.individuals).toBe(1);
    expect(body.warnings).toEqual([]);
  });

  it("surfaces an approximate-support warning for staged ANSEL uploads", async () => {
    const gedcom = "0 HEAD\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME Test /Person/\n0 TRLR";
    mockStagedContent(gedcom);

    const response = await POST(importRequest({
      sourceName: "family.ged",
      currentUpload: { pathname, etag: "etag-1", size: Buffer.byteLength(gedcom) },
      apply: false
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshot.recordCount).toBe(3);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatch(/ANSEL/);
  });

  it("rejects staged references that exceed the combined memory envelope", async () => {
    const response = await POST(importRequest({
      sourceName: "family.ged",
      currentUpload: { pathname, etag: "etag-1", size: 20 * 1024 * 1024 },
      previousUpload: {
        pathname: "gedcom-imports/266d0b8c-37e3-4560-9f44-47ce12dcd12b/previous.ged",
        etag: "etag-2",
        size: 20 * 1024 * 1024
      },
      apply: false
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "The current and previous GEDCOM files exceed the combined import limit." });
    expect(blobMocks.head).not.toHaveBeenCalled();
    expect(blobMocks.get).not.toHaveBeenCalled();
  });
});

function mockStagedContent(content: string) {
  blobMocks.head.mockResolvedValue({
    pathname,
    etag: "etag-1",
    size: Buffer.byteLength(content),
    contentType: "text/plain"
  });
  blobMocks.get.mockResolvedValue({
    statusCode: 200,
    stream: new Blob([content]).stream(),
    blob: {
      pathname,
      etag: "etag-1",
      size: Buffer.byteLength(content),
      contentType: "text/plain"
    }
  });
}

function importRequest(body: unknown): Request {
  return new Request("https://kinsleuth.example/api/imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
