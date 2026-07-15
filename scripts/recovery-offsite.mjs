#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

const maximumClockSkewMs = 5 * 60_000;
const maximumRetentionDays = 3_650;
const objectKeyPattern = /^(?:production-recovery\/[a-f0-9]{40}|production-backup\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-f0-9]{40})\/[0-9]+-[0-9]+\/(?:database\.dump|objects\.tar)\.age$/;

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const [operation, key, ...argumentsAfterKey] = argv;
  const upload = operation === "upload";
  const download = operation === "download";
  const [localPath, outputPath, ...uploadUnexpected] = upload ? argumentsAfterKey : [];
  const [versionId, downloadPath, expectedSha256, downloadOutputPath, ...downloadUnexpected] = download
    ? argumentsAfterKey
    : [];
  if (
    (!upload && !download)
    || !key
    || !objectKeyPattern.test(key)
    || (upload && (!localPath || !outputPath || uploadUnexpected.length > 0))
    || (download && (
      !versionId
      || !downloadPath
      || !expectedSha256
      || !downloadOutputPath
      || downloadUnexpected.length > 0
    ))
  ) {
    throw new Error(
      "Usage: recovery-offsite.mjs upload <key> <local-file> <output.json> OR "
      + "download <key> <version-id> <local-file> <expected-sha256> <output.json>."
    );
  }

  const bucket = required(environment, "RECOVERY_BACKUP_S3_BUCKET");
  const region = required(environment, "RECOVERY_BACKUP_S3_REGION");
  const accessKeyId = required(environment, "RECOVERY_BACKUP_S3_ACCESS_KEY_ID");
  const secretAccessKey = required(environment, "RECOVERY_BACKUP_S3_SECRET_ACCESS_KEY");
  const minimumRetentionDays = retentionDays(
    required(environment, "RECOVERY_BACKUP_S3_MIN_RETENTION_DAYS")
  );
  const endpoint = environment.RECOVERY_BACKUP_S3_ENDPOINT?.trim();
  if (endpoint && new URL(endpoint).protocol !== "https:") {
    throw new Error("RECOVERY_BACKUP_S3_ENDPOINT must use HTTPS.");
  }
  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId, secretAccessKey }
  });
  const bucketProtection = await readBucketProtection(client, bucket, minimumRetentionDays);
  const bucketDigest = sha256Utf8(bucket);

  if (upload) {
    const metadata = await stat(localPath);
    if (!metadata.isFile() || metadata.size <= 0) {
      throw new Error("The encrypted recovery backup is missing or empty.");
    }
    const sha256 = await fileSha256(localPath);
    const checksum = Buffer.from(sha256, "hex").toString("base64");
    const response = await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentLength: metadata.size,
      ContentType: "application/octet-stream",
      CacheControl: "private, no-store",
      IfNoneMatch: "*",
      ChecksumSHA256: checksum,
      ServerSideEncryption: "AES256"
    }));
    const uploadedVersionId = exactVersionId(response.VersionId);
    await assertHead(client, bucket, key, uploadedVersionId, metadata.size, checksum);
    const objectRetention = await readObjectRetention(
      client,
      bucket,
      key,
      uploadedVersionId,
      minimumRetentionDays,
      new Date()
    );
    await privateJson(outputPath, {
      operation: "upload",
      sha256,
      size: metadata.size,
      storage: {
        bucketDigest,
        key,
        versionId: uploadedVersionId,
        bucketProtection,
        objectRetention
      },
      completedAt: new Date().toISOString()
    });
    console.log(
      "Uploaded and exact-version-verified an encrypted offsite recovery backup under COMPLIANCE retention."
    );
    return;
  }

  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("The expected offsite backup digest is invalid.");
  }
  const exactVersion = exactVersionId(versionId);
  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    VersionId: exactVersion,
    ChecksumMode: "ENABLED"
  }));
  if (!response.Body?.transformToByteArray) {
    throw new Error("The offsite recovery backup body is unreadable.");
  }
  if (response.VersionId !== exactVersion) {
    throw new Error("The provider returned a different offsite backup version.");
  }
  const bytes = Buffer.from(await response.Body.transformToByteArray());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error("The downloaded offsite recovery backup digest does not match.");
  }
  const checksum = Buffer.from(expectedSha256, "hex").toString("base64");
  if (response.ChecksumSHA256 !== checksum) {
    throw new Error("The provider checksum for the downloaded backup is missing or wrong.");
  }
  if (response.ContentLength !== bytes.length) {
    throw new Error("The downloaded offsite recovery backup size does not match provider metadata.");
  }
  const objectRetention = await readObjectRetention(
    client,
    bucket,
    key,
    exactVersion,
    minimumRetentionDays,
    new Date()
  );
  await writeFile(downloadPath, bytes, { flag: "wx", mode: 0o600 });
  await chmod(downloadPath, 0o600);
  await privateJson(downloadOutputPath, {
    operation: "download",
    sha256: actual,
    size: bytes.length,
    storage: {
      bucketDigest,
      key,
      versionId: exactVersion,
      bucketProtection,
      objectRetention
    },
    completedAt: new Date().toISOString()
  });
  console.log(
    "Downloaded the exact retained version and checksum-verified an encrypted offsite recovery backup."
  );
}

