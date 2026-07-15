#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

try {
  const [workDirectory, outputPath, ...unexpected] = process.argv.slice(2);
  if (!workDirectory || !outputPath || unexpected.length > 0) {
    throw new Error("Usage: assemble-production-backup-evidence.mjs <work-directory> <output.json>.");
  }
  const releaseCommitSha = exact(process.env.RELEASE_COMMIT, /^[a-f0-9]{40}$/, "release commit");
  const runId = exact(process.env.GITHUB_RUN_ID, /^[1-9][0-9]{0,19}$/, "run ID");
  const runAttempt = exact(process.env.GITHUB_RUN_ATTEMPT, /^[1-9][0-9]{0,5}$/, "run attempt");
  const database = await json(path.join(workDirectory, "database-state.json"));
  const objects = await json(path.join(workDirectory, "object-state.json"));
  const databaseUpload = await json(path.join(workDirectory, "database-upload.json"));
  const databaseDownload = await json(path.join(workDirectory, "database-download.json"));
  const objectsUpload = await json(path.join(workDirectory, "objects-upload.json"));
  const objectsDownload = await json(path.join(workDirectory, "objects-download.json"));
  const providerPoint = await json(path.join(workDirectory, "provider-recovery-point.json"));
  const acquired = await json(path.join(workDirectory, "fence-acquire.json"));
  const released = await json(path.join(workDirectory, "fence-release.json"));

  const databaseIdentity = requiredDigest(database.databaseIdentity, "database identity");
  const objectStoreIdentity = requiredDigest(objects.objectStoreIdentity, "object-store identity");
  const objectStoreProviderId = exact(
    objects.providerStoreId,
    /^[a-z0-9][a-z0-9-]{7,63}$/,
    "object-store provider ID"
  );
  const objectNamespaces = exactNamespaceSummaries(objects.objectNamespaces);
  const activatedAt = timestamp(acquired?.fence?.activatedAt, "fence activation");
  const releasedAt = timestamp(released?.fence?.releasedAt, "fence release");
  const activatedTime = new Date(activatedAt).getTime();
  const releasedTime = new Date(releasedAt).getTime();
  if (
    acquired?.fence?.state !== "active"
    || released?.fence?.state !== "released"
    || acquired?.found !== true
    || released?.found !== true
    || acquired.fence.fenceId !== released.fence.fenceId
    || acquired.fence.releaseCommitSha !== releaseCommitSha
    || released.fence.releaseCommitSha !== releaseCommitSha
    || releasedTime <= activatedTime
  ) {
    throw new Error("Backup fence evidence is invalid.");
  }
  const databaseTransfer = matchingTransfer(databaseUpload, databaseDownload, {
    label: "database",
    fileName: "database.dump.age",
    releaseCommitSha,
    runId,
    runAttempt,
    activatedTime,
    releasedTime
  });
  const objectsTransfer = matchingTransfer(objectsUpload, objectsDownload, {
    label: "objects",
    fileName: "objects.tar.age",
    releaseCommitSha,
    runId,
    runAttempt,
    activatedTime,
    releasedTime
  });
  const databasePrefix = databaseTransfer.storage.key.slice(
    0,
    -"database.dump.age".length
  );
  const objectsPrefix = objectsTransfer.storage.key.slice(0, -"objects.tar.age".length);
  if (
    databaseTransfer.storage.bucketDigest !== objectsTransfer.storage.bucketDigest
    || databasePrefix !== objectsPrefix
    || canonicalJson(databaseTransfer.storage.bucketProtection)
      !== canonicalJson(objectsTransfer.storage.bucketProtection)
    || databaseTransfer.storage.objectRetention.validatedMinimumDays
      !== objectsTransfer.storage.objectRetention.validatedMinimumDays
  ) {
    throw new Error("The backup ciphertexts do not share one exact protected offsite bucket and prefix.");
  }
  if (
    database.capturePhase !== "candidate-final"
    || database.candidateSemanticsVerified !== true
    || database.fenceId !== acquired.fence.fenceId
    || database.releaseCommitSha !== releaseCommitSha
    || !digest(database.manifestSha256)
    || !digest(database.demoPurgeProductManifestSha256)
    || database.activeJobLeases !== 0
    || database.unexpiredUploadIntents !== 0
    || database.stragglerTransactions !== 0
    || database.stragglerVisibilityVerified !== true
    || objects.archiveId !== database.archiveId
    || providerPoint?.status !== "available"
    || providerPoint?.provider !== "supabase"
  ) {
    throw new Error("Backup source evidence is incomplete or unsafe.");
  }
  const providerRecoveryPointCreatedAt = timestamp(
    providerPoint.createdAt,
    "provider recovery point"
  );
  if (
    !Array.isArray(database.migrationVersions)
    || database.migrationVersions.length === 0
    || database.migrationVersions.some((value) => (
      typeof value !== "string" || !/^[0-9]{3}_[a-z0-9_]{1,96}$/.test(value)
    ))
    || new Date(providerRecoveryPointCreatedAt).getTime() > Date.now() + 5 * 60_000
    || Date.now() - new Date(providerRecoveryPointCreatedAt).getTime() > 24 * 60 * 60_000
  ) {
    throw new Error("Backup source recovery metadata is invalid or stale.");
  }
  const completedAt = new Date().toISOString();
  const completedTime = new Date(completedAt).getTime();
  const maximumClockSkewMs = 5 * 60_000;
  const maximumBackupAgeMs = 24 * 60 * 60_000;
  const providerPointTime = new Date(providerRecoveryPointCreatedAt).getTime();
  if (
    completedTime < releasedTime
    || releasedTime > completedTime + maximumClockSkewMs
    || providerPointTime > completedTime + maximumClockSkewMs
    || completedTime - providerPointTime > maximumBackupAgeMs
  ) {
    throw new Error("Backup completion timing is invalid or stale.");
  }
  const evidence = {
    schemaVersion: 3,
    kind: "kinresolve-encrypted-offsite-backup",
    releaseCommitSha,
    runId,
    runAttempt,
    archiveDigest: sha256(String(database.archiveId)),
    databaseIdentity,
    databaseManifestSha256: database.manifestSha256,
    databaseProductManifestSha256: database.demoPurgeProductManifestSha256,
    migrationVersions: database.migrationVersions,
    objectStoreIdentity,
    objectStoreProviderDigest: sha256(objectStoreProviderId),
    objectNamespaces,
    providerRecoveryPointCreatedAt,
    ciphertext: {
      database: databaseTransfer,
      objects: objectsTransfer
    },
    fence: {
      fenceId: acquired.fence.fenceId,
      activatedAt,
      releasedAt,
      durationSeconds: Math.ceil((releasedTime - activatedTime) / 1_000)
    },
    completedAt
  };
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log("Assembled privacy-safe encrypted backup evidence.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Backup evidence assembly failed.");
  process.exitCode = 1;
}

