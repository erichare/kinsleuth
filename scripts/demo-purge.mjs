#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { chmod, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { del, get, list } from "@vercel/blob";
import { Pool } from "pg";

import { getDatabaseConnectionString, isDatabaseTransportVerified } from "../lib/connection-string.ts";
import { readDatabaseIdentity } from "../lib/database-attestation.ts";
import {
  createDemoPurgeFenceId,
  createDemoPurgeInventory,
  demoPurgeMutableGlobalTables,
  demoPurgePreservedArchiveTables,
  demoPurgePreservedGlobalTables,
  demoPurgeProductTables,
  objectStoreProviderDigest,
  validateDemoPurgeBackupEvidence,
  validateDemoPurgeBindings,
  validateDemoPurgeConfirmations,
  validateDemoPurgeExecutionState,
  validateDemoPurgeInventory,
  validateDemoPurgeReceipt,
  validateDemoPurgeReceiptFenceContinuity,
  validateDemoPurgePublicSchemaTables,
  validateDemoPurgeSchemaTables
} from "../lib/demo-purge.ts";
import { closeDatabasePools } from "../lib/db.ts";
import { purgeDemoDatabaseTransaction } from "../lib/demo-purge-database.ts";
import { readDemoPurgeProductManifests } from "../lib/demo-purge-product-manifest.ts";
import {
  acquireReleaseFence,
  reacquireReleaseFence,
  ReleaseFenceError,
  releaseReleaseFence
} from "../lib/release-fence.ts";
import {
  canonicalJson,
  isRecoveryIdentitySentinel,
  recoveryNamespacePrefix,
  recoveryObjectNamespaceNames,
  sha256Utf8,
  summarizeRecoveryObjectManifest
} from "../lib/recovery-evidence-operations.ts";

const maximumRowsPerDemoTable = 100_000;
const maximumObjectsPerNamespace = 100_000;
const writeFenceDrainMs = 6 * 60_000;

const [operation, ...arguments_] = process.argv.slice(2);
if (
  (operation === "inventory" && arguments_.length !== 2)
  || (operation === "execute" && arguments_.length !== 3)
  || !["inventory", "execute"].includes(operation)
) {
  console.error(
    "Usage: demo-purge.mjs inventory <backup-evidence.json> <inventory.json> | "
    + "execute <backup-evidence.json> <inventory.json> <receipt.json>"
  );
  process.exit(2);
}

let pool;
let retainedFenceId;
try {
  if (process.env.KINRESOLVE_DATASET_MODE !== "demo") {
    throw new Error("Demo purge is disabled unless KINRESOLVE_DATASET_MODE is exactly demo.");
  }
  const configuration = configurationFromEnvironment();
  const backupSource = await readApprovedBackupEvidence(
    arguments_[0],
    configuration.approvedBackupEvidenceSha256
  );
  process.env.DATABASE_AUTO_MIGRATE = "false";
  pool = new Pool({
    connectionString: getDatabaseConnectionString(configuration.databaseUrl),
    max: 2
  });

  if (operation === "inventory") {
    const backup = validateDemoPurgeBackupEvidence(
      backupSource.value,
      configuration.bindings,
      new Date(),
      backupSource.sha256
    );
    const database = await scanDatabaseSnapshot(pool, configuration.bindings);
    const objects = await scanObjectStore(configuration);
    const inventory = createDemoPurgeInventory({
      bindings: configuration.bindings,
      backup,
      safety: database.safety,
      productTables: database.productTables,
      mutableGlobalTables: database.mutableGlobalTables,
      preservedTables: database.preservedTables,
      objectNamespaces: objects.manifests
    });
    await writePrivateJson(arguments_[1], inventory);
    process.stdout.write(`${JSON.stringify({
      kind: inventory.kind,
      inventoryDigest: inventory.inventoryDigest,
      archiveDigest: inventory.archiveDigest,
      productRows: totalRows(inventory.database.productTables),
      objectCount: totalObjects(inventory.objectNamespaces),
      expiresAt: inventory.expiresAt
    })}\n`);
  } else {
    const recoveryBackup = validateDemoPurgeBackupEvidence(
      backupSource.value,
      configuration.bindings,
      new Date(),
      backupSource.sha256,
      { allowStaleRecovery: true }
    );
    retainedFenceId = await executeDemoPurge({
      pool,
      configuration,
      backupSource,
      backup: recoveryBackup,
      inventoryPath: arguments_[1],
      receiptPath: arguments_[2]
    });
  }
} catch (error) {
  const suffix = retainedFenceId
    ? " The purge write fence remains active for safe operator recovery."
    : "";
  console.error(`${safeError(error)}${suffix}`);
  process.exitCode = 1;
} finally {
  if (pool) {
    await pool.end().catch(() => {
      console.error("Demo purge database cleanup failed.");
      process.exitCode = 1;
    });
  }
  await closeDatabasePools().catch(() => {
    console.error("Demo purge fence database cleanup failed.");
    process.exitCode = 1;
  });
}

