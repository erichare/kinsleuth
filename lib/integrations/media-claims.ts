import type { PoolClient } from "pg";

import { withTransaction, type DatabaseOptions } from "../db";
import {
  createConfiguredArchiveObjectStorage,
  type ArchiveObjectStorage
} from "../storage/object-storage";
import type { PreparedIntegrationMediaObject } from "./media-store";

const defaultMediaClaimLifetimeMilliseconds = 24 * 60 * 60 * 1000;
const maximumCleanupBatch = 500;

type MediaClaimOptions = DatabaseOptions & {
  archiveId: string;
  now?: () => Date;
  claimLifetimeMilliseconds?: number;
};

export type MediaClaimMaintenanceOptions = DatabaseOptions & {
  objectStorage?: ArchiveObjectStorage;
  now?: () => Date;
};

export type RegisterMediaWriteClaimInput = {
  runId: string;
  objectKey: string;
  sha256: string;
  mimeType: string;
  size: number;
};

export async function registerIntegrationMediaWriteClaim(
  input: RegisterMediaWriteClaimInput,
  options: MediaClaimOptions
): Promise<void> {
  const archiveId = required(options.archiveId, "archive id");
  const runId = required(input.runId, "sync run id");
  validateClaimObject(archiveId, input);
  const now = options.now?.() ?? new Date();
  const lifetime = options.claimLifetimeMilliseconds ?? defaultMediaClaimLifetimeMilliseconds;
  if (!Number.isSafeInteger(lifetime) || lifetime < 60_000 || lifetime > 7 * 24 * 60 * 60 * 1000) {
    throw mediaClaimError("INVALID_INPUT", "media write claim lifetime must be between one minute and seven days");
  }
  const expiresAt = new Date(now.getTime() + lifetime);

  await withTransaction(options, async (client) => {
    await lockObjectKey(client, archiveId, input.objectKey);
    const inserted = await client.query<{ object_key: string }>(
      `INSERT INTO integration_media_write_claims (
         archive_id, run_id, object_key, sha256, mime_type, size_bytes,
         expires_at, created_at, updated_at
       )
       SELECT $1, run.id, $3, $4, $5, $6, $7, $8, $8
       FROM sync_runs run
       WHERE run.archive_id = $1 AND run.id = $2 AND run.status = 'parsing'
       ON CONFLICT (archive_id, run_id, object_key)
       DO UPDATE SET expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at
       WHERE integration_media_write_claims.sha256 = EXCLUDED.sha256
         AND integration_media_write_claims.mime_type = EXCLUDED.mime_type
         AND integration_media_write_claims.size_bytes = EXCLUDED.size_bytes
       RETURNING object_key`,
      [
        archiveId,
        runId,
        input.objectKey,
        input.sha256,
        input.mimeType,
        input.size,
        expiresAt.toISOString(),
        now.toISOString()
      ]
    );
    if (!inserted.rows[0]) {
      throw mediaClaimError("RUN_STATE", "sync run cannot claim private media in its current state");
    }
  });
}

export async function expireIntegrationMediaWriteClaims(
  runId: string,
  options: Pick<MediaClaimOptions, "archiveId" | "databaseUrl" | "now">
): Promise<number> {
  const now = options.now?.() ?? new Date();
  return withTransaction(options, async (client) => {
    const result = await client.query(
      `UPDATE integration_media_write_claims
       SET expires_at = LEAST(expires_at, $3::timestamptz), updated_at = $3::timestamptz
       WHERE archive_id = $1 AND run_id = $2`,
      [required(options.archiveId, "archive id"), required(runId, "sync run id"), now.toISOString()]
    );
    return result.rowCount ?? 0;
  });
}

export async function lockIntegrationMediaWriteClaimsForCommit(
  client: PoolClient,
  input: {
    archiveId: string;
    runId: string;
    mediaObjects: PreparedIntegrationMediaObject[];
  }
): Promise<void> {
  const mediaByKey = new Map(input.mediaObjects.map((media) => [media.objectKey, media]));
  const keys = [...mediaByKey.keys()].sort();
  for (const key of keys) await lockObjectKey(client, input.archiveId, key);
  if (keys.length === 0) return;

  const claims = await client.query<{
    object_key: string;
    sha256: string;
    mime_type: string;
    size_bytes: number | string;
  }>(
    `SELECT object_key, sha256, mime_type, size_bytes
     FROM integration_media_write_claims
     WHERE archive_id = $1 AND run_id = $2
       AND object_key = ANY($3::text[]) AND expires_at > clock_timestamp()
     FOR UPDATE`,
    [input.archiveId, input.runId, keys]
  );
  const claimsByKey = new Map(claims.rows.map((claim) => [claim.object_key, claim]));
  for (const [key, media] of mediaByKey) {
    const claim = claimsByKey.get(key);
    if (
      !claim
      || claim.sha256 !== media.sha256
      || claim.mime_type !== media.mimeType
      || Number(claim.size_bytes) !== media.size
    ) {
      throw mediaClaimError("MEDIA_CLAIM_EXPIRED", "private media write ownership expired before publication");
    }
  }
}

