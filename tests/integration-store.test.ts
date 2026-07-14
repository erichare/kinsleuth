import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  addSyncChanges,
  applySyncRun,
  createIntegrationConnection,
  createIntegrationSnapshot,
  disconnectIntegrationConnection,
  getIntegrationConnection,
  getSyncRun,
  listIntegrationConnections,
  listSyncChanges,
  resolveExternalEntityRef,
  rollbackSyncRun,
  startSyncRun,
  upsertExternalEntityRef
} from "@/lib/integrations/store";
import { readWorkspace } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

type StoreOptions = { databaseUrl: string; archiveId: string };

const ancestryCapabilities = {
  snapshotImport: true,
  incrementalPull: false,
  media: false,
  oauth: false,
  writeback: false
};

let firstArchive: StoreOptions;
let secondArchive: StoreOptions;

beforeEach(async () => {
  if (!databaseUrl) return;
  const suffix = randomUUID();
  firstArchive = { databaseUrl, archiveId: `test-integration-a-${suffix}` };
  secondArchive = { databaseUrl, archiveId: `test-integration-b-${suffix}` };
  await readWorkspace(firstArchive);
  await readWorkspace(secondArchive);
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = ANY($1::text[])", [[firstArchive.archiveId, secondArchive.archiveId]], {
    databaseUrl
  });
});

afterAll(async () => {
  await closeDatabasePools();
});

async function createAncestryConnection(options = firstArchive, displayName = "Hartwell family tree") {
  return createIntegrationConnection(
    {
      provider: "ancestry_export",
      authority: "ancestry",
      displayName,
      capabilities: ancestryCapabilities,
      remoteTreeId: "tree-hartwell"
    },
    options
  );
}

async function createSnapshot(
  connectionId: string,
  sha256: string,
  options = firstArchive,
  overrides: Partial<{
    artifactKey: string;
    parserVersion: string;
    counts: Record<string, number>;
    warnings: string[];
    sourceMetadata: Record<string, unknown>;
  }> = {}
) {
  return createIntegrationSnapshot(
    {
      connectionId,
      artifactKey: `archives/${options.archiveId}/integrations/${connectionId}/${sha256}.ged`,
      sha256,
      parserVersion: "gedcom-5.5.1-v1",
      counts: { people: 4, families: 1, sources: 2, media: 0 },
      warnings: [],
      sourceMetadata: { fileName: "hartwell-tree.ged", source: "ancestry_export" },
      ...overrides
    },
    options
  );
}

async function insertBackup(options: StoreOptions, id = `backup-${randomUUID()}`): Promise<string> {
  await query(
    `INSERT INTO workspace_backups (archive_id, id, reason, storage_key, snapshot)
     VALUES ($1, $2, 'Before integration refresh', $3, '{}'::jsonb)`,
    [options.archiveId, id, `postgres://workspace_backups/${id}`],
    options
  );
  return id;
}

async function createReviewRun(options = firstArchive) {
  const connection = await createAncestryConnection(options);
  const base = await createSnapshot(connection.id, "a".repeat(64), options);
  const incoming = await createSnapshot(connection.id, "b".repeat(64), options);
  const run = await startSyncRun(
    {
      connectionId: connection.id,
      baseSnapshotId: base.snapshot.id,
      incomingSnapshotId: incoming.snapshot.id
    },
    options
  );
  return { connection, base: base.snapshot, incoming: incoming.snapshot, run };
}

