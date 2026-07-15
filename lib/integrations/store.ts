import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, withTransaction, type DatabaseOptions } from "../db";
import type { PreparedGedcomImport } from "../gedcom/apply";
import {
  applyPreparedGedcomImportInTransaction,
  createWorkspaceBackupInTransaction,
  restoreWorkspaceBackupInTransaction
} from "../workspace-store";
import {
  integrationProviders,
  type ExternalEntityRef,
  type IntegrationCapabilities,
  type IntegrationConnection,
  type IntegrationProvider,
  type IntegrationSnapshot,
  type SyncChange,
  type SyncChangeClassification,
  type SyncProposedAction,
  type SyncResolution,
  type SyncRun
} from "./types";
import { syncChangeSearchProjection } from "./change-search";
import { getIntegrationFeatureFlags, getProviderCapabilities, isIntegrationProviderEnabled } from "./feature-flags";

export {
  createIntegrationArtifact,
  deleteIntegrationArtifact,
  getIntegrationArtifact,
  readIntegrationArtifact,
  setIntegrationArtifactState
} from "./artifact-store";
export type {
  CreateIntegrationArtifactInput,
  IntegrationArtifact,
  IntegrationArtifactState,
  IntegrationArtifactStoreOptions
} from "./artifact-store";

export type {
  ExternalEntityRef,
  IntegrationCapabilities,
  IntegrationConnection,
  IntegrationProvider,
  IntegrationSnapshot,
  SyncChange,
  SyncChangeClassification,
  SyncProposedAction,
  SyncResolution,
  SyncRun
} from "./types";

export type IntegrationStoreOptions = DatabaseOptions & {
  archiveId: string;
};

export type CreateIntegrationConnectionInput = {
  provider: IntegrationProvider | string;
  authority: string;
  displayName: string;
  capabilities?: IntegrationCapabilities;
  remoteAccountId?: string;
  remoteTreeId?: string;
};

export type CreateIntegrationSnapshotInput = {
  connectionId: string;
  artifactKey: string;
  sha256: string;
  parserVersion: string;
  counts: Record<string, number>;
  warnings: string[];
  sourceMetadata: Record<string, unknown>;
};

export type UpsertExternalEntityRefInput = {
  connectionId: string;
  snapshotId: string;
  entityType: string;
  externalId: string;
  localEntityId: string;
};

export type StartSyncRunInput = {
  connectionId: string;
  artifactId?: string;
  baseSnapshotId?: string | null;
  incomingSnapshotId?: string | null;
  declaredAuthority?: string;
  mediaRightsAcknowledgement?: {
    accepted: true;
    version: string;
    actorId: string;
  };
};

export type AddSyncChangeInput = {
  entityType: string;
  externalId?: string | null;
  localEntityId?: string | null;
  baseHash?: string | null;
  localHash?: string | null;
  incomingHash?: string | null;
  classification: SyncChangeClassification;
  proposedAction: SyncProposedAction;
  resolutionPayload?: Record<string, unknown>;
};

export type SyncResolutionInput = {
  changeId: string;
  resolution?: SyncResolution;
  action?: SyncResolution;
  localEntityId?: string;
  fields?: Record<string, "accept_incoming" | "keep_local">;
};

export type SyncChangeSummary = {
  total: number;
  filtered: number;
  unresolved: number;
  byClassification: Record<SyncChangeClassification, number>;
};

export type ApplySyncRunInput = {
  idempotencyKey: string;
  backupId?: string;
  acceptAllSafeIncoming?: boolean;
  resolutions?: SyncResolutionInput[];
  preparedImport?: PreparedGedcomImport;
  expectedArchiveUpdatedAt?: string;
};

export type RollbackSyncRunInput = {
  idempotencyKey: string;
  actorId?: string;
  restoreBackup?: boolean;
};