function configurationFromEnvironment() {
  const databaseUrl = required("DEMO_PURGE_DATABASE_URL");
  if (!isDatabaseTransportVerified(databaseUrl) || new URL(databaseUrl).port === "6543") {
    throw new Error("Demo purge requires a verified direct database connection.");
  }
  return {
    databaseUrl,
    blobToken: required("DEMO_PURGE_BLOB_READ_WRITE_TOKEN"),
    approvedBackupEvidenceSha256: digest(
      required("DEMO_PURGE_APPROVED_BACKUP_EVIDENCE_SHA256"),
      "approved backup evidence"
    ),
    bindings: validateDemoPurgeBindings({
      archiveId: required("EXPECTED_ARCHIVE_ID"),
      databaseIdentity: required("EXPECTED_DATABASE_IDENTITY"),
      objectStoreIdentity: required("EXPECTED_OBJECT_STORAGE_IDENTITY"),
      objectStoreProviderId: required("EXPECTED_OBJECT_STORAGE_PROVIDER_ID"),
      releaseCommitSha: required("RELEASE_COMMIT")
    })
  };
}

async function executeDemoPurge({
  pool,
  configuration,
  backupSource,
  backup,
  inventoryPath,
  receiptPath
}) {
  const inventoryValue = await readJson(inventoryPath);
  const inventory = validateDemoPurgeInventory(
    inventoryValue,
    configuration.bindings,
    backup,
    new Date(),
    { allowExpiredRecovery: true }
  );
  validateDemoPurgeConfirmations(
    inventory,
    process.env.DEMO_PURGE_CONFIRM_DATASET_MODE,
    process.env.DEMO_PURGE_CONFIRMATION
  );

  const fenceId = createDemoPurgeFenceId(inventory.inventoryDigest);
  const fenceIdentity = {
    fenceId,
    releaseCommitSha: configuration.bindings.releaseCommitSha
  };
  const receiptValue = await readJsonIfExists(receiptPath);
  let receipt = receiptValue === undefined
    ? undefined
    : validateDemoPurgeReceipt(receiptValue, inventory);
  const initialDatabase = await scanDatabaseSnapshot(pool, configuration.bindings, fenceIdentity);
  const initialObjects = await scanObjectStore(configuration);
  const ownFence = initialDatabase.ownPurgeFence;
  if (ownFence?.state === "active") retainedFenceId = fenceId;
  validateDemoPurgeReceiptFenceContinuity(receipt, ownFence);

  const recoveryAuthorized = receipt !== undefined || ownFence?.state === "active";
  const authorizationTime = recoveryAuthorized
    ? new Date(inventory.createdAt)
    : new Date();
  const authorizedBackup = validateDemoPurgeBackupEvidence(
    backupSource.value,
    configuration.bindings,
    authorizationTime,
    backupSource.sha256
  );
  validateDemoPurgeInventory(
    inventoryValue,
    configuration.bindings,
    authorizedBackup,
    new Date(),
    { allowExpiredRecovery: recoveryAuthorized }
  );
  if (!recoveryAuthorized) {
    // A fresh destructive transition is permitted only while the short-lived
    // inventory is still valid. Durable receipt/fence state is required to
    // recover an already-started transition after that deadline.
    validateDemoPurgeInventory(inventoryValue, configuration.bindings, backup);
  }
  const initialState = validateDemoPurgeExecutionState(
    inventory,
    currentState(initialDatabase, initialObjects),
    { allowResume: recoveryAuthorized }
  );

  if (receipt?.kind === "kinresolve-demo-purge-receipt") {
    if (!initialState.databaseAlreadyPurged || !initialState.objectsAlreadyPurged) {
      throw new Error("The completed demo purge receipt no longer matches an empty demo cell.");
    }
    writeReceiptSummary(receipt, "already-complete");
    return undefined;
  }

  if (receipt?.kind === "kinresolve-demo-purge-pre-release-receipt") {
    if (!initialState.databaseAlreadyPurged || !initialState.objectsAlreadyPurged) {
      throw new Error("The pre-release demo purge receipt does not match an empty demo cell.");
    }
    if (ownFence?.state === "released") {
      const finalReceipt = createFinalReceipt(
        inventory,
        initialObjects.manifests,
        ownFence,
        receipt.startedAt
      );
      validateDemoPurgeReceipt(finalReceipt, inventory);
      await replacePrivateJson(receiptPath, finalReceipt);
      retainedFenceId = undefined;
      writeReceiptSummary(finalReceipt, "recovered-after-release");
      return undefined;
    }
  }

  let transition;
  let transitionedHere = false;
  const operationStartedAt = new Date().toISOString();
  let destructiveWorkStarted = initialState.databaseAlreadyPurged
    || receipt?.kind === "kinresolve-demo-purge-pre-release-receipt";
  let preReleaseDurable = receipt?.kind === "kinresolve-demo-purge-pre-release-receipt";
  try {
    transition = await acquireOrReacquirePurgeFence(fenceIdentity, configuration.databaseUrl);
    transitionedHere = transition.transition === "acquired" || transition.transition === "reacquired";
    retainedFenceId = fenceId;

    const startedAt = receipt?.startedAt ?? (
      transition.transition === "already-active"
        ? transition.fence.firstActivatedAt
        : operationStartedAt
    );
    if (receipt === undefined) {
      receipt = createPendingReceipt(inventory, transition.fence, startedAt);
      validateDemoPurgeReceipt(receipt, inventory);
      await writePrivateJson(receiptPath, receipt);
    }
    await waitForWriteFenceDrain(transition.fence.activatedAt);

    const fencedDatabase = await scanDatabaseSnapshot(
      pool,
      configuration.bindings,
      fenceIdentity,
      true
    );
    const fencedObjects = await scanObjectStore(configuration);
    const executionState = validateDemoPurgeExecutionState(
      inventory,
      currentState(fencedDatabase, fencedObjects),
      { allowResume: recoveryAuthorized }
    );
    if (
      receipt.kind === "kinresolve-demo-purge-pre-release-receipt"
      && (!executionState.databaseAlreadyPurged || !executionState.objectsAlreadyPurged)
    ) {
      throw new Error("The durable pre-release receipt no longer matches an empty demo cell.");
    }

    if (!recoveryAuthorized) {
      // Fence draining and exact scans consume real time. Re-prove freshness,
      // inventory lifetime, and the complete retained recovery margin at the
      // last possible instant before entering a commit-ambiguous operation.
      const destructiveAuthorizationTime = new Date();
      const destructiveBackup = validateDemoPurgeBackupEvidence(
        backupSource.value,
        configuration.bindings,
        destructiveAuthorizationTime,
        backupSource.sha256
      );
      validateDemoPurgeInventory(
        inventoryValue,
        configuration.bindings,
        destructiveBackup,
        destructiveAuthorizationTime
      );
    }

    // Any error after entering the transaction can have an ambiguous COMMIT
    // outcome. Keep the fence until a later exact-state recovery proves what
    // happened instead of reopening writes based on a lost acknowledgement.
    destructiveWorkStarted = true;
    await purgeDatabase(
      pool,
      configuration.bindings.archiveId,
      fenceIdentity,
      inventory,
      fencedObjects.manifests,
      recoveryAuthorized
    );
    if (!executionState.objectsAlreadyPurged) {
      await deleteInventoriedObjects(configuration.blobToken, fencedObjects.rawEntries);
    }
    const finalObjects = await scanObjectStore(configuration);
    const finalDatabase = await scanDatabaseSnapshot(
      pool,
      configuration.bindings,
      fenceIdentity,
      true
    );
    const finalState = validateDemoPurgeExecutionState(
      inventory,
      currentState(finalDatabase, finalObjects),
      { allowResume: true }
    );
    if (!finalState.databaseAlreadyPurged || !finalState.objectsAlreadyPurged) {
      throw new Error("The demo purge did not reach an empty product-data state.");
    }

    const preReleaseReceipt = createPreReleaseReceipt(
      inventory,
      transition.fence,
      startedAt
    );
    validateDemoPurgeReceipt(preReleaseReceipt, inventory);
    await replacePrivateJson(receiptPath, preReleaseReceipt);
    receipt = preReleaseReceipt;
    preReleaseDurable = true;

    const released = await releaseReleaseFence(fenceIdentity, {
      databaseUrl: configuration.databaseUrl
    });
    retainedFenceId = undefined;
    const finalReceipt = createFinalReceipt(
      inventory,
      finalObjects.manifests,
      released.fence,
      startedAt
    );
    validateDemoPurgeReceipt(finalReceipt, inventory);
    await replacePrivateJson(receiptPath, finalReceipt);
    writeReceiptSummary(finalReceipt, "completed");
    return undefined;
  } catch (error) {
    if (transitionedHere && !destructiveWorkStarted && !preReleaseDurable) {
      try {
        await invalidatePendingReceipt(receiptPath);
        await releaseReleaseFence(fenceIdentity, { databaseUrl: configuration.databaseUrl });
        retainedFenceId = undefined;
      } catch {
        // A failed automatic pre-deletion release remains visibly contained by
        // the exact durable fence and can be resumed with the same inventory.
      }
    }
    throw error;
  }
}

