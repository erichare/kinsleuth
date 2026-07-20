import { randomUUID } from "node:crypto";

import { withTransaction } from "../db";
// Imported from ../db-rls directly so unit tests that mock "@/lib/db" keep
// the real scope helper.
import { withRlsArchiveScope } from "../db-rls";
import { syncChangeSearchProjection } from "./change-search";
import {
  DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
  validatePreparedIntegrationMediaObject,
  type PreparedIntegrationMediaObject
} from "./media-store";
import {
  lockIntegrationMediaWriteClaimsForCommit,
  releaseCommittedIntegrationMediaWriteClaims
} from "./media-claims";
import {
  getIntegrationSnapshot,
  getSyncRun,
  type AddSyncChangeInput,
  type CreateIntegrationSnapshotInput,
  type IntegrationStoreOptions
} from "./store";

export type PreparationExternalRef = {
  entityType: string;
  externalId: string;
  localEntityId: string;
};

export type CommitIntegrationPreparationInput = {
  runId: string;
  connectionId: string;
  artifactId: string;
  snapshot: CreateIntegrationSnapshotInput;
  changes: AddSyncChangeInput[];
  externalRefs: PreparationExternalRef[];
  mediaObjects?: PreparedIntegrationMediaObject[];
  leaseFence?: { jobId: string; leaseToken: string };
};

const entityTypes = new Set(["person", "family", "fact", "relationship", "source", "citation", "media"]);
const classifications = new Set(["remote_only", "local_only", "same", "conflict", "deletion"]);
const proposedActions = new Set(["accept_incoming", "keep_local", "no_op", "review"]);
const writeBatchSize = 500;

/**
 * Publishes a parsed snapshot only after every review row and stable reference
 * is durable. A cancelled or reclaimed run therefore cannot expose a partial
 * review workspace.
 */
