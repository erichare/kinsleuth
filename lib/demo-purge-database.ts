import type { Pool, PoolClient } from "pg";

import {
  demoPurgeMutableGlobalTables,
  demoPurgePreservedArchiveTables,
  demoPurgePreservedGlobalTables,
  demoPurgeProductTables,
  type DemoPurgeTableManifest
} from "./demo-purge.ts";
import {
  validateReleaseFenceIdentity,
  type ReleaseFenceIdentity
} from "./release-fence.ts";

type LockedDemoPurgeState = {
  databaseAlreadyPurged: boolean;
};

export type DemoPurgeDatabaseTransactionInput = {
  pool: Pool;
  archiveId: string;
  fenceIdentity: ReleaseFenceIdentity;
  productTables: DemoPurgeTableManifest[];
  mutableGlobalTables: DemoPurgeTableManifest[];
  validateLockedState: (
    client: PoolClient,
    phase: "before" | "after"
  ) => Promise<LockedDemoPurgeState>;
};

// This is the only transactional deletion primitive used by the demo-purge
// CLI. It locks the complete classified schema, re-proves the exact isolated
// demo cell and active commit-bound fence, then checks expected row counts as
// each child-first deletion runs. The caller supplies the full manifest and
// preserved-evidence validation both before and after deletion.
export async function purgeDemoDatabaseTransaction(
  input: DemoPurgeDatabaseTransactionInput
): Promise<void> {
  const fenceIdentity = validateReleaseFenceIdentity(input.fenceIdentity);
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(input.archiveId)) {
    throw new Error("The demo purge database archive identity is invalid.");
  }
  const expectedProductRows = expectedRows(
    input.productTables,
    demoPurgeProductTables,
    "product"
  );
  const expectedMutableRows = expectedRows(
    input.mutableGlobalTables,
    demoPurgeMutableGlobalTables,
    "mutable global"
  );
  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '5min'");
    // RLS maintenance mode: this operator-only purge deletes the demo cell's
    // product rows and unfiltered mutable-global capability rows across the
    // whole classified schema, so a single archive scope cannot describe it.
    // The purge normally runs with the owner/migration credential, but it must
    // stay valid if ever pointed at a non-owner, NOBYPASSRLS session.
    await client.query("SELECT pg_catalog.set_config('kinresolve.rls_mode', 'maintenance', true)");
    const lockedTables = [
      ...demoPurgeProductTables,
      ...demoPurgeMutableGlobalTables,
      ...demoPurgePreservedGlobalTables,
      ...demoPurgePreservedArchiveTables
    ].sort(compareUtf8);
    await client.query(
      `LOCK TABLE ${lockedTables.map((name) => `public.${quoteIdentifier(name)}`).join(", ")}`
      + " IN SHARE ROW EXCLUSIVE MODE"
    );

    const archives = await client.query<{ id: string; dataset_mode: string }>(
      'SELECT id, dataset_mode FROM public.archives ORDER BY id COLLATE "C" FOR SHARE'
    );
    if (
      archives.rows.length !== 1
      || archives.rows[0]?.id !== input.archiveId
      || archives.rows[0]?.dataset_mode !== "demo"
    ) {
      throw new Error("The locked database is not the single exact demo purge cell.");
    }
    const fence = await client.query<{
      release_commit_sha: string;
      state: string;
    }>(
      `SELECT release_commit_sha, state
       FROM public.release_write_fences
       WHERE fence_id = $1
       FOR SHARE`,
      [fenceIdentity.fenceId]
    );
    if (
      fence.rows.length !== 1
      || fence.rows[0]?.release_commit_sha !== fenceIdentity.releaseCommitSha
      || fence.rows[0]?.state !== "active"
    ) {
      throw new Error("The demo purge database transaction requires its exact active write fence.");
    }

    const before = await input.validateLockedState(client, "before");
    if (!before.databaseAlreadyPurged) {
      // Break the intentional connection/snapshot cycle before child-first
      // deletes. This remains inside the same all-or-nothing transaction.
      await client.query(
        "UPDATE public.integration_connections SET last_applied_snapshot_id = NULL WHERE archive_id = $1",
        [input.archiveId]
      );
      for (const name of demoPurgeProductTables) {
        const deleted = await client.query(
          `DELETE FROM public.${quoteIdentifier(name)} WHERE archive_id = $1`,
          [input.archiveId]
        );
        if (deleted.rowCount !== expectedProductRows.get(name)) {
          throw new Error("The demo purge database changed during transactional deletion.");
        }
      }
      for (const name of demoPurgeMutableGlobalTables) {
        const deleted = await client.query(`DELETE FROM public.${quoteIdentifier(name)}`);
        if (deleted.rowCount !== expectedMutableRows.get(name)) {
          throw new Error("The demo purge capability state changed during transactional deletion.");
        }
      }
    }

    const after = await input.validateLockedState(client, "after");
    if (!after.databaseAlreadyPurged) {
      throw new Error("The demo purge database transaction did not remove every product row.");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function expectedRows(
  manifests: DemoPurgeTableManifest[],
  expectedNames: readonly string[],
  label: string
): Map<string, number> {
  if (!Array.isArray(manifests) || manifests.length !== expectedNames.length) {
    throw new Error(`The demo purge ${label} deletion plan is incomplete.`);
  }
  const rows = new Map<string, number>();
  for (const manifest of manifests) {
    if (
      typeof manifest !== "object"
      || manifest === null
      || typeof manifest.name !== "string"
      || !expectedNames.includes(manifest.name)
      || rows.has(manifest.name)
      || !Number.isSafeInteger(manifest.rowCount)
      || manifest.rowCount < 0
    ) {
      throw new Error(`The demo purge ${label} deletion plan is invalid.`);
    }
    rows.set(manifest.name, manifest.rowCount);
  }
  if (expectedNames.some((name) => !rows.has(name))) {
    throw new Error(`The demo purge ${label} deletion plan is incomplete.`);
  }
  return rows;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
