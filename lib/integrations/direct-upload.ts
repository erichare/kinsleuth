import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, withTransaction, type DatabaseOptions } from "../db";
// Imported from ../db-rls directly so unit tests that mock "@/lib/db" keep
// the real scope helper.
import { withRlsArchiveScope, withRlsMaintenanceMode } from "../db-rls";
import { validateHostedGedcomFile } from "../hosted-capabilities";
import { assertReleaseWritesAllowed } from "../release-fence";
import {
  createConfiguredArchiveObjectStorage,
  type ArchiveObjectStorage,
  type PrivateObjectMetadata
} from "../storage/object-storage";
import {
  createConfiguredDirectUploadTicketIssuer,
  maximumPrivateDirectUploadBytes,
  type DirectUploadBackend,
  type DirectUploadInstructions,
  type DirectUploadTicketIssuer
} from "../storage/direct-upload-ticket";
import {
  isIntegrationProviderEnabled,
  resolveIntegrationFeatureFlags
} from "./feature-flags";
import {
  resolveArtifactRightsAcknowledgement,
  type MediaRightsAcceptance
} from "./artifact-rights";
import {
  getIntegrationArtifact,
  type IntegrationArtifact,
  type IntegrationArtifactState,
  type IntegrationArtifactStoreOptions
} from "./artifact-store";
import type { IntegrationProvider } from "./types";

export const maximumDirectIntegrationArtifactBytes = maximumPrivateDirectUploadBytes;
const defaultIntentLifetimeMilliseconds = 5 * 60 * 1000;
const maximumSignatureBytes = 8 * 1024;

type UploadIntentStatus = "pending" | "completed" | "rejected" | "expired";

type UploadIntentRow = {
  archive_id?: string;
  id: string;
  connection_id: string;
  file_name: string;
  content_type: string;
  declared_size_bytes: number | string;
  staging_key: string;
  backend: DirectUploadBackend;
  status: UploadIntentStatus;
  artifact_id: string | null;
  artifact_duplicate: boolean;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  staging_deleted_at?: Date | string | null;
  media_rights_acknowledgement_version: string | null;
  media_rights_acknowledged_by: string | null;
  media_rights_acknowledged_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ArtifactRow = {
  id: string;
  connection_id: string;
  file_name: string;
  artifact_key: string;
  sha256: string;
  content_type: string;
  size_bytes: number | string;
  state: IntegrationArtifactState;
  media_rights_acknowledgement_version: string | null;
  media_rights_acknowledged_by: string | null;
  media_rights_acknowledged_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type PublicIntegrationUploadIntent = {
  id: string;
  connectionId: string;
  fileName: string;
  contentType: string;
  size: number;
  expiresAt: string;
};

export type DirectIntegrationUploadOptions = IntegrationArtifactStoreOptions & {
  ticketIssuer?: DirectUploadTicketIssuer;
  now?: () => Date;
  intentLifetimeMilliseconds?: number;
};

export type DirectUploadMaintenanceOptions = DatabaseOptions & {
  objectStorage?: ArchiveObjectStorage;
  now?: () => Date;
};

export type StageDirectIntegrationUploadInput = {
  fileName: string;
  contentType: string;
  size: number;
  mediaRightsAcknowledgement?: MediaRightsAcceptance;
};

export async function stageDirectIntegrationUpload(
  connectionId: string,
  input: StageDirectIntegrationUploadInput,
  options: DirectIntegrationUploadOptions
): Promise<{ intent: PublicIntegrationUploadIntent; upload: DirectUploadInstructions }> {
  // This service-level guard is deliberate defense in depth: the centralized
  // API proxy blocks the route, while this check prevents any internal caller
  // from minting a ticket that could outlive a release drain.
  await assertReleaseWritesAllowed(options);
  const archiveId = required(options.archiveId, "archiveId");
  const normalizedConnectionId = required(connectionId, "connection id");
  const file = validateUploadDeclaration(input);
  const featureFlags = resolveIntegrationFeatureFlags(options.featureFlags);
  if (featureFlags.plainGedcomOnly) {
    validateHostedGedcomFile(file);
  }
  const now = currentTime(options);
  const lifetime = normalizeIntentLifetime(options.intentLifetimeMilliseconds);
  const expiresAt = new Date(now.getTime() + lifetime);
  const issuer = configuredTicketIssuer(options);
  const intentId = `integration-upload-intent-${randomUUID()}`;
  const stagingKey = `archives/${archiveId}/integration-upload-staging/${randomUUID()}${file.extension}`;

  const intent = await withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    const provider = await requireEnabledConnection(client, archiveId, normalizedConnectionId, options);
    const rightsAcknowledgement = resolveArtifactRightsAcknowledgement({
      provider,
      fileName: file.fileName,
      acknowledgement: input.mediaRightsAcknowledgement,
      featureFlags,
      acknowledgedAt: now
    });
    const inserted = await client.query<UploadIntentRow>(
      `INSERT INTO integration_upload_intents (
         archive_id, id, connection_id, file_name, content_type,
         declared_size_bytes, staging_key, backend, expires_at, created_at, updated_at,
         media_rights_acknowledgement_version, media_rights_acknowledged_by,
         media_rights_acknowledged_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, $13)
       RETURNING *`,
      [
        archiveId,
        intentId,
        normalizedConnectionId,
        file.fileName,
        file.contentType,
        file.size,
        stagingKey,
        issuer.backend,
        expiresAt.toISOString(),
        now.toISOString(),
        rightsAcknowledgement?.version ?? null,
        rightsAcknowledgement?.actorId ?? null,
        rightsAcknowledgement?.acknowledgedAt ?? null
      ]
    );
    return inserted.rows[0];
  });

  try {
    const upload = await issuer.issue({
      key: stagingKey,
      contentType: file.contentType,
      size: file.size,
      expiresAt
    });
    return { intent: publicIntent(intent), upload };
  } catch (error) {
    await consumePendingIntent(intent, "rejected", options).catch(() => false);
    throw directUploadError("STORAGE_UNAVAILABLE", "Private direct upload ticket issuance failed", error);
  }
}

