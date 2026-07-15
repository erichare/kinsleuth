#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  combineRecoveryStateDigest,
  recoveryObjectNamespaceNames
} from "../lib/recovery-evidence-operations.ts";
import {
  migrationLedgerSha256,
  migrationPolicyPrefixSha256,
  validateReleaseReadinessEvidence
} from "../lib/release-readiness.ts";
import { loadReleasePolicy } from "../lib/release-policy.ts";

try {
  const [workDirectory, outputPath, ...unexpected] = process.argv.slice(2);
  if (!workDirectory || !outputPath || unexpected.length > 0) {
    throw new Error("Usage: assemble-recovery-evidence.mjs <work-directory> <recovery-evidence.json>.");
  }
  const repository = required("GITHUB_REPOSITORY");
  const githubRunId = pattern(required("GITHUB_RUN_ID"), /^[1-9][0-9]{0,19}$/, "GitHub run ID");
  const githubRunAttempt = pattern(
    required("GITHUB_RUN_ATTEMPT"),
    /^[1-9][0-9]{0,19}$/,
    "GitHub run attempt"
  );
  const releaseCommit = required("RELEASE_COMMIT");
  const releaseVersion = required("RELEASE_VERSION");
  const archiveId = required("EXPECTED_ARCHIVE_ID");
  const sourceDatabaseIdentity = required("KINRESOLVE_DATABASE_IDENTITY");
  const sourceObjectIdentity = required("KINRESOLVE_OBJECT_STORAGE_IDENTITY");
  const sourceObjectProviderId = required("KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID");
  const targetDatabaseIdentity = required("RECOVERY_TARGET_DATABASE_IDENTITY");
  const targetObjectIdentity = required("RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY");
  const targetObjectProviderId = required("RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID");
  const sourceDatabaseProviderId = projectRef(required("SUPABASE_PROJECT_REF"));
  const targetDatabaseProviderId = projectRef(required("RECOVERY_TARGET_SUPABASE_PROJECT_REF"));
  if (
    sourceDatabaseIdentity === targetDatabaseIdentity
    || sourceObjectIdentity === targetObjectIdentity
    || sourceObjectProviderId === targetObjectProviderId
    || sourceDatabaseProviderId === targetDatabaseProviderId
  ) {
    throw new Error("Recovery targets must be distinct from both production identities.");
  }
  const policy = await loadReleasePolicy({ repositoryRoot: process.cwd() });
  const migrationVersions = policy.migrations.map((migration) => migration.file.replace(/\.sql$/, ""));
  const migrationChecksums = Object.fromEntries(
    policy.migrations.map((migration) => [migration.file, migration.sha256])
  );

  const [
    fenceAcquire, fenceAssert, cronEndpoints,
    sourceBeforeDatabase, sourceAfterDatabase,
    sourceBeforeObjects, sourceAfterObjects,
    providerPoint, databaseUpload, databaseDownload, objectsUpload, objectsDownload,
    rawRestoreDatabase, postMigrationDatabase, restoredObjects, health,
    runtimeDatabase, targetObjectCleanup, targetDatabaseDestruction
  ] = await Promise.all([
    json(workDirectory, "fence-acquire.json"),
    json(workDirectory, "fence-assert.json"),
    json(workDirectory, "cron-endpoints.json"),
    json(workDirectory, "source-before-database.json"),
    json(workDirectory, "source-after-database.json"),
    json(workDirectory, "source-before-objects.json"),
    json(workDirectory, "source-after-objects.json"),
    json(workDirectory, "provider-recovery-point.json"),
    json(workDirectory, "database-upload.json"),
    json(workDirectory, "database-download.json"),
    json(workDirectory, "objects-upload.json"),
    json(workDirectory, "objects-download.json"),
    json(workDirectory, "raw-restore-database.json"),
    json(workDirectory, "post-migration-database.json"),
    json(workDirectory, "restored-objects.json"),
    json(workDirectory, "restore-health.json"),
    json(workDirectory, "runtime-database-attestation.json"),
    json(workDirectory, "target-object-cleanup-proof.json"),
    json(workDirectory, "target-database-destruction.json")
  ]);
  const drainedAt = await timeFile(workDirectory, "drained-at.txt");
  const restoreStartedAt = await timeFile(workDirectory, "restore-started-at.txt");
  const preMigrationRestoredAt = await timeFile(workDirectory, "pre-migration-restored-at.txt");
  const migrationStartedAt = await timeFile(workDirectory, "migration-started-at.txt");
  const migrationCompletedAt = await timeFile(workDirectory, "migration-completed-at.txt");
  const restoreCompletedAt = await timeFile(workDirectory, "restore-completed-at.txt");

  const sourcePrefix = databaseCapture(
    sourceBeforeDatabase,
    sourceDatabaseIdentity,
    archiveId,
    fenceAcquire,
    "source-prefix",
    migrationVersions
  );
  databaseCapture(
    sourceAfterDatabase,
    sourceDatabaseIdentity,
    archiveId,
    fenceAcquire,
    "source-prefix",
    migrationVersions,
    sourcePrefix
  );
  databaseCapture(
    rawRestoreDatabase,
    targetDatabaseIdentity,
    archiveId,
    fenceAcquire,
    "restored-prefix",
    migrationVersions,
    sourcePrefix
  );
  databaseCapture(
    postMigrationDatabase,
    targetDatabaseIdentity,
    archiveId,
    fenceAcquire,
    "candidate-final",
    migrationVersions,
    migrationVersions
  );
  objectCapture(sourceBeforeObjects, sourceObjectIdentity, sourceObjectProviderId, archiveId);
  objectCapture(sourceAfterObjects, sourceObjectIdentity, sourceObjectProviderId, archiveId);
  objectCapture(restoredObjects, targetObjectIdentity, targetObjectProviderId, archiveId);
  runtimeDatabaseAttestation(runtimeDatabase, targetDatabaseIdentity, targetDatabaseProviderId);
  if (
    sourceAfterDatabase.activeJobLeases !== 0
    || sourceAfterDatabase.unexpiredUploadIntents !== 0
    || sourceAfterDatabase.stragglerTransactions !== 0
    || sourceAfterDatabase.stragglerVisibilityVerified !== true
  ) {
    throw new Error("The post-drain production database still has active work or a straggler transaction.");
  }
  if (
    rawRestoreDatabase.manifestSha256 !== sourceAfterDatabase.manifestSha256
  ) {
    throw new Error("The pre-migration recovery database does not exactly match the production backup.");
  }
  if (!sameNamespaces(sourceBeforeObjects.objectNamespaces, sourceAfterObjects.objectNamespaces)) {
    throw new Error("Production object namespace state changed during the write drain.");
  }
  if (!sameNamespaces(sourceAfterObjects.objectNamespaces, restoredObjects.objectNamespaces)) {
    throw new Error("The restored object namespaces do not exactly match production.");
  }

  fence(fenceAcquire, ["acquired", "already-active"], releaseCommit);
  fence(fenceAssert, ["asserted"], releaseCommit);
  if (
    fenceAssert.fenceId !== fenceAcquire.fenceId
    || fenceAssert.activatedAt !== fenceAcquire.activatedAt
    || fenceAssert.activationGeneration !== fenceAcquire.activationGeneration
  ) {
    throw new Error("The final fence assertion does not match the exact acquired activation.");
  }
  if (!Array.isArray(cronEndpoints) || cronEndpoints.length !== 2) {
    throw new Error("Both cron fence probes are required.");
  }
  for (const endpoint of cronEndpoints) {
    if (endpoint.fenceId !== fenceAcquire.fenceId || endpoint.status !== 423) {
      throw new Error("A cron fence probe does not match the acquired fence.");
    }
  }

  provider(providerPoint);
  const databaseUploadStorage = offsite(databaseUpload, "upload", {
    releaseCommit,
    githubRunId,
    githubRunAttempt,
    fileName: "database.dump.age"
  });
  const databaseDownloadStorage = offsite(databaseDownload, "download", {
    releaseCommit,
    githubRunId,
    githubRunAttempt,
    fileName: "database.dump.age"
  });
  const objectsUploadStorage = offsite(objectsUpload, "upload", {
    releaseCommit,
    githubRunId,
    githubRunAttempt,
    fileName: "objects.tar.age"
  });
  const objectsDownloadStorage = offsite(objectsDownload, "download", {
    releaseCommit,
    githubRunId,
    githubRunAttempt,
    fileName: "objects.tar.age"
  });
  if (
    databaseDownload.sha256 !== databaseUpload.sha256
    || databaseDownload.size !== databaseUpload.size
    || objectsDownload.sha256 !== objectsUpload.sha256
    || objectsDownload.size !== objectsUpload.size
    || JSON.stringify(databaseDownloadStorage) !== JSON.stringify(databaseUploadStorage)
    || JSON.stringify(objectsDownloadStorage) !== JSON.stringify(objectsUploadStorage)
    || databaseUploadStorage.bucketDigest !== objectsUploadStorage.bucketDigest
  ) {
    throw new Error(
      "An offsite recovery download does not match its exact uploaded ciphertext version."
    );
  }
  const healthCheckedAt = exactTimestamp(health.checkedAt, "restored health checkedAt");
  if (
    health.status !== "pass"
    || JSON.stringify(Object.keys(health).sort()) !== JSON.stringify(["checkedAt", "status"])
    || healthCheckedAt < migrationCompletedAt
    || healthCheckedAt > restoreCompletedAt
  ) {
    throw new Error("The restored candidate application health proof is invalid.");
  }
  const restoredObjectCount = restoredObjects.objectNamespaces.reduce(
    (total, namespace) => total + namespace.objectCount,
    0
  );
  const objectDataRemovedAt = objectCleanupProof(
    targetObjectCleanup,
    targetObjectIdentity,
    targetObjectProviderId,
    archiveId,
    restoredObjectCount
  );
  const databaseDestroyedAt = databaseDestructionProof(
    targetDatabaseDestruction,
    sourceDatabaseProviderId,
    targetDatabaseProviderId
  );

  const stateDigestBefore = combineRecoveryStateDigest({
    databaseManifestSha256: sourceBeforeDatabase.manifestSha256,
    objectNamespaces: sourceBeforeObjects.objectNamespaces
  });
  const stateDigestAfter = combineRecoveryStateDigest({
    databaseManifestSha256: sourceAfterDatabase.manifestSha256,
    objectNamespaces: sourceAfterObjects.objectNamespaces
  });
  if (stateDigestBefore !== stateDigestAfter) {
    throw new Error("Production database or object state changed while the fence drained.");
  }

  const backupCompletedAt = latestTime(databaseUpload.completedAt, objectsUpload.completedAt);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 23 * 60 * 60_000);
  const restoreDurationSeconds = Math.floor((restoreCompletedAt.getTime() - restoreStartedAt.getTime()) / 1_000);
  const migrationDurationSeconds = Math.floor(
    (migrationCompletedAt.getTime() - migrationStartedAt.getTime()) / 1_000
  );
  const sourceLedgerSha256 = migrationLedgerSha256(sourcePrefix);
  const sourcePolicySha256 = migrationPolicyPrefixSha256(sourcePrefix, migrationChecksums);
  const fenceMigrationVersion = "013_release_write_fence";
  const fenceMigrationSha256 = migrationChecksums[`${fenceMigrationVersion}.sql`];
  const appliedMigrationVersions = migrationVersions.slice(sourcePrefix.length);
  if (
    objectDataRemovedAt < restoreCompletedAt
    || databaseDestroyedAt <= objectDataRemovedAt
    || databaseDestroyedAt > issuedAt
  ) {
    throw new Error("Recovery target cleanup proof timing is invalid.");
  }
  const evidence = {
    schemaVersion: 2,
    kind: "kinresolve.release-recovery",
    repository,
    release: { commitSha: releaseCommit, version: releaseVersion },
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sourceCell: {
      environment: "production",
      databaseIdentity: sourceDatabaseIdentity,
      databaseProviderId: sourceDatabaseProviderId,
      archiveId,
      objectStoreIdentity: sourceObjectIdentity,
      providerStoreId: sourceObjectProviderId,
      migrationPolicyPrefix: {
        migrationCount: sourcePrefix.length,
        versions: sourcePrefix,
        ledgerSha256: sourceLedgerSha256,
        policySha256: sourcePolicySha256,
        fenceMigrationVersion,
        fenceMigrationSha256
      }
    },
    fence: {
      id: fenceAcquire.fenceId,
      releaseCommitSha: releaseCommit,
      activatedAt: fenceAcquire.activatedAt,
      drainedAt: drainedAt.toISOString(),
      minimumDrainSeconds: 1_860,
      cronEndpoints,
      activeJobLeases: sourceAfterDatabase.activeJobLeases,
      unexpiredUploadIntents: sourceAfterDatabase.unexpiredUploadIntents,
      stragglerTransactions: sourceAfterDatabase.stragglerTransactions,
      stragglerVisibilityVerified: sourceAfterDatabase.stragglerVisibilityVerified,
      stateDigestBefore,
      stateDigestAfter
    },
    backup: {
      completedAt: backupCompletedAt.toISOString(),
      providerRecoveryPointStatus: providerPoint.status,
      databaseManifestSha256: sourceAfterDatabase.manifestSha256,
      databaseCiphertextSha256: databaseUpload.sha256,
      objectCiphertextSha256: objectsUpload.sha256,
      objectNamespaces: sourceAfterObjects.objectNamespaces
    },
    restore: {
      startedAt: restoreStartedAt.toISOString(),
      preMigrationRestoredAt: preMigrationRestoredAt.toISOString(),
      migrationStartedAt: migrationStartedAt.toISOString(),
      migrationCompletedAt: migrationCompletedAt.toISOString(),
      completedAt: restoreCompletedAt.toISOString(),
      durationSeconds: restoreDurationSeconds,
      migrationDurationSeconds,
      targetDatabaseIdentity,
      targetDatabaseProviderId,
      targetObjectStoreIdentity: targetObjectIdentity,
      targetProviderStoreId: targetObjectProviderId,
      preMigrationDatabaseManifestSha256: rawRestoreDatabase.manifestSha256,
      preMigrationLedgerSha256: sourceLedgerSha256,
      postMigrationDatabaseManifestSha256: postMigrationDatabase.manifestSha256,
      postMigrationLedgerSha256: migrationLedgerSha256(migrationVersions),
      appliedMigrationVersions,
      runtimeDatabase,
      objectNamespaces: restoredObjects.objectNamespaces,
      checks: [
        "app-health-ok",
        "candidate-database-semantics-verified",
        "candidate-ledger-exact",
        "database-pre-migration-restore-exact",
        "object-manifests-exact",
        "remaining-candidate-migrations-applied",
        "runtime-database-credential-distinct",
        "runtime-database-bounded-privilege",
        "runtime-database-target-observed",
        "target-database-destroyed",
        "target-object-data-removed"
      ]
    },
    cleanup: {
      targetObjectDataRemoved: true,
      targetObjectDataRemovedAt: objectDataRemovedAt.toISOString(),
      targetObjectCountRemoved: targetObjectCleanup.removedObjectCount,
      targetDatabaseDestroyed: true,
      targetDatabaseDestroyedAt: databaseDestroyedAt.toISOString(),
      sourceDatabaseRetained: true
    },
    result: "pass"
  };
  validateReleaseReadinessEvidence(evidence, {
    repository,
    releaseCommit,
    releaseVersion,
    databaseIdentity: sourceDatabaseIdentity,
    objectStorageIdentity: sourceObjectIdentity,
    targetDatabaseIdentity,
    targetObjectStorageIdentity: targetObjectIdentity,
    objectStorageProviderId: sourceObjectProviderId,
    targetObjectStorageProviderId: targetObjectProviderId,
    databaseProviderId: sourceDatabaseProviderId,
    targetDatabaseProviderId,
    archiveId,
    migrationVersions,
    migrationChecksums,
    now: issuedAt
  });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log("Assembled and strictly validated release-bound recovery evidence; the fence remains active.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery evidence assembly failed.");
  process.exitCode = 1;
}