export function validateBucketProtection(versioning, lockConfiguration, minimumRetentionDays) {
  if (versioning?.Status !== "Enabled") {
    throw new Error("The offsite backup bucket must have versioning enabled.");
  }
  const retention = lockConfiguration?.Rule?.DefaultRetention;
  const hasDays = Number.isSafeInteger(retention?.Days) && retention.Days > 0;
  const hasYears = Number.isSafeInteger(retention?.Years) && retention.Years > 0;
  if (
    lockConfiguration?.ObjectLockEnabled !== "Enabled"
    || retention?.Mode !== "COMPLIANCE"
    || hasDays === hasYears
  ) {
    throw new Error(
      "The offsite backup bucket must use Object Lock with one default COMPLIANCE retention period."
    );
  }
  const unit = hasDays ? "days" : "years";
  const value = hasDays ? retention.Days : retention.Years;
  const configuredDays = hasDays ? value : value * 365;
  if (!Number.isSafeInteger(configuredDays) || configuredDays < minimumRetentionDays) {
    throw new Error("The offsite backup bucket default retention is shorter than the protected minimum.");
  }
  return {
    versioning: "Enabled",
    objectLock: "Enabled",
    defaultRetention: { mode: "COMPLIANCE", unit, value }
  };
}

export function validateObjectRetention(value, minimumRetentionDays, now = new Date()) {
  const retention = value?.Retention;
  const retainUntil = retention?.RetainUntilDate instanceof Date
    ? retention.RetainUntilDate
    : new Date(retention?.RetainUntilDate ?? Number.NaN);
  if (
    retention?.Mode !== "COMPLIANCE"
    || Number.isNaN(retainUntil.getTime())
    || retainUntil.getTime()
      < now.getTime() + minimumRetentionDays * 24 * 60 * 60_000 - maximumClockSkewMs
  ) {
    throw new Error("The exact offsite backup version does not have the required COMPLIANCE retention.");
  }
  return {
    mode: "COMPLIANCE",
    retainUntil: retainUntil.toISOString(),
    validatedMinimumDays: minimumRetentionDays
  };
}

async function readBucketProtection(client, bucket, minimumRetentionDays) {
  const [versioning, lockConfiguration] = await Promise.all([
    client.send(new GetBucketVersioningCommand({ Bucket: bucket })),
    client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }))
  ]);
  return validateBucketProtection(versioning, lockConfiguration, minimumRetentionDays);
}

async function readObjectRetention(client, bucket, key, versionId, minimumRetentionDays, now) {
  const retention = await client.send(new GetObjectRetentionCommand({
    Bucket: bucket,
    Key: key,
    VersionId: versionId
  }));
  return validateObjectRetention(retention, minimumRetentionDays, now);
}

async function assertHead(client, bucket, key, versionId, size, checksum) {
  const head = await client.send(new HeadObjectCommand({
    Bucket: bucket,
    Key: key,
    VersionId: versionId,
    ChecksumMode: "ENABLED"
  }));
  if (
    head.VersionId !== versionId
    || head.ContentLength !== size
    || head.ChecksumSHA256 !== checksum
    || head.ServerSideEncryption !== "AES256"
  ) {
    throw new Error(
      "The provider did not attest the exact uploaded version, size, encryption, and SHA-256 checksum."
    );
  }
}

async function fileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function privateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(filePath, 0o600);
}

function exactVersionId(value) {
  if (typeof value !== "string" || !/^[^\u0000-\u0020\u007f]{1,1024}$/u.test(value)) {
    throw new Error("The offsite backup provider version ID is missing or invalid.");
  }
  return value;
}

function retentionDays(value) {
  if (!/^[1-9][0-9]{0,3}$/.test(value)) {
    throw new Error("RECOVERY_BACKUP_S3_MIN_RETENTION_DAYS is invalid.");
  }
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days > maximumRetentionDays) {
    throw new Error("RECOVERY_BACKUP_S3_MIN_RETENTION_DAYS is invalid.");
  }
  return days;
}

function sha256Utf8(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Offsite recovery backup operation failed."
    );
    process.exitCode = 1;
  }
}