export async function completeDirectIntegrationUpload(
  connectionId: string,
  intentId: string,
  options: DirectIntegrationUploadOptions
): Promise<{ artifact: IntegrationArtifact; replayed: boolean }> {
  const archiveId = required(options.archiveId, "archiveId");
  const normalizedConnectionId = required(connectionId, "connection id");
  const normalizedIntentId = required(intentId, "upload intent id");
  const intent = await getUploadIntent(normalizedConnectionId, normalizedIntentId, options);
  const completedReplay = intent.status === "completed" && Boolean(intent.artifact_id);
  if (!completedReplay && intent.status !== "pending") {
    throw directUploadError("INVALID_STATE", "Upload intent has already been consumed");
  }

  const featureFlags = resolveIntegrationFeatureFlags(options.featureFlags);
  if (featureFlags.plainGedcomOnly) {
    validateHostedGedcomFile({
      fileName: intent.file_name,
      contentType: intent.content_type,
      size: Number(intent.declared_size_bytes)
    });
  }
  await withTransaction(withRlsArchiveScope(options, archiveId), (client) =>
    requireEnabledConnection(client, archiveId, normalizedConnectionId, { ...options, featureFlags })
  );

  if (completedReplay && intent.artifact_id) {
    return {
      artifact: withDuplicate(
        await getIntegrationArtifact(normalizedConnectionId, intent.artifact_id, options),
        intent.artifact_duplicate
      ),
      replayed: true
    };
  }

  const storage = configuredObjectStorage(options);
  if (isExpired(intent, currentTime(options))) {
    await rejectAndClean(intent, "expired", storage, options);
    throw terminalUploadError("UPLOAD_EXPIRED", "Upload intent expired before completion", "expired");
  }

  const promotionState: { attempted: boolean; key?: string } = { attempted: false };
  try {
    const before = await statPrivateUpload(storage, archiveId, intent.staging_key);
    if (!before) throw directUploadError("UPLOAD_NOT_READY", "The private upload is not available yet");
    validateObjectMetadata(intent, before);
    const inspected = await hashAndInspectObject(intent, storage, options);
    const after = await statPrivateUpload(storage, archiveId, intent.staging_key);
    if (!after || objectChanged(before, after)) {
      throw terminalUploadError("ARTIFACT_INTEGRITY", "The uploaded object changed during validation", "rejected");
    }
    validateObjectMetadata(intent, after);
    if (!after.etag) {
      throw directUploadError(
        "STORAGE_UNAVAILABLE",
        "Private upload storage did not provide a stable object identity"
      );
    }

    const promoted = await promotePrivateUpload(
      intent,
      inspected.sha256,
      after,
      after.etag,
      promotionState,
      storage,
      options
    );
    const promotedMetadata = await verifyPromotedArtifact(
      intent,
      promoted.key,
      inspected.sha256,
      storage,
      options
    );

    const completed = await finalizeIntent(
      normalizedConnectionId,
      intent,
      inspected.sha256,
      promoted.key,
      promotedMetadata,
      storage,
      options
    );
    return { artifact: completed.artifact, replayed: completed.replayed };
  } catch (error) {
    if (promotionState.attempted && promotionState.key) {
      await deletePromotedArtifactIfUnreferenced(
        promotionState.key,
        storage,
        options
      ).catch(() => false);
    }
    if (isTerminalUploadError(error)) {
      await rejectAndClean(intent, error.intentStatus, storage, options);
    }
    throw error;
  }
}

