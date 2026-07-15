import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  BlobNotFoundError,
  copy as blobCopy,
  del as blobDelete,
  get as blobGet,
  head as blobHead,
  put as blobPut
} from "@vercel/blob";

const privateAccess = "private" as const;
const archiveIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const purposePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type PrivateObjectKey = {
  key: string;
  access: typeof privateAccess;
};

export type PrivateObjectWrite = PrivateObjectKey & {
  bytes: Uint8Array;
  contentType: string;
};

export type PrivateObjectPromotion = {
  sourceKey: string;
  destinationKey: string;
  access: typeof privateAccess;
  contentType: string;
  expectedSourceEtag: string;
};

export type PrivateObjectMetadata = {
  key: string;
  size: number;
  contentType?: string;
  etag?: string;
};

export type PrivateObjectStorageBackend = {
  stat(input: PrivateObjectKey): Promise<PrivateObjectMetadata | undefined>;
  put(input: PrivateObjectWrite): Promise<unknown>;
  promote?(input: PrivateObjectPromotion): Promise<unknown>;
  read(input: PrivateObjectKey): Promise<Uint8Array>;
  stream?(input: PrivateObjectKey): Promise<AsyncIterable<Uint8Array>>;
  delete(input: PrivateObjectKey): Promise<void>;
};

type S3CompatibleClient = {
  send(command: never): Promise<unknown>;
};

type VercelBlobOperations = {
  head(pathname: string, options: { token: string }): Promise<{ size: number; contentType?: string; etag?: string }>;
  put(
    pathname: string,
    bytes: Uint8Array,
    options: {
      access: "private";
      addRandomSuffix: false;
      allowOverwrite: false;
      contentType: string;
      token: string;
    }
  ): Promise<unknown>;
  copy(
    sourcePathname: string,
    destinationPathname: string,
    options: {
      access: "private";
      addRandomSuffix: false;
      allowOverwrite: false;
      cacheControlMaxAge: number;
      contentType: string;
      ifMatch: string;
      token: string;
    }
  ): Promise<unknown>;
  get(
    pathname: string,
    options: { access: "private"; token: string; useCache: false }
  ): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;
  del(pathname: string, options: { token: string }): Promise<void>;
};

type ObjectStorageEnvironment = Record<string, string | undefined>;

type ObjectStorageFactories = {
  s3(input: S3BackendConfiguration): PrivateObjectStorageBackend;
  vercelBlob(input: VercelBlobBackendConfiguration): PrivateObjectStorageBackend;
};