function databaseCapture(
  value,
  identity,
  archiveId,
  expectedFence,
  expectedPhase,
  policyVersions,
  exactVersions
) {
  exactKeys(value, [
    "activeJobLeases", "archiveId", "candidateSemanticsVerified", "capturePhase",
    "databaseIdentity", "demoPurgeProductManifestSha256", "fenceActivatedAt", "fenceId",
    "manifestSha256", "migrationVersions", "releaseCommitSha",
    "stragglerTransactions", "stragglerVisibilityVerified", "unexpiredUploadIntents"
  ], "database capture");
  if (
    value.capturePhase !== expectedPhase
    || value.databaseIdentity !== identity
    || value.archiveId !== archiveId
    || value.fenceId !== expectedFence.fenceId
    || value.releaseCommitSha !== expectedFence.releaseCommitSha
    || value.fenceActivatedAt !== expectedFence.activatedAt
    || !/^[a-f0-9]{64}$/.test(value.manifestSha256)
    || !/^[a-f0-9]{64}$/.test(value.demoPurgeProductManifestSha256)
    || !Array.isArray(value.migrationVersions)
    || typeof value.stragglerVisibilityVerified !== "boolean"
    || ![value.activeJobLeases, value.unexpiredUploadIntents, value.stragglerTransactions]
      .every((count) => Number.isSafeInteger(count) && count >= 0)
  ) throw new Error("A recovery database capture does not match its expected cell and ledger.");
  if (
    value.migrationVersions.length > policyVersions.length
    || value.migrationVersions.some((version, index) => version !== policyVersions[index])
    || (exactVersions && JSON.stringify(value.migrationVersions) !== JSON.stringify(exactVersions))
    || !value.migrationVersions.includes("013_release_write_fence")
    || value.candidateSemanticsVerified !== (expectedPhase === "candidate-final")
  ) {
    throw new Error("A recovery database capture is not the required immutable policy prefix or candidate ledger.");
  }
  return [...value.migrationVersions];
}