/**
 * Bounded maintenance for abandoned upload staging objects. The database state
 * is claimed first with SKIP LOCKED; failed object deletions remain retryable.
 */
export async function cleanupExpiredDirectIntegrationUploadIntents(
  input: { limit?: number } = {},
  options: DirectUploadMaintenanceOptions = {}
): Promise<{ scanned: number; deleted: number; failed: number }> {
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw directUploadError("INVALID_INPUT", "Direct upload cleanup limit must be between 1 and 500");
  }
  const now = currentTime(options);
  // RLS maintenance mode: this bounded janitor sweeps expired upload intents
  // across every archive in one locked scan, so no single archive scope can
  // describe its FOR UPDATE locks and expiry updates.
  const candidates = await withTransaction(withRlsMaintenanceMode(options), async (client) => {
    const selected = await client.query<UploadIntentRow & { archive_id: string }>(
      `SELECT intent.*
       FROM integration_upload_intents intent
       WHERE intent.staging_deleted_at IS NULL
         AND intent.expires_at <= $1
         AND intent.status IN ('pending', 'completed', 'expired', 'rejected')
         AND NOT EXISTS (
           SELECT 1 FROM integration_artifacts artifact
           WHERE artifact.archive_id = intent.archive_id
             AND artifact.artifact_key = intent.staging_key
             AND artifact.state <> 'abandoned'
         )
         AND NOT EXISTS (
           SELECT 1 FROM integration_snapshots snapshot
           WHERE snapshot.archive_id = intent.archive_id
             AND snapshot.artifact_key = intent.staging_key
         )
         AND NOT EXISTS (
           SELECT 1 FROM integration_upload_intents live_intent
           WHERE live_intent.archive_id = intent.archive_id
             AND live_intent.staging_key = intent.staging_key
             AND live_intent.id <> intent.id
             AND live_intent.staging_deleted_at IS NULL
             AND live_intent.expires_at > $1
             AND live_intent.status IN ('pending', 'completed')
         )
       ORDER BY intent.expires_at, intent.archive_id, intent.id
       LIMIT $2
       FOR UPDATE OF intent SKIP LOCKED`,
      [now.toISOString(), limit]
    );
    for (const intent of selected.rows) {
      if (intent.status !== "pending") continue;
      await client.query(
        `UPDATE integration_upload_intents
         SET status = 'expired', consumed_at = $3, updated_at = $3
         WHERE archive_id = $1 AND id = $2 AND status = 'pending'`,
        [intent.archive_id, intent.id, now.toISOString()]
      );
      intent.status = "expired";
      intent.consumed_at = now;
    }
    return selected.rows;
  });

  const storage = configuredObjectStorage(options);
  let deleted = 0;
  let failed = 0;
  for (const intent of candidates) {
    try {
      await storage.delete({ archiveId: intent.archive_id, key: intent.staging_key });
      await markStagingObjectDeleted(intent.archive_id, intent.id, intent.staging_key, options);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { scanned: candidates.length, deleted, failed };
}

async function finalizeIntent(
  connectionId: string,
  initialIntent: UploadIntentRow,
  sha256: string,
  promotedKey: string,
  promotedMetadata: PrivateObjectMetadata & { etag: string },
  storage: ArchiveObjectStorage,
  options: DirectIntegrationUploadOptions
): Promise<{ artifact: IntegrationArtifact; replayed: boolean }> {
  const archiveId = required(options.archiveId, "archiveId");
  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    const selected = await client.query<UploadIntentRow>(
      `SELECT * FROM integration_upload_intents
       WHERE archive_id = $1 AND connection_id = $2 AND id = $3
       FOR UPDATE`,
      [archiveId, connectionId, initialIntent.id]
    );
    const intent = selected.rows[0];
    if (!intent) throw directUploadError("NOT_FOUND", "Upload intent not found");
    if (intent.status === "completed" && intent.artifact_id) {
      const replayArtifact = await requireArtifactRow(client, archiveId, connectionId, intent.artifact_id);
      return {
        artifact: mapArtifact(replayArtifact, intent.artifact_duplicate),
        replayed: true
      };
    }
    if (intent.status !== "pending") {
      throw directUploadError("INVALID_STATE", "Upload intent has already been consumed");
    }
    if (isExpired(intent, currentTime(options))) {
      throw terminalUploadError("UPLOAD_EXPIRED", "Upload intent expired before completion", "expired");
    }
    if (
      intent.staging_key !== initialIntent.staging_key
      || intent.file_name !== initialIntent.file_name
      || intent.content_type !== initialIntent.content_type
      || Number(intent.declared_size_bytes) !== Number(initialIntent.declared_size_bytes)
      || intent.media_rights_acknowledgement_version !== initialIntent.media_rights_acknowledgement_version
      || intent.media_rights_acknowledged_by !== initialIntent.media_rights_acknowledged_by
      || nullableIso(intent.media_rights_acknowledged_at) !== nullableIso(initialIntent.media_rights_acknowledged_at)
    ) {
      throw terminalUploadError("ARTIFACT_INTEGRITY", "Upload intent changed during completion", "rejected");
    }
    await requireEnabledConnection(client, archiveId, connectionId, options);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      promotedKey
    ]);
    const durableMetadata = await statPrivateUpload(storage, archiveId, promotedKey);
    if (!durableMetadata || objectChanged(promotedMetadata, durableMetadata)) {
      throw terminalUploadError(
        "ARTIFACT_INTEGRITY",
        "Promoted private artifact changed before it could be committed",
        "rejected"
      );
    }
    validateObjectMetadata(intent, durableMetadata);

    const existingResult = await client.query<ArtifactRow>(
      `SELECT * FROM integration_artifacts
       WHERE archive_id = $1 AND connection_id = $2 AND sha256 = $3
       FOR UPDATE`,
      [archiveId, connectionId, sha256]
    );
    let artifactRow = existingResult.rows[0];
    const duplicate = Boolean(artifactRow);

    if (artifactRow && artifactRow.state !== "abandoned") {
      const refreshed = await client.query<ArtifactRow>(
        `UPDATE integration_artifacts
         SET artifact_key = $4,
             media_rights_acknowledgement_version = $5,
             media_rights_acknowledged_by = $6,
             media_rights_acknowledged_at = $7,
             updated_at = now()
         WHERE archive_id = $1 AND connection_id = $2 AND id = $3
         RETURNING *`,
        [
          archiveId,
          connectionId,
          artifactRow.id,
          promotedKey,
          intent.media_rights_acknowledgement_version,
          intent.media_rights_acknowledged_by,
          intent.media_rights_acknowledged_at
        ]
      );
      artifactRow = refreshed.rows[0];
    } else if (artifactRow?.state === "abandoned") {
      const revived = await client.query<ArtifactRow>(
        `UPDATE integration_artifacts
         SET file_name = $4, artifact_key = $5, content_type = $6, size_bytes = $7,
             state = 'staged', deleted_at = NULL, completed_at = NULL,
             media_rights_acknowledgement_version = $8,
             media_rights_acknowledged_by = $9,
             media_rights_acknowledged_at = $10,
             updated_at = now()
         WHERE archive_id = $1 AND connection_id = $2 AND id = $3
         RETURNING *`,
        [
          archiveId,
          connectionId,
          artifactRow.id,
          initialIntent.file_name,
          promotedKey,
          initialIntent.content_type,
          Number(initialIntent.declared_size_bytes),
          intent.media_rights_acknowledgement_version,
          intent.media_rights_acknowledged_by,
          intent.media_rights_acknowledged_at
        ]
      );
      artifactRow = revived.rows[0];
    } else if (!artifactRow) {
      const inserted = await client.query<ArtifactRow>(
        `INSERT INTO integration_artifacts (
           archive_id, id, connection_id, file_name, artifact_key, sha256,
           content_type, size_bytes, state, media_rights_acknowledgement_version,
           media_rights_acknowledged_by, media_rights_acknowledged_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'staged', $9, $10, $11)
         RETURNING *`,
        [
          archiveId,
          `integration-artifact-${randomUUID()}`,
          connectionId,
          initialIntent.file_name,
          promotedKey,
          sha256,
          initialIntent.content_type,
          Number(initialIntent.declared_size_bytes),
          intent.media_rights_acknowledgement_version,
          intent.media_rights_acknowledged_by,
          intent.media_rights_acknowledged_at
        ]
      );
      artifactRow = inserted.rows[0];
    }

    const completedAt = currentTime(options).toISOString();
    const consumed = await client.query<UploadIntentRow>(
      `UPDATE integration_upload_intents
       SET status = 'completed', artifact_id = $4, artifact_duplicate = $5,
           consumed_at = $6, updated_at = $6
       WHERE archive_id = $1 AND connection_id = $2 AND id = $3 AND status = 'pending'
       RETURNING *`,
      [archiveId, connectionId, initialIntent.id, artifactRow.id, duplicate, completedAt]
    );
    if (consumed.rowCount !== 1) {
      throw directUploadError("INVALID_STATE", "Upload intent could not be consumed");
    }
    return {
      artifact: mapArtifact(artifactRow, duplicate),
      replayed: false
    };
  });
}