function currentState(database, objects) {
  return {
    safety: database.safety,
    database: {
      productTables: database.productTables,
      mutableGlobalTables: database.mutableGlobalTables,
      preservedTables: database.preservedTables
    },
    objectNamespaces: objects.manifests
  };
}

function receiptBindings(inventory) {
  return {
    releaseCommitSha: inventory.releaseCommitSha,
    archiveDigest: inventory.archiveDigest,
    databaseIdentity: inventory.databaseIdentity,
    objectStoreIdentity: inventory.objectStoreIdentity,
    objectStoreProviderDigest: inventory.objectStoreProviderDigest,
    backupEvidenceDigest: inventory.backupEvidenceDigest,
    inventoryDigest: inventory.inventoryDigest
  };
}

function createPendingReceipt(inventory, fence, startedAt) {
  return {
    schemaVersion: 1,
    kind: "kinresolve-demo-purge-pending-receipt",
    ...receiptBindings(inventory),
    fence: {
      fenceId: fence.fenceId,
      activatedAt: fence.activatedAt,
      activationGeneration: fence.activationGeneration
    },
    startedAt
  };
}

function createPreReleaseReceipt(inventory, fence, startedAt) {
  return {
    schemaVersion: 1,
    kind: "kinresolve-demo-purge-pre-release-receipt",
    ...receiptBindings(inventory),
    fence: {
      fenceId: fence.fenceId,
      activatedAt: fence.activatedAt,
      activationGeneration: fence.activationGeneration
    },
    startedAt,
    verifiedEmptyAt: new Date().toISOString()
  };
}