function objectCapture(value, identity, providerId, archiveId) {
  exactKeys(value, ["archiveId", "objectNamespaces", "objectStoreIdentity", "providerStoreId"], "object capture");
  if (
    value.archiveId !== archiveId
    || value.objectStoreIdentity !== identity
    || value.providerStoreId !== providerId
    || !Array.isArray(value.objectNamespaces)
  ) {
    throw new Error("A recovery object capture does not match its expected cell.");
  }
  const names = value.objectNamespaces.map((namespace) => namespace.name);
  if (JSON.stringify(names) !== JSON.stringify(recoveryObjectNamespaceNames)) {
    throw new Error("A recovery object capture does not contain both exact namespaces.");
  }
}

function runtimeDatabaseAttestation(value, identity, databaseProviderId) {
  exactKeys(value, [
    "schemaVersion", "databaseIdentity", "databaseProviderId", "runtimeRoleIdentitySha256", "credentialsDistinct",
    "sameDatabaseSessionVerified", "superuser", "bypassRls", "createDatabase", "createRole",
    "replication", "privilegedMembership", "ownerMembership", "ownsDatabase",
    "ownsPublicSchema", "ownedPublicRelations", "releaseFenceReadable", "releaseFenceMutable",
    "publicSchemaCreate", "representativeAppWriteRolledBack"
  ], "runtime database attestation");
  if (
    value.schemaVersion !== 1
    || value.databaseIdentity !== identity
    || value.databaseProviderId !== databaseProviderId
    || !/^[a-f0-9]{64}$/.test(value.runtimeRoleIdentitySha256)
    || value.credentialsDistinct !== true
    || value.sameDatabaseSessionVerified !== true
    || value.superuser !== false
    || typeof value.bypassRls !== "boolean"
    || value.createDatabase !== false
    || value.createRole !== false
    || value.replication !== false
    || value.privilegedMembership !== false
    || value.ownerMembership !== false
    || value.ownsDatabase !== false
    || value.ownsPublicSchema !== false
    || value.ownedPublicRelations !== 0
    || value.releaseFenceReadable !== true
    || value.releaseFenceMutable !== false
    || value.publicSchemaCreate !== false
    || value.representativeAppWriteRolledBack !== true
  ) {
    throw new Error("The recovery runtime database attestation is not bounded to the target runtime contract.");
  }
}

