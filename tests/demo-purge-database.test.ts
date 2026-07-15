import { randomBytes, randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  demoPurgeProductManifestSha256,
  demoPurgeMutableGlobalTables,
  demoPurgeProductTables,
  type DemoPurgeTableManifest
} from "@/lib/demo-purge";
import { purgeDemoDatabaseTransaction } from "@/lib/demo-purge-database";
import { readDemoPurgeProductManifests } from "@/lib/demo-purge-product-manifest";
import { closeDatabasePools } from "@/lib/db";
import { runPendingMigrations } from "@/lib/migrations";
import { acquireReleaseFence } from "@/lib/release-fence";
import { provisionArchive } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const releaseCommitSha = "d".repeat(40);

describe("demo purge database plan validation", () => {
  it("fails before connecting when a classified table is missing or duplicated", async () => {
    const pool = new Pool({ connectionString: "postgres://invalid.invalid/unused" });
    const productTables = zeroManifests(demoPurgeProductTables);
    productTables.pop();

    await expect(purgeDemoDatabaseTransaction({
      pool,
      archiveId: "demo-cell-01",
      fenceIdentity: {
        fenceId: "fence-demo-purge-validation",
        releaseCommitSha
      },
      productTables,
      mutableGlobalTables: zeroManifests(demoPurgeMutableGlobalTables),
      validateLockedState: async () => ({ databaseAlreadyPurged: false })
    })).rejects.toThrow(/product deletion plan is incomplete/i);
    await pool.end();
  });
});

describeIfDatabase("demo purge destructive database rehearsal", () => {
  let controlPool: Pool;
  let scratchPool: Pool;
  let scratchDatabaseName = "";
  let scratchDatabaseUrl = "";
  let scratchCreated = false;

  beforeAll(() => {
    controlPool = new Pool({ connectionString: databaseUrl!, max: 2 });
  });

  beforeEach(async () => {
    scratchDatabaseName = `kr_purge_${process.pid}_${randomBytes(4).toString("hex")}`;
    if (!/^kr_purge_[a-z0-9_]+$/.test(scratchDatabaseName)) {
      throw new Error("Generated an invalid demo purge rehearsal database name.");
    }
    await controlPool.query(`CREATE DATABASE "${scratchDatabaseName}"`);
    scratchCreated = true;
    const url = new URL(databaseUrl!);
    url.pathname = `/${scratchDatabaseName}`;
    scratchDatabaseUrl = url.toString();
    scratchPool = new Pool({ connectionString: scratchDatabaseUrl, max: 4 });
    await runPendingMigrations(scratchPool);
  });

  afterEach(async () => {
    await closeDatabasePools();
    if (scratchCreated) {
      await scratchPool.end();
      await dropScratchDatabase(controlPool, scratchDatabaseName);
      scratchCreated = false;
    }
  });

  afterAll(async () => {
    await controlPool.end();
  });

  it("deletes the migrated demo/FK graph and mutable capabilities while preserving cell evidence", async () => {
    const archiveId = "demo-purge-rehearsal";
    await provisionArchive("demo", { archiveId, databaseUrl: scratchDatabaseUrl });
    await seedCyclicIntegrationGraph(scratchPool, archiveId);
    await seedMutableCapabilities(scratchPool);

    const fenceIdentity = {
      fenceId: `fence-demo-purge-${randomBytes(12).toString("hex")}`,
      releaseCommitSha
    };
    await acquireReleaseFence(fenceIdentity, { databaseUrl: scratchDatabaseUrl });
    const productTables = await readDemoPurgeProductManifests(scratchPool, archiveId);
    const mutableGlobalTables = await tableCounts(
      scratchPool,
      demoPurgeMutableGlobalTables
    );
    expect(productTables.reduce((total, table) => total + table.rowCount, 0)).toBeGreaterThan(0);
    expect(demoPurgeProductManifestSha256(productTables)).toMatch(/^[a-f0-9]{64}$/);
    expect(mutableGlobalTables.every((table) => table.rowCount === 1)).toBe(true);

    const preservedBefore = await scratchPool.query<{ archives: number; fences: number; users: number }>(
      `SELECT
         (SELECT count(*)::integer FROM public.archives) AS archives,
         (SELECT count(*)::integer FROM public.release_write_fences) AS fences,
         (SELECT count(*)::integer FROM public."user") AS users`
    );
    let validationCalls = 0;
    await purgeDemoDatabaseTransaction({
      pool: scratchPool,
      archiveId,
      fenceIdentity,
      productTables,
      mutableGlobalTables,
      validateLockedState: async (client) => {
        validationCalls += 1;
        return {
          databaseAlreadyPurged: await classifiedRowsAreEmpty(client, archiveId)
        };
      }
    });

    expect(validationCalls).toBe(2);
    await expect(classifiedRowsAreEmpty(scratchPool, archiveId)).resolves.toBe(true);
    await expect(scratchPool.query(
      "SELECT last_applied_snapshot_id FROM public.integration_connections WHERE archive_id = $1",
      [archiveId]
    )).resolves.toMatchObject({ rows: [] });
    await expect(scratchPool.query(
      `SELECT
         (SELECT count(*)::integer FROM public.archives) AS archives,
         (SELECT count(*)::integer FROM public.release_write_fences) AS fences,
         (SELECT count(*)::integer FROM public."user") AS users`
    )).resolves.toMatchObject({ rows: preservedBefore.rows });
  });
});