describeIfDatabase("provider-neutral integration store", () => {
  it("creates, lists, reads, and disconnects a remembered source without exposing it to another archive", async () => {
    const connection = await createAncestryConnection();

    expect(connection).toMatchObject({
      provider: "ancestry_export",
      authority: "ancestry",
      displayName: "Hartwell family tree",
      status: "active",
      capabilities: ancestryCapabilities,
      remoteTreeId: "tree-hartwell"
    });
    await expect(listIntegrationConnections(firstArchive)).resolves.toEqual([connection]);
    await expect(getIntegrationConnection(connection.id, firstArchive)).resolves.toEqual(connection);
    await expect(getIntegrationConnection(connection.id, secondArchive)).rejects.toThrow(/not found/i);
    await expect(disconnectIntegrationConnection(connection.id, secondArchive)).rejects.toThrow(/not found/i);

    const disconnected = await disconnectIntegrationConnection(connection.id, firstArchive);
    expect(disconnected.status).toBe("disconnected");
    expect(disconnected.disconnectedAt).toEqual(expect.any(String));
    await expect(getIntegrationConnection(connection.id, firstArchive)).resolves.toEqual(disconnected);
  });

  it("deduplicates an immutable SHA-256 snapshot within a connection without overwriting the first metadata", async () => {
    const connection = await createAncestryConnection();
    const sha256 = "c".repeat(64);

    const first = await createSnapshot(connection.id, sha256);
    const duplicate = await createSnapshot(connection.id, sha256, firstArchive, {
      warnings: ["A retry must not replace the first parse result."],
      sourceMetadata: { fileName: "renamed-retry.ged" }
    });

    expect(first.duplicate).toBe(false);
    expect(duplicate).toEqual({ snapshot: first.snapshot, duplicate: true });

    const rows = await query<{ id: string; warnings: unknown; source_metadata: unknown }>(
      `SELECT id, warnings, source_metadata
       FROM integration_snapshots
       WHERE archive_id = $1 AND connection_id = $2 AND sha256 = $3`,
      [firstArchive.archiveId, connection.id, sha256],
      firstArchive
    );
    expect(rows.rows).toEqual([
      {
        id: first.snapshot.id,
        warnings: [],
        source_metadata: { fileName: "hartwell-tree.ged", source: "ancestry_export" }
      }
    ]);

    await expect(
      query(
        "UPDATE integration_snapshots SET parser_version = 'rewritten' WHERE archive_id = $1 AND id = $2",
        [firstArchive.archiveId, first.snapshot.id],
        firstArchive
      )
    ).rejects.toThrow(/immutable|snapshot/i);
  });

  it("allows the same artifact digest in another connection but rejects cross-archive snapshot ownership", async () => {
    const firstConnection = await createAncestryConnection(firstArchive, "First tree");
    const secondConnection = await createAncestryConnection(firstArchive, "Second tree");
    const digest = "d".repeat(64);

    const first = await createSnapshot(firstConnection.id, digest);
    const second = await createSnapshot(secondConnection.id, digest);

    expect(second.snapshot.id).not.toBe(first.snapshot.id);
    await expect(createSnapshot(firstConnection.id, "e".repeat(64), secondArchive)).rejects.toThrow(/not found|archive/i);
  });

  it("keeps external identities connection-scoped and never silently remaps a stable external id", async () => {
    const firstConnection = await createAncestryConnection(firstArchive, "Ancestry tree");
    const otherConnection = await createAncestryConnection(firstArchive, "FTM tree");
    const firstSnapshot = (await createSnapshot(firstConnection.id, "f".repeat(64))).snapshot;
    const otherSnapshot = (await createSnapshot(otherConnection.id, "0".repeat(64))).snapshot;

    const first = await upsertExternalEntityRef(
      {
        connectionId: firstConnection.id,
        snapshotId: firstSnapshot.id,
        entityType: "person",
        externalId: "@I1@",
        localEntityId: "person-hartwell"
      },
      firstArchive
    );
    const retry = await upsertExternalEntityRef(
      {
        connectionId: firstConnection.id,
        snapshotId: firstSnapshot.id,
        entityType: "person",
        externalId: "@I1@",
        localEntityId: "person-hartwell"
      },
      firstArchive
    );
    const other = await upsertExternalEntityRef(
      {
        connectionId: otherConnection.id,
        snapshotId: otherSnapshot.id,
        entityType: "person",
        externalId: "@I1@",
        localEntityId: "person-other-tree"
      },
      firstArchive
    );

    expect(retry).toEqual(first);
    expect(other.localEntityId).toBe("person-other-tree");
    await expect(
      resolveExternalEntityRef(
        { connectionId: firstConnection.id, entityType: "person", externalId: "@I1@" },
        firstArchive
      )
    ).resolves.toEqual(first);
    await expect(
      upsertExternalEntityRef(
        {
          connectionId: firstConnection.id,
          snapshotId: firstSnapshot.id,
          entityType: "person",
          externalId: "@I1@",
          localEntityId: "person-silent-remap"
        },
        firstArchive
      )
    ).rejects.toThrow(/conflict|already mapped/i);
    await expect(
      resolveExternalEntityRef(
        { connectionId: firstConnection.id, entityType: "person", externalId: "@I1@" },
        secondArchive
      )
    ).rejects.toThrow(/not found/i);
  });

  it("persists paginated, reviewable sync changes and scopes the run to its archive", async () => {
    const { run } = await createReviewRun();
    const changes = await addSyncChanges(
      run.id,
      [
        {
          entityType: "person",
          externalId: "@I1@",
          localEntityId: "person-1",
          baseHash: "base-1",
          localHash: "base-1",
          incomingHash: "incoming-1",
          classification: "remote_only",
          proposedAction: "accept_incoming"
        },
        {
          entityType: "person",
          externalId: "@I2@",
          localEntityId: "person-2",
          baseHash: "base-2",
          localHash: "local-2",
          incomingHash: "incoming-2",
          classification: "conflict",
          proposedAction: "review"
        },
        {
          entityType: "person",
          externalId: "@I3@",
          localEntityId: "person-3",
          baseHash: "base-3",
          localHash: "base-3",
          incomingHash: null,
          classification: "deletion",
          proposedAction: "keep_local"
        }
      ],
      firstArchive
    );

    expect(changes).toHaveLength(3);
    const firstPage = await listSyncChanges(run.id, { pageSize: 2 }, firstArchive);
    const secondPage = await listSyncChanges(
      run.id,
      { pageSize: 2, cursor: firstPage.nextCursor ?? undefined },
      firstArchive
    );
    expect(firstPage.items).toEqual(changes.slice(0, 2));
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage).toEqual({ items: changes.slice(2), nextCursor: null });
    await expect(getSyncRun(run.id, secondArchive)).rejects.toThrow(/not found/i);
    await expect(listSyncChanges(run.id, { pageSize: 20 }, secondArchive)).rejects.toThrow(/not found/i);
  });

  it("applies a reviewed run once per idempotency payload and advances the remembered baseline", async () => {
    const { connection, incoming, run } = await createReviewRun();
    const [change] = await addSyncChanges(
      run.id,
      [
        {
          entityType: "person",
          externalId: "@I4@",
          localEntityId: "person-4",
          baseHash: "base",
          localHash: "base",
          incomingHash: "incoming",
          classification: "remote_only",
          proposedAction: "accept_incoming"
        }
      ],
      firstArchive
    );
    const backupId = await insertBackup(firstArchive);
    const input = {
      idempotencyKey: `apply-${randomUUID()}`,
      backupId,
      resolutions: [{ changeId: change.id, resolution: "accept_incoming" as const }]
    };

    const first = await applySyncRun(run.id, input, firstArchive);
    const retry = await applySyncRun(run.id, input, firstArchive);

    expect(first).toMatchObject({
      replayed: false,
      appliedChangeCount: 1,
      run: { id: run.id, status: "applied", backupId, incomingSnapshotId: incoming.id }
    });
    expect(retry).toMatchObject({
      replayed: true,
      appliedChangeCount: 1,
      run: { id: run.id, status: "applied", backupId }
    });
    expect(retry.run.appliedAt).toBe(first.run.appliedAt);

    const remembered = await getIntegrationConnection(connection.id, firstArchive);
    expect(remembered.lastAppliedSnapshotId).toBe(incoming.id);
    expect(remembered.lastRefreshedAt).toBe(first.run.appliedAt);

    await expect(
      applySyncRun(run.id, { ...input, resolutions: [{ changeId: change.id, resolution: "keep_local" }] }, firstArchive)
    ).rejects.toThrow(/idempot|payload|conflict/i);
  });

  it("records replay-safe rollback metadata and restores the previous remembered baseline", async () => {
    const { connection, base, run } = await createReviewRun();
    const backupId = await insertBackup(firstArchive);
    await applySyncRun(
      run.id,
      { idempotencyKey: `apply-${randomUUID()}`, backupId, resolutions: [] },
      firstArchive
    );
    const input = { idempotencyKey: `rollback-${randomUUID()}`, actorId: "integration-test-user" };

    const first = await rollbackSyncRun(run.id, input, firstArchive);
    const retry = await rollbackSyncRun(run.id, input, firstArchive);

    expect(first).toMatchObject({
      replayed: false,
      run: {
        id: run.id,
        status: "rolled_back",
        backupId,
        rolledBackAt: expect.any(String),
        rolledBackBy: "integration-test-user"
      }
    });
    expect(retry).toMatchObject({ replayed: true, run: { id: run.id, status: "rolled_back", backupId } });
    expect(retry.run.rolledBackAt).toBe(first.run.rolledBackAt);
    expect((await getIntegrationConnection(connection.id, firstArchive)).lastAppliedSnapshotId).toBe(base.id);

    await expect(
      rollbackSyncRun(run.id, { ...input, actorId: "different-user" }, firstArchive)
    ).rejects.toThrow(/idempot|payload|conflict/i);
  });
});