export type S3BackendConfiguration = {
  bucket: string;
  client?: S3CompatibleClient;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type VercelBlobBackendConfiguration = {
  token: string;
  operations?: VercelBlobOperations;
};

export type ArchiveObjectPutInput = {
  archiveId: string;
  purpose: string;
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
};

export type ArchiveObjectPromotionInput = {
  archiveId: string;
  sourceKey: string;
  purpose: string;
  sha256: string;
  contentType: string;
  expectedSourceEtag: string;
};

export type StoredArchiveObject = {
  key: string;
  access: typeof privateAccess;
  sha256: string;
  size: number;
  duplicate: boolean;
};

export function createArchiveObjectStorage(input: { backend: PrivateObjectStorageBackend }) {
  const { backend } = input;

  return {
    async put(object: ArchiveObjectPutInput): Promise<StoredArchiveObject> {
      validateArchiveId(object.archiveId);
      validatePurpose(object.purpose);
      validateFileName(object.fileName);
      validateContentType(object.contentType);

      const bytes = Buffer.from(object.bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const key = `${archivePrefix(object.archiveId)}${object.purpose}/${sha256}`;
      const privateKey = { key, access: privateAccess };
      const existing = await backend.stat(privateKey);

      if (existing) {
        return {
          ...privateKey,
          sha256,
          size: existing.size,
          duplicate: true
        };
      }

      await backend.put({
        ...privateKey,
        bytes,
        contentType: object.contentType
      });

      return {
        ...privateKey,
        sha256,
        size: bytes.length,
        duplicate: false
      };
    },

    async read(object: { archiveId: string; key: string }): Promise<Buffer> {
      assertArchiveKey(object.archiveId, object.key);
      return Buffer.from(await backend.read({ key: object.key, access: privateAccess }));
    },

    async promote(object: ArchiveObjectPromotionInput): Promise<{
      key: string;
      access: typeof privateAccess;
      duplicate: boolean;
    }> {
      validateArchiveId(object.archiveId);
      assertArchiveKey(object.archiveId, object.sourceKey);
      validatePurpose(object.purpose);
      validateSha256(object.sha256);
      validateContentType(object.contentType);
      if (!object.expectedSourceEtag.trim() || /[\r\n\0]/.test(object.expectedSourceEtag)) {
        throw new Error("Invalid source object identity");
      }

      const key = `${archivePrefix(object.archiveId)}${object.purpose}/${object.sha256}`;
      if (key === object.sourceKey) throw new Error("Promotion source and destination must differ");
      const destination = { key, access: privateAccess };
      const existing = await backend.stat(destination);
      if (existing) return { ...destination, duplicate: true };
      if (!backend.promote) {
        throw new Error("Private object storage does not support provider-side promotion");
      }
      await backend.promote({
        sourceKey: object.sourceKey,
        destinationKey: key,
        access: privateAccess,
        contentType: object.contentType,
        expectedSourceEtag: object.expectedSourceEtag
      });
      return { ...destination, duplicate: false };
    },

    async stat(object: { archiveId: string; key: string }): Promise<PrivateObjectMetadata | undefined> {
      assertArchiveKey(object.archiveId, object.key);
      return backend.stat({ key: object.key, access: privateAccess });
    },

    async stream(object: { archiveId: string; key: string }): Promise<AsyncIterable<Uint8Array>> {
      assertArchiveKey(object.archiveId, object.key);
      if (!backend.stream) {
        throw new Error("Private object storage does not support streaming reads");
      }
      return backend.stream({ key: object.key, access: privateAccess });
    },

    async delete(object: { archiveId: string; key: string }): Promise<void> {
      assertArchiveKey(object.archiveId, object.key);
      await backend.delete({ key: object.key, access: privateAccess });
    }
  };
}

export type ArchiveObjectStorage = ReturnType<typeof createArchiveObjectStorage>;

export function createS3ObjectStorageBackend(input: S3BackendConfiguration): PrivateObjectStorageBackend {
  const bucket = input.bucket.trim();
  if (!bucket || /[\r\n\0]/.test(bucket)) {
    throw new Error("S3 object storage requires a valid private bucket");
  }
  if ((input.accessKeyId && !input.secretAccessKey) || (!input.accessKeyId && input.secretAccessKey)) {
    throw new Error("S3 object storage credentials must include both access key fields");
  }

  const client = input.client ?? new S3Client({
    region: input.region?.trim() || "us-east-1",
    endpoint: input.endpoint?.trim() || undefined,
    forcePathStyle: Boolean(input.endpoint?.trim()),
    credentials: input.accessKeyId && input.secretAccessKey
      ? { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey }
      : undefined
  }) as unknown as S3CompatibleClient;

  return {
    async stat(object) {
      try {
        const result = await client.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: object.key
        }) as never) as { ContentLength?: number; ContentType?: string; ETag?: string };
        return {
          key: object.key,
          size: result.ContentLength ?? 0,
          contentType: result.ContentType,
          ...(result.ETag ? { etag: result.ETag } : {})
        };
      } catch (error) {
        if (isS3NotFound(error)) return undefined;
        throw error;
      }
    },

    async put(object) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: object.key,
        Body: object.bytes,
        ContentType: object.contentType,
        CacheControl: "private, no-store"
      }) as never);
    },

    async promote(object) {
      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: object.destinationKey,
        CopySource: encodeURIComponent(`${bucket}/${object.sourceKey}`),
        CopySourceIfMatch: object.expectedSourceEtag,
        IfNoneMatch: "*",
        MetadataDirective: "REPLACE",
        ContentType: object.contentType,
        CacheControl: "private, no-store"
      }) as never);
    },

    async read(object) {
      const result = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: object.key
      }) as never) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } };
      if (!result.Body?.transformToByteArray) {
        throw new Error("Private S3 object response did not include a readable body");
      }
      return result.Body.transformToByteArray();
    },

    async stream(object) {
      const result = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: object.key
      }) as never) as { Body?: unknown };
      return objectBodyStream(result.Body);
    },

    async delete(object) {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: object.key
      }) as never);
    }
  };
}