export async function commitIntegrationPreparation(
  input: CommitIntegrationPreparationInput,
  options: IntegrationStoreOptions
) {
  const archiveId = required(options.archiveId, "archiveId");
  const runId = required(input.runId, "sync run id");
  const connectionId = required(input.connectionId, "connection id");
  const artifactId = required(input.artifactId, "artifact id");
  const leaseFence = input.leaseFence
    ? {
        jobId: required(input.leaseFence.jobId, "lease job id"),
        leaseToken: required(input.leaseFence.leaseToken, "lease token")
      }
    : undefined;
  if (input.snapshot.connectionId !== connectionId) {
    throw preparationError("INVALID_INPUT", "snapshot connection does not match the sync run");
  }
  validateSnapshot(input.snapshot);
  input.changes.forEach(validateChange);
  input.externalRefs.forEach(validateExternalRef);
  assertUniqueExternalRefs(input.externalRefs);
  const mediaObjects = input.mediaObjects ?? [];
  mediaObjects.forEach(validatePreparedIntegrationMediaObject);

  const committed = await withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    if (leaseFence) {
      const activeLease = await client.query<{ id: string }>(
        `SELECT id FROM durable_jobs
         WHERE archive_id = $1 AND id = $2 AND state = 'running'
           AND lease_token = $3 AND lease_expires_at > clock_timestamp()
         FOR UPDATE`,
        [archiveId, leaseFence.jobId, leaseFence.leaseToken]
      );
      if (!activeLease.rows[0]) {
        throw preparationError("LEASE_LOST", "worker lease expired before preparation could be published");
      }
    }
    const selectedRun = await client.query<{
      connection_id: string;
      artifact_id: string | null;
      status: string;
      provider: string;
      media_rights_acknowledgement_version: string | null;
      media_rights_acknowledged_by: string | null;
      media_rights_acknowledged_at: Date | string | null;
    }>(
      `SELECT run.connection_id, run.artifact_id, run.status, connection.provider,
              run.media_rights_acknowledgement_version,
              run.media_rights_acknowledged_by,
              run.media_rights_acknowledged_at
       FROM sync_runs run
       JOIN integration_connections connection
         ON connection.archive_id = run.archive_id AND connection.id = run.connection_id
       WHERE run.archive_id = $1 AND run.id = $2
       FOR UPDATE`,
      [archiveId, runId]
    );
    const run = selectedRun.rows[0];
    if (!run) throw preparationError("NOT_FOUND", "sync run not found");
    if (run.connection_id !== connectionId || run.artifact_id !== artifactId) {
      throw preparationError("INVALID_INPUT", "preparation does not belong to this sync run");
    }
    if (run.status !== "parsing") {
      throw preparationError(
        run.status === "cancelled" || run.status === "cancel_requested" ? "RUN_CANCELLED" : "RUN_STATE",
        "sync run is not available for preparation"
      );
    }
    if (mediaObjects.length > 0 && (
      !["family_tree_maker", "rootsmagic"].includes(run.provider)
      || run.media_rights_acknowledgement_version !== DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION
      || !run.media_rights_acknowledged_by
      || !run.media_rights_acknowledged_at
    )) {
      throw preparationError("MEDIA_RETENTION_NOT_AUTHORIZED", "media retention is not authorized for this refresh");
    }

    const selectedArtifact = await client.query<{ id: string; sha256: string }>(
      `SELECT id, sha256
       FROM integration_artifacts
       WHERE archive_id = $1 AND id = $2 AND connection_id = $3
         AND state IN ('staged', 'quarantined')
       FOR UPDATE`,
      [archiveId, artifactId, connectionId]
    );
    if (!selectedArtifact.rows[0]) {
      throw preparationError("RUN_STATE", "staged artifact is not available for preparation");
    }

    const snapshotId = `integration-snapshot-${randomUUID()}`;
    const insertedSnapshot = await client.query<{ id: string }>(
      `INSERT INTO integration_snapshots (
         archive_id, id, connection_id, artifact_key, sha256, parser_version,
         counts, warnings, source_metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
       ON CONFLICT (archive_id, connection_id, sha256) DO NOTHING
       RETURNING id`,
      [
        archiveId,
        snapshotId,
        connectionId,
        input.snapshot.artifactKey,
        input.snapshot.sha256,
        input.snapshot.parserVersion,
        JSON.stringify(input.snapshot.counts),
        JSON.stringify(input.snapshot.warnings),
        JSON.stringify(input.snapshot.sourceMetadata)
      ]
    );
    const duplicate = !insertedSnapshot.rows[0];
    const effectiveSnapshotId = insertedSnapshot.rows[0]?.id ?? (await client.query<{ id: string }>(
      `SELECT id FROM integration_snapshots
       WHERE archive_id = $1 AND connection_id = $2 AND sha256 = $3`,
      [archiveId, connectionId, input.snapshot.sha256]
    )).rows[0]?.id;
    if (!effectiveSnapshotId) {
      throw new Error("Unable to resolve immutable integration snapshot");
    }

    // Retry preparation always replaces its private draft rows; none become
    // visible as review-ready until the final run transition below.
    await client.query(
      "DELETE FROM sync_changes WHERE archive_id = $1 AND run_id = $2",
      [archiveId, runId]
    );
    const changeRows = input.changes.map((change, index) => ({
      id: `sync-change-${randomUUID()}`,
      entity_type: change.entityType,
      external_id: change.externalId ?? null,
      local_entity_id: change.localEntityId ?? null,
      base_hash: change.baseHash ?? null,
      local_hash: change.localHash ?? null,
      incoming_hash: change.incomingHash ?? null,
      classification: change.classification,
      proposed_action: change.proposedAction,
      resolution_payload: change.resolutionPayload ?? {},
      search_projection: syncChangeSearchProjection(change),
      sort_order: index
    }));
    for (const batch of batches(changeRows, writeBatchSize)) {
      await client.query(
        `INSERT INTO sync_changes (
           archive_id, id, run_id, entity_type, external_id, local_entity_id,
           base_hash, local_hash, incoming_hash, classification, proposed_action,
           resolution_payload, search_projection, sort_order
         )
         SELECT $1, row.id, $2, row.entity_type, row.external_id, row.local_entity_id,
           row.base_hash, row.local_hash, row.incoming_hash, row.classification,
           row.proposed_action, row.resolution_payload, row.search_projection, row.sort_order
         FROM jsonb_to_recordset($3::jsonb) AS row(
           id text, entity_type text, external_id text, local_entity_id text,
           base_hash text, local_hash text, incoming_hash text, classification text,
           proposed_action text, resolution_payload jsonb, search_projection text, sort_order integer
         )`,
        [archiveId, runId, JSON.stringify(batch)]
      );
    }

    // Identity mappings remain draft evidence inside sync_changes until the
    // user applies this review. A cancelled or rejected preview must never
    // alter the connection's remembered matching state.

    if (mediaObjects.length > 0) {
      await lockIntegrationMediaWriteClaimsForCommit(client, {
        archiveId,
        runId,
        mediaObjects
      });
      for (const media of mediaObjects) {
        if (media.objectKey !== `archives/${archiveId}/integration-media/${media.sha256}`) {
          throw preparationError("ARTIFACT_INTEGRITY", "private media storage returned an invalid identity");
        }
      }
      const mediaRows = mediaObjects.map((media) => ({
        id: `integration-media-${randomUUID()}`,
        object_key: media.objectKey,
        source_gedcom_path: media.sourceGedcomPath,
        source_normalized_path: media.sourceNormalizedPath,
        source_archive_path: media.sourceArchivePath,
        sha256: media.sha256,
        mime_type: media.mimeType,
        size_bytes: media.size
      }));
      for (const batch of batches(mediaRows, writeBatchSize)) {
        await client.query(
          `INSERT INTO integration_media_objects (
             archive_id, id, connection_id, snapshot_id, run_id, artifact_id,
             object_key, source_provider, source_artifact_sha256,
             source_gedcom_path, source_normalized_path, source_archive_path,
             sha256, mime_type, size_bytes,
             rights_acknowledgement_version, rights_acknowledged_by, rights_acknowledged_at
           )
           SELECT $1, row.id, $2, $3, $4, $5,
             row.object_key, $6, $7,
             row.source_gedcom_path, row.source_normalized_path, row.source_archive_path,
             row.sha256, row.mime_type, row.size_bytes,
             $8, $9, $10::timestamptz
           FROM jsonb_to_recordset($11::jsonb) AS row(
             id text, object_key text, source_gedcom_path text,
             source_normalized_path text, source_archive_path text,
             sha256 text, mime_type text, size_bytes bigint
           )
           ON CONFLICT (archive_id, snapshot_id, source_normalized_path) DO NOTHING`,
          [
            archiveId,
            connectionId,
            effectiveSnapshotId,
            runId,
            artifactId,
            run.provider,
            selectedArtifact.rows[0].sha256,
            run.media_rights_acknowledgement_version,
            run.media_rights_acknowledged_by,
            run.media_rights_acknowledged_at,
            JSON.stringify(batch)
          ]
        );
      }
      const published = await client.query<{
        source_normalized_path: string;
        object_key: string;
        sha256: string;
        mime_type: string;
        size_bytes: number | string;
      }>(
        `SELECT source_normalized_path, object_key, sha256, mime_type, size_bytes
         FROM integration_media_objects
         WHERE archive_id = $1 AND snapshot_id = $2
           AND source_normalized_path = ANY($3::text[])`,
        [archiveId, effectiveSnapshotId, mediaObjects.map((media) => media.sourceNormalizedPath)]
      );
      const publishedByPath = new Map(published.rows.map((row) => [row.source_normalized_path, row]));
      for (const media of mediaObjects) {
        const row = publishedByPath.get(media.sourceNormalizedPath);
        if (
          !row
          || row.object_key !== media.objectKey
          || row.sha256 !== media.sha256
          || row.mime_type !== media.mimeType
          || Number(row.size_bytes) !== media.size
        ) {
          throw preparationError("ARTIFACT_INTEGRITY", "published media metadata does not match private storage");
        }
      }
      await releaseCommittedIntegrationMediaWriteClaims(client, {
        archiveId,
        runId,
        objectKeys: mediaObjects.map((media) => media.objectKey)
      });
    }

    await client.query(
      `UPDATE integration_artifacts
       SET state = 'ready', completed_at = now(), updated_at = now()
       WHERE archive_id = $1 AND id = $2`,
      [archiveId, artifactId]
    );
    const updatedRun = await client.query<{ id: string }>(
      `UPDATE sync_runs
       SET incoming_snapshot_id = $3, status = 'review_ready',
           error_code = NULL, error_message = NULL, updated_at = now()
       WHERE archive_id = $1 AND id = $2 AND status = 'parsing'
       RETURNING id`,
      [archiveId, runId, effectiveSnapshotId]
    );
    if (!updatedRun.rows[0]) {
      throw preparationError("RUN_STATE", "sync run changed while preparation was committing");
    }
    return { snapshotId: effectiveSnapshotId, duplicate };
  });

  const [snapshot, run] = await Promise.all([
    getIntegrationSnapshot(committed.snapshotId, options),
    getSyncRun(runId, options)
  ]);
  return { snapshot: { snapshot, duplicate: committed.duplicate }, run };
}