export async function releaseCommittedIntegrationMediaWriteClaims(
  client: PoolClient,
  input: { archiveId: string; runId: string; objectKeys: string[] }
): Promise<void> {
  const objectKeys = [...new Set(input.objectKeys)];
  if (objectKeys.length === 0) return;
  await client.query(
    `DELETE FROM integration_media_write_claims
     WHERE archive_id = $1 AND run_id = $2 AND object_key = ANY($3::text[])`,
    [input.archiveId, input.runId, objectKeys]
  );
}

export async function cleanupExpiredIntegrationMediaWriteClaims(
  input: { limit?: number } = {},
  options: MediaClaimMaintenanceOptions = {}
): Promise<{ scanned: number; deleted: number; failed: number }> {
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumCleanupBatch) {
    throw mediaClaimError("INVALID_INPUT", "media claim cleanup limit must be between 1 and 500");
  }
  const now = options.now?.() ?? new Date();
  const candidates = await withTransaction(options, async (client) => {
    const result = await client.query<{ archive_id: string; object_key: string }>(
      `SELECT archive_id, object_key
       FROM integration_media_write_claims
       WHERE expires_at <= $1::timestamptz
       GROUP BY archive_id, object_key
       ORDER BY min(expires_at), archive_id, object_key
       LIMIT $2`,
      [now.toISOString(), limit]
    );
    return result.rows;
  });
  if (candidates.length === 0) return { scanned: 0, deleted: 0, failed: 0 };

  const storage = options.objectStorage ?? createConfiguredArchiveObjectStorage();
  let deleted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const removedObject = await withTransaction(options, async (client) => {
        await lockObjectKey(client, candidate.archive_id, candidate.object_key);
        const expired = await client.query<{ run_id: string }>(
          `SELECT run_id FROM integration_media_write_claims
           WHERE archive_id = $1 AND object_key = $2 AND expires_at <= $3::timestamptz
           FOR UPDATE`,
          [candidate.archive_id, candidate.object_key, now.toISOString()]
        );
        if (expired.rows.length === 0) return false;
        const protectedObject = await client.query<{ protected: boolean }>(
          `SELECT (
             EXISTS (
               SELECT 1 FROM integration_media_write_claims
               WHERE archive_id = $1 AND object_key = $2 AND expires_at > $3::timestamptz
             )
             OR EXISTS (
               SELECT 1 FROM integration_media_objects
               WHERE archive_id = $1 AND object_key = $2
             )
           ) AS protected`,
          [candidate.archive_id, candidate.object_key, now.toISOString()]
        );
        const isProtected = protectedObject.rows[0]?.protected === true;
        if (!isProtected) {
          // Keep the advisory transaction lock while deleting so a new writer
          // cannot register a claim until the stale object is gone. Its later
          // put will then safely recreate the content-addressed key.
          await storage.delete({ archiveId: candidate.archive_id, key: candidate.object_key });
        }
        await client.query(
          `DELETE FROM integration_media_write_claims
           WHERE archive_id = $1 AND object_key = $2 AND expires_at <= $3::timestamptz`,
          [candidate.archive_id, candidate.object_key, now.toISOString()]
        );
        return !isProtected;
      });
      if (removedObject) deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { scanned: candidates.length, deleted, failed };
}

async function lockObjectKey(client: PoolClient, archiveId: string, objectKey: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    JSON.stringify([archiveId, objectKey])
  ]);
}

function validateClaimObject(
  archiveId: string,
  input: Pick<RegisterMediaWriteClaimInput, "objectKey" | "sha256" | "mimeType" | "size">
): void {
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw mediaClaimError("INVALID_INPUT", "media claim sha256 is invalid");
  if (input.objectKey !== `archives/${archiveId}/integration-media/${input.sha256}`) {
    throw mediaClaimError("INVALID_INPUT", "media claim object key is invalid");
  }
  if (!Number.isSafeInteger(input.size) || input.size < 1) {
    throw mediaClaimError("INVALID_INPUT", "media claim size is invalid");
  }
  if (![
    "image/jpeg", "image/png", "image/gif", "image/tiff",
    "image/bmp", "image/webp", "application/pdf"
  ].includes(input.mimeType)) {
    throw mediaClaimError("INVALID_INPUT", "media claim MIME type is invalid");
  }
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw mediaClaimError("INVALID_INPUT", `${label} is required`);
  return normalized;
}

function mediaClaimError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