function createFinalReceipt(inventory, finalObjectNamespaces, fence, startedAt) {
  if (fence.state !== "released" || fence.releasedAt === null) {
    throw new Error("The final demo purge receipt requires the exact released write fence.");
  }
  return {
    schemaVersion: 1,
    kind: "kinresolve-demo-purge-receipt",
    ...receiptBindings(inventory),
    database: {
      productRowsBefore: totalRows(inventory.database.productTables),
      productRowsAfter: 0,
      mutableSecurityRowsBefore: totalRows(inventory.database.mutableGlobalTables),
      mutableSecurityRowsAfter: 0,
      preservedManifestSha256: sha256Utf8(
        `${canonicalJson(inventory.database.preservedTables)}\n`
      )
    },
    objects: {
      objectsBefore: totalObjects(inventory.objectNamespaces),
      objectsAfter: 0,
      namespaces: finalObjectNamespaces.map(({
        entries: _entries,
        backupManifestSha256: _backupManifestSha256,
        ...summary
      }) => summary)
    },
    fence: {
      fenceId: fence.fenceId,
      activatedAt: fence.activatedAt,
      activationGeneration: fence.activationGeneration,
      releasedAt: fence.releasedAt
    },
    startedAt,
    completedAt: new Date().toISOString()
  };
}

function writeReceiptSummary(receipt, status) {
  process.stdout.write(`${JSON.stringify({
    kind: receipt.kind,
    status,
    inventoryDigest: receipt.inventoryDigest,
    completedAt: receipt.completedAt
  })}\n`);
}