export async function resetIntegrationPreparationForRetry(
  runId: string,
  options: IntegrationStoreOptions
) {
  const archiveId = required(options.archiveId, "archiveId");
  const normalizedRunId = required(runId, "sync run id");
  const state = await withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    const selected = await client.query<{ status: string; artifact_id: string | null }>(
      `SELECT status, artifact_id FROM sync_runs
       WHERE archive_id = $1 AND id = $2
       FOR UPDATE`,
      [archiveId, normalizedRunId]
    );
    const run = selected.rows[0];
    if (!run) throw preparationError("NOT_FOUND", "sync run not found");
    if (run.status === "cancelled" || run.status === "cancel_requested") return "cancelled" as const;
    if (run.status !== "parsing" && run.status !== "failed") {
      throw preparationError("RUN_STATE", "sync run cannot be retried from its current state");
    }
    await client.query("DELETE FROM sync_changes WHERE archive_id = $1 AND run_id = $2", [archiveId, normalizedRunId]);
    if (run.artifact_id) {
      await client.query(
        `UPDATE integration_artifacts
         SET state = 'staged', updated_at = now()
         WHERE archive_id = $1 AND id = $2 AND state IN ('quarantined', 'rejected', 'staged')`,
        [archiveId, run.artifact_id]
      );
    }
    await client.query(
      `UPDATE sync_runs
       SET status = 'queued', incoming_snapshot_id = NULL,
           error_code = NULL, error_message = NULL, updated_at = now()
       WHERE archive_id = $1 AND id = $2`,
      [archiveId, normalizedRunId]
    );
    return "queued" as const;
  });
  return { state, run: await getSyncRun(normalizedRunId, options) };
}