async function getUploadIntent(
  connectionId: string,
  intentId: string,
  options: DirectIntegrationUploadOptions
): Promise<UploadIntentRow> {
  const result = await query<UploadIntentRow>(
    `SELECT * FROM integration_upload_intents
     WHERE archive_id = $1 AND connection_id = $2 AND id = $3`,
    [required(options.archiveId, "archiveId"), connectionId, intentId],
    options
  );
  if (!result.rows[0]) throw directUploadError("NOT_FOUND", "Upload intent not found");
  return result.rows[0];
}

async function hashAndInspectObject(
  intent: UploadIntentRow,
  storage: ArchiveObjectStorage,
  options: DirectIntegrationUploadOptions,
  key = intent.staging_key
): Promise<{ sha256: string }> {
  let stream: AsyncIterable<Uint8Array>;
  try {
    stream = await storage.stream({
      archiveId: required(options.archiveId, "archiveId"),
      key
    });
  } catch (error) {
    throw directUploadError("STORAGE_UNAVAILABLE", "Private upload could not be streamed", error);
  }
  const hash = createHash("sha256");
  const signatureParts: Buffer[] = [];
  let signatureBytes = 0;
  let totalBytes = 0;
  try {
    for await (const value of stream) {
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maximumDirectIntegrationArtifactBytes || totalBytes > Number(intent.declared_size_bytes)) {
        throw terminalUploadError("ARTIFACT_INTEGRITY", "Uploaded object exceeds its declared size", "rejected");
      }
      hash.update(chunk);
      if (signatureBytes < maximumSignatureBytes) {
        const prefix = chunk.subarray(0, maximumSignatureBytes - signatureBytes);
        signatureParts.push(prefix);
        signatureBytes += prefix.byteLength;
      }
    }
  } catch (error) {
    if (isTerminalUploadError(error)) throw error;
    throw directUploadError("STORAGE_UNAVAILABLE", "Private upload stream failed", error);
  }
  if (totalBytes !== Number(intent.declared_size_bytes)) {
    throw terminalUploadError("ARTIFACT_INTEGRITY", "Uploaded object size does not match its declaration", "rejected");
  }
  validateContentSignature(intent.file_name, Buffer.concat(signatureParts, signatureBytes));
  return { sha256: hash.digest("hex") };
}

