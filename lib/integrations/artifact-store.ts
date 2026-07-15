import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, withTransaction, type DatabaseOptions } from "../db";
import {
  createConfiguredArchiveObjectStorage,
  type ArchiveObjectStorage
} from "../storage/object-storage";
import {
  getIntegrationFeatureFlags,
  isIntegrationProviderEnabled,
  type IntegrationFeatureFlags
} from "./feature-flags";
import {
  resolveArtifactRightsAcknowledgement,
  type MediaRightsAcceptance
} from "./artifact-rights";
import type {
  IntegrationProvider,
  MediaRightsAcknowledgement
} from "./types";

export type IntegrationArtifactState = "staged" | "quarantined" | "ready" | "abandoned" | "rejected";

export type IntegrationArtifact = {
  id: string;
  connectionId: string;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  artifactKey: string;
  state: IntegrationArtifactState;
  duplicate: boolean;
  mediaRightsAcknowledgement?: MediaRightsAcknowledgement;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationArtifactStoreOptions = DatabaseOptions & {
  archiveId: string;
  objectStorage?: ArchiveObjectStorage;
  featureFlags?: IntegrationFeatureFlags;
  now?: () => Date;
};

export type CreateIntegrationArtifactInput = {
  fileName: string;
  contentType: string;
  size?: number;
  bytes: Uint8Array;
  mediaRightsAcknowledgement?: MediaRightsAcceptance;
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

export async function createIntegrationArtifact(
  connectionId: string,
  input: CreateIntegrationArtifactInput,
  options: IntegrationArtifactStoreOptions
): Promise<IntegrationArtifact> {
  const archiveId = required(options.archiveId, "archiveId");
  const normalizedConnectionId = required(connectionId, "connection id");
  const fileName = safeFileName(input.fileName);
  const contentType = safeContentType(input.contentType);
  const bytes = Buffer.from(input.bytes);
  if (bytes.length === 0 || (input.size !== undefined && input.size !== bytes.length)) {
    throw integrationArtifactError("INVALID_INPUT", "artifact content is empty or has an invalid size");
  }

  const storage = options.objectStorage ?? createConfiguredArchiveObjectStorage();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expectedKey = `archives/${archiveId}/integration-artifacts/${sha256}`;
  let storedKey: string | undefined;

  try {
    return await withTransaction(options, async (client) => {
      await lockArtifactKey(client, expectedKey);
      const connection = await client.query<{ id: string; provider: IntegrationProvider }>(
        `SELECT id, provider FROM integration_connections
         WHERE archive_id = $1 AND id = $2 AND status = 'active'
         FOR SHARE`,
        [archiveId, normalizedConnectionId]
      );
      if (connection.rowCount !== 1) {
        throw integrationArtifactError("NOT_FOUND", "data source not found");
      }
      if (!isIntegrationProviderEnabled(
        connection.rows[0].provider,
        options.featureFlags ?? getIntegrationFeatureFlags()
      )) {
        throw integrationArtifactError("FEATURE_DISABLED", "this data-source provider is disabled");
      }
      const rightsAcknowledgement = resolveArtifactRightsAcknowledgement({
        provider: connection.rows[0].provider,
        fileName,
        acknowledgement: input.mediaRightsAcknowledgement,
        featureFlags: options.featureFlags ?? getIntegrationFeatureFlags(),
        acknowledgedAt: new Date()
      });

      const stored = await storage.put({
        archiveId,
        purpose: "integration-artifacts",
        fileName,
        bytes,
        contentType
      });
      storedKey = stored.key;
      if (stored.sha256 !== sha256 || stored.key !== expectedKey) {
        throw integrationArtifactError("ARTIFACT_INTEGRITY", "Private artifact storage returned an invalid identity");
      }

      const inserted = await client.query<ArtifactRow>(
        `INSERT INTO integration_artifacts (
           archive_id, id, connection_id, file_name, artifact_key, sha256,
           content_type, size_bytes, state, media_rights_acknowledgement_version,
           media_rights_acknowledged_by, media_rights_acknowledged_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'staged', $9, $10, $11)
         ON CONFLICT (archive_id, connection_id, sha256) DO NOTHING
         RETURNING *`,
        [
          archiveId,
          `integration-artifact-${randomUUID()}`,
          normalizedConnectionId,
          fileName,
          stored.key,
          stored.sha256,
          contentType,
          stored.size,
          rightsAcknowledgement?.version ?? null,
          rightsAcknowledgement?.actorId ?? null,
          rightsAcknowledgement?.acknowledgedAt ?? null
        ]
      );
      if (inserted.rows[0]) return mapArtifact(inserted.rows[0], false);

      const existing = await client.query<ArtifactRow>(
        `UPDATE integration_artifacts
         SET state = 'staged', deleted_at = NULL,
             media_rights_acknowledgement_version = $4,
             media_rights_acknowledged_by = $5,
             media_rights_acknowledged_at = $6,
             updated_at = now()
         WHERE archive_id = $1 AND connection_id = $2 AND sha256 = $3
         RETURNING *`,
        [
          archiveId,
          normalizedConnectionId,
          stored.sha256,
          rightsAcknowledgement?.version ?? null,
          rightsAcknowledgement?.actorId ?? null,
          rightsAcknowledgement?.acknowledgedAt ?? null
        ]
      );
      if (!existing.rows[0]) {
        throw new Error("Unable to resolve the duplicate integration artifact");
      }
      return mapArtifact(existing.rows[0], true);
    });
  } catch (error) {
    if (storedKey) {
      await deleteArtifactObjectIfUnreferenced(storedKey, storage, options).catch(() => undefined);
    }
    throw error;
  }
}

export async function getIntegrationArtifact(
  connectionId: string,
  artifactId: string,
  options: IntegrationArtifactStoreOptions
): Promise<IntegrationArtifact> {
  const archiveId = required(options.archiveId, "archiveId");
  const result = await query<ArtifactRow>(
    `SELECT * FROM integration_artifacts
     WHERE archive_id = $1 AND connection_id = $2 AND id = $3 AND state <> 'abandoned'`,
    [archiveId, required(connectionId, "connection id"), required(artifactId, "artifact id")],
    options
  );
  if (!result.rows[0]) throw integrationArtifactError("NOT_FOUND", "staged artifact not found");
  return mapArtifact(result.rows[0], false);
}

export async function readIntegrationArtifact(
  connectionId: string,
  artifactId: string,
  options: IntegrationArtifactStoreOptions
): Promise<{ artifact: IntegrationArtifact; bytes: Buffer }> {
  const artifact = await getIntegrationArtifact(connectionId, artifactId, options);
  const storage = options.objectStorage ?? createConfiguredArchiveObjectStorage();
  const bytes = await storage.read({ archiveId: options.archiveId, key: artifact.artifactKey });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== artifact.size || sha256 !== artifact.sha256.toLowerCase()) {
    throw integrationArtifactError(
      "ARTIFACT_INTEGRITY",
      "Stored integration artifact failed integrity verification"
    );
  }
  return { artifact, bytes };
}

export async function streamIntegrationArtifact(
  connectionId: string,
  artifactId: string,
  options: IntegrationArtifactStoreOptions
): Promise<{ artifact: PublicIntegrationArtifact; body: AsyncIterable<Uint8Array> }> {
  const archiveId = required(options.archiveId, "archiveId");
  const result = await query<ArtifactRow>(
    `SELECT * FROM integration_artifacts
     WHERE archive_id = $1 AND connection_id = $2 AND id = $3
       AND state = 'ready'`,
    [archiveId, required(connectionId, "connection id"), required(artifactId, "artifact id")],
    options
  );
  if (!result.rows[0]) {
    throw integrationArtifactError("NOT_FOUND", "downloadable integration artifact not found");
  }

  const artifact = mapArtifact(result.rows[0], false);
  const storage = options.objectStorage ?? createConfiguredArchiveObjectStorage();
  try {
    const metadata = await storage.stat({ archiveId, key: artifact.artifactKey });
    if (
      !metadata
      || metadata.key !== artifact.artifactKey
      || metadata.size !== artifact.size
    ) {
      throw integrationArtifactError(
        "STORAGE_UNAVAILABLE",
        "Private artifact failed its download integrity check"
      );
    }
    const body = await storage.stream({ archiveId, key: artifact.artifactKey });
    return { artifact: toPublicIntegrationArtifact(artifact), body };
  } catch (error) {
    if (isIntegrationArtifactError(error, "STORAGE_UNAVAILABLE")) throw error;
    throw integrationArtifactError(
      "STORAGE_UNAVAILABLE",
      "Private artifact is temporarily unavailable"
    );
  }
}

export async function setIntegrationArtifactState(
  connectionId: string,
  artifactId: string,
  state: Exclude<IntegrationArtifactState, "abandoned">,
  options: IntegrationArtifactStoreOptions
): Promise<IntegrationArtifact> {
  const archiveId = required(options.archiveId, "archiveId");
  const result = await query<ArtifactRow>(
    `UPDATE integration_artifacts
     SET state = $4,
         completed_at = CASE WHEN $4 = 'ready' THEN now() ELSE completed_at END,
         updated_at = now()
     WHERE archive_id = $1 AND connection_id = $2 AND id = $3 AND state <> 'abandoned'
     RETURNING *`,
    [archiveId, required(connectionId, "connection id"), required(artifactId, "artifact id"), state],
    options
  );
  if (!result.rows[0]) throw integrationArtifactError("NOT_FOUND", "staged artifact not found");
  return mapArtifact(result.rows[0], false);
}

export async function deleteIntegrationArtifact(
  connectionId: string,
  artifactId: string,
  options: IntegrationArtifactStoreOptions
): Promise<void> {
  const archiveId = required(options.archiveId, "archiveId");
  const normalizedConnectionId = required(connectionId, "connection id");
  const normalizedArtifactId = required(artifactId, "artifact id");
  const artifact = await withTransaction(options, async (client) => {
    const lookup = await client.query<{ artifact_key: string }>(
      `SELECT artifact_key FROM integration_artifacts
       WHERE archive_id = $1 AND connection_id = $2 AND id = $3`,
      [archiveId, normalizedConnectionId, normalizedArtifactId]
    );
    if (!lookup.rows[0]) throw integrationArtifactError("NOT_FOUND", "staged artifact not found");
    await lockArtifactKey(client, lookup.rows[0].artifact_key);
    const selected = await client.query<ArtifactRow & {
      used_by_run: boolean;
      used_by_snapshot: boolean;
    }>(
      `SELECT artifact.*,
              EXISTS (
                SELECT 1 FROM sync_runs run
                WHERE run.archive_id = artifact.archive_id AND run.artifact_id = artifact.id
              ) AS used_by_run,
              EXISTS (
                SELECT 1 FROM integration_snapshots snapshot
                WHERE snapshot.archive_id = artifact.archive_id
                  AND snapshot.artifact_key = artifact.artifact_key
              ) AS used_by_snapshot
       FROM integration_artifacts artifact
       WHERE artifact.archive_id = $1 AND artifact.connection_id = $2 AND artifact.id = $3
       FOR UPDATE`,
      [archiveId, normalizedConnectionId, normalizedArtifactId]
    );
    const row = selected.rows[0];
    if (!row) throw integrationArtifactError("NOT_FOUND", "staged artifact not found");
    if (row.state === "abandoned") return row;
    if (row.state !== "staged" || row.used_by_run || row.used_by_snapshot) {
      throw integrationArtifactError("RUN_STATE", "Only an unconsumed staged artifact can be removed");
    }
    await client.query(
      `UPDATE integration_artifacts
       SET state = 'abandoned', deleted_at = now(), updated_at = now()
       WHERE archive_id = $1 AND id = $2`,
      [archiveId, row.id]
    );
    return row;
  });

  const storage = options.objectStorage ?? createConfiguredArchiveObjectStorage();
  await deleteArtifactObjectIfUnreferenced(artifact.artifact_key, storage, options);
}

async function deleteArtifactObjectIfUnreferenced(
  artifactKey: string,
  storage: ArchiveObjectStorage,
  options: IntegrationArtifactStoreOptions
): Promise<boolean> {
  const archiveId = required(options.archiveId, "archiveId");
  return withTransaction(options, async (client) => {
    await lockArtifactKey(client, artifactKey);
    const references = await client.query<{ total: number | string }>(
      `SELECT (
         (SELECT count(*) FROM integration_artifacts
          WHERE archive_id = $1 AND artifact_key = $2 AND state <> 'abandoned')
         +
         (SELECT count(*) FROM integration_snapshots
          WHERE archive_id = $1 AND artifact_key = $2)
         +
         (SELECT count(*) FROM integration_upload_intents
          WHERE archive_id = $1 AND staging_key = $2
            AND staging_deleted_at IS NULL AND expires_at > $3)
       )::integer AS total`,
      [archiveId, artifactKey, (options.now?.() ?? new Date()).toISOString()]
    );
    if (Number(references.rows[0]?.total ?? 0) > 0) return false;
    await storage.delete({ archiveId, key: artifactKey });
    return true;
  });
}

async function lockArtifactKey(client: PoolClient, artifactKey: string): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [artifactKey]
  );
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