export async function failIntegrationPreparationTerminally(
  runId: string,
  input: { errorCode: string },
  options: IntegrationStoreOptions
) {
  const archiveId = required(options.archiveId, "archiveId");
  const normalizedRunId = required(runId, "sync run id");
  const errorCode = required(input.errorCode, "error code").toLowerCase();
  if (!/^[a-z0-9_]{1,64}$/.test(errorCode)) {
    throw preparationError("INVALID_INPUT", "public error code is invalid");
  }
  const errorMessage = terminalPreparationMessage(errorCode);
  const state = await withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    const selected = await client.query<{ status: string; artifact_id: string | null }>(
      `SELECT status, artifact_id FROM sync_runs
       WHERE archive_id = $1 AND id = $2
       FOR UPDATE`,
      [archiveId, normalizedRunId]
    );
    const run = selected.rows[0];
    if (!run) throw preparationError("NOT_FOUND", "sync run not found");
    if (run.status === "cancelled" || run.status === "cancel_requested") return "cancelled" as const;
    if (run.artifact_id) {
      await client.query(
        `UPDATE integration_artifacts
         SET state = 'rejected', updated_at = now()
         WHERE archive_id = $1 AND id = $2 AND state <> 'abandoned'`,
        [archiveId, run.artifact_id]
      );
    }
    await client.query(
      `UPDATE sync_runs
       SET status = 'failed', error_code = $3,
           error_message = $4,
           updated_at = now()
       WHERE archive_id = $1 AND id = $2`,
      [archiveId, normalizedRunId, errorCode, errorMessage]
    );
    return "failed" as const;
  });
  return { state, run: await getSyncRun(normalizedRunId, options) };
}