async function promotePrivateUpload(
  intent: UploadIntentRow,
  sha256: string,
  sourceMetadata: PrivateObjectMetadata,
  sourceEtag: string,
  promotionState: { attempted: boolean; key?: string },
  storage: ArchiveObjectStorage,
  options: DirectIntegrationUploadOptions
): Promise<{ key: string }> {
  const archiveId = required(options.archiveId, "archiveId");
  let promoted: { key: string };
  promotionState.attempted = true;
  promotionState.key = `archives/${archiveId}/integration-artifacts/${sha256}`;
  try {
    promoted = await storage.promote({
      archiveId,
      sourceKey: intent.staging_key,
      purpose: "integration-artifacts",
      sha256,
      contentType: intent.content_type,
      expectedSourceEtag: sourceEtag
    });
    promotionState.key = promoted.key;
  } catch (error) {
    const latest = await statPrivateUpload(storage, archiveId, intent.staging_key);
    if (!latest || objectChanged(sourceMetadata, latest)) {
      throw terminalUploadError(
        "ARTIFACT_INTEGRITY",
        "The uploaded object changed during promotion",
        "rejected"
      );
    }
    throw directUploadError("STORAGE_UNAVAILABLE", "Private upload promotion failed", error);
  }
  const latest = await statPrivateUpload(storage, archiveId, intent.staging_key);
  if (!latest || objectChanged(sourceMetadata, latest)) {
    throw terminalUploadError(
      "ARTIFACT_INTEGRITY",
      "The uploaded object changed during promotion",
      "rejected"
    );
  }
  return promoted;
}