export type PublicIntegrationArtifact = Pick<
  IntegrationArtifact,
  "id" | "connectionId" | "fileName" | "contentType" | "size" | "state" | "duplicate" | "createdAt" | "updatedAt"
>;

/** Public API shape deliberately omits the private object key and content hash. */
export function toPublicIntegrationArtifact(artifact: IntegrationArtifact): PublicIntegrationArtifact {
  return {
    id: artifact.id,
    connectionId: artifact.connectionId,
    fileName: artifact.fileName,
    contentType: artifact.contentType,
    size: artifact.size,
    state: artifact.state,
    duplicate: artifact.duplicate,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt
  };
}

function safeFileName(value: string): string {
  const normalized = required(value, "file name");
  if (normalized.length > 512 || /[\0\r\n]/.test(normalized)) {
    throw integrationArtifactError("INVALID_INPUT", "artifact file name is invalid");
  }
  return normalized;
}

function safeContentType(value: string): string {
  const normalized = required(value, "content type").toLowerCase();
  if (normalized.length > 255 || /[\0\r\n]/.test(normalized)) {
    throw integrationArtifactError("INVALID_INPUT", "artifact content type is invalid");
  }
  return normalized;
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw integrationArtifactError("INVALID_INPUT", `${label} is required`);
  return normalized;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function integrationArtifactError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function isIntegrationArtifactError(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}
