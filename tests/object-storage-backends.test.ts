import { describe, expect, it, vi } from "vitest";

import {
  createConfiguredArchiveObjectStorage,
  createS3ObjectStorageBackend,
  createVercelBlobObjectStorageBackend
} from "@/lib/storage/object-storage";

describe("private object-storage backends", () => {
  it("maps private archive operations to an S3-compatible bucket", async () => {
    const objects = new Map<string, { bytes: Uint8Array; contentType: string; etag: string }>();
    const client = {
      send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const key = String(command.input.Key);
        if (command.constructor.name === "HeadObjectCommand") {
          const value = objects.get(key);
          if (!value) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
          return { ContentLength: value.bytes.length, ContentType: value.contentType, ETag: value.etag };
        }
        if (command.constructor.name === "PutObjectCommand") {
          objects.set(key, {
            bytes: new Uint8Array(command.input.Body as Uint8Array),
            contentType: String(command.input.ContentType),
            etag: '"etag-source"'
          });
          return {};
        }
        if (command.constructor.name === "CopyObjectCommand") {
          const source = decodeURIComponent(String(command.input.CopySource)).replace(/^kinresolve-private\//, "");
          const value = objects.get(source);
          if (!value || command.input.CopySourceIfMatch !== value.etag) throw new Error("source precondition failed");
          objects.set(key, {
            bytes: new Uint8Array(value.bytes),
            contentType: String(command.input.ContentType),
            etag: '"etag-promoted"'
          });
          return {};
        }
        if (command.constructor.name === "GetObjectCommand") {
          const value = objects.get(key);
          if (!value) throw new Error("not found");
          return { Body: { transformToByteArray: async () => value.bytes } };
        }
        if (command.constructor.name === "DeleteObjectCommand") {
          objects.delete(key);
          return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
      })
    };
    const backend = createS3ObjectStorageBackend({ client, bucket: "kinresolve-private" });
    const key = { key: "archives/synthetic/integration-artifacts/abc", access: "private" as const };

    await expect(backend.stat(key)).resolves.toBeUndefined();
    await backend.put({ ...key, bytes: new Uint8Array([1, 2, 3]), contentType: "application/zip" });
    await expect(backend.stat(key)).resolves.toEqual({
      key: key.key,
      size: 3,
      contentType: "application/zip",
      etag: '"etag-source"'
    });
    const promoted = { ...key, key: "archives/synthetic/integration-artifacts/promoted" };
    await backend.promote!({
      sourceKey: key.key,
      destinationKey: promoted.key,
      access: "private",
      contentType: "application/zip",
      expectedSourceEtag: '"etag-source"'
    });
    await expect(backend.read(promoted)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        Bucket: "kinresolve-private",
        Key: promoted.key,
        CopySourceIfMatch: '"etag-source"',
        ContentType: "application/zip",
        CacheControl: "private, no-store"
      })
    }));
    await expect(backend.read(key)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await backend.delete(key);
    await expect(backend.stat(key)).resolves.toBeUndefined();
    expect(client.send).toHaveBeenCalled();
  });

  it("uses Vercel Blob only through private server operations", async () => {
    const operations = {
      head: vi.fn(async () => ({ size: 4, contentType: "text/plain", etag: "etag-source" })),
      put: vi.fn(async () => ({ pathname: "archives/synthetic/integration-artifacts/abc" })),
      copy: vi.fn(async () => ({ pathname: "archives/synthetic/integration-artifacts/promoted" })),
      get: vi.fn(async () => ({ statusCode: 200, stream: new Blob(["tree"]).stream() })),
      del: vi.fn(async () => undefined)
    };
    const backend = createVercelBlobObjectStorageBackend({ operations, token: "test-token" });
    const key = { key: "archives/synthetic/integration-artifacts/abc", access: "private" as const };

    await expect(backend.stat(key)).resolves.toEqual({
      key: key.key,
      size: 4,
      contentType: "text/plain",
      etag: "etag-source"
    });
    await backend.put({ ...key, bytes: new TextEncoder().encode("tree"), contentType: "text/plain" });
    await backend.promote!({
      sourceKey: key.key,
      destinationKey: "archives/synthetic/integration-artifacts/promoted",
      access: "private",
      contentType: "text/plain",
      expectedSourceEtag: "etag-source"
    });
    await expect(backend.read(key)).resolves.toEqual(new TextEncoder().encode("tree"));
    await backend.delete(key);

    expect(operations.put).toHaveBeenCalledWith(
      key.key,
      expect.any(Uint8Array),
      expect.objectContaining({ access: "private", addRandomSuffix: false, allowOverwrite: false, token: "test-token" })
    );
    expect(operations.get).toHaveBeenCalledWith(key.key, expect.objectContaining({ access: "private", token: "test-token" }));
    expect(operations.copy).toHaveBeenCalledWith(
      key.key,
      "archives/synthetic/integration-artifacts/promoted",
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "text/plain",
        ifMatch: "etag-source",
        token: "test-token"
      })
    );
  });

  it("selects an explicit hosted or self-hosted backend and fails closed without one", () => {
    const s3Backend = { stat: vi.fn(), put: vi.fn(), read: vi.fn(), delete: vi.fn() };
    const blobBackend = { stat: vi.fn(), put: vi.fn(), read: vi.fn(), delete: vi.fn() };
    const factories = {
      s3: vi.fn(() => s3Backend),
      vercelBlob: vi.fn(() => blobBackend)
    };

    expect(createConfiguredArchiveObjectStorage({
      environment: {
        KINRESOLVE_OBJECT_STORAGE_BACKEND: "s3",
        S3_BUCKET: "kinresolve",
        MINIO_ROOT_USER: "synthetic-minio-user",
        MINIO_ROOT_PASSWORD: "synthetic-minio-password"
      },
      factories
    })).toBeDefined();
    expect(factories.s3).toHaveBeenCalledOnce();
    expect(factories.s3).toHaveBeenCalledWith(expect.objectContaining({
      accessKeyId: "synthetic-minio-user",
      secretAccessKey: "synthetic-minio-password"
    }));

    expect(createConfiguredArchiveObjectStorage({
      environment: {
        KINRESOLVE_OBJECT_STORAGE_BACKEND: "vercel-blob",
        BLOB_READ_WRITE_TOKEN: "blob-token"
      },
      factories
    })).toBeDefined();
    expect(factories.vercelBlob).toHaveBeenCalledOnce();

    expect(() => createConfiguredArchiveObjectStorage({ environment: {}, factories })).toThrow(/object storage.*configured/i);
  });
});