/**
 * Repairs the narrow crash window after a durable job reaches `failed` but
 * before the corresponding run and artifact are finalized. Failed jobs remain
 * discoverable by the worker until this transaction completes.
 */
export async function reconcileTerminalIntegrationFailures(
  options: IntegrationStoreOptions
): Promise<number> {
  const archiveId = required(options.archiveId, "archiveId");
  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    const selected = await client.query<{
      id: string;
      artifact_id: string | null;
      error_code: string | null;
    }>(
      `SELECT run.id, run.artifact_id, job.last_error_code AS error_code
       FROM sync_runs run
       JOIN durable_jobs job
         ON job.archive_id = run.archive_id
        AND job.kind = 'integration_snapshot_parse'
        AND job.payload->>'runId' = run.id
       WHERE run.archive_id = $1
         AND run.status IN ('queued', 'parsing')
         AND job.state = 'failed'
       FOR UPDATE OF run SKIP LOCKED`,
      [archiveId]
    );

    for (const run of selected.rows) {
      const errorCode = run.error_code && /^[a-z][a-z0-9_]{0,63}$/.test(run.error_code)
        ? run.error_code
        : "source_package_invalid";
      if (run.artifact_id) {
        await client.query(
          `UPDATE integration_artifacts
           SET state = 'rejected', updated_at = now()
           WHERE archive_id = $1 AND id = $2 AND state <> 'abandoned'`,
          [archiveId, run.artifact_id]
        );
      }
      await client.query(
        `UPDATE sync_runs
         SET status = 'failed', error_code = $3,
             error_message = $4,
             updated_at = now()
         WHERE archive_id = $1 AND id = $2 AND status IN ('queued', 'parsing')`,
        [archiveId, run.id, errorCode, terminalPreparationMessage(errorCode)]
      );
    }

    return selected.rows.length;
  });
}

function terminalPreparationMessage(errorCode: string): string {
  if (errorCode === "media_retention_not_authorized") {
    return "This media package requires the private-media feature to be enabled and a current rights acknowledgement.";
  }
  return "The import package could not be prepared for review.";
}

function validateSnapshot(input: CreateIntegrationSnapshotInput): void {
  required(input.artifactKey, "artifact key");
  required(input.parserVersion, "parser version");
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw preparationError("INVALID_INPUT", "snapshot digest is invalid");
  if (!isRecord(input.counts) || !Array.isArray(input.warnings) || !isRecord(input.sourceMetadata)) {
    throw preparationError("INVALID_INPUT", "snapshot metadata is invalid");
  }
}

function validateChange(input: AddSyncChangeInput): void {
  if (!entityTypes.has(input.entityType)
    || !classifications.has(input.classification)
    || !proposedActions.has(input.proposedAction)) {
    throw preparationError("INVALID_INPUT", "sync change is invalid");
  }
  if (input.classification === "conflict" && input.proposedAction !== "review") {
    throw preparationError("INVALID_INPUT", "conflicts must require review");
  }
  if (input.classification === "deletion" && input.proposedAction !== "keep_local") {
    throw preparationError("INVALID_INPUT", "incoming deletions must keep the local entity");
  }
}

function validateExternalRef(input: PreparationExternalRef): void {
  if (!entityTypes.has(input.entityType)) throw preparationError("INVALID_INPUT", "external entity type is invalid");
  required(input.externalId, "external id");
  required(input.localEntityId, "local entity id");
}

function assertUniqueExternalRefs(inputs: PreparationExternalRef[]): void {
  const keys = new Set<string>();
  for (const input of inputs) {
    const key = `${input.entityType}:${input.externalId}`;
    if (keys.has(key)) {
      throw preparationError("INVALID_INPUT", "external identities must be unique within a snapshot");
    }
    keys.add(key);
  }
}

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw preparationError("INVALID_INPUT", `${label} is required`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function preparationError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