function objectCleanupProof(value, identity, providerId, archiveId, restoredObjectCount) {
  exactKeys(value, [
    "schemaVersion", "archiveId", "objectStoreIdentity", "providerStoreId",
    "expectedObjectCount", "removedObjectCount", "completeSetObserved",
    "targetObjectDataRemoved", "verifiedAt"
  ], "target object cleanup proof");
  if (
    value.schemaVersion !== 1
    || value.archiveId !== archiveId
    || value.objectStoreIdentity !== identity
    || value.providerStoreId !== providerId
    || value.expectedObjectCount !== restoredObjectCount
    || value.removedObjectCount !== restoredObjectCount
    || value.completeSetObserved !== true
    || value.targetObjectDataRemoved !== true
  ) {
    throw new Error("The recovery target object cleanup proof is incomplete or addresses the wrong store.");
  }
  return exactTimestamp(value.verifiedAt, "target object cleanup verifiedAt");
}

function databaseDestructionProof(value, sourceProjectRef, targetProjectRef) {
  exactKeys(value, [
    "schemaVersion", "provider", "sourceProjectRef", "targetProjectRef", "deletionRequested",
    "sourceProjectRetained", "targetDatabaseDestroyed", "verifiedAt"
  ], "target database destruction proof");
  if (
    value.schemaVersion !== 1
    || value.provider !== "supabase"
    || value.sourceProjectRef !== sourceProjectRef
    || value.targetProjectRef !== targetProjectRef
    || value.deletionRequested !== true
    || value.sourceProjectRetained !== true
    || value.targetDatabaseDestroyed !== true
  ) {
    throw new Error("The recovery target database destruction proof is incomplete or addresses the wrong project.");
  }
  return exactTimestamp(value.verifiedAt, "target database destruction verifiedAt");
}