async function seedCyclicIntegrationGraph(pool: Pool, archiveId: string): Promise<void> {
  await pool.query(
    `INSERT INTO public.integration_connections
       (archive_id, id, provider, authority, display_name, capabilities)
     VALUES ($1, 'connection-1', 'gedcom', 'local-file', 'Rehearsal',
             '{"read": true, "writeback": false}'::jsonb)`,
    [archiveId]
  );
  await pool.query(
    `INSERT INTO public.integration_snapshots
       (archive_id, id, connection_id, artifact_key, sha256, parser_version)
     VALUES ($1, 'snapshot-1', 'connection-1', 'private/rehearsal.ged', $2, 'test-v1')`,
    [archiveId, "a".repeat(64)]
  );
  await pool.query(
    `UPDATE public.integration_connections
     SET last_applied_snapshot_id = 'snapshot-1'
     WHERE archive_id = $1 AND id = 'connection-1'`,
    [archiveId]
  );
}

async function seedMutableCapabilities(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO public."user" ("id", "name", "email")
     VALUES ('purge-user', 'Purge User', 'purge-user@example.test')`
  );
  await pool.query(
    `INSERT INTO public."session" ("id", "userId", "token", "expiresAt")
     VALUES ('purge-session', 'purge-user', 'purge-session-token', now() + interval '1 hour')`
  );
  await pool.query(
    `INSERT INTO public."verification" ("id", "identifier", "value", "expiresAt")
     VALUES ('purge-verification', 'purge-user@example.test', 'purge-verification-token',
             now() + interval '1 hour')`
  );
  await pool.query(
    `INSERT INTO public.auth_rate_limit_buckets
       (bucket_digest, request_count, window_started_at, expires_at)
     VALUES ($1, 1, now(), now() + interval '1 hour')`,
    ["b".repeat(64)]
  );
  await pool.query(
    `INSERT INTO public.beta_operator_nonces
       (operator_key_digest, nonce, request_timestamp, request_digest, expires_at)
     VALUES ($1, $2, now(), $3, now() + interval '1 hour')`,
    ["c".repeat(64), randomUUID(), "e".repeat(64)]
  );
}

async function tableCounts(
  pool: Pool | PoolClient,
  names: readonly string[],
  archiveId?: string
): Promise<DemoPurgeTableManifest[]> {
  const result = [];
  for (const name of names) {
    const count = await pool.query<{ row_count: number }>(
      `SELECT count(*)::integer AS row_count FROM public."${name}"${archiveId ? " WHERE archive_id = $1" : ""}`,
      archiveId ? [archiveId] : []
    );
    result.push({
      name,
      rowCount: count.rows[0]!.row_count,
      manifestSha256: "0".repeat(64)
    });
  }
  return result;
}

async function classifiedRowsAreEmpty(
  poolOrClient: Pool | PoolClient,
  archiveId: string
): Promise<boolean> {
  const product = await tableCounts(poolOrClient, demoPurgeProductTables, archiveId);
  const mutable = await tableCounts(poolOrClient, demoPurgeMutableGlobalTables);
  return [...product, ...mutable].every((table) => table.rowCount === 0);
}

function zeroManifests(names: readonly string[]): DemoPurgeTableManifest[] {
  return names.map((name) => ({ name, rowCount: 0, manifestSha256: "0".repeat(64) }));
}

async function dropScratchDatabase(controlPool: Pool, name: string): Promise<void> {
  if (!/^kr_purge_[a-z0-9_]+$/.test(name)) {
    throw new Error("Refusing to drop an untracked demo purge rehearsal database.");
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const active = await controlPool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = $1",
      [name]
    );
    if (active.rows[0]!.count === 0) {
      await controlPool.query(`DROP DATABASE "${name}"`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Demo purge rehearsal database ${name} still has active connections.`);
}
