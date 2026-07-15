import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  cleanupExpiredIntegrationMediaWriteClaims,
  expireIntegrationMediaWriteClaims,
  registerIntegrationMediaWriteClaim
} from "@/lib/integrations/media-claims";
import { createArchiveObjectStorage } from "@/lib/storage/object-storage";
import { readWorkspace } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describe("integration media claim migration contract", () => {
  it("records durable run-scoped claims and expiry indexes in migration history", async () => {
    const migrationName = "010_integration_media_write_claims.sql";
    const [sql, manifest] = await Promise.all([
      readFile(path.join(process.cwd(), "db", "migrations", migrationName), "utf8"),
      readFile(path.join(process.cwd(), "db", "migrations", "checksums.json"), "utf8")
    ]);
    expect(sql).toMatch(/CREATE TABLE public\.integration_media_write_claims/);
    expect(sql).toMatch(/FOREIGN KEY \(archive_id, run_id\)[\s\S]*?REFERENCES public\.sync_runs/);
    expect(sql).toMatch(/integration_media_write_claims_expiry_idx/);
    expect((JSON.parse(manifest) as { files: Record<string, string> }).files[migrationName])
      .toMatch(/^[a-f0-9]{64}$/);
  });
});

describeIfDatabase("durable integration media write claims", () => {
  const createdArchives = new Set<string>();

  afterEach(async () => {
    if (createdArchives.size > 0) {
      const archiveIds = [...createdArchives];
      createdArchives.clear();
      await query("DELETE FROM archives WHERE id = ANY($1::text[])", [archiveIds], { databaseUrl: databaseUrl! });
    }
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  it("preserves a shared content-addressed object until every concurrent claim is expired", async () => {
    const archiveId = `test-media-claims-${randomUUID()}`;
    createdArchives.add(archiveId);
    const options = { archiveId, databaseUrl: databaseUrl! };
    await readWorkspace(options);
    const connectionId = `connection-${randomUUID()}`;
    const secondConnectionId = `connection-${randomUUID()}`;
    const firstRunId = `run-${randomUUID()}`;
    const secondRunId = `run-${randomUUID()}`;
    await query(
      `INSERT INTO integration_connections (
         archive_id, id, provider, authority, display_name, capabilities
       ) VALUES (
         $1, $2, 'family_tree_maker', 'family_tree_maker', 'Synthetic claim source',
         '{"snapshotImport":true,"incrementalPull":false,"media":true,"oauth":false,"writeback":false}'::jsonb
       ), (
         $1, $3, 'rootsmagic', 'rootsmagic', 'Second synthetic claim source',
         '{"snapshotImport":true,"incrementalPull":false,"media":true,"oauth":false,"writeback":false}'::jsonb
       )`,
      [archiveId, connectionId, secondConnectionId],
      options
    );
    await query(
      `INSERT INTO sync_runs (archive_id, id, connection_id, status)
       VALUES ($1, $2, $4, 'parsing'), ($1, $3, $5, 'parsing')`,
      [archiveId, firstRunId, secondRunId, connectionId, secondConnectionId],
      options
    );

    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `archives/${archiveId}/integration-media/${sha256}`;
    const objects = new Set([objectKey]);
    const remove = vi.fn(async ({ key }: { key: string }) => { objects.delete(key); });
    const objectStorage = createArchiveObjectStorage({
      backend: {
        stat: vi.fn(async ({ key }) => objects.has(key)
          ? { key, size: bytes.length, contentType: "image/jpeg" }
          : undefined),
        put: vi.fn(async () => undefined),
        read: vi.fn(async () => bytes),
        delete: remove
      }
    });
    const startedAt = new Date("2026-07-15T00:00:00.000Z");
    for (const runId of [firstRunId, secondRunId]) {
      await registerIntegrationMediaWriteClaim({
        runId,
        objectKey,
        sha256,
        mimeType: "image/jpeg",
        size: bytes.length
      }, {
        ...options,
        now: () => startedAt,
        claimLifetimeMilliseconds: 60 * 60_000
      });
    }

    await expireIntegrationMediaWriteClaims(firstRunId, {
      ...options,
      now: () => new Date(startedAt.getTime() + 5 * 60_000)
    });
    await expect(cleanupExpiredIntegrationMediaWriteClaims(
      { limit: 10 },
      {
        databaseUrl: databaseUrl!,
        objectStorage,
        now: () => new Date(startedAt.getTime() + 10 * 60_000)
      }
    )).resolves.toEqual({ scanned: 1, deleted: 0, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
    expect(objects.has(objectKey)).toBe(true);
    await expect(query<{ run_id: string }>(
      `SELECT run_id FROM integration_media_write_claims
       WHERE archive_id = $1 AND object_key = $2`,
      [archiveId, objectKey],
      options
    )).resolves.toMatchObject({ rows: [{ run_id: secondRunId }] });

    await expireIntegrationMediaWriteClaims(secondRunId, {
      ...options,
      now: () => new Date(startedAt.getTime() + 70 * 60_000)
    });
    await expect(cleanupExpiredIntegrationMediaWriteClaims(
      { limit: 10 },
      {
        databaseUrl: databaseUrl!,
        objectStorage,
        now: () => new Date(startedAt.getTime() + 71 * 60_000)
      }
    )).resolves.toEqual({ scanned: 1, deleted: 1, failed: 0 });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(objects.has(objectKey)).toBe(false);
  });
});