export function createVercelBlobObjectStorageBackend(
  input: VercelBlobBackendConfiguration
): PrivateObjectStorageBackend {
  const token = input.token.trim();
  if (!token) throw new Error("Vercel Blob object storage requires a read-write token");
  const operations = input.operations ?? defaultVercelBlobOperations();

  return {
    async stat(object) {
      try {
        const result = await operations.head(object.key, { token });
        return {
          key: object.key,
          size: result.size,
          contentType: result.contentType,
          ...(result.etag ? { etag: result.etag } : {})
        };
      } catch (error) {
        if (error instanceof BlobNotFoundError || isHttpNotFound(error)) return undefined;
        throw error;
      }
    },

    async put(object) {
      await operations.put(object.key, object.bytes, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: object.contentType,
        token
      });
    },

    async promote(object) {
      await operations.copy(object.sourceKey, object.destinationKey, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
        contentType: object.contentType,
        ifMatch: object.expectedSourceEtag,
        token
      });
    },

    async read(object) {
      const result = await operations.get(object.key, {
        access: "private",
        token,
        useCache: false
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new Error("Private Blob object not found");
      }
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },

    async stream(object) {
      const result = await operations.get(object.key, {
        access: "private",
        token,
        useCache: false
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new Error("Private Blob object not found");
      }
      return readableStreamBytes(result.stream);
    },

    async delete(object) {
      await operations.del(object.key, { token });
    }
  };
}

export function createConfiguredArchiveObjectStorage(input: {
  environment?: ObjectStorageEnvironment;
  factories?: ObjectStorageFactories;
} = {}) {
  const environment = input.environment ?? process.env;
  const factories = input.factories ?? {
    s3: createS3ObjectStorageBackend,
    vercelBlob: createVercelBlobObjectStorageBackend
  };
  const backendName = environment.KINRESOLVE_OBJECT_STORAGE_BACKEND?.trim().toLowerCase();

  if (backendName === "s3") {
    const bucket = environment.S3_BUCKET?.trim();
    if (!bucket) throw new Error("S3 object storage is configured without S3_BUCKET");
    return createArchiveObjectStorage({
      backend: factories.s3({
        bucket,
        endpoint: environment.S3_ENDPOINT,
        region: environment.S3_REGION,
        accessKeyId: environment.S3_ACCESS_KEY_ID ?? environment.MINIO_ROOT_USER,
        secretAccessKey: environment.S3_SECRET_ACCESS_KEY ?? environment.MINIO_ROOT_PASSWORD
      })
    });
  }

  if (backendName === "vercel-blob") {
    const token = environment.BLOB_READ_WRITE_TOKEN?.trim();
    if (!token) throw new Error("Vercel Blob object storage is configured without BLOB_READ_WRITE_TOKEN");
    return createArchiveObjectStorage({ backend: factories.vercelBlob({ token }) });
  }

  throw new Error("Private object storage is not configured; choose s3 or vercel-blob");
}

function defaultVercelBlobOperations(): VercelBlobOperations {
  return {
    head: (pathname, options) => blobHead(pathname, options),
    put: (pathname, bytes, options) => blobPut(pathname, Buffer.from(bytes), options),
    copy: (sourcePathname, destinationPathname, options) =>
      blobCopy(sourcePathname, destinationPathname, options),
    get: (pathname, options) => blobGet(pathname, options),
    del: (pathname, options) => blobDelete(pathname, options)
  };
}

function isS3NotFound(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const metadata = isRecord(error.$metadata) ? error.$metadata : undefined;
  return error.name === "NotFound"
    || error.name === "NoSuchKey"
    || metadata?.httpStatusCode === 404;
}

function isHttpNotFound(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const metadata = isRecord(error.$metadata) ? error.$metadata : undefined;
  return error.status === 404 || error.statusCode === 404 || metadata?.httpStatusCode === 404;
}

function objectBodyStream(body: unknown): AsyncIterable<Uint8Array> {
  if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body)) {
    throw new Error("Private S3 object response did not include a streaming body");
  }
  return body as AsyncIterable<Uint8Array>;
}

async function* readableStreamBytes(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      if (result.value.byteLength > 0) yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertArchiveKey(archiveId: string, key: string): void {
  validateArchiveId(archiveId);
  const prefix = archivePrefix(archiveId);
  if (
    !key.startsWith(prefix)
    || key.includes("\\")
    || key.includes("\0")
    || key.slice(prefix.length).split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Object key is outside the authenticated archive scope");
  }
}

function archivePrefix(archiveId: string): string {
  return `archives/${archiveId}/`;
}

function validateArchiveId(archiveId: string): void {
  if (!archiveIdPattern.test(archiveId)) {
    throw new Error("Invalid archive namespace");
  }
}

function validatePurpose(purpose: string): void {
  if (!purposePattern.test(purpose)) {
    throw new Error("Invalid object-storage purpose");
  }
}

function validateFileName(fileName: string): void {
  if (!fileName.trim() || fileName.includes("\0")) {
    throw new Error("Invalid object-storage filename");
  }
}

function validateContentType(contentType: string): void {
  if (!contentType.trim() || /[\r\n\0]/.test(contentType)) {
    throw new Error("Invalid object-storage content type");
  }
}

function validateSha256(sha256: string): void {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("Invalid object-storage SHA-256 identity");
  }
}