async function verifyPromotedArtifact(
  intent: UploadIntentRow,
  promotedKey: string,
  expectedSha256: string,
  storage: ArchiveObjectStorage,
  options: DirectIntegrationUploadOptions
): Promise<PrivateObjectMetadata & { etag: string }> {
  const archiveId = required(options.archiveId, "archiveId");
  const before = await statPrivateUpload(storage, archiveId, promotedKey);
  if (!before) {
    throw directUploadError("STORAGE_UNAVAILABLE", "Promoted private artifact is unavailable");
  }
  validateObjectMetadata(intent, before);
  const inspected = await hashAndInspectObject(intent, storage, options, promotedKey);
  if (inspected.sha256 !== expectedSha256) {
    throw terminalUploadError(
      "ARTIFACT_INTEGRITY",
      "Promoted private artifact failed hash verification",
      "rejected"
    );
  }
  const after = await statPrivateUpload(storage, archiveId, promotedKey);
  if (!after || objectChanged(before, after)) {
    throw terminalUploadError(
      "ARTIFACT_INTEGRITY",
      "Promoted private artifact changed during verification",
      "rejected"
    );
  }
  validateObjectMetadata(intent, after);
  if (!after.etag) {
    throw directUploadError(
      "STORAGE_UNAVAILABLE",
      "Promoted private artifact did not provide a stable object identity"
    );
  }
  return { ...after, etag: after.etag };
}

async function deletePromotedArtifactIfUnreferenced(
  promotedKey: string,
  storage: ArchiveObjectStorage,
  options: DirectIntegrationUploadOptions
): Promise<boolean> {
  const archiveId = required(options.archiveId, "archiveId");
  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [promotedKey]);
    const references = await client.query<{ total: number | string }>(
      `SELECT (
         (SELECT count(*) FROM integration_artifacts
          WHERE archive_id = $1 AND artifact_key = $2 AND state <> 'abandoned')
         +
         (SELECT count(*) FROM integration_snapshots
          WHERE archive_id = $1 AND artifact_key = $2)
       )::integer AS total`,
      [archiveId, promotedKey]
    );
    if (Number(references.rows[0]?.total ?? 0) > 0) return false;
    await storage.delete({ archiveId, key: promotedKey });
    return true;
  });
}

async function statPrivateUpload(
  storage: ArchiveObjectStorage,
  archiveId: string,
  stagingKey: string
): Promise<PrivateObjectMetadata | undefined> {
  try {
    return await storage.stat({ archiveId, key: stagingKey });
  } catch (error) {
    throw directUploadError("STORAGE_UNAVAILABLE", "Private upload metadata is unavailable", error);
  }
}

function validateObjectMetadata(intent: UploadIntentRow, metadata: PrivateObjectMetadata): void {
  if (metadata.size !== Number(intent.declared_size_bytes)) {
    throw terminalUploadError("ARTIFACT_INTEGRITY", "Private object size does not match its declaration", "rejected");
  }
  if (storedContentType(metadata.contentType) !== intent.content_type) {
    throw terminalUploadError("ARTIFACT_INTEGRITY", "Private object content type does not match its declaration", "rejected");
  }
}

function objectChanged(before: PrivateObjectMetadata, after: PrivateObjectMetadata): boolean {
  return before.size !== after.size
    || storedContentType(before.contentType) !== storedContentType(after.contentType)
    || (Boolean(before.etag || after.etag) && before.etag !== after.etag);
}

function storedContentType(value: string | undefined): string {
  if (!value || value.length > 255 || /[\0\r\n;]/.test(value)) return "";
  return value.trim().toLowerCase();
}

async function rejectAndClean(
  intent: UploadIntentRow,
  status: "rejected" | "expired",
  storage: ArchiveObjectStorage,
  options: DirectIntegrationUploadOptions
): Promise<void> {
  const consumed = await consumePendingIntent(intent, status, options).catch(() => false);
  if (consumed && isExpired(intent, currentTime(options))) {
    const archiveId = required(options.archiveId, "archiveId");
    const deleted = await storage.delete({ archiveId, key: intent.staging_key })
      .then(() => true, () => false);
    if (deleted) await markStagingObjectDeleted(archiveId, intent.id, intent.staging_key, options);
  }
}

async function markStagingObjectDeleted(
  archiveId: string,
  intentId: string,
  stagingKey: string,
  options: DatabaseOptions
): Promise<void> {
  await query(
    `UPDATE integration_upload_intents
     SET staging_deleted_at = COALESCE(staging_deleted_at, now()), updated_at = now()
     WHERE archive_id = $1 AND id = $2 AND staging_key = $3 AND status <> 'pending'`,
    [archiveId, intentId, stagingKey],
    withRlsArchiveScope(options, archiveId)
  );
}