async function scanDatabase(poolOrClient, bindings, permittedFence, requirePermittedFence = false) {
  const identity = await readDatabaseIdentity(poolOrClient);
  if (identity.fingerprint !== bindings.databaseIdentity) {
    throw new Error("The demo purge database does not match its configured physical identity.");
  }
  const archives = await poolOrClient.query(
    'SELECT id, dataset_mode FROM public.archives ORDER BY id COLLATE "C"'
  );
  if (
    archives.rows.length !== 1
    || archives.rows[0]?.id !== bindings.archiveId
    || archives.rows[0]?.dataset_mode !== "demo"
  ) {
    throw new Error("Demo purge is permitted only for the single exact archive persisted as demo.");
  }

  const schema = await poolOrClient.query(
    `SELECT relation.relname AS table_name
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = relation.oid
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
       AND attribute.attname = 'archive_id'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     ORDER BY relation.relname COLLATE "C"`
  );
  validateDemoPurgeSchemaTables(schema.rows.map((row) => row.table_name));
  const publicSchema = await poolOrClient.query(
    `SELECT relation.relname AS table_name
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
     ORDER BY relation.relname COLLATE "C"`
  );
  validateDemoPurgePublicSchemaTables(publicSchema.rows.map((row) => row.table_name));

  const fences = await poolOrClient.query(
    `SELECT fence_id, release_commit_sha, state, activation_generation,
            first_activated_at, activated_at, released_at
     FROM public.release_write_fences
     WHERE state = 'active' OR ($1::text IS NOT NULL AND fence_id = $1)
     ORDER BY fence_id COLLATE "C"`,
    [permittedFence?.fenceId ?? null]
  );
  const ownFenceRow = permittedFence
    ? fences.rows.find((row) => row.fence_id === permittedFence.fenceId)
    : undefined;
  if (ownFenceRow && ownFenceRow.release_commit_sha !== permittedFence.releaseCommitSha) {
    throw new Error("The demo purge fence is bound to a different release commit.");
  }
  const otherActiveFences = fences.rows.filter(
    (row) => row.state === "active" && row.fence_id !== permittedFence?.fenceId
  );
  if (otherActiveFences.length !== 0) {
    throw new Error("Another release fence is active; demo purge is blocked.");
  }
  const ownPurgeFence = ownFenceRow ? {
    fenceId: ownFenceRow.fence_id,
    releaseCommitSha: ownFenceRow.release_commit_sha,
    state: ownFenceRow.state,
    activationGeneration: positiveInteger(
      ownFenceRow.activation_generation,
      "purge fence activation generation"
    ),
    firstActivatedAt: isoTimestamp(ownFenceRow.first_activated_at, "purge fence first activation"),
    activatedAt: isoTimestamp(ownFenceRow.activated_at, "purge fence activation"),
    releasedAt: ownFenceRow.released_at === null
      ? null
      : isoTimestamp(ownFenceRow.released_at, "purge fence release")
  } : null;
  const ownPurgeFenceActive = ownPurgeFence?.state === "active";
  if (requirePermittedFence && !ownPurgeFenceActive) {
    throw new Error("The exact demo purge write fence is not active.");
  }

  const work = await poolOrClient.query(
    `WITH visibility AS (
       SELECT pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER') AS read_all_stats
     )
     SELECT
       (SELECT COUNT(*)::text FROM public.durable_jobs
        WHERE state = 'running' AND lease_expires_at > clock_timestamp()) AS active_job_leases,
       (SELECT COUNT(*)::text FROM public.integration_upload_intents
        WHERE status = 'pending' AND expires_at > clock_timestamp()) AS unexpired_upload_intents,
       (SELECT COUNT(*)::text FROM public.beta_invitations
        WHERE state = 'pending' AND token_digest IS NOT NULL) AS active_invitation_capabilities,
       (SELECT COUNT(*)::text FROM public.beta_email_verification_tokens
        WHERE state = 'pending' AND token_digest IS NOT NULL) AS active_email_verification_capabilities,
       (SELECT COUNT(*)::text FROM public.account
        WHERE "accessToken" IS NOT NULL
           OR "refreshToken" IS NOT NULL
           OR "idToken" IS NOT NULL) AS oauth_account_capabilities,
       (SELECT state = 'paused' FROM public.beta_invitation_control
        WHERE scope = 'hosted') AS invitations_paused,
       (SELECT COUNT(*)::text
        FROM pg_catalog.pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND backend_type = 'client backend'
          AND xact_start IS NOT NULL) AS active_client_transactions,
       visibility.read_all_stats,
       (SELECT COUNT(*)::text
        FROM pg_catalog.pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND backend_type = 'client backend'
          AND usename IS DISTINCT FROM current_user) AS other_role_sessions
     FROM visibility`
  );
  const activeClientTransactions = count(
    work.rows[0]?.active_client_transactions,
    "active client transactions"
  );
  const otherRoleSessions = count(work.rows[0]?.other_role_sessions, "other-role sessions");
  const transactionVisibilityVerified = work.rows[0]?.read_all_stats === true || otherRoleSessions === 0;
  const safety = {
    activeJobLeases: count(work.rows[0]?.active_job_leases, "active job leases"),
    unexpiredUploadIntents: count(
      work.rows[0]?.unexpired_upload_intents,
      "unexpired upload intents"
    ),
    activeInvitationCapabilities: count(
      work.rows[0]?.active_invitation_capabilities,
      "active invitation capabilities"
    ),
    activeEmailVerificationCapabilities: count(
      work.rows[0]?.active_email_verification_capabilities,
      "active email-verification capabilities"
    ),
    oauthAccountCapabilities: count(
      work.rows[0]?.oauth_account_capabilities,
      "OAuth account capabilities"
    ),
    otherActiveReleaseFences: 0,
    activeClientTransactions,
    invitationsPaused: work.rows[0]?.invitations_paused === true,
    transactionVisibilityVerified
  };
  if (
    safety.activeJobLeases !== 0
    || safety.unexpiredUploadIntents !== 0
    || safety.activeInvitationCapabilities !== 0
    || safety.activeEmailVerificationCapabilities !== 0
    || safety.oauthAccountCapabilities !== 0
    || safety.activeClientTransactions !== 0
    || safety.invitationsPaused !== true
    || safety.transactionVisibilityVerified !== true
  ) {
    throw new Error(
      "Demo purge requires paused invitations, zero active work/capabilities, and verified transaction visibility."
    );
  }

  const productTables = await readDemoPurgeProductManifests(poolOrClient, bindings.archiveId);
  const mutableGlobalTables = [];
  for (const name of demoPurgeMutableGlobalTables) {
    mutableGlobalTables.push(await tableManifest(poolOrClient, name, bindings.archiveId, false));
  }
  const preservedTables = [];
  for (const name of [...demoPurgePreservedGlobalTables, ...demoPurgePreservedArchiveTables]) {
    // The cell contains exactly one archive. Hashing the whole preserved table
    // also covers global password-recovery audit events whose archive_id is NULL.
    preservedTables.push(await tableManifest(
      poolOrClient,
      name,
      bindings.archiveId,
      false,
      permittedFence?.fenceId
    ));
  }
  return {
    safety,
    productTables,
    mutableGlobalTables,
    preservedTables,
    ownPurgeFence,
    ownPurgeFenceActive
  };
}

