import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

export type DirectUploadBackend = "s3" | "vercel_blob";
export const maximumPrivateDirectUploadBytes = 128 * 1024 * 1024;

export type DirectUploadTicketInput = {
  key: string;
  contentType: string;
  size: number;
  expiresAt: Date;
};

export type DirectUploadInstructions =
  | {
      strategy: "presigned_post";
      method: "POST";
      url: string;
      fields: Record<string, string>;
      expiresAt: string;
    }
  | {
      strategy: "vercel_blob_client";
      pathname: string;
      clientToken: string;
      access: "private";
      contentType: string;
      multipart: true;
      expiresAt: string;
    };

export type DirectUploadTicketIssuer = {
  backend: DirectUploadBackend;
  issue(input: DirectUploadTicketInput): Promise<DirectUploadInstructions>;
};

type Environment = Record<string, string | undefined>;

type TicketFactories = {
  s3(input: S3DirectUploadTicketIssuerConfiguration): DirectUploadTicketIssuer;
  vercelBlob(input: VercelBlobDirectUploadTicketIssuerConfiguration): DirectUploadTicketIssuer;
};

export type S3DirectUploadTicketIssuerConfiguration = {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  client?: S3Client;
  presignPost?: (input: S3PresignedPostPolicyInput) => Promise<{
    url: string;
    fields: Record<string, string>;
  }>;
};

type S3PresignedPostCondition =
  | ["eq", string, string]
  | ["content-length-range", number, number];

type S3PresignedPostPolicyInput = DirectUploadTicketInput & {
  bucket: string;
  expiresInSeconds: number;
  fields: Record<string, string>;
  conditions: S3PresignedPostCondition[];
};

export type VercelBlobDirectUploadTicketIssuerConfiguration = {
  token: string;
  generateClientToken?: typeof generateClientTokenFromReadWriteToken;
};

export function createS3DirectUploadTicketIssuer(
  input: S3DirectUploadTicketIssuerConfiguration
): DirectUploadTicketIssuer {
  const bucket = input.bucket.trim();
  if (!bucket || /[\r\n\0]/.test(bucket)) {
    throw new Error("S3 direct uploads require a valid private bucket");
  }
  if ((input.accessKeyId && !input.secretAccessKey) || (!input.accessKeyId && input.secretAccessKey)) {
    throw new Error("S3 direct upload credentials must include both access key fields");
  }
  const client = input.client ?? new S3Client({
    region: input.region?.trim() || "us-east-1",
    endpoint: input.endpoint?.trim() || undefined,
    forcePathStyle: Boolean(input.endpoint?.trim()),
    credentials: input.accessKeyId && input.secretAccessKey
      ? { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey }
      : undefined
  });
  const presignPost = input.presignPost ?? (async (policy: S3PresignedPostPolicyInput) =>
    createPresignedPost(client, {
      Bucket: policy.bucket,
      Key: policy.key,
      Fields: policy.fields,
      Conditions: policy.conditions,
      Expires: policy.expiresInSeconds
    }));

  return {
    backend: "s3",
    async issue(ticket) {
      if (
        !Number.isSafeInteger(ticket.size)
        || ticket.size < 1
        || ticket.size > maximumPrivateDirectUploadBytes
      ) {
        throw new Error("S3 direct upload size is outside the application limit");
      }
      const expiresInSeconds = expirySeconds(ticket.expiresAt);
      const fields = {
        key: ticket.key,
        "Content-Type": ticket.contentType,
        "Cache-Control": "private, no-store"
      };
      const signed = await presignPost({
        ...ticket,
        bucket,
        expiresInSeconds,
        fields,
        conditions: [
          ["eq", "$key", ticket.key],
          ["eq", "$Content-Type", ticket.contentType],
          ["eq", "$Cache-Control", "private, no-store"],
          ["content-length-range", ticket.size, ticket.size]
        ]
      });
      if (!signed.url || !hasExactFields(signed.fields, fields)) {
        throw new Error("S3 direct upload signer returned an invalid POST contract");
      }
      return {
        strategy: "presigned_post",
        method: "POST",
        url: signed.url,
        fields: signed.fields,
        expiresAt: ticket.expiresAt.toISOString()
      };
    }
  };
}

export function createVercelBlobDirectUploadTicketIssuer(
  input: VercelBlobDirectUploadTicketIssuerConfiguration
): DirectUploadTicketIssuer {
  const token = input.token.trim();
  if (!token) throw new Error("Vercel Blob direct uploads require a read-write token");
  const generateClientToken = input.generateClientToken ?? generateClientTokenFromReadWriteToken;

  return {
    backend: "vercel_blob",
    async issue(ticket) {
      const clientToken = await generateClientToken({
        pathname: ticket.key,
        token,
        maximumSizeInBytes: ticket.size,
        allowedContentTypes: [ticket.contentType],
        validUntil: ticket.expiresAt.getTime(),
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60
      });
      return {
        strategy: "vercel_blob_client",
        pathname: ticket.key,
        clientToken,
        access: "private",
        contentType: ticket.contentType,
        multipart: true,
        expiresAt: ticket.expiresAt.toISOString()
      };
    }
  };
}

export function createConfiguredDirectUploadTicketIssuer(input: {
  environment?: Environment;
  factories?: TicketFactories;
} = {}): DirectUploadTicketIssuer {
  const environment = input.environment ?? process.env;
  const factories = input.factories ?? {
    s3: createS3DirectUploadTicketIssuer,
    vercelBlob: createVercelBlobDirectUploadTicketIssuer
  };
  const backend = environment.KINRESOLVE_OBJECT_STORAGE_BACKEND?.trim().toLowerCase();

  if (backend === "s3") {
    const bucket = environment.S3_BUCKET?.trim();
    if (!bucket) throw new Error("S3 direct uploads are configured without S3_BUCKET");
    return factories.s3({
      bucket,
      // Browser upload tickets must be signed for the browser-reachable
      // endpoint. Server reads continue to use S3_ENDPOINT in object-storage.
      endpoint: environment.S3_PUBLIC_ENDPOINT?.trim() || environment.S3_ENDPOINT,
      region: environment.S3_REGION,
      accessKeyId: environment.S3_ACCESS_KEY_ID ?? environment.MINIO_ROOT_USER,
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY ?? environment.MINIO_ROOT_PASSWORD
    });
  }
  if (backend === "vercel-blob") {
    const token = environment.BLOB_READ_WRITE_TOKEN?.trim();
    if (!token) throw new Error("Vercel Blob direct uploads are configured without BLOB_READ_WRITE_TOKEN");
    return factories.vercelBlob({ token });
  }
  throw new Error("Private direct-upload storage is not configured; choose s3 or vercel-blob");
}

function expirySeconds(expiresAt: Date): number {
  const seconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 1) throw new Error("Direct upload ticket expiry must be in the future");
  return Math.min(seconds, 900);
}

function hasExactFields(
  actual: Record<string, string>,
  required: Record<string, string>
): boolean {
  return Object.entries(required).every(([key, value]) => actual[key] === value);
}