async function consumePendingIntent(
  intent: UploadIntentRow,
  status: "rejected" | "expired",
  options: DirectIntegrationUploadOptions
): Promise<boolean> {
  const result = await query(
    `UPDATE integration_upload_intents
     SET status = $4, consumed_at = $5, updated_at = $5
     WHERE archive_id = $1 AND connection_id = $2 AND id = $3 AND status = 'pending'`,
    [
      required(options.archiveId, "archiveId"),
      intent.connection_id,
      intent.id,
      status,
      currentTime(options).toISOString()
    ],
    withRlsArchiveScope(options, required(options.archiveId, "archiveId"))
  );
  return result.rowCount === 1;
}

async function requireEnabledConnection(
  client: PoolClient,
  archiveId: string,
  connectionId: string,
  options: DirectIntegrationUploadOptions
): Promise<IntegrationProvider> {
  const connection = await client.query<{ provider: IntegrationProvider }>(
    `SELECT provider FROM integration_connections
     WHERE archive_id = $1 AND id = $2 AND status = 'active'
     FOR SHARE`,
    [archiveId, connectionId]
  );
  if (!connection.rows[0]) throw directUploadError("NOT_FOUND", "Data source not found");
  if (!isIntegrationProviderEnabled(
    connection.rows[0].provider,
    resolveIntegrationFeatureFlags(options.featureFlags)
  )) {
    throw directUploadError("FEATURE_DISABLED", "This data-source provider is disabled");
  }
  return connection.rows[0].provider;
}

async function requireArtifactRow(
  client: PoolClient,
  archiveId: string,
  connectionId: string,
  artifactId: string
): Promise<ArtifactRow> {
  const result = await client.query<ArtifactRow>(
    `SELECT * FROM integration_artifacts
     WHERE archive_id = $1 AND connection_id = $2 AND id = $3 AND state <> 'abandoned'`,
    [archiveId, connectionId, artifactId]
  );
  if (!result.rows[0]) throw directUploadError("NOT_FOUND", "Completed artifact not found");
  return result.rows[0];
}

function validateUploadDeclaration(input: StageDirectIntegrationUploadInput): {
  fileName: string;
  contentType: string;
  size: number;
  extension: ".ged" | ".gedcom" | ".zip";
} {
  const fileName = required(input.fileName, "file name");
  if (fileName.length > 240 || /[\\/\0\r\n]/.test(fileName)) {
    throw directUploadError("INVALID_INPUT", "Upload file name is invalid");
  }
  const extensionMatch = fileName.toLowerCase().match(/(\.gedcom|\.ged|\.zip)$/);
  if (!extensionMatch) throw directUploadError("UNSUPPORTED_MEDIA", "Only GEDCOM and ZIP packages are supported");
  const extension = extensionMatch[1] as ".ged" | ".gedcom" | ".zip";
  const contentType = normalizeContentType(required(input.contentType, "content type"));
  const allowed = extension === ".zip"
    ? new Set(["application/zip", "application/x-zip-compressed", "application/octet-stream"])
    : new Set(["text/plain", "text/x-gedcom", "application/gedcom", "application/x-gedcom", "application/octet-stream"]);
  if (!allowed.has(contentType)) {
    throw directUploadError("UNSUPPORTED_MEDIA", "File extension and content type do not match");
  }
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > maximumDirectIntegrationArtifactBytes) {
    throw directUploadError("INVALID_INPUT", "Upload size is outside the configured limit");
  }
  return { fileName, contentType, size: input.size, extension };
}

function validateContentSignature(fileName: string, prefix: Buffer): void {
  if (
    (prefix[0] === 0x4d && prefix[1] === 0x5a)
    || (prefix[0] === 0x7f && prefix.subarray(1, 4).toString("ascii") === "ELF")
    || isMachExecutable(prefix)
  ) {
    throw terminalUploadError("UNSUPPORTED_MEDIA", "Executable content is not accepted", "rejected");
  }
  if (/\.zip$/i.test(fileName)) {
    const zipMagic = prefix.length >= 4
      && prefix[0] === 0x50
      && prefix[1] === 0x4b
      && [0x03, 0x05, 0x07].includes(prefix[2])
      && [0x04, 0x06, 0x08].includes(prefix[3]);
    if (!zipMagic) throw terminalUploadError("UNSUPPORTED_MEDIA", "ZIP signature is invalid", "rejected");
    return;
  }
  if (!/^0 HEAD(?:\r?\n|$)/.test(decodeGedcomSignaturePrefix(prefix))) {
    throw terminalUploadError("UNSUPPORTED_MEDIA", "GEDCOM HEAD signature is invalid", "rejected");
  }
}