async function scanDatabaseSnapshot(pool, bindings, permittedFence, requirePermittedFence = false) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await scanDatabase(client, bindings, permittedFence, requirePermittedFence);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function tableManifest(poolOrClient, name, archiveId, archiveScoped, excludedFenceId) {
  const exclusion = name === "release_write_fences" && excludedFenceId
    ? "WHERE fence_id <> $1"
    : "";
  const parameters = archiveScoped ? [archiveId] : exclusion ? [excludedFenceId] : [];
  const result = await poolOrClient.query(
    `SELECT to_jsonb(inventory_row)::text AS row_json
     FROM public.${quoteIdentifier(name)} AS inventory_row
     ${archiveScoped ? "WHERE archive_id = $1" : exclusion}`,
    parameters
  );
  if (result.rows.length > maximumRowsPerDemoTable) {
    throw new Error("A demo purge table exceeds the supported inventory size.");
  }
  const rows = result.rows.map((row) => {
    if (typeof row.row_json !== "string") {
      throw new Error("A demo purge table row could not be canonicalized.");
    }
    return row.row_json;
  }).sort(compareUtf8);
  return {
    name,
    rowCount: rows.length,
    manifestSha256: sha256Utf8(`${canonicalJson(rows)}\n`)
  };
}

async function purgeDatabase(pool, archiveId, fenceIdentity, inventory, objectNamespaces, allowResume) {
  await purgeDemoDatabaseTransaction({
    pool,
    archiveId,
    fenceIdentity,
    productTables: inventory.database.productTables,
    mutableGlobalTables: inventory.database.mutableGlobalTables,
    validateLockedState: async (client, phase) => {
      const current = await scanDatabase(client, {
        archiveId,
        databaseIdentity: inventory.databaseIdentity
      }, fenceIdentity, true);
      return validateDemoPurgeExecutionState(inventory, {
        safety: current.safety,
        database: {
          productTables: current.productTables,
          mutableGlobalTables: current.mutableGlobalTables,
          preservedTables: current.preservedTables
        },
        objectNamespaces
      }, { allowResume: phase === "after" ? true : allowResume });
    }
  });
}