function fence(value, transitions, releaseCommit) {
  exactKeys(value, [
    "activatedAt", "activationGeneration", "active", "fenceId", "releaseCommitSha", "released", "transition"
  ], "fence response");
  if (
    !transitions.includes(value.transition)
    || value.releaseCommitSha !== releaseCommit
    || value.active !== true
    || value.released !== false
    || !Number.isSafeInteger(value.activationGeneration)
    || value.activationGeneration < 1
  ) throw new Error("A recovery fence response is invalid.");
  exactTimestamp(value.activatedAt, "fence activatedAt");
}

function provider(value) {
  exactKeys(value, ["createdAt", "provider", "status"], "provider recovery point");
  if (value.provider !== "supabase" || value.status !== "available") {
    throw new Error("The provider recovery point is unavailable.");
  }
  exactTimestamp(value.createdAt, "provider recovery point createdAt");
}

function offsite(value, operation, expected) {
  exactKeys(
    value,
    ["completedAt", "operation", "sha256", "size", "storage"],
    "offsite backup result"
  );
  if (
    value.operation !== operation
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !Number.isSafeInteger(value.size)
    || value.size <= 0
  ) throw new Error("An offsite backup result is invalid.");
  const completedAt = exactTimestamp(value.completedAt, "offsite backup completedAt");
  return offsiteStorage(value.storage, expected, completedAt);
}