async function json(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function matchingTransfer(uploadValue, downloadValue, expected) {
  const upload = exactRecord(
    uploadValue,
    ["operation", "sha256", "size", "storage", "completedAt"],
    `${expected.label} backup upload`
  );
  const download = exactRecord(
    downloadValue,
    ["operation", "sha256", "size", "storage", "completedAt"],
    `${expected.label} backup download`
  );
  if (
    upload.operation !== "upload"
    || download.operation !== "download"
    || !digest(upload.sha256)
    || upload.sha256 !== download.sha256
    || !Number.isSafeInteger(upload.size)
    || upload.size <= 0
    || upload.size !== download.size
  ) {
    throw new Error(`The ${expected.label} backup did not complete an exact offsite round trip.`);
  }
  const uploadedAt = timestamp(upload.completedAt, `${expected.label} backup upload completion`);
  const verifiedDownloadAt = timestamp(
    download.completedAt,
    `${expected.label} backup download completion`
  );
  const uploadedTime = new Date(uploadedAt).getTime();
  const downloadedTime = new Date(verifiedDownloadAt).getTime();
  if (
    uploadedTime < expected.activatedTime
    || downloadedTime < uploadedTime
    || downloadedTime > expected.releasedTime
  ) {
    throw new Error(`The ${expected.label} backup transfer timing is invalid.`);
  }
  const uploadStorage = exactStorageProof(upload.storage, expected, uploadedTime);
  const downloadStorage = exactStorageProof(download.storage, expected, uploadedTime);
  if (canonicalJson(uploadStorage) !== canonicalJson(downloadStorage)) {
    throw new Error(`The ${expected.label} backup round trip did not use one exact retained object version.`);
  }
  return {
    sha256: upload.sha256,
    size: upload.size,
    uploadedAt,
    verifiedDownloadAt,
    storage: uploadStorage
  };
}

function exactStorageProof(value, expected, uploadedTime) {
  const storage = exactRecord(
    value,
    ["bucketDigest", "key", "versionId", "bucketProtection", "objectRetention"],
    `${expected.label} backup storage proof`
  );
  const expectedKey = new RegExp(
    `^production-backup/[0-9]{4}-[0-9]{2}-[0-9]{2}/${expected.releaseCommitSha}/`
    + `${expected.runId}-${expected.runAttempt}/${expected.fileName.replaceAll(".", "\\.")}$`
  );
  if (
    !digest(storage.bucketDigest)
    || typeof storage.key !== "string"
    || !expectedKey.test(storage.key)
    || typeof storage.versionId !== "string"
    || !/^[^\u0000-\u0020\u007f]{1,1024}$/u.test(storage.versionId)
  ) {
    throw new Error(`The ${expected.label} backup storage locator is invalid.`);
  }

  const bucketProtection = exactRecord(
    storage.bucketProtection,
    ["versioning", "objectLock", "defaultRetention"],
    `${expected.label} backup bucket protection`
  );
  const defaultRetention = exactRecord(
    bucketProtection.defaultRetention,
    ["mode", "unit", "value"],
    `${expected.label} backup bucket default retention`
  );
  const validDefaultValue = Number.isSafeInteger(defaultRetention.value)
    && defaultRetention.value > 0;
  if (
    bucketProtection.versioning !== "Enabled"
    || bucketProtection.objectLock !== "Enabled"
    || defaultRetention.mode !== "COMPLIANCE"
    || !["days", "years"].includes(defaultRetention.unit)
    || !validDefaultValue
  ) {
    throw new Error(`The ${expected.label} backup bucket protection is invalid.`);
  }

  const objectRetention = exactRecord(
    storage.objectRetention,
    ["mode", "retainUntil", "validatedMinimumDays"],
    `${expected.label} backup object retention`
  );
  const retainUntil = timestamp(
    objectRetention.retainUntil,
    `${expected.label} backup object retention expiry`
  );
  const minimumDays = objectRetention.validatedMinimumDays;
  const defaultDays = defaultRetention.unit === "days"
    ? defaultRetention.value
    : defaultRetention.value * 365;
  if (
    objectRetention.mode !== "COMPLIANCE"
    || !Number.isSafeInteger(minimumDays)
    || minimumDays < 1
    || minimumDays > 3_650
    || !Number.isSafeInteger(defaultDays)
    || defaultDays < minimumDays
    || new Date(retainUntil).getTime()
      < uploadedTime + minimumDays * 24 * 60 * 60_000 - 5 * 60_000
  ) {
    throw new Error(`The ${expected.label} backup COMPLIANCE retention proof is invalid.`);
  }
  return {
    bucketDigest: storage.bucketDigest,
    key: storage.key,
    versionId: storage.versionId,
    bucketProtection: {
      versioning: "Enabled",
      objectLock: "Enabled",
      defaultRetention: {
        mode: "COMPLIANCE",
        unit: defaultRetention.unit,
        value: defaultRetention.value
      }
    },
    objectRetention: {
      mode: "COMPLIANCE",
      retainUntil,
      validatedMinimumDays: minimumDays
    }
  };
}

function digest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function requiredDigest(value, label) {
  if (!digest(value)) throw new Error(`Backup ${label} is invalid.`);
  return value;
}

function exactNamespaceSummaries(value) {
  const names = ["archive-private", "legacy-gedcom"];
  if (!Array.isArray(value) || value.length !== names.length) {
    throw new Error("Backup object namespace evidence is incomplete.");
  }
  const byName = new Map();
  for (const summary of value) {
    if (
      typeof summary !== "object"
      || summary === null
      || Array.isArray(summary)
      || !names.includes(summary.name)
      || byName.has(summary.name)
      || !Number.isSafeInteger(summary.objectCount)
      || summary.objectCount < 0
      || !Number.isSafeInteger(summary.totalBytes)
      || summary.totalBytes < 0
      || !digest(summary.manifestSha256)
    ) {
      throw new Error("Backup object namespace evidence is invalid.");
    }
    byName.set(summary.name, {
      name: summary.name,
      objectCount: summary.objectCount,
      totalBytes: summary.totalBytes,
      manifestSha256: summary.manifestSha256
    });
  }
  return names.map((name) => byName.get(name));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactRecord(value, keys, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The ${label} must be an object.`);
  }
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`The ${label} fields are invalid.`);
  }
  return value;
}

function exact(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Backup ${label} is invalid.`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`Backup ${label} is invalid.`);
  }
  return new Date(value).toISOString();
}