async function scanObjectStore(configuration) {
  await assertObjectStoreIdentity(configuration);
  const manifests = [];
  const rawEntries = [];
  for (const name of recoveryObjectNamespaceNames) {
    const prefix = recoveryNamespacePrefix(configuration.bindings.archiveId, name);
    const blobs = (await listAll(configuration.blobToken, prefix)).filter(
      (blob) => !isRecoveryIdentitySentinel(
        configuration.bindings.archiveId,
        blob.pathname,
        configuration.bindings.objectStoreIdentity
      )
    );
    const safeEntries = [];
    const backupEntries = [];
    const namespaceRawEntries = [];
    for (const blob of blobs) {
      if (!blob.pathname.startsWith(prefix)) {
        throw new Error("The object provider returned a path outside the demo archive namespace.");
      }
      const content = await hashPrivateObject(configuration.blobToken, blob.pathname, blob.size);
      safeEntries.push({
        pathnameDigest: sha256Utf8(blob.pathname),
        size: content.size,
        contentSha256: content.sha256
      });
      backupEntries.push({
        pathname: blob.pathname,
        contentType: content.contentType,
        size: content.size,
        sha256: content.sha256
      });
      namespaceRawEntries.push({ pathname: blob.pathname });
    }
    safeEntries.sort((left, right) => compareUtf8(left.pathnameDigest, right.pathnameDigest));
    const totalBytes = safeEntries.reduce((total, entry) => total + entry.size, 0);
    if (!Number.isSafeInteger(totalBytes)) {
      throw new Error("The demo object inventory exceeds the safe integer range.");
    }
    manifests.push({
      name,
      objectCount: safeEntries.length,
      totalBytes,
      manifestSha256: sha256Utf8(`${canonicalJson(safeEntries)}\n`),
      backupManifestSha256: summarizeRecoveryObjectManifest(name, backupEntries).manifestSha256,
      entries: safeEntries
    });
    rawEntries.push(...namespaceRawEntries);
  }
  return { manifests, rawEntries };
}

async function assertObjectStoreIdentity(configuration) {
  const pathname = `archives/${configuration.bindings.archiveId}/release-readiness/`
    + configuration.bindings.objectStoreIdentity;
  const result = await get(pathname, {
    access: "private",
    token: configuration.blobToken,
    useCache: false
  });
  if (!result || result.statusCode !== 200 || result.blob.pathname !== pathname) {
    throw new Error("The demo purge object-store identity sentinel is unavailable.");
  }
  const actual = await hashStream(result.stream);
  if (actual.sha256 !== configuration.bindings.objectStoreIdentity) {
    throw new Error("The demo purge object store does not match its configured identity.");
  }
  const providerStoreId = providerStoreIdFromUrl(result.blob.url);
  if (
    providerStoreId !== configuration.bindings.objectStoreProviderId
    || objectStoreProviderDigest(providerStoreId)
      !== objectStoreProviderDigest(configuration.bindings.objectStoreProviderId)
  ) {
    throw new Error("The demo purge object store does not match its physical provider identity.");
  }
}

async function hashPrivateObject(token, pathname, expectedSize) {
  const result = await get(pathname, { access: "private", token, useCache: false });
  if (!result || result.statusCode !== 200 || result.blob.pathname !== pathname) {
    throw new Error("An inventoried demo object could not be read exactly.");
  }
  const content = await hashStream(result.stream);
  if (content.size !== expectedSize || content.size !== result.blob.size) {
    throw new Error("An inventoried demo object changed size while it was hashed.");
  }
  return { ...content, contentType: result.blob.contentType };
}

async function hashStream(stream) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (!Number.isSafeInteger(size)) {
      throw new Error("An inventoried demo object exceeds the safe integer range.");
    }
    hash.update(bytes);
  }
  return { size, sha256: hash.digest("hex") };
}