function offsiteStorage(value, expected, completedAt) {
  exactKeys(
    value,
    ["bucketDigest", "key", "versionId", "bucketProtection", "objectRetention"],
    "offsite backup storage proof"
  );
  const expectedKey = `production-recovery/${expected.releaseCommit}/`
    + `${expected.githubRunId}-${expected.githubRunAttempt}/${expected.fileName}`;
  if (
    !/^[a-f0-9]{64}$/.test(value.bucketDigest)
    || value.key !== expectedKey
    || typeof value.versionId !== "string"
    || !/^[^\u0000-\u0020\u007f]{1,1024}$/u.test(value.versionId)
  ) throw new Error("An offsite backup exact-version locator is invalid.");

  exactKeys(
    value.bucketProtection,
    ["versioning", "objectLock", "defaultRetention"],
    "offsite backup bucket protection"
  );
  exactKeys(
    value.bucketProtection.defaultRetention,
    ["mode", "unit", "value"],
    "offsite backup default retention"
  );
  const defaultRetention = value.bucketProtection.defaultRetention;
  const defaultDays = defaultRetention.unit === "days"
    ? defaultRetention.value
    : defaultRetention.value * 365;
  exactKeys(
    value.objectRetention,
    ["mode", "retainUntil", "validatedMinimumDays"],
    "offsite backup object retention"
  );
  const retention = value.objectRetention;
  const retainedUntil = exactTimestamp(retention.retainUntil, "offsite backup retention");
  if (
    value.bucketProtection.versioning !== "Enabled"
    || value.bucketProtection.objectLock !== "Enabled"
    || defaultRetention.mode !== "COMPLIANCE"
    || !["days", "years"].includes(defaultRetention.unit)
    || !Number.isSafeInteger(defaultRetention.value)
    || defaultRetention.value < 1
    || !Number.isSafeInteger(defaultDays)
    || retention.mode !== "COMPLIANCE"
    || !Number.isSafeInteger(retention.validatedMinimumDays)
    || retention.validatedMinimumDays < 1
    || retention.validatedMinimumDays > 3_650
    || defaultDays < retention.validatedMinimumDays
    || retainedUntil.getTime()
      < completedAt.getTime() + retention.validatedMinimumDays * 24 * 60 * 60_000 - 5 * 60_000
  ) throw new Error("An offsite backup COMPLIANCE retention proof is invalid.");
  return {
    bucketDigest: value.bucketDigest,
    key: value.key,
    versionId: value.versionId,
    bucketProtection: value.bucketProtection,
    objectRetention: {
      ...retention,
      retainUntil: retainedUntil.toISOString()
    }
  };
}

function sameNamespaces(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function latestTime(left, right) {
  const leftTime = exactTimestamp(left, "backup completedAt");
  const rightTime = exactTimestamp(right, "backup completedAt");
  return leftTime > rightTime ? leftTime : rightTime;
}

async function json(directory, fileName) {
  try {
    return JSON.parse(await readFile(path.join(directory, fileName), "utf8"));
  } catch {
    throw new Error(`Recovery input ${fileName} is missing or invalid JSON.`);
  }
}

async function timeFile(directory, fileName) {
  let value;
  try {
    value = (await readFile(path.join(directory, fileName), "utf8")).trim();
  } catch {
    throw new Error(`Recovery timestamp ${fileName} is missing.`);
  }
  return exactTimestamp(value, fileName);
}

function exactTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${label} must be an exact UTC timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`${label} is invalid.`);
  return parsed;
}

function exactKeys(value, keys, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} does not match its strict machine schema.`);
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function pattern(value, expected, label) {
  if (!expected.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function projectRef(value) {
  if (!/^[a-z0-9]{20}$/.test(value)) throw new Error("A recovery Supabase project ref is invalid.");
  return value;
}