type ConnectionRow = {
  id: string;
  provider: IntegrationProvider;
  authority: string;
  display_name: string;
  status: IntegrationConnection["status"];
  capabilities: IntegrationCapabilities;
  remote_account_id: string | null;
  remote_tree_id: string | null;
  last_applied_snapshot_id: string | null;
  last_refreshed_at: Date | string | null;
  disconnected_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type SnapshotRow = {
  id: string;
  connection_id: string;
  artifact_key: string;
  sha256: string;
  parser_version: string;
  counts: Record<string, number>;
  warnings: string[];
  source_metadata: Record<string, unknown>;
  created_at: Date | string;
};

type ExternalRefRow = {
  id: string;
  connection_id: string;
  snapshot_id: string;
  entity_type: string;
  external_id: string;
  local_entity_id: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type SyncRunRow = {
  id: string;
  connection_id: string;
  artifact_id: string | null;
  base_snapshot_id: string | null;
  incoming_snapshot_id: string | null;
  status: SyncRun["status"];
  apply_idempotency_key: string | null;
  apply_request_hash: string | null;
  backup_id: string | null;
  applied_change_count: number;
  applied_at: Date | string | null;
  applied_archive_updated_at: Date | string | null;
  rollback_idempotency_key: string | null;
  rollback_request_hash: string | null;
  rolled_back_at: Date | string | null;
  rolled_back_by: string | null;
  cancel_requested_at: Date | string | null;
  error_code: string | null;
  error_message: string | null;
  media_rights_acknowledgement_version: string | null;
  media_rights_acknowledged_by: string | null;
  media_rights_acknowledged_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type SyncChangeRow = {
  id: string;
  run_id: string;
  entity_type: string;
  external_id: string | null;
  local_entity_id: string | null;
  base_hash: string | null;
  local_hash: string | null;
  incoming_hash: string | null;
  classification: SyncChangeClassification;
  proposed_action: SyncProposedAction;
  resolution: SyncResolution | null;
  resolution_payload: Record<string, unknown>;
  sort_order: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const entityTypes = new Set(["person", "family", "fact", "relationship", "source", "citation", "media"]);
const classifications = new Set<SyncChangeClassification>([
  "remote_only",
  "local_only",
  "same",
  "conflict",
  "deletion"
]);
const proposedActions = new Set<SyncProposedAction>(["accept_incoming", "keep_local", "no_op", "review"]);
const resolutions = new Set<SyncResolution>(["accept_incoming", "keep_local", "no_op"]);
const RESOLUTION_UPDATE_CHUNK_SIZE = 500;
const fieldResolutions = new Set(["accept_incoming", "keep_local"] as const);
const authoritativeEditors = new Set([
  "ancestry",
  "family_tree_maker",
  "rootsmagic",
  "another_genealogy_app"
]);

export async function listIntegrationConnections(options?: IntegrationStoreOptions): Promise<IntegrationConnection[]> {
  const archiveId = requireArchiveId(options);
  const result = await query<ConnectionRow>(
    `SELECT * FROM integration_connections
     WHERE archive_id = $1
     ORDER BY created_at DESC, id ASC`,
    [archiveId],
    options
  );
  return result.rows.map(mapConnection);
}

export async function getIntegrationConnection(
  connectionId: string,
  options: IntegrationStoreOptions
): Promise<IntegrationConnection> {
  const archiveId = requireArchiveId(options);
  const result = await query<ConnectionRow>(
    "SELECT * FROM integration_connections WHERE archive_id = $1 AND id = $2",
    [archiveId, requireValue(connectionId, "connection id")],
    options
  );
  if (result.rowCount !== 1) {
    throw integrationError("NOT_FOUND", "data source not found");
  }
  return mapConnection(result.rows[0]);
}

export async function createIntegrationConnection(
  input: CreateIntegrationConnectionInput,
  options: IntegrationStoreOptions
): Promise<IntegrationConnection> {
  const archiveId = requireArchiveId(options);
  if (!integrationProviders.includes(input.provider as IntegrationProvider)) {
    throw integrationError("INVALID_INPUT", "unsupported integration provider");
  }
  const provider = input.provider as IntegrationProvider;
  const featureFlags = getIntegrationFeatureFlags();
  if (!isIntegrationProviderEnabled(provider, featureFlags)) {
    throw integrationError("FEATURE_DISABLED", "this data-source provider is disabled");
  }
  const authority = requireAuthoritativeEditor(input.authority);
  const displayName = requireValue(input.displayName, "display name");
  const capabilities = getProviderCapabilities(provider, featureFlags);
  const id = `integration-${randomUUID()}`;
  const result = await query<ConnectionRow>(
    `INSERT INTO integration_connections (
       archive_id, id, provider, authority, display_name, capabilities,
       remote_account_id, remote_tree_id
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING *`,
    [
      archiveId,
      id,
      provider,
      authority,
      displayName,
      JSON.stringify(capabilities),
      input.remoteAccountId?.trim() || null,
      input.remoteTreeId?.trim() || null
    ],
    options
  );
  return mapConnection(result.rows[0]);
}

export async function disconnectIntegrationConnection(
  connectionId: string,
  options: IntegrationStoreOptions
): Promise<IntegrationConnection> {
  const archiveId = requireArchiveId(options);
  const normalizedConnectionId = requireValue(connectionId, "connection id");
  return withTransaction(options, async (client) => {
    await requireConnectionRow(client, archiveId, normalizedConnectionId, true);
    const applying = await client.query<{ id: string }>(
      `SELECT id FROM sync_runs
       WHERE archive_id = $1 AND connection_id = $2 AND status = 'applying'
       LIMIT 1 FOR UPDATE`,
      [archiveId, normalizedConnectionId]
    );
    if (applying.rowCount) {
      throw integrationError("ACTIVE_RUN", "an applying refresh cannot be disconnected");
    }
    const cancelledRuns = await client.query<{ id: string }>(
      `UPDATE sync_runs
       SET status = 'cancelled', cancel_requested_at = COALESCE(cancel_requested_at, now()), updated_at = now()
       WHERE archive_id = $1 AND connection_id = $2
         AND status IN ('queued', 'parsing', 'review_ready', 'cancel_requested')
       RETURNING id`,
      [archiveId, normalizedConnectionId]
    );
    if (cancelledRuns.rows.length > 0) {
      await client.query(
        `UPDATE durable_jobs
         SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
             lease_expires_at = NULL, cancelled_at = now(), updated_at = now()
         WHERE archive_id = $1
           AND payload->>'runId' = ANY($2::text[])
           AND state IN ('queued', 'running')`,
        [archiveId, cancelledRuns.rows.map((run) => run.id)]
      );
    }
    const result = await client.query<ConnectionRow>(
      `UPDATE integration_connections
       SET status = 'disconnected', disconnected_at = now(), updated_at = now()
       WHERE archive_id = $1 AND id = $2
       RETURNING *`,
      [archiveId, normalizedConnectionId]
    );
    return mapConnection(result.rows[0]);
  });
}

export async function createIntegrationSnapshot(
  input: CreateIntegrationSnapshotInput,
  options: IntegrationStoreOptions
): Promise<{ snapshot: IntegrationSnapshot; duplicate: boolean }> {
  const archiveId = requireArchiveId(options);
  const connectionId = requireValue(input.connectionId, "connection id");
  const sha256 = input.sha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw integrationError("INVALID_INPUT", "snapshot sha256 must be a lowercase SHA-256 digest");
  }
  const artifactKey = requireValue(input.artifactKey, "artifact key");
  const parserVersion = requireValue(input.parserVersion, "parser version");

  return withTransaction(options, async (client) => {
    await requireConnectionRow(client, archiveId, connectionId);
    const inserted = await client.query<SnapshotRow>(
      `INSERT INTO integration_snapshots (
         archive_id, id, connection_id, artifact_key, sha256, parser_version,
         counts, warnings, source_metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
       ON CONFLICT (archive_id, connection_id, sha256) DO NOTHING
       RETURNING *`,
      [
        archiveId,
        `snapshot-${randomUUID()}`,
        connectionId,
        artifactKey,
        sha256,
        parserVersion,
        JSON.stringify(input.counts ?? {}),
        JSON.stringify(input.warnings ?? []),
        JSON.stringify(input.sourceMetadata ?? {})
      ]
    );
    if (inserted.rowCount === 1) {
      return { snapshot: mapSnapshot(inserted.rows[0]), duplicate: false };
    }

    const existing = await client.query<SnapshotRow>(
      `SELECT * FROM integration_snapshots
       WHERE archive_id = $1 AND connection_id = $2 AND sha256 = $3`,
      [archiveId, connectionId, sha256]
    );
    return { snapshot: mapSnapshot(existing.rows[0]), duplicate: true };
  });
}

export async function getIntegrationSnapshot(
  snapshotId: string,
  options: IntegrationStoreOptions
): Promise<IntegrationSnapshot> {
  const archiveId = requireArchiveId(options);
  const result = await query<SnapshotRow>(
    "SELECT * FROM integration_snapshots WHERE archive_id = $1 AND id = $2",
    [archiveId, requireValue(snapshotId, "snapshot id")],
    options
  );
  if (result.rowCount !== 1) {
    throw integrationError("NOT_FOUND", "integration snapshot not found");
  }
  return mapSnapshot(result.rows[0]);
}

export async function upsertExternalEntityRef(
  input: UpsertExternalEntityRefInput,
  options: IntegrationStoreOptions
): Promise<ExternalEntityRef> {
  const archiveId = requireArchiveId(options);
  const connectionId = requireValue(input.connectionId, "connection id");
  const snapshotId = requireValue(input.snapshotId, "snapshot id");
  const entityType = requireEntityType(input.entityType);
  const externalId = requireValue(input.externalId, "external id");
  const localEntityId = requireValue(input.localEntityId, "local entity id");

  return withTransaction(options, async (client) => {
    await requireConnectionRow(client, archiveId, connectionId);
    await requireSnapshotRow(client, archiveId, connectionId, snapshotId);
    const existing = await client.query<ExternalRefRow>(
      `SELECT * FROM external_entity_refs
       WHERE archive_id = $1 AND connection_id = $2 AND entity_type = $3 AND external_id = $4
       FOR UPDATE`,
      [archiveId, connectionId, entityType, externalId]
    );
    if (existing.rowCount === 1) {
      if (existing.rows[0].local_entity_id !== localEntityId) {
        throw integrationError("EXTERNAL_REF_CONFLICT", "external id is already mapped to a different local entity");
      }
      return mapExternalRef(existing.rows[0]);
    }

    const inserted = await client.query<ExternalRefRow>(
      `INSERT INTO external_entity_refs (
         archive_id, id, connection_id, snapshot_id, entity_type, external_id, local_entity_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [archiveId, `external-ref-${randomUUID()}`, connectionId, snapshotId, entityType, externalId, localEntityId]
    );
    return mapExternalRef(inserted.rows[0]);
  });
}

export async function resolveExternalEntityRef(
  input: Pick<UpsertExternalEntityRefInput, "connectionId" | "entityType" | "externalId">,
  options: IntegrationStoreOptions
): Promise<ExternalEntityRef> {
  const archiveId = requireArchiveId(options);
  const result = await query<ExternalRefRow>(
    `SELECT * FROM external_entity_refs
     WHERE archive_id = $1 AND connection_id = $2 AND entity_type = $3 AND external_id = $4`,
    [
      archiveId,
      requireValue(input.connectionId, "connection id"),
      requireEntityType(input.entityType),
      requireValue(input.externalId, "external id")
    ],
    options
  );
  if (result.rowCount !== 1) {
    throw integrationError("NOT_FOUND", "external entity reference not found");
  }
  return mapExternalRef(result.rows[0]);
}

export function startSyncRun(input: StartSyncRunInput, options: IntegrationStoreOptions): Promise<SyncRun>;
export function startSyncRun(
  connectionId: string,
  input: Omit<StartSyncRunInput, "connectionId">,
  options: IntegrationStoreOptions
): Promise<SyncRun>;
export async function startSyncRun(
  connectionOrInput: string | StartSyncRunInput,
  inputOrOptions: Omit<StartSyncRunInput, "connectionId"> | IntegrationStoreOptions,
  maybeOptions?: IntegrationStoreOptions
): Promise<SyncRun> {
  const input: StartSyncRunInput =
    typeof connectionOrInput === "string"
      ? { ...(inputOrOptions as Omit<StartSyncRunInput, "connectionId">), connectionId: connectionOrInput }
      : connectionOrInput;
  const options = (typeof connectionOrInput === "string" ? maybeOptions : inputOrOptions) as IntegrationStoreOptions;
  const archiveId = requireArchiveId(options);
  const connectionId = requireValue(input.connectionId, "connection id");
  const declaredAuthority = input.declaredAuthority === undefined
    ? undefined
    : requireAuthoritativeEditor(input.declaredAuthority);
  const mediaRightsAcknowledgement = input.mediaRightsAcknowledgement;
  if (mediaRightsAcknowledgement && (
    mediaRightsAcknowledgement.accepted !== true
    || !mediaRightsAcknowledgement.version?.trim()
    || !mediaRightsAcknowledgement.actorId?.trim()
  )) {
    throw integrationError("INVALID_INPUT", "the current desktop-media rights acknowledgement is required");
  }

  try {
    return await withTransaction(options, async (client) => {
      const connection = await requireConnectionRow(client, archiveId, connectionId, true);
      if (connection.status !== "active") {
        throw integrationError("CONNECTION_INACTIVE", "data source is not active");
      }
      if (!isIntegrationProviderEnabled(connection.provider, getIntegrationFeatureFlags())) {
        throw integrationError("FEATURE_DISABLED", "this data-source provider is disabled");
      }
      const baseSnapshotId = input.baseSnapshotId === undefined
        ? connection.last_applied_snapshot_id
        : input.baseSnapshotId;
      const incomingSnapshotId = input.incomingSnapshotId ?? null;
      if (baseSnapshotId) {
        await requireSnapshotRow(client, archiveId, connectionId, baseSnapshotId);
      }
      if (incomingSnapshotId) {
        await requireSnapshotRow(client, archiveId, connectionId, incomingSnapshotId);
      }
      const artifactId = input.artifactId?.trim() || null;
      let artifactRightsAcknowledgement: {
        version: string;
        actorId: string;
        acknowledgedAt: string;
      } | undefined;
      if (artifactId) {
        const artifact = await client.query<{
          id: string;
          media_rights_acknowledgement_version: string | null;
          media_rights_acknowledged_by: string | null;
          media_rights_acknowledged_at: Date | string | null;
        }>(
          `SELECT id, media_rights_acknowledgement_version,
                  media_rights_acknowledged_by, media_rights_acknowledged_at
           FROM integration_artifacts
           WHERE archive_id = $1 AND connection_id = $2 AND id = $3
             AND state IN ('staged', 'quarantined', 'ready')
           FOR UPDATE`,
          [archiveId, connectionId, artifactId]
        );
        if (artifact.rowCount !== 1) {
          throw integrationError("NOT_FOUND", "staged artifact not found in this data source");
        }
        const artifactRow = artifact.rows[0];
        if (
          artifactRow.media_rights_acknowledgement_version
          && artifactRow.media_rights_acknowledged_by
          && artifactRow.media_rights_acknowledged_at
        ) {
          artifactRightsAcknowledgement = {
            version: artifactRow.media_rights_acknowledgement_version,
            actorId: artifactRow.media_rights_acknowledged_by,
            acknowledgedAt: requiredIso(artifactRow.media_rights_acknowledged_at)
          };
        }
      }
      if (
        mediaRightsAcknowledgement
        && (
          !artifactRightsAcknowledgement
          || mediaRightsAcknowledgement.version.trim() !== artifactRightsAcknowledgement.version
          || mediaRightsAcknowledgement.actorId.trim() !== artifactRightsAcknowledgement.actorId
        )
      ) {
        throw integrationError(
          "MEDIA_RIGHTS_MISMATCH",
          "the request acknowledgement does not match the staged artifact"
        );
      }

      const active = await client.query<{ id: string }>(
        `SELECT id FROM sync_runs
         WHERE archive_id = $1 AND connection_id = $2
           AND status IN ('queued', 'parsing', 'review_ready', 'applying', 'cancel_requested')
         LIMIT 1`,
        [archiveId, connectionId]
      );
      if (active.rowCount) {
        throw integrationError("ACTIVE_RUN", "a refresh is already active for this data source");
      }

      if (declaredAuthority && declaredAuthority !== connection.authority) {
        await client.query(
          `UPDATE integration_connections
           SET authority = $3, updated_at = now()
           WHERE archive_id = $1 AND id = $2`,
          [archiveId, connectionId, declaredAuthority]
        );
      }

      const inserted = await client.query<SyncRunRow>(
        `INSERT INTO sync_runs (
           archive_id, id, connection_id, artifact_id, base_snapshot_id, incoming_snapshot_id,
           media_rights_acknowledgement_version, media_rights_acknowledged_by,
           media_rights_acknowledged_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          archiveId,
          `sync-run-${randomUUID()}`,
          connectionId,
          artifactId,
          baseSnapshotId || null,
          incomingSnapshotId,
          artifactRightsAcknowledgement?.version ?? null,
          artifactRightsAcknowledgement?.actorId ?? null,
          artifactRightsAcknowledgement?.acknowledgedAt ?? null
        ]
      );
      const run = mapSyncRun(inserted.rows[0]);
      if (artifactId) {
        await client.query(
          `INSERT INTO durable_jobs (
             archive_id, id, kind, payload, state, idempotency_key,
             attempt, maximum_attempts, available_at
           ) VALUES ($1, $2, 'integration_snapshot_parse', $3::jsonb, 'queued', $4, 0, 3, now())`,
          [
            archiveId,
            `integration-job-${randomUUID()}`,
            JSON.stringify({ runId: run.id, connectionId, artifactId }),
            `integration-snapshot-parse:${run.id}`
          ]
        );
      }
      return run;
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      throw integrationError("ACTIVE_RUN", "a refresh is already active for this data source");
    }
    throw error;
  }
}

export async function getSyncRun(runId: string, options: IntegrationStoreOptions): Promise<SyncRun> {
  const archiveId = requireArchiveId(options);
  const result = await query<SyncRunRow>(
    "SELECT * FROM sync_runs WHERE archive_id = $1 AND id = $2",
    [archiveId, requireValue(runId, "sync run id")],
    options
  );
  if (result.rowCount !== 1) {
    throw integrationError("NOT_FOUND", "sync run not found");
  }
  return mapSyncRun(result.rows[0]);
}

export async function getLatestSyncRunForConnection(
  connectionId: string,
  options: IntegrationStoreOptions
): Promise<SyncRun | undefined> {
  const archiveId = requireArchiveId(options);
  const normalizedConnectionId = requireValue(connectionId, "connection id");
  await getIntegrationConnection(normalizedConnectionId, options);
  const result = await query<SyncRunRow>(
    `SELECT * FROM sync_runs
     WHERE archive_id = $1 AND connection_id = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [archiveId, normalizedConnectionId],
    options
  );
  return result.rows[0] ? mapSyncRun(result.rows[0]) : undefined;
}

export async function cancelSyncRun(runId: string, options: IntegrationStoreOptions): Promise<SyncRun> {
  const archiveId = requireArchiveId(options);
  const normalizedRunId = requireValue(runId, "sync run id");
  return withTransaction(options, async (client) => {
    const existing = await requireSyncRunRow(client, archiveId, normalizedRunId, true);
    if (existing.status === "cancelled") {
      return mapSyncRun(existing);
    }
    if (!["queued", "parsing", "review_ready", "cancel_requested"].includes(existing.status)) {
      throw integrationError("RUN_STATE", "sync run can no longer be cancelled");
    }
    const result = await client.query<SyncRunRow>(
      `UPDATE sync_runs
       SET status = 'cancelled', cancel_requested_at = COALESCE(cancel_requested_at, now()), updated_at = now()
       WHERE archive_id = $1 AND id = $2
       RETURNING *`,
      [archiveId, normalizedRunId]
    );
    await client.query(
      `UPDATE durable_jobs
       SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
           lease_expires_at = NULL, cancelled_at = now(), updated_at = now()
       WHERE archive_id = $1 AND payload->>'runId' = $2
         AND state IN ('queued', 'running')`,
      [archiveId, normalizedRunId]
    );
    return mapSyncRun(result.rows[0]);
  });
}

export async function markSyncRunParsing(
  runId: string,
  options: IntegrationStoreOptions
): Promise<SyncRun> {
  const archiveId = requireArchiveId(options);
  const result = await query<SyncRunRow>(
    `UPDATE sync_runs SET status = 'parsing', updated_at = now()
     WHERE archive_id = $1 AND id = $2 AND status = 'queued'
     RETURNING *`,
    [archiveId, requireValue(runId, "sync run id")],
    options
  );
  if (!result.rows[0]) {
    const existing = await getSyncRun(runId, options);
    if (existing.status === "parsing") return existing;
    throw integrationError("RUN_STATE", "sync run is not queued for parsing");
  }
  return mapSyncRun(result.rows[0]);
}

export async function completeSyncRunPreparation(
  runId: string,
  incomingSnapshotId: string,
  options: IntegrationStoreOptions
): Promise<SyncRun> {
  const archiveId = requireArchiveId(options);
  const normalizedRunId = requireValue(runId, "sync run id");
  const normalizedSnapshotId = requireValue(incomingSnapshotId, "incoming snapshot id");
  return withTransaction(options, async (client) => {
    const run = await requireSyncRunRow(client, archiveId, normalizedRunId, true);
    if (!["queued", "parsing", "review_ready"].includes(run.status)) {
      throw integrationError("RUN_STATE", "sync run could not be prepared");
    }
    await requireSnapshotRow(client, archiveId, run.connection_id, normalizedSnapshotId);
    const result = await client.query<SyncRunRow>(
      `UPDATE sync_runs
       SET incoming_snapshot_id = $3, status = 'review_ready', updated_at = now()
       WHERE archive_id = $1 AND id = $2
       RETURNING *`,
      [archiveId, normalizedRunId, normalizedSnapshotId]
    );
    return mapSyncRun(result.rows[0]);
  });
}

export async function failSyncRunPreparation(
  runId: string,
  input: { errorCode: string; errorMessage: string },
  options: IntegrationStoreOptions
): Promise<SyncRun> {
  const archiveId = requireArchiveId(options);
  const errorCode = requireValue(input.errorCode, "error code");
  const errorMessage = requireValue(input.errorMessage, "error message");
  const result = await query<SyncRunRow>(
    `UPDATE sync_runs
     SET status = 'failed', error_code = $3, error_message = $4, updated_at = now()
     WHERE archive_id = $1 AND id = $2
       AND status IN ('queued', 'parsing', 'cancel_requested')
     RETURNING *`,
    [archiveId, requireValue(runId, "sync run id"), errorCode, errorMessage],
    options
  );
  if (!result.rows[0]) return getSyncRun(runId, options);
  return mapSyncRun(result.rows[0]);
}

export async function addSyncChanges(
  runId: string,
  inputs: AddSyncChangeInput[],
  options: IntegrationStoreOptions
): Promise<SyncChange[]> {
  const archiveId = requireArchiveId(options);
  const normalizedRunId = requireValue(runId, "sync run id");
  return withTransaction(options, async (client) => {
    await requireSyncRunRow(client, archiveId, normalizedRunId, true);
    const sortResult = await client.query<{ next_sort: number }>(
      `SELECT COALESCE(max(sort_order), -1)::integer + 1 AS next_sort
       FROM sync_changes WHERE archive_id = $1 AND run_id = $2`,
      [archiveId, normalizedRunId]
    );
    const startSort = sortResult.rows[0].next_sort;
    const changes: SyncChange[] = [];

    for (const [index, input] of inputs.entries()) {
      validateSyncChangeInput(input);
      const inserted = await client.query<SyncChangeRow>(
        `INSERT INTO sync_changes (
           archive_id, id, run_id, entity_type, external_id, local_entity_id,
           base_hash, local_hash, incoming_hash, classification, proposed_action,
           resolution_payload, search_projection, sort_order
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
         RETURNING *`,
        [
          archiveId,
          `sync-change-${randomUUID()}`,
          normalizedRunId,
          input.entityType,
          input.externalId ?? null,
          input.localEntityId ?? null,
          input.baseHash ?? null,
          input.localHash ?? null,
          input.incomingHash ?? null,
          input.classification,
          input.proposedAction,
          JSON.stringify(input.resolutionPayload ?? {}),
          syncChangeSearchProjection(input),
          startSort + index
        ]
      );
      changes.push(mapSyncChange(inserted.rows[0]));
    }
    if (changes.length > 0) {
      await client.query(
        `UPDATE sync_runs
         SET status = CASE WHEN status IN ('queued', 'parsing') THEN 'review_ready' ELSE status END,
             updated_at = now()
         WHERE archive_id = $1 AND id = $2`,
        [archiveId, normalizedRunId]
      );
    }
    return changes;
  });
}

export async function listSyncChanges(
  runId: string,
  input: {
    cursor?: string;
    pageSize?: number;
    limit?: number;
    query?: string;
    classification?: SyncChangeClassification;
  },
  options: IntegrationStoreOptions
): Promise<{ items: SyncChange[]; nextCursor: string | null; summary: SyncChangeSummary }> {
  const archiveId = requireArchiveId(options);
  const normalizedRunId = requireValue(runId, "sync run id");
  await getSyncRun(normalizedRunId, options);
  const limit = input.pageSize ?? input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw integrationError("INVALID_INPUT", "sync change page size must be between 1 and 100");
  }
  const searchQuery = input.query?.trim() || undefined;
  if (searchQuery && searchQuery.length > 160) {
    throw integrationError("INVALID_INPUT", "sync change search query is too long");
  }
  if (input.classification && !classifications.has(input.classification)) {
    throw integrationError("INVALID_INPUT", "sync change classification filter is invalid");
  }
  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  const filterValues: unknown[] = [archiveId, normalizedRunId];
  const filterClauses: string[] = [];
  if (searchQuery) {
    filterValues.push(`%${searchQuery}%`);
    const parameter = `$${filterValues.length}`;
    filterClauses.push(`(search_projection <> '' AND search_projection ILIKE ${parameter})`);
  }
  if (input.classification) {
    filterValues.push(input.classification);
    filterClauses.push(`classification = $${filterValues.length}`);
  }
  const filterPredicate = filterClauses.length > 0 ? filterClauses.join(" AND ") : "TRUE";
  const values = [...filterValues];
  let cursorSql = "";
  if (cursor) {
    values.push(cursor.sortOrder, cursor.id);
    const sortParameter = `$${values.length - 1}`;
    const idParameter = `$${values.length}`;
    cursorSql = `AND (sort_order, id) > (${sortParameter}::integer, ${idParameter}::text)`;
  }
  values.push(limit + 1);
  const limitParameter = `$${values.length}`;
  const result = await query<SyncChangeRow>(
    `SELECT * FROM sync_changes
     WHERE archive_id = $1 AND run_id = $2 AND ${filterPredicate} ${cursorSql}
     ORDER BY sort_order ASC, id ASC
     LIMIT ${limitParameter}`,
    values,
    options
  );
  const hasNext = result.rows.length > limit;
  const pageRows = result.rows.slice(0, limit);
  const items = pageRows.map(mapSyncChange);
  const last = items.at(-1);
  const summaryResult = await query<{
    total: number;
    filtered: number;
    unresolved: number;
    remote_only: number;
    local_only: number;
    same: number;
    conflict: number;
    deletion: number;
  }>(
    `SELECT
       count(*)::integer AS total,
       count(*) FILTER (WHERE ${filterPredicate})::integer AS filtered,
       count(*) FILTER (WHERE proposed_action = 'review' AND resolution IS NULL)::integer AS unresolved,
       count(*) FILTER (WHERE classification = 'remote_only')::integer AS remote_only,
       count(*) FILTER (WHERE classification = 'local_only')::integer AS local_only,
       count(*) FILTER (WHERE classification = 'same')::integer AS same,
       count(*) FILTER (WHERE classification = 'conflict')::integer AS conflict,
       count(*) FILTER (WHERE classification = 'deletion')::integer AS deletion
     FROM sync_changes
     WHERE archive_id = $1 AND run_id = $2`,
    filterValues,
    options
  );
  const summaryRow = summaryResult.rows[0];
  return {
    items,
    nextCursor: hasNext && last ? encodeCursor(last.sortOrder, last.id) : null,
    summary: {
      total: summaryRow.total,
      filtered: summaryRow.filtered,
      unresolved: summaryRow.unresolved,
      byClassification: {
        remote_only: summaryRow.remote_only,
        local_only: summaryRow.local_only,
        same: summaryRow.same,
        conflict: summaryRow.conflict,
        deletion: summaryRow.deletion
      }
    }
  };
}

export async function applySyncRun(
  runId: string,
  input: ApplySyncRunInput,
  options: IntegrationStoreOptions
): Promise<{ run: SyncRun; replayed: boolean; appliedChangeCount: number }> {
  const archiveId = requireArchiveId(options);
  const normalizedRunId = requireValue(runId, "sync run id");
  const idempotencyKey = requireValue(input.idempotencyKey, "idempotency key");
  if (input.acceptAllSafeIncoming !== undefined && typeof input.acceptAllSafeIncoming !== "boolean") {
    throw integrationError("INVALID_INPUT", "safe incoming approval must be a boolean");
  }
  const acceptAllSafeIncoming = input.acceptAllSafeIncoming === true;
  const normalizedResolutions = normalizeResolutions(input.resolutions ?? []);
  const requestHash = hashJson({
    backupId: input.backupId ?? null,
    acceptAllSafeIncoming,
    resolutions: normalizedResolutions
  });

  return withTransaction(options, async (client) => {
    const currentArchiveUpdatedAt = await lockArchiveRow(client, archiveId);
    const existing = await requireSyncRunRow(client, archiveId, normalizedRunId, true);
    if (existing.apply_idempotency_key) {
      if (existing.apply_idempotency_key !== idempotencyKey || existing.apply_request_hash !== requestHash) {
        throw integrationError("IDEMPOTENCY_CONFLICT", "idempotency key was already used with a different apply payload");
      }
      return {
        run: mapSyncRun(existing),
        replayed: true,
        appliedChangeCount: existing.applied_change_count
      };
    }
    if (
      input.expectedArchiveUpdatedAt
      && currentArchiveUpdatedAt !== requiredIso(input.expectedArchiveUpdatedAt)
    ) {
      throw integrationError("STALE_BASELINE", "archive changed after sync review was prepared");
    }
    if (!new Set(["queued", "review_ready"]).has(existing.status)) {
      throw integrationError("RUN_STATE", "sync run is not ready to apply");
    }
    if (input.backupId) {
      const backup = await client.query<{ id: string }>(
        "SELECT id FROM workspace_backups WHERE archive_id = $1 AND id = $2",
        [archiveId, input.backupId]
      );
      if (backup.rowCount !== 1) {
        throw integrationError("NOT_FOUND", "integration apply backup not found");
      }
    }

    const changeResult = await client.query<SyncChangeRow>(
      `SELECT * FROM sync_changes
       WHERE archive_id = $1 AND run_id = $2
       ORDER BY sort_order ASC, id ASC
       FOR UPDATE`,
      [archiveId, normalizedRunId]
    );
    const changesById = new Map(changeResult.rows.map((change) => [change.id, change]));
    for (const resolution of normalizedResolutions) {
      if (!changesById.has(resolution.changeId)) {
        throw integrationError("INVALID_INPUT", `sync change ${resolution.changeId} not found in this run`);
      }
    }

    const resolvedAt = new Date().toISOString();
    const requested = new Map(normalizedResolutions.map((resolution) => [resolution.changeId, resolution]));
    const resolutionUpdates: Array<{
      id: string;
      entity_type: string;
      external_id: string | null;
      classification: SyncChangeClassification;
      resolution: SyncResolution;
      resolution_payload: Record<string, unknown>;
      local_entity_id: string | null;
      accepts_incoming: boolean;
      persists_identity: boolean;
    }> = [];
    for (const change of changeResult.rows) {
      const requestedResolution = requested.get(change.id);
      const resolution = requestedResolution?.resolution ?? defaultResolution(
        change.proposed_action,
        acceptAllSafeIncoming && change.classification === "remote_only"
      );
      if (!resolution) {
        throw integrationError("RESOLUTION_REQUIRED", `sync change ${change.id} requires review`);
      }
      if (
        change.classification === "deletion"
        && (
          resolution === "accept_incoming"
          || Object.values(requestedResolution?.fields ?? {}).includes("accept_incoming")
        )
      ) {
        throw integrationError("INVALID_INPUT", "incoming deletions cannot accept incoming values");
      }
      const acceptsIncoming = resolution === "accept_incoming"
        || Object.values(requestedResolution?.fields ?? {}).includes("accept_incoming");
      const candidateIds = ambiguousCandidateIds(change.resolution_payload, change.id);
      const selectedLocalEntityId = requestedResolution?.localEntityId;
      if (selectedLocalEntityId && (!candidateIds || !candidateIds.includes(selectedLocalEntityId))) {
        throw integrationError("INVALID_INPUT", `sync change ${change.id} identity selection is not a candidate`);
      }
      if (selectedLocalEntityId && !acceptsIncoming) {
        throw integrationError("INVALID_INPUT", `sync change ${change.id} identity selection does not accept incoming data`);
      }
      if (candidateIds && acceptsIncoming && !selectedLocalEntityId) {
        throw integrationError("RESOLUTION_REQUIRED", `sync change ${change.id} requires an identity candidate`);
      }
      let resolutionPayload = requestedResolution?.fields
        ? { ...change.resolution_payload, fieldResolutions: requestedResolution.fields }
        : change.resolution_payload;
      if (selectedLocalEntityId) {
        resolutionPayload = { ...resolutionPayload, selectedLocalEntityId };
        if (!existing.incoming_snapshot_id || !change.external_id) {
          throw integrationError("INVALID_STATE", `sync change ${change.id} cannot persist its selected identity`);
        }
      }
      resolutionUpdates.push({
        id: change.id,
        entity_type: change.entity_type,
        external_id: change.external_id,
        classification: change.classification,
        resolution,
        resolution_payload: resolutionPayload,
        local_entity_id: selectedLocalEntityId ?? change.local_entity_id,
        accepts_incoming: acceptsIncoming,
        persists_identity: change.incoming_hash !== null
          && !(
            change.classification === "remote_only"
            && resolution === "keep_local"
            && !acceptsIncoming
          )
          && !(candidateIds && !selectedLocalEntityId)
      });
    }

    const refsByExternalId = new Map<string, {
      id: string;
      entity_type: string;
      external_id: string;
      local_entity_id: string;
    }>();
    const rememberExternalRef = (update: {
      entity_type: string;
      external_id: string;
      local_entity_id: string;
    }) => {
      const key = `${update.entity_type}\u0000${update.external_id}`;
      const previous = refsByExternalId.get(key);
      if (previous && previous.local_entity_id !== update.local_entity_id) {
        throw integrationError("INVALID_INPUT", "reviewed identity mappings conflict within this refresh");
      }
      refsByExternalId.set(key, {
        id: previous?.id ?? `external-ref-${randomUUID()}`,
        ...update
      });
    };
    for (const update of resolutionUpdates) {
      if (!update.external_id || !update.local_entity_id) continue;
      if (!update.persists_identity) continue;
      rememberExternalRef({
        entity_type: update.entity_type,
        external_id: update.external_id,
        local_entity_id: update.local_entity_id
      });
    }

    if (existing.incoming_snapshot_id) {
      const snapshotResult = await client.query<{ source_metadata: unknown }>(
        `SELECT source_metadata
         FROM integration_snapshots
         WHERE archive_id = $1 AND connection_id = $2 AND id = $3`,
        [archiveId, existing.connection_id, existing.incoming_snapshot_id]
      );
      if (!snapshotResult.rows[0]) {
        throw integrationError("INVALID_STATE", "reviewed integration snapshot is unavailable");
      }
      const updatesByEntity = new Map(
        resolutionUpdates
          .filter((update) => update.external_id)
          .map((update) => [`${update.entity_type}\u0000${update.external_id}`, update])
      );
      for (const entity of snapshotIdentityManifest(snapshotResult.rows[0].source_metadata)) {
        const update = updatesByEntity.get(`${entity.entityType}\u0000${entity.externalId}`);
        if (!update?.persists_identity || !update.local_entity_id) continue;
        for (const externalId of entity.providerIds) {
          rememberExternalRef({
            entity_type: update.entity_type,
            external_id: externalId,
            local_entity_id: update.local_entity_id
          });
        }
      }
    }
    const persistedExternalRefs = [...refsByExternalId.values()];

    for (let offset = 0; offset < resolutionUpdates.length; offset += RESOLUTION_UPDATE_CHUNK_SIZE) {
      const chunk = resolutionUpdates.slice(offset, offset + RESOLUTION_UPDATE_CHUNK_SIZE);
      const updatedChanges = await client.query<{ id: string }>(
        `UPDATE sync_changes AS target
         SET resolution = input.resolution,
             resolution_payload = input.resolution_payload,
             local_entity_id = input.local_entity_id,
             updated_at = $4::timestamptz
         FROM jsonb_to_recordset($3::jsonb) AS input(
           id text, resolution text, resolution_payload jsonb, local_entity_id text
         )
         WHERE target.archive_id = $1 AND target.run_id = $2 AND target.id = input.id
         RETURNING target.id`,
        [archiveId, normalizedRunId, JSON.stringify(chunk), resolvedAt]
      );
      if (updatedChanges.rowCount !== chunk.length) {
        throw integrationError("INVALID_STATE", "one or more reviewed changes could not be updated");
      }
    }

    for (let offset = 0; offset < persistedExternalRefs.length; offset += RESOLUTION_UPDATE_CHUNK_SIZE) {
      const chunk = persistedExternalRefs.slice(offset, offset + RESOLUTION_UPDATE_CHUNK_SIZE);
      const insertedRefs = await client.query<{ id: string }>(
        `INSERT INTO external_entity_refs (
           archive_id, id, connection_id, snapshot_id, entity_type, external_id, local_entity_id
         )
         SELECT $1, input.id, $2, $3, input.entity_type, input.external_id, input.local_entity_id
         FROM jsonb_to_recordset($4::jsonb) AS input(
           id text, entity_type text, external_id text, local_entity_id text
         )
         ON CONFLICT (archive_id, connection_id, entity_type, external_id)
         DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id,
                       local_entity_id = EXCLUDED.local_entity_id,
                       updated_at = $5::timestamptz
         RETURNING external_entity_refs.id`,
        [
          archiveId,
          existing.connection_id,
          existing.incoming_snapshot_id,
          JSON.stringify(chunk),
          resolvedAt
        ]
      );
      if (insertedRefs.rowCount !== chunk.length) {
        throw integrationError("EXTERNAL_ID_CONFLICT", "a selected identity could not be persisted");
      }
    }

    await touchArchiveRow(client, archiveId);
    let backupId = input.backupId ?? null;
    if (input.preparedImport) {
      const applied = await applyPreparedGedcomImportInTransaction(
        client,
        archiveId,
        input.preparedImport,
        { preserveCurationByStableId: true }
      );
      backupId = applied.backup.id;
    } else if (!backupId) {
      const backup = await createWorkspaceBackupInTransaction(
        client,
        archiveId,
        "Before applying reviewed data-source refresh"
      );
      backupId = backup.id;
    }

    const appliedAt = new Date().toISOString();
    const updated = await client.query<SyncRunRow>(
      `UPDATE sync_runs
       SET status = 'applied', apply_idempotency_key = $3, apply_request_hash = $4,
           backup_id = $5, applied_change_count = $6, applied_at = $7,
           applied_archive_updated_at = (SELECT updated_at FROM archives WHERE id = $1),
           updated_at = $7
       WHERE archive_id = $1 AND id = $2
       RETURNING *`,
      [
        archiveId,
        normalizedRunId,
        idempotencyKey,
        requestHash,
        backupId,
        changeResult.rows.length,
        appliedAt
      ]
    );
    await client.query(
      `UPDATE integration_connections
       SET last_applied_snapshot_id = COALESCE($3, last_applied_snapshot_id),
           last_refreshed_at = $4,
           updated_at = $4
       WHERE archive_id = $1 AND id = $2`,
      [archiveId, existing.connection_id, existing.incoming_snapshot_id, appliedAt]
    );
    return {
      run: mapSyncRun(updated.rows[0]),
      replayed: false,
      appliedChangeCount: changeResult.rows.length
    };
  });
}

export async function rollbackSyncRun(
  runId: string,
  input: RollbackSyncRunInput,
  options: IntegrationStoreOptions
): Promise<{ run: SyncRun; replayed: boolean }> {
  const archiveId = requireArchiveId(options);
  const normalizedRunId = requireValue(runId, "sync run id");
  const idempotencyKey = requireValue(input.idempotencyKey, "idempotency key");
  const actorId = input.actorId?.trim() || null;
  const requestHash = hashJson({ actorId, restoreBackup: input.restoreBackup === true });

  return withTransaction(options, async (client) => {
    await lockArchiveRow(client, archiveId);
    const existing = await requireSyncRunRow(client, archiveId, normalizedRunId, true);
    if (existing.rollback_idempotency_key) {
      if (existing.rollback_idempotency_key !== idempotencyKey || existing.rollback_request_hash !== requestHash) {
        throw integrationError("IDEMPOTENCY_CONFLICT", "idempotency key was already used with a different rollback payload");
      }
      return { run: mapSyncRun(existing), replayed: true };
    }
    if (existing.status !== "applied") {
      throw integrationError("RUN_STATE", "only an applied sync run can be rolled back");
    }
    const connection = await requireConnectionRow(client, archiveId, existing.connection_id, true);
    if (
      !existing.incoming_snapshot_id
      || connection.last_applied_snapshot_id !== existing.incoming_snapshot_id
    ) {
      throw integrationError("STALE_BASELINE", "this sync run is no longer the current applied baseline");
    }
    const archiveVersion = await client.query<{ unchanged: boolean }>(
      `SELECT (archive.updated_at = run.applied_archive_updated_at) AS unchanged
       FROM archives archive
       JOIN sync_runs run ON run.archive_id = archive.id
       WHERE archive.id = $1 AND run.id = $2`,
      [archiveId, normalizedRunId]
    );
    if (archiveVersion.rows[0]?.unchanged !== true) {
      throw integrationError("STALE_BASELINE", "archive changed after this sync run was applied");
    }
    if (!existing.backup_id || input.restoreBackup !== true) {
      throw integrationError("RUN_STATE", "the applied sync run does not have a restorable backup");
    }
    await restoreWorkspaceBackupInTransaction(client, archiveId, existing.backup_id);

    const rolledBackAt = new Date().toISOString();
    const updated = await client.query<SyncRunRow>(
      `UPDATE sync_runs
       SET status = 'rolled_back', rollback_idempotency_key = $3, rollback_request_hash = $4,
           rolled_back_at = $5, rolled_back_by = $6, updated_at = $5
       WHERE archive_id = $1 AND id = $2
       RETURNING *`,
      [archiveId, normalizedRunId, idempotencyKey, requestHash, rolledBackAt, actorId]
    );
    await client.query(
      `UPDATE integration_connections
       SET last_applied_snapshot_id = $3, last_refreshed_at = $4, updated_at = $4
       WHERE archive_id = $1 AND id = $2`,
      [archiveId, existing.connection_id, existing.base_snapshot_id, rolledBackAt]
    );
    return { run: mapSyncRun(updated.rows[0]), replayed: false };
  });
}

async function lockArchiveRow(
  client: PoolClient,
  archiveId: string
): Promise<string> {
  const selected = await client.query<{ updated_at: Date | string }>(
    "SELECT updated_at FROM archives WHERE id = $1 FOR UPDATE",
    [archiveId]
  );
  if (selected.rowCount !== 1) {
    throw integrationError("NOT_FOUND", "archive not found");
  }
  return requiredIso(selected.rows[0].updated_at);
}

async function touchArchiveRow(client: PoolClient, archiveId: string): Promise<void> {
  await client.query("UPDATE archives SET updated_at = clock_timestamp() WHERE id = $1", [archiveId]);
}

async function requireConnectionRow(
  client: PoolClient,
  archiveId: string,
  connectionId: string,
  lock = false
): Promise<ConnectionRow> {
  const result = await client.query<ConnectionRow>(
    `SELECT * FROM integration_connections
     WHERE archive_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [archiveId, connectionId]
  );
  if (result.rowCount !== 1) {
    throw integrationError("NOT_FOUND", "data source not found");
  }
  return result.rows[0];
}

async function requireSnapshotRow(
  client: PoolClient,
  archiveId: string,
  connectionId: string,
  snapshotId: string
): Promise<SnapshotRow> {
  const result = await client.query<SnapshotRow>(
    `SELECT * FROM integration_snapshots
     WHERE archive_id = $1 AND connection_id = $2 AND id = $3`,
    [archiveId, connectionId, snapshotId]
  );
  if (result.rowCount !== 1) {
    throw integrationError("NOT_FOUND", "integration snapshot not found in this archive and data source");
  }
  return result.rows[0];
}

async function requireSyncRunRow(
  client: PoolClient,
  archiveId: string,
  runId: string,
  lock = false
): Promise<SyncRunRow> {
  const result = await client.query<SyncRunRow>(
    `SELECT * FROM sync_runs WHERE archive_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [archiveId, runId]
  );
  if (result.rowCount !== 1) {
    throw integrationError("NOT_FOUND", "sync run not found");
  }
  return result.rows[0];
}

function mapConnection(row: ConnectionRow): IntegrationConnection {
  return {
    id: row.id,
    provider: row.provider,
    authority: row.authority,
    displayName: row.display_name,
    status: row.status,
    capabilities: row.capabilities,
    remoteAccountId: row.remote_account_id ?? undefined,
    remoteTreeId: row.remote_tree_id ?? undefined,
    lastAppliedSnapshotId: row.last_applied_snapshot_id ?? undefined,
    lastRefreshedAt: optionalIso(row.last_refreshed_at),
    disconnectedAt: optionalIso(row.disconnected_at),
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at)
  };
}

function mapSnapshot(row: SnapshotRow): IntegrationSnapshot {
  return {
    id: row.id,
    connectionId: row.connection_id,
    artifactKey: row.artifact_key,
    sha256: row.sha256,
    parserVersion: row.parser_version,
    counts: row.counts,
    warnings: row.warnings,
    sourceMetadata: row.source_metadata,
    createdAt: requiredIso(row.created_at)
  };
}

function mapExternalRef(row: ExternalRefRow): ExternalEntityRef {
  return {
    id: row.id,
    connectionId: row.connection_id,
    snapshotId: row.snapshot_id,
    entityType: row.entity_type,
    externalId: row.external_id,
    localEntityId: row.local_entity_id,
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at)
  };
}

function mapSyncRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    connectionId: row.connection_id,
    artifactId: row.artifact_id ?? undefined,
    baseSnapshotId: row.base_snapshot_id ?? undefined,
    incomingSnapshotId: row.incoming_snapshot_id ?? undefined,
    status: row.status,
    backupId: row.backup_id ?? undefined,
    appliedChangeCount: row.applied_change_count,
    appliedAt: optionalIso(row.applied_at),
    cancelRequestedAt: optionalIso(row.cancel_requested_at),
    rolledBackAt: optionalIso(row.rolled_back_at),
    rolledBackBy: row.rolled_back_by ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    mediaRightsAcknowledgement: row.media_rights_acknowledgement_version
      && row.media_rights_acknowledged_by
      && row.media_rights_acknowledged_at
      ? {
          version: row.media_rights_acknowledgement_version,
          actorId: row.media_rights_acknowledged_by,
          acknowledgedAt: requiredIso(row.media_rights_acknowledged_at)
        }
      : undefined,
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at)
  };
}

function mapSyncChange(row: SyncChangeRow): SyncChange {
  return {
    id: row.id,
    runId: row.run_id,
    entityType: row.entity_type,
    externalId: row.external_id ?? undefined,
    localEntityId: row.local_entity_id ?? undefined,
    baseHash: row.base_hash ?? undefined,
    localHash: row.local_hash ?? undefined,
    incomingHash: row.incoming_hash ?? undefined,
    classification: row.classification,
    proposedAction: row.proposed_action,
    resolution: row.resolution ?? undefined,
    resolutionPayload: row.resolution_payload,
    sortOrder: row.sort_order,
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at)
  };
}

function normalizeResolutions(inputs: SyncResolutionInput[]): Array<{
  changeId: string;
  resolution: SyncResolution;
  localEntityId?: string;
  fields?: Record<string, "accept_incoming" | "keep_local">;
}> {
  const seen = new Set<string>();
  const normalized = inputs.map((input) => {
    const changeId = requireValue(input.changeId, "sync change id");
    if (seen.has(changeId)) {
      throw integrationError("INVALID_INPUT", `duplicate resolution for sync change ${changeId}`);
    }
    seen.add(changeId);
    const resolution = input.resolution ?? input.action;
    if (!resolution || !resolutions.has(resolution)) {
      throw integrationError("INVALID_INPUT", `invalid resolution for sync change ${changeId}`);
    }
    const localEntityId = input.localEntityId === undefined
      ? undefined
      : requireValue(input.localEntityId, "selected local entity id");
    const fields = normalizeFieldResolutions(input.fields, changeId);
    return {
      changeId,
      resolution,
      ...(localEntityId ? { localEntityId } : {}),
      ...(fields ? { fields } : {})
    };
  });
  return normalized.sort((left, right) => left.changeId.localeCompare(right.changeId));
}

function ambiguousCandidateIds(payload: Record<string, unknown>, changeId: string): string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, "ambiguousLocalEntityIds")) return undefined;
  const candidates = payload.ambiguousLocalEntityIds;
  if (
    !Array.isArray(candidates)
    || candidates.length === 0
    || candidates.some((candidate) => typeof candidate !== "string" || !candidate.trim())
  ) {
    throw integrationError("INVALID_STATE", `sync change ${changeId} has invalid identity candidates`);
  }
  return [...new Set(candidates.map((candidate) => candidate.trim()))];
}

function normalizeFieldResolutions(
  input: SyncResolutionInput["fields"],
  changeId: string
): Record<string, "accept_incoming" | "keep_local"> | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw integrationError("INVALID_INPUT", `field resolutions for sync change ${changeId} must be an object`);
  }
  const entries = Object.entries(input).map(([fieldName, resolution]) => {
    const normalizedFieldName = fieldName.trim();
    if (
      !normalizedFieldName
      || normalizedFieldName !== fieldName
      || normalizedFieldName.length > 128
      || /[\u0000-\u001f\u007f]/.test(normalizedFieldName)
      || ["__proto__", "prototype", "constructor"].includes(normalizedFieldName)
    ) {
      throw integrationError("INVALID_INPUT", `invalid field resolution name for sync change ${changeId}`);
    }
    if (!fieldResolutions.has(resolution)) {
      throw integrationError("INVALID_INPUT", `invalid field resolution for ${normalizedFieldName}`);
    }
    return [normalizedFieldName, resolution] as const;
  });
  if (entries.length === 0) return undefined;
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function requireAuthoritativeEditor(value: string): string {
  const normalized = requireValue(value, "authoritative editor");
  if (!authoritativeEditors.has(normalized)) {
    throw integrationError("INVALID_INPUT", "authoritative editor is not supported");
  }
  return normalized;
}

function snapshotIdentityManifest(value: unknown): Array<{
  entityType: string;
  externalId: string;
  providerIds: string[];
}> {
  if (!isRecord(value) || !Array.isArray(value.entityManifest)) return [];
  return value.entityManifest.flatMap((entry) => {
    if (
      !isRecord(entry)
      || typeof entry.entityType !== "string"
      || !entityTypes.has(entry.entityType)
      || typeof entry.externalId !== "string"
      || !entry.externalId.trim()
    ) {
      return [];
    }
    const providerIds = Array.isArray(entry.providerIds)
      ? [...new Set(entry.providerIds.flatMap((providerId) => {
          if (typeof providerId !== "string") return [];
          const normalized = providerId.trim();
          return normalized && normalized.length <= 1_024 ? [normalized] : [];
        }))].slice(0, 20)
      : [];
    return [{
      entityType: entry.entityType,
      externalId: entry.externalId.trim(),
      providerIds
    }];
  });
}

function defaultResolution(
  action: SyncProposedAction,
  acceptSafeIncoming = false
): SyncResolution | undefined {
  if (action === "review") return undefined;
  if (action === "accept_incoming" && !acceptSafeIncoming) return undefined;
  return action;
}

function validateSyncChangeInput(input: AddSyncChangeInput): void {
  requireEntityType(input.entityType);
  if (!classifications.has(input.classification) || !proposedActions.has(input.proposedAction)) {
    throw integrationError("INVALID_INPUT", "invalid sync change classification or proposed action");
  }
  if (input.classification === "deletion" && input.proposedAction !== "keep_local") {
    throw integrationError("INVALID_INPUT", "incoming deletions must keep the local entity by default");
  }
}

function requireEntityType(value: string): string {
  const normalized = requireValue(value, "entity type");
  if (!entityTypes.has(normalized)) {
    throw integrationError("INVALID_INPUT", "unsupported integration entity type");
  }
  return normalized;
}

function requireArchiveId(options: IntegrationStoreOptions | undefined): string {
  if (!options?.archiveId?.trim()) {
    throw integrationError("ARCHIVE_REQUIRED", "archiveId is required for integration persistence");
  }
  return options.archiveId.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireValue(value: string | undefined | null, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw integrationError("INVALID_INPUT", `${label} is required`);
  }
  return normalized;
}

function requiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: Date | string | null): string | undefined {
  return value === null ? undefined : requiredIso(value);
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function encodeCursor(sortOrder: number, id: string): string {
  return Buffer.from(JSON.stringify([sortOrder, id]), "utf8").toString("base64url");
}

function decodeCursor(value: string): { sortOrder: number; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !Number.isInteger(parsed[0]) ||
      typeof parsed[1] !== "string" ||
      !parsed[1]
    ) {
      throw new Error("invalid cursor payload");
    }
    return { sortOrder: parsed[0] as number, id: parsed[1] };
  } catch (error) {
    throw integrationError("INVALID_CURSOR", "invalid sync change cursor", error);
  }
}

function integrationError(code: string, message: string, cause?: unknown): Error & { code: string } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