async function listAll(token, prefix) {
  const result = [];
  let cursor;
  do {
    const page = await list({ token, prefix, limit: 1_000, ...(cursor ? { cursor } : {}) });
    result.push(...page.blobs);
    if (result.length > maximumObjectsPerNamespace) {
      throw new Error("A demo object namespace exceeds the supported inventory size.");
    }
    if (page.hasMore && !page.cursor) {
      throw new Error("The object provider omitted a required pagination cursor.");
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const paths = new Set();
  for (const blob of result) {
    if (paths.has(blob.pathname)) {
      throw new Error("The object provider returned a duplicate demo object path.");
    }
    paths.add(blob.pathname);
  }
  return result.sort((left, right) => compareUtf8(left.pathname, right.pathname));
}

async function deleteInventoriedObjects(token, entries) {
  for (let offset = 0; offset < entries.length; offset += 1_000) {
    await del(entries.slice(offset, offset + 1_000).map((entry) => entry.pathname), { token });
  }
}

async function acquireOrReacquirePurgeFence(identity, databaseUrl) {
  try {
    return await acquireReleaseFence(identity, { databaseUrl });
  } catch (error) {
    if (!(error instanceof ReleaseFenceError) || error.code !== "CONFLICT") throw error;
    return reacquireReleaseFence(identity, { databaseUrl });
  }
}

async function waitForWriteFenceDrain(activatedAt) {
  const activationTime = new Date(activatedAt).getTime();
  if (Number.isNaN(activationTime)) {
    throw new Error("The demo purge write-fence activation time is invalid.");
  }
  const remaining = activationTime + writeFenceDrainMs - Date.now();
  if (remaining <= 0) return;
  process.stderr.write("Demo purge write fence is active; waiting for in-flight requests to drain.\n");
  await new Promise((resolve) => setTimeout(resolve, remaining));
}

function providerStoreIdFromUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The object provider returned an invalid private store URL.");
  }
  const match = parsed.hostname.match(
    /^([a-z0-9][a-z0-9-]{7,63})\.private\.blob\.vercel-storage\.com$/
  );
  if (!match || parsed.protocol !== "https:") {
    throw new Error("The object provider did not return the expected private store URL.");
  }
  return match[1];
}

function totalRows(tables) {
  return tables.reduce((total, table) => total + table.rowCount, 0);
}

function totalObjects(namespaces) {
  return namespaces.reduce((total, namespace) => total + namespace.objectCount, 0);
}

function count(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value)) {
    throw new Error(`The ${label} count is invalid.`);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`The ${label} count is invalid.`);
  return result;
}

function positiveInteger(value, label) {
  const normalized = typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error(`The ${label} count is invalid.`);
  }
  return normalized;
}

function isoTimestamp(value, label) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`The ${label} timestamp is invalid.`);
  return parsed.toISOString();
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function readJson(filePath) {
  try {
    const bytes = await readBoundedFile(filePath, 128 * 1024 * 1024);
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("A required demo purge evidence file is unavailable or invalid.");
  }
}

async function readJsonIfExists(filePath) {
  let bytes;
  try {
    bytes = await readBoundedFile(filePath, 128 * 1024 * 1024);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return undefined;
    throw new Error("The demo purge receipt is unavailable or invalid.");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("The demo purge receipt is unavailable or invalid.");
  }
}

async function readApprovedBackupEvidence(filePath, expectedSha256) {
  let bytes;
  try {
    bytes = await readBoundedFile(filePath, 1024 * 1024);
  } catch {
    throw new Error("The approved production backup evidence is unavailable or invalid.");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedSha256) {
    throw new Error("The production backup evidence does not match its independently approved digest.");
  }
  try {
    return { value: JSON.parse(bytes.toString("utf8")), sha256 };
  } catch {
    throw new Error("The approved production backup evidence is unavailable or invalid.");
  }
}

async function readBoundedFile(filePath, maximumBytes) {
  const bytes = await readFile(filePath);
  if (bytes.length === 0 || bytes.length > maximumBytes) {
    throw new Error("The demo purge evidence file size is invalid.");
  }
  return bytes;
}

async function writePrivateJson(filePath, value) {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, 0o600);
  await syncParentDirectory(filePath);
}

async function replacePrivateJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryExists = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
    temporaryExists = false;
    await chmod(filePath, 0o600);
    await syncParentDirectory(filePath);
  } finally {
    if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
  }
}

async function invalidatePendingReceipt(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
  await syncParentDirectory(filePath);
}

async function syncParentDirectory(filePath) {
  const directory = await open(dirname(filePath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function digest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`The ${label} digest is invalid.`);
  return value;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function safeError(error) {
  if (error instanceof Error && /^The |^Demo /.test(error.message)) return error.message;
  return "Demo purge failed closed.";
}