function decodeGedcomSignaturePrefix(prefix: Buffer): string {
  if (prefix[0] === 0xff && prefix[1] === 0xfe) {
    return new TextDecoder("utf-16le", { fatal: false }).decode(prefix).replace(/^\uFEFF/, "");
  }
  if (prefix[0] === 0xfe && prefix[1] === 0xff) {
    return new TextDecoder("utf-16be", { fatal: false }).decode(prefix).replace(/^\uFEFF/, "");
  }
  const withoutBom = prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf
    ? prefix.subarray(3)
    : prefix;
  return withoutBom.toString("latin1");
}

function isMachExecutable(prefix: Buffer): boolean {
  if (prefix.length < 4) return false;
  const magic = prefix.readUInt32BE(0);
  return new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]).has(magic);
}

function publicIntent(row: UploadIntentRow): PublicIntegrationUploadIntent {
  return {
    id: row.id,
    connectionId: row.connection_id,
    fileName: row.file_name,
    contentType: row.content_type,
    size: Number(row.declared_size_bytes),
    expiresAt: iso(row.expires_at)
  };
}

function mapArtifact(row: ArtifactRow, duplicate: boolean): IntegrationArtifact {
  return {
    id: row.id,
    connectionId: row.connection_id,
    fileName: row.file_name,
    contentType: row.content_type,
    size: Number(row.size_bytes),
    sha256: row.sha256,
    artifactKey: row.artifact_key,
    state: row.state,
    duplicate,
    ...(row.media_rights_acknowledgement_version
      && row.media_rights_acknowledged_by
      && row.media_rights_acknowledged_at
      ? {
          mediaRightsAcknowledgement: {
            version: row.media_rights_acknowledgement_version,
            actorId: row.media_rights_acknowledged_by,
            acknowledgedAt: iso(row.media_rights_acknowledged_at)
          }
        }
      : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function withDuplicate(artifact: IntegrationArtifact, duplicate: boolean): IntegrationArtifact {
  return { ...artifact, duplicate };
}

function configuredTicketIssuer(options: DirectIntegrationUploadOptions): DirectUploadTicketIssuer {
  try {
    return options.ticketIssuer ?? createConfiguredDirectUploadTicketIssuer();
  } catch (error) {
    throw directUploadError("STORAGE_UNAVAILABLE", "Private direct uploads are not configured", error);
  }
}

function configuredObjectStorage(options: { objectStorage?: ArchiveObjectStorage }): ArchiveObjectStorage {
  try {
    return options.objectStorage ?? createConfiguredArchiveObjectStorage();
  } catch (error) {
    throw directUploadError("STORAGE_UNAVAILABLE", "Private object storage is not configured", error);
  }
}

function normalizeIntentLifetime(value: number | undefined): number {
  const lifetime = value ?? defaultIntentLifetimeMilliseconds;
  if (!Number.isSafeInteger(lifetime) || lifetime < 1_000 || lifetime > 15 * 60 * 1000) {
    throw directUploadError("INVALID_INPUT", "Upload intent lifetime is invalid");
  }
  return lifetime;
}

function normalizeContentType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 255 || /[\0\r\n;]/.test(normalized)) {
    throw directUploadError("INVALID_INPUT", "Upload content type is invalid");
  }
  return normalized;
}

function currentTime(options: { now?: () => Date }): Date {
  return options.now?.() ?? new Date();
}

function isExpired(intent: UploadIntentRow, now: Date): boolean {
  return new Date(intent.expires_at).getTime() <= now.getTime();
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw directUploadError("INVALID_INPUT", `${label} is required`);
  return normalized;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

type DirectUploadError = Error & {
  code: string;
  cause?: unknown;
  terminalUpload?: true;
  intentStatus?: "rejected" | "expired";
};

function directUploadError(code: string, message: string, cause?: unknown): DirectUploadError {
  return Object.assign(new Error(message), { code, ...(cause === undefined ? {} : { cause }) });
}

function terminalUploadError(
  code: string,
  message: string,
  intentStatus: "rejected" | "expired"
): DirectUploadError {
  return Object.assign(directUploadError(code, message), { terminalUpload: true as const, intentStatus });
}

function isTerminalUploadError(error: unknown): error is DirectUploadError & {
  terminalUpload: true;
  intentStatus: "rejected" | "expired";
} {
  return error instanceof Error
    && (error as DirectUploadError).terminalUpload === true
    && Boolean((error as DirectUploadError).intentStatus);
}
