import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query, withTransaction } from "@/lib/db";
import { prepareGedcomImport } from "@/lib/gedcom/apply";
import {
  addSyncChanges,
  applySyncRun,
  cancelSyncRun,
  completeSyncRunPreparation,
  createIntegrationConnection,
  createIntegrationSnapshot,
  disconnectIntegrationConnection,
  getIntegrationConnection,
  getLatestSyncRunForConnection,
  getSyncRun,
  listIntegrationConnections,
  listSyncChanges,
  resolveExternalEntityRef,
  rollbackSyncRun,
  startSyncRun,
  upsertExternalEntityRef
} from "@/lib/integrations/store";
import { pruneBackupRows } from "@/lib/store/rows";
import { readWorkspace, updatePersonCuration } from "@/lib/workspace-store";

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
  const workspace = await readWorkspace(options);
  await query(
    `INSERT INTO workspace_backups (archive_id, id, reason, storage_key, snapshot)
     VALUES ($1, $2, 'Before integration refresh', $3, $4::jsonb)`,
    [options.archiveId, id, `postgres://workspace_backups/${id}`, JSON.stringify(workspace)],
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

  it("cancels active refresh work transactionally before disconnecting a source", async () => {
    const connection = await createAncestryConnection();
    const run = await startSyncRun({ connectionId: connection.id }, firstArchive);
    const jobId = `integration-job-${randomUUID()}`;
    await query(
      `INSERT INTO durable_jobs (
         archive_id, id, kind, payload, state, idempotency_key, maximum_attempts
       ) VALUES ($1, $2, 'integration_snapshot_parse', $3::jsonb, 'queued', $4, 3)`,
      [
        firstArchive.archiveId,
        jobId,
        JSON.stringify({ runId: run.id, connectionId: connection.id }),
        `disconnect-refresh:${run.id}`
      ],
      firstArchive
    );

    const disconnected = await disconnectIntegrationConnection(connection.id, firstArchive);

    expect(disconnected.status).toBe("disconnected");
    await expect(getSyncRun(run.id, firstArchive)).resolves.toMatchObject({ status: "cancelled" });
    const job = await query<{ state: string; cancelled_at: Date | null }>(
      "SELECT state, cancelled_at FROM durable_jobs WHERE archive_id = $1 AND id = $2",
      [firstArchive.archiveId, jobId],
      firstArchive
    );
    expect(job.rows[0]).toMatchObject({ state: "cancelled", cancelled_at: expect.any(Date) });
  });

  it("persists the declared authoritative editor and returns the latest connection run", async () => {
    const connection = await createAncestryConnection();
    const first = await startSyncRun(
      connection.id,
      { declaredAuthority: "family_tree_maker" },
      firstArchive
    );

    await expect(getIntegrationConnection(connection.id, firstArchive)).resolves.toMatchObject({
      authority: "family_tree_maker"
    });
    await expect(getLatestSyncRunForConnection(connection.id, firstArchive)).resolves.toEqual(first);
    await expect(getLatestSyncRunForConnection(connection.id, secondArchive)).rejects.toThrow(/not found/i);

    await cancelSyncRun(first.id, firstArchive);
    const second = await startSyncRun(
      connection.id,
      { declaredAuthority: "rootsmagic" },
      firstArchive
    );
    await expect(getLatestSyncRunForConnection(connection.id, firstArchive)).resolves.toEqual(second);
    await expect(getIntegrationConnection(connection.id, firstArchive)).resolves.toMatchObject({
      authority: "rootsmagic"
    });
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

  it("does not complete a run with a snapshot owned by another connection in the same archive", async () => {
    const firstConnection = await createAncestryConnection(firstArchive, "First tree");
    const secondConnection = await createAncestryConnection(firstArchive, "Second tree");
    const otherSnapshot = (await createSnapshot(secondConnection.id, "1".repeat(64))).snapshot;
    const run = await startSyncRun({ connectionId: firstConnection.id }, firstArchive);

    await expect(completeSyncRunPreparation(run.id, otherSnapshot.id, firstArchive)).rejects.toThrow(
      /snapshot|data source|connection|not found/i
    );
    await expect(getSyncRun(run.id, firstArchive)).resolves.toMatchObject({
      status: "queued",
      incomingSnapshotId: undefined
    });
  });

  it("cancels the run and its durable job atomically and cannot later complete preparation", async () => {
    const connection = await createAncestryConnection();
    const incoming = (await createSnapshot(connection.id, "3".repeat(64))).snapshot;
    const run = await startSyncRun({ connectionId: connection.id }, firstArchive);
    const jobId = `integration-job-${randomUUID()}`;
    await query(
      `INSERT INTO durable_jobs (
         archive_id, id, kind, payload, state, idempotency_key, maximum_attempts
       ) VALUES ($1, $2, 'integration_snapshot_parse', $3::jsonb, 'queued', $4, 3)`,
      [
        firstArchive.archiveId,
        jobId,
        JSON.stringify({ runId: run.id, connectionId: connection.id }),
        `integration-snapshot-parse:${run.id}`
      ],
      firstArchive
    );

    const cancelled = await cancelSyncRun(run.id, firstArchive);

    expect(cancelled.status).toBe("cancelled");
    await expect(cancelSyncRun(run.id, firstArchive)).resolves.toMatchObject({ status: "cancelled" });
    const job = await query<{ state: string; cancelled_at: Date | null }>(
      "SELECT state, cancelled_at FROM durable_jobs WHERE archive_id = $1 AND id = $2",
      [firstArchive.archiveId, jobId],
      firstArchive
    );
    expect(job.rows[0]).toMatchObject({ state: "cancelled", cancelled_at: expect.any(Date) });
    await expect(completeSyncRunPreparation(run.id, incoming.id, firstArchive)).rejects.toThrow(/cancel|state|prepare/i);
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
          proposedAction: "accept_incoming",
          resolutionPayload: {
            values: {
              incoming: {
                displayName: "Mara Quill",
                notes: "sealed synthetic note"
              }
            }
          }
        },
        {
          entityType: "source",
          externalId: "@S2@",
          localEntityId: "source-2",
          baseHash: "base-2",
          localHash: "local-2",
          incomingHash: "incoming-2",
          classification: "conflict",
          proposedAction: "review",
          resolutionPayload: {
            values: {
              incoming: {
                title: "Lantern Harbor ledger",
                transcript: "private synthetic transcript"
              }
            }
          }
        },
        {
          entityType: "person",
          externalId: "@I3@",
          localEntityId: "person-3",
          baseHash: "base-3",
          localHash: "base-3",
          incomingHash: null,
          classification: "deletion",
          proposedAction: "keep_local",
          resolutionPayload: {
            values: { local: { displayName: "Mara Quill Senior" } }
          }
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
    expect(secondPage.items).toEqual(changes.slice(2));
    expect(secondPage.nextCursor).toBeNull();
    expect(firstPage.summary).toEqual({
      total: 3,
      filtered: 3,
      unresolved: 1,
      byClassification: {
        remote_only: 1,
        local_only: 0,
        same: 0,
        conflict: 1,
        deletion: 1
      }
    });
    const filtered = await listSyncChanges(
      run.id,
      { pageSize: 20, query: "S2", classification: "conflict" },
      firstArchive
    );
    expect(filtered.items).toEqual([changes[1]]);
    expect(filtered.summary).toMatchObject({ total: 3, filtered: 1, unresolved: 1 });
    const byPersonName = await listSyncChanges(run.id, { pageSize: 1, query: "mara qu" }, firstArchive);
    expect(byPersonName.items).toEqual([changes[0]]);
    expect(byPersonName.nextCursor).toEqual(expect.any(String));
    expect(byPersonName.summary).toMatchObject({ total: 3, filtered: 2 });
    const byPersonNameNextPage = await listSyncChanges(
      run.id,
      { pageSize: 1, query: "mara qu", cursor: byPersonName.nextCursor ?? undefined },
      firstArchive
    );
    expect(byPersonNameNextPage.items).toEqual([changes[2]]);
    expect(byPersonNameNextPage.nextCursor).toBeNull();
    const bySourceTitle = await listSyncChanges(run.id, { pageSize: 20, query: "HARBOR LEDGER" }, firstArchive);
    expect(bySourceTitle.items).toEqual([changes[1]]);
    expect(bySourceTitle.summary).toMatchObject({ total: 3, filtered: 1 });
    const privateText = await listSyncChanges(run.id, { pageSize: 20, query: "synthetic transcript" }, firstArchive);
    expect(privateText.items).toEqual([]);
    expect(privateText.summary).toMatchObject({ total: 3, filtered: 0 });
    expect((await listSyncChanges(run.id, { pageSize: 20, query: "deletion" }, firstArchive)).items).toEqual([
      changes[2]
    ]);
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

  it("requires explicit approval before accepting remote-only changes outside the loaded page", async () => {
    const { run } = await createReviewRun();
    await addSyncChanges(
      run.id,
      Array.from({ length: 51 }, (_, index) => ({
        entityType: "person",
        externalId: `@I${index + 1}@`,
        localEntityId: `person-remote-${index + 1}`,
        baseHash: null,
        localHash: null,
        incomingHash: `incoming-${index + 1}`,
        classification: "remote_only" as const,
        proposedAction: "accept_incoming" as const,
        resolutionPayload: {
          values: { incoming: { displayName: `Synthetic remote person ${index + 1}` } }
        }
      })),
      firstArchive
    );
    const firstPage = await listSyncChanges(run.id, { pageSize: 50 }, firstArchive);
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    await expect(applySyncRun(
      run.id,
      { idempotencyKey: `apply-unreviewed-${randomUUID()}`, resolutions: [] },
      firstArchive
    )).rejects.toMatchObject({ code: "RESOLUTION_REQUIRED" });
    await expect(getSyncRun(run.id, firstArchive)).resolves.toMatchObject({ status: "review_ready" });

    await expect(applySyncRun(
      run.id,
      {
        idempotencyKey: `apply-reviewed-${randomUUID()}`,
        acceptAllSafeIncoming: true,
        resolutions: []
      },
      firstArchive
    )).resolves.toMatchObject({
      appliedChangeCount: 51,
      run: { status: "applied" }
    });
  });

  it("persists canonical field-level resolutions and replays reordered fields idempotently", async () => {
    const { run } = await createReviewRun();
    const [change] = await addSyncChanges(
      run.id,
      [
        {
          entityType: "person",
          externalId: "@I5@",
          localEntityId: "person-5",
          baseHash: "base",
          localHash: "local",
          incomingHash: "incoming",
          classification: "conflict",
          proposedAction: "review",
          resolutionPayload: { canonicalValues: { birthDate: { base: "1900", local: "1901", incoming: "1902" } } }
        }
      ],
      firstArchive
    );
    const idempotencyKey = `apply-${randomUUID()}`;

    const first = await applySyncRun(
      run.id,
      {
        idempotencyKey,
        resolutions: [
          {
            changeId: change.id,
            resolution: "keep_local",
            fields: { notes: "keep_local", birthDate: "accept_incoming" }
          }
        ]
      },
      firstArchive
    );
    const retry = await applySyncRun(
      run.id,
      {
        idempotencyKey,
        resolutions: [
          {
            changeId: change.id,
            resolution: "keep_local",
            fields: { birthDate: "accept_incoming", notes: "keep_local" }
          }
        ]
      },
      firstArchive
    );

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    const stored = await listSyncChanges(run.id, { pageSize: 20 }, firstArchive);
    expect(stored.items[0].resolutionPayload).toMatchObject({
      canonicalValues: { birthDate: { base: "1900", local: "1901", incoming: "1902" } },
      fieldResolutions: { birthDate: "accept_incoming", notes: "keep_local" }
    });
  });

  it("requires and atomically persists a reviewed ambiguous identity candidate", async () => {
    const { run } = await createReviewRun();
    const [change] = await addSyncChanges(
      run.id,
      [
        {
          entityType: "person",
          externalId: "@I72@",
          localEntityId: "person-new-incoming",
          baseHash: null,
          localHash: null,
          incomingHash: "incoming",
          classification: "conflict",
          proposedAction: "review",
          resolutionPayload: {
            ambiguousLocalEntityIds: ["person-synthetic-candidate-1", "person-synthetic-candidate-2"]
          }
        }
      ],
      firstArchive
    );
    const backupId = await insertBackup(firstArchive);

    await expect(
      applySyncRun(
        run.id,
        {
          idempotencyKey: `apply-${randomUUID()}`,
          backupId,
          resolutions: [{ changeId: change.id, resolution: "accept_incoming" }]
        },
        firstArchive
      )
    ).rejects.toThrow(/identity|candidate|resolution|review/i);
    await expect(
      applySyncRun(
        run.id,
        {
          idempotencyKey: `apply-${randomUUID()}`,
          backupId,
          resolutions: [{
            changeId: change.id,
            resolution: "accept_incoming",
            localEntityId: "person-not-a-candidate"
          }]
        },
        firstArchive
      )
    ).rejects.toThrow(/identity|candidate|invalid/i);

    const unchanged = await listSyncChanges(run.id, { pageSize: 20 }, firstArchive);
    expect(unchanged.items[0]).toMatchObject({
      localEntityId: "person-new-incoming",
      resolution: undefined,
      resolutionPayload: {
        ambiguousLocalEntityIds: ["person-synthetic-candidate-1", "person-synthetic-candidate-2"]
      }
    });

    await applySyncRun(
      run.id,
      {
        idempotencyKey: `apply-${randomUUID()}`,
        backupId,
        resolutions: [{
          changeId: change.id,
          resolution: "accept_incoming",
          localEntityId: "person-synthetic-candidate-2"
        }]
      },
      firstArchive
    );

    const stored = await listSyncChanges(run.id, { pageSize: 20 }, firstArchive);
    expect(stored.items[0]).toMatchObject({
      localEntityId: "person-synthetic-candidate-2",
      resolution: "accept_incoming",
      resolutionPayload: {
        ambiguousLocalEntityIds: ["person-synthetic-candidate-1", "person-synthetic-candidate-2"],
        selectedLocalEntityId: "person-synthetic-candidate-2"
      }
    });
  });

  it("preserves local publication and privacy curation across reviewed identity-field corrections", async () => {
    const { run } = await createReviewRun();
    const before = await readWorkspace(firstArchive);
    const target = before.people[0];
    const curatedFact = target.facts[0];
    const curatedSource = before.sources[0];
    expect(curatedFact).toBeDefined();
    expect(curatedSource).toBeDefined();
    await updatePersonCuration(
      target.id,
      { published: true, privacy: "public", livingStatus: "deceased" },
      firstArchive
    );
    await query(
      "UPDATE person_facts SET privacy = 'sensitive' WHERE archive_id = $1 AND id = $2",
      [firstArchive.archiveId, curatedFact.id],
      firstArchive
    );
    await query(
      "UPDATE sources SET privacy = 'sensitive' WHERE archive_id = $1 AND id = $2",
      [firstArchive.archiveId, curatedSource.id],
      firstArchive
    );
    const prepared = prepareGedcomImport(
      "corrected-tree.ged",
      "0 @I1@ INDI\n1 NAME Completely Corrected /Identity/\n1 BIRT\n2 DATE 1 JAN 1902\n"
    );
    prepared.people[0] = {
      ...prepared.people[0],
      id: target.id,
      facts: prepared.people[0].facts.map((fact, index) => ({
        ...fact,
        id: index === 0 ? curatedFact.id : `${target.id}-corrected-fact-${index}`,
        privacy: "private"
      }))
    };
    prepared.sources = [{ ...curatedSource, title: "Corrected synthetic source title", privacy: "private" }];

    await applySyncRun(
      run.id,
      {
        idempotencyKey: `apply-${randomUUID()}`,
        preparedImport: prepared,
        resolutions: []
      },
      firstArchive
    );

    const corrected = (await readWorkspace(firstArchive)).people.find((person) => person.id === target.id);
    expect(corrected).toMatchObject({
      displayName: "Completely Corrected Identity",
      birthDate: "1 JAN 1902",
      published: true,
      privacy: "public",
      livingStatus: "deceased"
    });
    expect(corrected?.facts[0]?.privacy).toBe("sensitive");
    expect((await readWorkspace(firstArchive)).sources.find((source) => source.id === curatedSource.id)).toMatchObject({
      title: "Corrected synthetic source title",
      privacy: "sensitive"
    });
  });

  it("rejects invalid field-level resolution names before applying", async () => {
    const { run } = await createReviewRun();
    const [change] = await addSyncChanges(
      run.id,
      [
        {
          entityType: "person",
          classification: "conflict",
          proposedAction: "review"
        }
      ],
      firstArchive
    );

    await expect(
      applySyncRun(
        run.id,
        {
          idempotencyKey: `apply-${randomUUID()}`,
          resolutions: [
            { changeId: change.id, resolution: "keep_local", fields: { " ": "accept_incoming" } }
          ]
        },
        firstArchive
      )
    ).rejects.toThrow(/field|invalid/i);
  });

  it("never accepts incoming field values for an incoming deletion", async () => {
    const { run } = await createReviewRun();
    const [change] = await addSyncChanges(
      run.id,
      [
        {
          entityType: "person",
          externalId: "@I6@",
          localEntityId: "person-6",
          baseHash: "base",
          localHash: "base",
          incomingHash: null,
          classification: "deletion",
          proposedAction: "keep_local"
        }
      ],
      firstArchive
    );

    await expect(
      applySyncRun(
        run.id,
        {
          idempotencyKey: `apply-${randomUUID()}`,
          resolutions: [
            {
              changeId: change.id,
              resolution: "keep_local",
              fields: { displayName: "accept_incoming" }
            }
          ]
        },
        firstArchive
      )
    ).rejects.toThrow(/deletion|incoming/i);
  });

  it("records replay-safe rollback metadata and restores the previous remembered baseline", async () => {
    const { connection, base, run } = await createReviewRun();
    const backupId = await insertBackup(firstArchive);
    await applySyncRun(
      run.id,
      { idempotencyKey: `apply-${randomUUID()}`, backupId, resolutions: [] },
      firstArchive
    );
    const input = {
      idempotencyKey: `rollback-${randomUUID()}`,
      actorId: "integration-test-user",
      restoreBackup: true
    };

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
    await expect(
      rollbackSyncRun(run.id, { ...input, restoreBackup: false }, firstArchive)
    ).rejects.toThrow(/idempot|payload|conflict/i);
  });

  it("creates a restorable backup when every reviewed change keeps local data", async () => {
    const { connection, base, run } = await createReviewRun();
    const before = await readWorkspace(firstArchive);

    const applied = await applySyncRun(
      run.id,
      { idempotencyKey: `apply-${randomUUID()}`, resolutions: [] },
      firstArchive
    );

    expect(applied.run).toMatchObject({
      status: "applied",
      backupId: expect.stringMatching(/^backup-/)
    });
    await rollbackSyncRun(
      run.id,
      { idempotencyKey: `rollback-${randomUUID()}`, restoreBackup: true },
      firstArchive
    );
    expect((await getIntegrationConnection(connection.id, firstArchive)).lastAppliedSnapshotId).toBe(base.id);
    expect(await readWorkspace(firstArchive)).toMatchObject({
      people: before.people,
      sources: before.sources
    });
  });

  it("rejects rollback after any later archive mutation", async () => {
    const { run } = await createReviewRun();
    const backupId = await insertBackup(firstArchive);
    await applySyncRun(
      run.id,
      { idempotencyKey: `apply-${randomUUID()}`, backupId, resolutions: [] },
      firstArchive
    );
    await query(
      "UPDATE archives SET updated_at = updated_at + interval '1 second' WHERE id = $1",
      [firstArchive.archiveId],
      firstArchive
    );

    await expect(
      rollbackSyncRun(
        run.id,
        { idempotencyKey: `rollback-${randomUUID()}`, restoreBackup: true },
        firstArchive
      )
    ).rejects.toThrow(/archive changed|stale|latest/i);
    await expect(getSyncRun(run.id, firstArchive)).resolves.toMatchObject({ status: "applied", backupId });
  });

  it("rejects rollback of an older applied run after a newer baseline was applied", async () => {
    const { connection, incoming: firstIncoming, run: firstRun } = await createReviewRun();
    const firstBackupId = await insertBackup(firstArchive);
    await applySyncRun(
      firstRun.id,
      { idempotencyKey: `apply-${randomUUID()}`, backupId: firstBackupId, resolutions: [] },
      firstArchive
    );

    const secondIncoming = (await createSnapshot(connection.id, "2".repeat(64))).snapshot;
    const secondRun = await startSyncRun(
      {
        connectionId: connection.id,
        baseSnapshotId: firstIncoming.id,
        incomingSnapshotId: secondIncoming.id
      },
      firstArchive
    );
    const secondBackupId = await insertBackup(firstArchive);
    await applySyncRun(
      secondRun.id,
      { idempotencyKey: `apply-${randomUUID()}`, backupId: secondBackupId, resolutions: [] },
      firstArchive
    );

    await expect(
      rollbackSyncRun(
        firstRun.id,
        { idempotencyKey: `rollback-${randomUUID()}`, restoreBackup: true },
        firstArchive
      )
    ).rejects.toThrow(/archive changed|current|latest|baseline|stale/i);
    expect((await getIntegrationConnection(connection.id, firstArchive)).lastAppliedSnapshotId).toBe(secondIncoming.id);
  });

  it("expires sync-run rollback references outside the bounded backup window", async () => {
    const connection = await createAncestryConnection();
    for (let index = 0; index < 12; index += 1) {
      const backupId = await insertBackup(firstArchive, `backup-retention-${index}-${randomUUID()}`);
      await query(
        `INSERT INTO sync_runs (
           archive_id, id, connection_id, status, backup_id, applied_at, created_at, updated_at
         ) VALUES ($1, $2, $3, 'applied', $4, now(), now(), now())`,
        [firstArchive.archiveId, `sync-run-retention-${index}-${randomUUID()}`, connection.id, backupId],
        firstArchive
      );
    }

    await withTransaction(firstArchive, async (client) => {
      await pruneBackupRows(client, firstArchive.archiveId, 10);
    });

    const backups = await query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM workspace_backups WHERE archive_id = $1",
      [firstArchive.archiveId],
      firstArchive
    );
    const expiredRuns = await query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM sync_runs WHERE archive_id = $1 AND backup_id IS NULL",
      [firstArchive.archiveId],
      firstArchive
    );
    expect(backups.rows[0].count).toBe(10);
    expect(expiredRuns.rows[0].count).toBe(2);
  });
});
