import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createArchiveObjectStorage } from "@/lib/storage/object-storage";

describe("archive-namespaced private object storage", () => {
  it("stores integration artifacts under an opaque archive namespace", async () => {
    const backend = createMemoryBackend();
    const storage = createArchiveObjectStorage({ backend });
    const bytes = Buffer.from("synthetic Ancestry export", "utf8");

    const stored = await storage.put({
      archiveId: "archive-northwood",
      purpose: "integration-artifacts",
      fileName: "Northwood Family Tree.zip",
      bytes,
      contentType: "application/zip"
    });

    expect(stored.key).toMatch(/^archives\/archive-northwood\/integration-artifacts\//);
    expect(stored.key).not.toContain("Northwood Family Tree");
    expect(stored).toMatchObject({
      access: "private",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
      duplicate: false
    });
    expect(backend.put).toHaveBeenCalledWith(
      expect.objectContaining({
        key: stored.key,
        access: "private",
        contentType: "application/zip"
      })
    );

    await expect(storage.read({ archiveId: "archive-northwood", key: stored.key })).resolves.toEqual(bytes);
  });

  it("rejects cross-archive reads and deletes before calling the storage backend", async () => {
    const backend = createMemoryBackend();
    const storage = createArchiveObjectStorage({ backend });
    const stored = await storage.put({
      archiveId: "archive-northwood",
      purpose: "integration-media",
      fileName: "portrait.jpg",
      bytes: Buffer.from("synthetic portrait", "utf8"),
      contentType: "image/jpeg"
    });
    backend.read.mockClear();
    backend.delete.mockClear();

    await expect(storage.read({ archiveId: "archive-southwood", key: stored.key })).rejects.toThrow(/archive|scope/i);
    await expect(storage.delete({ archiveId: "archive-southwood", key: stored.key })).rejects.toThrow(/archive|scope/i);
    expect(backend.read).not.toHaveBeenCalled();
    expect(backend.delete).not.toHaveBeenCalled();
  });

  it.each(["../archive-northwood", "archive/northwood", "archive\\northwood", ""])(
    "rejects an unsafe archive namespace %j",
    async (archiveId) => {
      const backend = createMemoryBackend();
      const storage = createArchiveObjectStorage({ backend });

      await expect(
        storage.put({
          archiveId,
          purpose: "integration-artifacts",
          fileName: "tree.ged",
          bytes: Buffer.from("0 HEAD\n0 TRLR", "utf8"),
          contentType: "text/plain"
        })
      ).rejects.toThrow(/archive/i);
      expect(backend.put).not.toHaveBeenCalled();
    }
  );

  it("deduplicates an identical staged artifact by SHA-256 within one archive", async () => {
    const backend = createMemoryBackend();
    const storage = createArchiveObjectStorage({ backend });
    const bytes = Buffer.from("same synthetic export bytes", "utf8");
    const input = {
      archiveId: "archive-northwood",
      purpose: "integration-artifacts" as const,
      fileName: "tree.zip",
      bytes,
      contentType: "application/zip"
    };

    const first = await storage.put(input);
    const duplicate = await storage.put({ ...input, fileName: "renamed-tree.zip" });

    expect(duplicate).toMatchObject({
      key: first.key,
      sha256: first.sha256,
      duplicate: true
    });
    expect(backend.put).toHaveBeenCalledTimes(1);
  });

  it("never deduplicates identical bytes across archive boundaries", async () => {
    const backend = createMemoryBackend();
    const storage = createArchiveObjectStorage({ backend });
    const bytes = Buffer.from("same synthetic export bytes", "utf8");

    const northwood = await storage.put({
      archiveId: "archive-northwood",
      purpose: "integration-artifacts",
      fileName: "tree.zip",
      bytes,
      contentType: "application/zip"
    });
    const southwood = await storage.put({
      archiveId: "archive-southwood",
      purpose: "integration-artifacts",
      fileName: "tree.zip",
      bytes,
      contentType: "application/zip"
    });

    expect(southwood.key).not.toBe(northwood.key);
    expect(southwood.duplicate).toBe(false);
    expect(backend.put).toHaveBeenCalledTimes(2);
  });

  it("promotes a staging object to an opaque content-addressed key without reading it", async () => {
    const backend = createMemoryBackend();
    const storage = createArchiveObjectStorage({ backend });
    const sourceKey = "archives/archive-northwood/integration-upload-staging/intent.ged";
    const bytes = Buffer.from("0 HEAD\n0 TRLR", "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    backend.seed(sourceKey, bytes, "text/plain", "etag-source");

    await expect(storage.promote({
      archiveId: "archive-northwood",
      sourceKey,
      purpose: "integration-artifacts",
      sha256,
      contentType: "text/plain",
      expectedSourceEtag: "etag-source"
    })).resolves.toEqual({
      key: `archives/archive-northwood/integration-artifacts/${sha256}`,
      access: "private",
      duplicate: false
    });
    expect(backend.promote).toHaveBeenCalledWith({
      sourceKey,
      destinationKey: `archives/archive-northwood/integration-artifacts/${sha256}`,
      access: "private",
      contentType: "text/plain",
      expectedSourceEtag: "etag-source"
    });
    expect(backend.read).not.toHaveBeenCalled();
  });
});

type BackendObject = {
  key: string;
  bytes: Buffer;
  contentType: string;
  access: "private";
};

type BackendWrite = Omit<BackendObject, "bytes"> & { bytes: Uint8Array };
type BackendKey = { key: string; access: "private" };

function createMemoryBackend() {
  const objects = new Map<string, BackendObject>();

  return {
    stat: vi.fn(async ({ key }: BackendKey) => {
      const stored = objects.get(key);
      return stored ? { key: stored.key, size: stored.bytes.length, contentType: stored.contentType } : undefined;
    }),
    put: vi.fn(async (input: BackendWrite) => {
      objects.set(input.key, { ...input, bytes: Buffer.from(input.bytes) });
      return { key: input.key };
    }),
    promote: vi.fn(async (input: {
      sourceKey: string;
      destinationKey: string;
      access: "private";
      contentType: string;
      expectedSourceEtag: string;
    }) => {
      const source = objects.get(input.sourceKey);
      if (!source || (source as BackendObject & { etag?: string }).etag !== input.expectedSourceEtag) {
        throw new Error("source changed");
      }
      objects.set(input.destinationKey, {
        key: input.destinationKey,
        access: "private",
        bytes: Buffer.from(source.bytes),
        contentType: input.contentType
      });
    }),
    read: vi.fn(async ({ key }: BackendKey) => {
      const stored = objects.get(key);
      if (!stored) {
        throw new Error("Object not found");
      }
      return Buffer.from(stored.bytes);
    }),
    delete: vi.fn(async ({ key }: BackendKey) => {
      objects.delete(key);
    }),
    seed(key: string, bytes: Buffer, contentType: string, etag: string) {
      objects.set(key, { key, bytes, contentType, access: "private", etag } as BackendObject);
    }
  };
}
