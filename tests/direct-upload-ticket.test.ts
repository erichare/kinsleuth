import { describe, expect, it, vi } from "vitest";

import {
  createConfiguredDirectUploadTicketIssuer,
  createS3DirectUploadTicketIssuer,
  createVercelBlobDirectUploadTicketIssuer
} from "@/lib/storage/direct-upload-ticket";

const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
const ticket = {
  key: "archives/archive-synthetic/integration-upload-staging/random.ged",
  contentType: "text/plain",
  size: 4096,
  expiresAt
};

describe("private direct-upload tickets", () => {
  it("issues an exact S3/MinIO presigned POST policy with provider-enforced metadata and size", async () => {
    const presignPost = vi.fn(async () => ({
      url: "https://minio.example/kinresolve-private",
      fields: {
        key: ticket.key,
        "Content-Type": ticket.contentType,
        "Cache-Control": "private, no-store",
        policy: "synthetic-policy",
        "x-amz-signature": "synthetic-signature"
      }
    }));
    const issuer = createS3DirectUploadTicketIssuer({
      bucket: "kinresolve-private",
      presignPost
    });

    await expect(issuer.issue(ticket)).resolves.toEqual({
      strategy: "presigned_post",
      method: "POST",
      url: "https://minio.example/kinresolve-private",
      fields: {
        key: ticket.key,
        "Content-Type": "text/plain",
        "Cache-Control": "private, no-store",
        policy: "synthetic-policy",
        "x-amz-signature": "synthetic-signature"
      },
      expiresAt: expiresAt.toISOString()
    });
    expect(presignPost).toHaveBeenCalledWith(expect.objectContaining({
      ...ticket,
      bucket: "kinresolve-private",
      expiresInSeconds: expect.any(Number),
      fields: {
        key: ticket.key,
        "Content-Type": ticket.contentType,
        "Cache-Control": "private, no-store"
      },
      conditions: expect.arrayContaining([
        ["eq", "$key", ticket.key],
        ["eq", "$Content-Type", ticket.contentType],
        ["eq", "$Cache-Control", "private, no-store"],
        ["content-length-range", ticket.size, ticket.size]
      ])
    }));
  });

  it("rejects S3 tickets above the private direct-upload application ceiling", async () => {
    const issuer = createS3DirectUploadTicketIssuer({
      bucket: "kinresolve-private",
      presignPost: vi.fn()
    });

    await expect(issuer.issue({ ...ticket, size: 128 * 1024 * 1024 + 1 }))
      .rejects.toThrow(/size.*limit/i);
  });

  it("uses the installed Vercel Blob SDK client-token API for private multipart uploads", async () => {
    const generateClientToken = vi.fn(async () => "vercel_blob_client_synthetic");
    const issuer = createVercelBlobDirectUploadTicketIssuer({
      token: "vercel-read-write-token",
      generateClientToken
    });

    await expect(issuer.issue(ticket)).resolves.toEqual({
      strategy: "vercel_blob_client",
      pathname: ticket.key,
      clientToken: "vercel_blob_client_synthetic",
      access: "private",
      contentType: "text/plain",
      multipart: true,
      expiresAt: expiresAt.toISOString()
    });
    expect(generateClientToken).toHaveBeenCalledWith({
      pathname: ticket.key,
      token: "vercel-read-write-token",
      maximumSizeInBytes: ticket.size,
      allowedContentTypes: [ticket.contentType],
      validUntil: expiresAt.getTime(),
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60
    });
  });

  it("selects only the configured private backend and fails closed otherwise", () => {
    const s3 = vi.fn(() => createS3DirectUploadTicketIssuer({
      bucket: "kinresolve-private",
      presignPost: async () => ({ url: "https://example.test", fields: {} })
    }));
    const vercelBlob = vi.fn(() => createVercelBlobDirectUploadTicketIssuer({
      token: "vercel-read-write-token",
      generateClientToken: async () => "token"
    }));

    expect(createConfiguredDirectUploadTicketIssuer({
      environment: {
        KINRESOLVE_OBJECT_STORAGE_BACKEND: "s3",
        S3_BUCKET: "kinresolve-private",
        S3_ENDPOINT: "http://minio:9000",
        S3_PUBLIC_ENDPOINT: "http://localhost:9000",
        MINIO_ROOT_USER: "synthetic-minio-user",
        MINIO_ROOT_PASSWORD: "synthetic-minio-password"
      },
      factories: { s3, vercelBlob }
    }).backend).toBe("s3");
    expect(s3).toHaveBeenCalledWith(expect.objectContaining({
      bucket: "kinresolve-private",
      endpoint: "http://localhost:9000",
      accessKeyId: "synthetic-minio-user",
      secretAccessKey: "synthetic-minio-password"
    }));
    expect(createConfiguredDirectUploadTicketIssuer({
      environment: {
        KINRESOLVE_OBJECT_STORAGE_BACKEND: "vercel-blob",
        BLOB_READ_WRITE_TOKEN: "vercel-read-write-token"
      },
      factories: { s3, vercelBlob }
    }).backend).toBe("vercel_blob");
    expect(() => createConfiguredDirectUploadTicketIssuer({
      environment: {},
      factories: { s3, vercelBlob }
    })).toThrow(/not configured/i);
  });
});
