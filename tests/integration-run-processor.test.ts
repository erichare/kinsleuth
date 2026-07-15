import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  applyPreparedIntegrationSyncRun,
  processIntegrationSyncRun,
  rollbackAppliedIntegrationSyncRun
} from "@/lib/integrations/run-processor";
import {
  createIntegrationArtifact,
  createIntegrationConnection,
  getIntegrationConnection,
  getIntegrationSnapshot,
  getSyncRun,
  listSyncChanges,
  startSyncRun,
  type SyncChange
} from "@/lib/integrations/store";
import { createArchiveObjectStorage } from "@/lib/storage/object-storage";
import { readWorkspace } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase("repeatable integration refresh processor", () => {
  const archiveId = `test-refresh-${randomUUID()}`;
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const backend = {
    stat: vi.fn(async ({ key }: { key: string }) => {
      const value = objects.get(key);
      return value ? { key, size: value.bytes.length, contentType: value.contentType } : undefined;
    }),
    put: vi.fn(async (input: { key: string; bytes: Uint8Array; contentType: string }) => {
      objects.set(input.key, { bytes: Buffer.from(input.bytes), contentType: input.contentType });
    }),
    read: vi.fn(async ({ key }: { key: string }) => {
      const value = objects.get(key);
      if (!value) throw new Error("object not found");
      return value.bytes;
    }),
    delete: vi.fn(async ({ key }: { key: string }) => {
      objects.delete(key);
    })
  };
  const objectStorage = createArchiveObjectStorage({ backend });
  const options = { archiveId, databaseUrl: databaseUrl!, objectStorage };

  beforeEach(async () => {
    await readWorkspace(options);
  });

  afterEach(async () => {
    await query("DELETE FROM archives WHERE id = $1", [archiveId], options);
    objects.clear();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  it("rejects apply before parsing without changing the queued run or durable job", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Queued Northwood export"
      },
      options
    );
    const artifact = await stage(connection.id, syntheticGedcom("14 APR 1884"));
    const run = await startSyncRun(connection.id, { artifactId: artifact.id }, options);

    await expect(applyPreparedIntegrationSyncRun(
      run.id,
      { idempotencyKey: "reject-queued-apply", resolutions: [] },
      options
    )).rejects.toMatchObject({ code: "RUN_STATE" });

    const persisted = await query<{
      status: string;
      incoming_snapshot_id: string | null;
      job_state: string;
    }>(
      `SELECT run.status, run.incoming_snapshot_id, job.state AS job_state
       FROM sync_runs run
       JOIN durable_jobs job
         ON job.archive_id = run.archive_id
        AND job.payload->>'runId' = run.id
       WHERE run.archive_id = $1 AND run.id = $2`,
      [archiveId, run.id],
      options
    );
    expect(persisted.rows).toEqual([{
      status: "queued",
      incoming_snapshot_id: null,
      job_state: "queued"
    }]);
  });

  it("stages, reviews, atomically applies, repeats as a no-op, and rolls back a synthetic tree", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Northwood family on Ancestry"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticGedcom("14 APR 1884"));
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);

    const prepared = await processIntegrationSyncRun(firstRun.id, options);
    expect(prepared.run.status).toBe("review_ready");
    expect(prepared.snapshot.duplicate).toBe(false);
    expect(prepared.counts).toMatchObject({ people: 1, media: 0 });
    const firstChanges = await listSyncChanges(firstRun.id, { pageSize: 100 }, options);
    expect(firstChanges.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: "person",
        externalId: "@I1@",
        classification: "remote_only",
        proposedAction: "accept_incoming"
      })
    ]));

    const applied = await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-northwood-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect(applied.run).toMatchObject({ status: "applied", backupId: expect.any(String) });
    const replayed = await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-northwood-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect(replayed).toMatchObject({ replayed: true, run: { status: "applied" } });
    const workspaceAfterApply = await readWorkspace(options);
    const imported = workspaceAfterApply.people.find((person) => person.displayName === "Eliza Northwood");
    expect(imported).toMatchObject({ privacy: "private", published: false, birthDate: "14 APR 1884" });
    expect(imported?.id).not.toBe("@I1@");

    const duplicateArtifact = await stage(connection.id, syntheticGedcom("14 APR 1884"));
    expect(duplicateArtifact.duplicate).toBe(true);
    const duplicateRun = await startSyncRun(connection.id, { artifactId: duplicateArtifact.id }, options);
    const duplicatePrepared = await processIntegrationSyncRun(duplicateRun.id, options);
    expect(duplicatePrepared.snapshot.duplicate).toBe(true);
    const duplicateChanges = await listSyncChanges(duplicateRun.id, { pageSize: 100 }, options);
    expect(duplicateChanges.items.filter((change) => change.entityType === "person")).toEqual([
      expect.objectContaining({ classification: "same", proposedAction: "no_op" })
    ]);

    await applyPreparedIntegrationSyncRun(
      duplicateRun.id,
      { idempotencyKey: "apply-northwood-duplicate", resolutions: [] },
      options
    );
    expect((await getIntegrationConnection(connection.id, options)).lastAppliedSnapshotId).toBe(
      duplicatePrepared.run.incomingSnapshotId
    );

    const changedArtifact = await stage(connection.id, syntheticGedcom("14 APR 1885"));
    const changedRun = await startSyncRun(connection.id, { artifactId: changedArtifact.id }, options);
    await processIntegrationSyncRun(changedRun.id, options);
    const changed = await listSyncChanges(changedRun.id, { pageSize: 100 }, options);
    expect(changed.items.filter((change) => change.entityType === "person")).toEqual([
      expect.objectContaining({ classification: "remote_only", proposedAction: "accept_incoming" })
    ]);
    await applyPreparedIntegrationSyncRun(
      changedRun.id,
      { idempotencyKey: "apply-northwood-v2", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect((await readWorkspace(options)).people.find((person) => person.id === imported?.id)?.birthDate).toBe("14 APR 1885");

    const rolledBack = await rollbackAppliedIntegrationSyncRun(
      changedRun.id,
      { idempotencyKey: "rollback-northwood-v2", actorId: "synthetic-owner" },
      options
    );
    expect(rolledBack.run.status).toBe("rolled_back");
    expect((await readWorkspace(options)).people.find((person) => person.id === imported?.id)?.birthDate).toBe("14 APR 1884");
    expect((await getSyncRun(changedRun.id, options)).rolledBackBy).toBe("synthetic-owner");
  });

  it("treats incoming publication tags as untrusted while preserving local curation", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "gedcom",
        authority: "another_genealogy_app",
        displayName: "Synthetic curation boundary"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticCurationGedcom("Original evidence"));
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    const preview = await processIntegrationSyncRun(firstRun.id, options);
    const incomingSnapshot = await getIntegrationSnapshot(preview.run.incomingSnapshotId!, options);
    expect(incomingSnapshot.sourceMetadata).toMatchObject({
      privacyPreview: {
        private: 1,
        public: 0,
        unknownLivingStatus: 1,
        deceased: 0
      }
    });
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-untrusted-curation-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const imported = (await readWorkspace(options)).people.find(
      (person) => person.displayName === "Avery Lantern"
    )!;
    expect(imported).toMatchObject({ privacy: "private", published: false, livingStatus: "unknown" });

    await query(
      `UPDATE people
       SET privacy = 'public', published = true, living_status = 'deceased'
       WHERE archive_id = $1 AND id = $2`,
      [archiveId, imported.id],
      options
    );
    await query("UPDATE archives SET updated_at = now() + interval '1 second' WHERE id = $1", [archiveId], options);

    const secondArtifact = await stage(connection.id, syntheticCurationGedcom("Corrected evidence"));
    const secondRun = await startSyncRun(connection.id, { artifactId: secondArtifact.id }, options);
    await processIntegrationSyncRun(secondRun.id, options);
    await applyPreparedIntegrationSyncRun(
      secondRun.id,
      { idempotencyKey: "apply-untrusted-curation-v2", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect((await readWorkspace(options)).people.find((person) => person.id === imported.id)).toMatchObject({
      notes: "Corrected evidence",
      privacy: "public",
      published: true,
      livingStatus: "deceased"
    });
  });

  it("keeps stable local people when every GEDCOM xref is renumbered", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Silver Pine family on Ancestry"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticRelationshipGedcom(["@I1@", "@I2@", "@I3@", "@I4@"], ["@F1@", "@F2@"]))
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    await processIntegrationSyncRun(firstRun.id, options);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-silver-pine-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const before = await readWorkspace(options);
    const beforeIds = new Set(before.people.filter((person) =>
      ["Alex Northwood", "Martin Vale", "Rowan Pike"].includes(person.displayName)
    ).map((person) => person.id));
    expect(beforeIds.size).toBe(4);

    const secondArtifact = await stage(connection.id, syntheticRelationshipGedcom(["@P91@", "@P12@", "@P77@", "@P34@"], ["@G8@", "@G9@"]))
    const secondRun = await startSyncRun(connection.id, { artifactId: secondArtifact.id }, options);
    await processIntegrationSyncRun(secondRun.id, options);
    const changes = await listSyncChanges(secondRun.id, { pageSize: 100 }, options);
    const people = changes.items.filter((change) => change.entityType === "person");
    expect(people).toHaveLength(4);
    expect(people.every((change) => change.classification === "same")).toBe(true);
    expect(people.some((change) => change.classification === "deletion")).toBe(false);

    await applyPreparedIntegrationSyncRun(
      secondRun.id,
      { idempotencyKey: "apply-silver-pine-v2", resolutions: [] },
      options
    );
    const afterIds = new Set((await readWorkspace(options)).people.filter((person) =>
      ["Alex Northwood", "Martin Vale", "Rowan Pike"].includes(person.displayName)
    ).map((person) => person.id));
    expect(afterIds).toEqual(beforeIds);
  });

  it("prioritizes stable provider ids when GEDCOM xrefs are swapped", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Stable identity tree on Ancestry"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticStableIdentityGedcom([
      { xref: "@I1@", uid: "northwood-eliza", name: "Eliza /Northwood/", birthDate: "14 APR 1884" },
      { xref: "@I2@", uid: "vale-martin", name: "Martin /Vale/", birthDate: "3 MAR 1880" }
    ]));
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    await processIntegrationSyncRun(firstRun.id, options);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-stable-identities-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const before = await readWorkspace(options);
    const elizaId = before.people.find((person) => person.displayName === "Eliza Northwood")!.id;
    const martinId = before.people.find((person) => person.displayName === "Martin Vale")!.id;
    const rememberedProviderRefs = await query<{ external_id: string; local_entity_id: string }>(
      `SELECT external_id, local_entity_id
       FROM external_entity_refs
       WHERE archive_id = $1 AND connection_id = $2 AND entity_type = 'person'
         AND external_id = ANY($3::text[])
       ORDER BY external_id`,
      [archiveId, connection.id, ["_UID:northwood-eliza", "_UID:vale-martin"]],
      options
    );
    expect(rememberedProviderRefs.rows).toEqual([
      { external_id: "_UID:northwood-eliza", local_entity_id: elizaId },
      { external_id: "_UID:vale-martin", local_entity_id: martinId }
    ]);

    const swappedArtifact = await stage(connection.id, syntheticStableIdentityGedcom([
      { xref: "@I2@", uid: "northwood-eliza", name: "Eliza /Northwood/", birthDate: "14 APR 1884" },
      { xref: "@I1@", uid: "vale-martin", name: "Martin /Vale/", birthDate: "3 MAR 1880" }
    ]));
    const swappedRun = await startSyncRun(connection.id, { artifactId: swappedArtifact.id }, options);
    await processIntegrationSyncRun(swappedRun.id, options);
    const changes = await listSyncChanges(swappedRun.id, { pageSize: 100 }, options);
    const people = changes.items.filter((change) => change.entityType === "person");

    expect(people).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: "@I2@", localEntityId: elizaId, classification: "same" }),
      expect.objectContaining({ externalId: "@I1@", localEntityId: martinId, classification: "same" })
    ]));
    expect(people.some((change) => change.classification === "deletion")).toBe(false);
  });

  it("does not remember xrefs or provider ids for a rejected incoming identity", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Rejected synthetic identity tree"
      },
      options
    );
    const artifact = await stage(connection.id, syntheticStableIdentityGedcom([
      { xref: "@I44@", uid: "rejected-avery-lantern", name: "Avery /Lantern/", birthDate: "2 FEB 1882" }
    ]));
    const run = await startSyncRun(connection.id, { artifactId: artifact.id }, options);
    await processIntegrationSyncRun(run.id, options);
    const changes = await listSyncChanges(run.id, { pageSize: 20 }, options);

    await applyPreparedIntegrationSyncRun(
      run.id,
      {
        idempotencyKey: "reject-synthetic-identity-v1",
        resolutions: changes.items
          .filter((change) => change.classification === "remote_only")
          .map((change) => ({ changeId: change.id, resolution: "keep_local" as const }))
      },
      options
    );

    expect((await readWorkspace(options)).people.some((person) => person.displayName === "Avery Lantern")).toBe(false);
    const remembered = await query<{ external_id: string }>(
      `SELECT external_id FROM external_entity_refs
       WHERE archive_id = $1 AND connection_id = $2
         AND external_id = ANY($3::text[])`,
      [archiveId, connection.id, ["@I44@", "_UID:rejected-avery-lantern"]],
      options
    );
    expect(remembered.rows).toEqual([]);
  });

  it("uses relationship evidence when a renumbered person also has a corrected fact", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Corrected relationship tree on Ancestry"
      },
      options
    );
    const firstArtifact = await stage(
      connection.id,
      syntheticCorrectedRelationshipGedcom(["@I1@", "@I2@"], "@F1@", "14 APR 1884")
    );
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    await processIntegrationSyncRun(firstRun.id, options);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-corrected-relationship-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const before = await readWorkspace(options);
    const elizaId = before.people.find((person) => person.displayName === "Eliza Northwood")!.id;
    const martinId = before.people.find((person) => person.displayName === "Martin Vale")!.id;

    const correctedArtifact = await stage(
      connection.id,
      syntheticCorrectedRelationshipGedcom(["@P91@", "@P12@"], "@G8@", "14 APR 1885")
    );
    const correctedRun = await startSyncRun(connection.id, { artifactId: correctedArtifact.id }, options);
    await processIntegrationSyncRun(correctedRun.id, options);
    const changes = await listSyncChanges(correctedRun.id, { pageSize: 100 }, options);
    const people = changes.items.filter((change) => change.entityType === "person");

    expect(people).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalId: "@P91@",
        localEntityId: elizaId,
        classification: "remote_only",
        proposedAction: "accept_incoming"
      }),
      expect.objectContaining({ externalId: "@P12@", localEntityId: martinId, classification: "same" })
    ]));
    expect(people.some((change) => change.classification === "deletion")).toBe(false);

    await applyPreparedIntegrationSyncRun(
      correctedRun.id,
      { idempotencyKey: "apply-corrected-relationship-v2", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const after = await readWorkspace(options);
    expect(after.people.filter((person) => person.displayName === "Eliza Northwood")).toHaveLength(1);
    expect(after.people.find((person) => person.id === elizaId)?.birthDate).toBe("14 APR 1885");
  });

  it("publishes normalized genealogy entities and applies their supported canonical links", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Normalized Lantern Bay tree"
      },
      options
    );
    const content = syntheticNormalizedGedcom({
      name: "Eliza /Northwood/",
      birthDate: "4 MAY 1888",
      sourceXref: "@S1@",
      includeChild: true
    });
    const artifact = await stage(connection.id, content);
    const run = await startSyncRun(connection.id, { artifactId: artifact.id }, options);
    await processIntegrationSyncRun(run.id, options);
    const changes = await listSyncChanges(run.id, { pageSize: 100 }, options);

    expect(new Set(changes.items.map((change) => change.entityType))).toEqual(new Set([
      "person", "source", "family", "fact", "relationship", "citation", "media"
    ]));
    const factChange = changes.items.find((change) => change.entityType === "fact")!;
    expect(factChange).toMatchObject({ classification: "remote_only", proposedAction: "accept_incoming" });
    expect(factChange.resolutionPayload).toMatchObject({
      values: {
        incoming: expect.objectContaining({
          personId: expect.stringMatching(/^integration-person-/),
          type: "BIRT",
          date: "4 MAY 1888",
          raw: expect.stringContaining("1 BIRT")
        })
      }
    });

    const preparedRun = await getSyncRun(run.id, options);
    const snapshot = await getIntegrationSnapshot(preparedRun.incomingSnapshotId!, options);
    expect(snapshot.sourceMetadata).toMatchObject({
      canonicalApplySupport: {
        fact: "person_facts",
        relationship: "person_relatives",
        citation: "primary_fact_source_link",
        family: "snapshot_only",
        media: "snapshot_only"
      },
      privacyPreview: { living: 0, private: 3 },
      unsupportedTags: { total: 0, tags: [], truncated: false }
    });

    await applyPreparedIntegrationSyncRun(
      run.id,
      { idempotencyKey: "apply-normalized-lantern-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const workspace = await readWorkspace(options);
    const eliza = workspace.people.find((person) => person.displayName === "Eliza Northwood")!;
    const martin = workspace.people.find((person) => person.displayName === "Martin Vale")!;
    const child = workspace.people.find((person) => person.displayName === "Mira Northwood")!;
    const source = workspace.sources.find((candidate) => candidate.title === "Synthetic Lantern Bay register")!;
    expect(eliza.facts).toEqual([
      expect.objectContaining({
        id: factChange.localEntityId,
        type: "BIRT",
        date: "4 MAY 1888",
        source: source.id,
        privacy: "private"
      })
    ]);
    expect(eliza.relatives).toEqual(expect.arrayContaining([martin.id, child.id]));
    expect(child.relatives).toContain(eliza.id);

    const repeatedArtifact = await stage(connection.id, content);
    const repeatedRun = await startSyncRun(connection.id, { artifactId: repeatedArtifact.id }, options);
    await processIntegrationSyncRun(repeatedRun.id, options);
    const repeatedChanges = await listSyncChanges(repeatedRun.id, { pageSize: 100 }, options);
    expect(repeatedChanges.items.every((change) => change.classification === "same")).toBe(true);
  });

  it("classifies retained extension-only edits on their owning entities using opaque hashes", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Synthetic retained-extension tree"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticRetainedExtensionGedcom({
      personValue: "person sealed alpha",
      factValue: "fact sealed alpha",
      sourceValue: "source sealed alpha"
    }));
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    await processIntegrationSyncRun(firstRun.id, options);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-retained-extensions-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );

    const factArtifact = await stage(connection.id, syntheticRetainedExtensionGedcom({
      personValue: "person sealed alpha",
      factValue: "fact sealed beta",
      sourceValue: "source sealed alpha"
    }));
    const factRun = await startSyncRun(connection.id, { artifactId: factArtifact.id }, options);
    await processIntegrationSyncRun(factRun.id, options);
    const factChanges = await listSyncChanges(factRun.id, { pageSize: 100 }, options);
    expect(factChanges.items.filter((change) => change.classification === "remote_only")
      .map((change) => change.entityType)).toEqual(["fact"]);
    expect(factChanges.items.find((change) => change.entityType === "person")?.classification).toBe("same");
    await applyPreparedIntegrationSyncRun(
      factRun.id,
      { idempotencyKey: "apply-retained-extensions-v2", resolutions: [], acceptAllSafeIncoming: true },
      options
    );

    const primaryArtifact = await stage(connection.id, syntheticRetainedExtensionGedcom({
      personValue: "person sealed beta",
      factValue: "fact sealed beta",
      sourceValue: "source sealed beta"
    }));
    const primaryRun = await startSyncRun(connection.id, { artifactId: primaryArtifact.id }, options);
    await processIntegrationSyncRun(primaryRun.id, options);
    const primaryChanges = await listSyncChanges(primaryRun.id, { pageSize: 100 }, options);
    const extensionChanges = primaryChanges.items.filter((change) => change.classification === "remote_only");
    expect(extensionChanges.map((change) => change.entityType).sort()).toEqual(["person", "source"]);
    expect(primaryChanges.items.find((change) => change.entityType === "fact")?.classification).toBe("same");
    for (const change of extensionChanges) {
      expect(change.incomingHash).toMatch(/^[a-f0-9]{64}$/);
      const incoming = (change.resolutionPayload.values as Record<string, unknown>).incoming;
      expect(JSON.stringify(incoming)).not.toContain("sealed beta");
      expect(incoming).toMatchObject({ retainedExtensionHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    }
  });

  it("keeps unchanged repeated fact ids and classifications when facts are inserted and reordered", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Reordered Lantern Bay evidence"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticReorderedFactsGedcom(false));
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    await processIntegrationSyncRun(firstRun.id, options);
    const firstChanges = await listSyncChanges(firstRun.id, { pageSize: 100 }, options);
    const firstFacts = factChangesByTypeAndDate(firstChanges.items);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-reordered-facts-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );

    const secondArtifact = await stage(connection.id, syntheticReorderedFactsGedcom(true));
    const secondRun = await startSyncRun(connection.id, { artifactId: secondArtifact.id }, options);
    await processIntegrationSyncRun(secondRun.id, options);
    const secondChanges = await listSyncChanges(secondRun.id, { pageSize: 100 }, options);
    const secondFacts = factChangesByTypeAndDate(secondChanges.items);

    for (const key of ["CENS:1900", "CENS:1910", "RESI:1912"]) {
      expect(secondFacts.get(key)).toMatchObject({
        localEntityId: firstFacts.get(key)?.localEntityId,
        classification: "same",
        proposedAction: "no_op"
      });
    }
    expect(secondFacts.get("CENS:1905")).toMatchObject({
      classification: "remote_only",
      proposedAction: "accept_incoming"
    });
  });

  it("keeps normalized identities stable when every GEDCOM xref is renumbered", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Fully renumbered Lantern Bay tree"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticFullyRenumberedNormalizedGedcom({
      people: ["@I1@", "@I2@", "@I3@"],
      family: "@F1@",
      source: "@S1@",
      media: "@M1@"
    }));
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    await processIntegrationSyncRun(firstRun.id, options);
    const firstChanges = await listSyncChanges(firstRun.id, { pageSize: 100 }, options);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-fully-renumbered-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const before = await readWorkspace(options);
    const elizaBefore = before.people.find((person) => person.displayName === "Eliza Northwood")!;
    const importedPersonIds = new Set(before.people
      .filter((person) => ["Eliza Northwood", "Martin Vale", "Mira Northwood"].includes(person.displayName))
      .map((person) => person.id));
    const factBefore = elizaBefore.facts[0];
    const sourceBefore = before.sources.find((source) => source.title === "Synthetic Lantern Bay register")!;

    const secondArtifact = await stage(connection.id, syntheticFullyRenumberedNormalizedGedcom({
      people: ["@P91@", "@P12@", "@P77@"],
      family: "@G8@",
      source: "@Q44@",
      media: "@O63@"
    }));
    const secondRun = await startSyncRun(connection.id, { artifactId: secondArtifact.id }, options);
    await processIntegrationSyncRun(secondRun.id, options);
    const secondChanges = await listSyncChanges(secondRun.id, { pageSize: 100 }, options);
    const normalizedTypes = ["family", "fact", "relationship", "citation", "media"] as const;
    for (const entityType of normalizedTypes) {
      expect(new Set(secondChanges.items
        .filter((change) => change.entityType === entityType && change.classification !== "deletion")
        .map((change) => change.localEntityId)))
        .toEqual(new Set(firstChanges.items
          .filter((change) => change.entityType === entityType)
          .map((change) => change.localEntityId)));
    }
    for (const entityType of ["fact", "citation", "relationship"] as const) {
      const changes = secondChanges.items.filter((change) => change.entityType === entityType);
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.every((change) => change.classification === "same")).toBe(true);
    }
    expect(secondChanges.items.some((change) =>
      normalizedTypes.includes(change.entityType as typeof normalizedTypes[number])
      && change.classification === "deletion"
    )).toBe(false);

    await applyPreparedIntegrationSyncRun(
      secondRun.id,
      { idempotencyKey: "apply-fully-renumbered-v2", resolutions: [] },
      options
    );
    const after = await readWorkspace(options);
    const elizaAfter = after.people.find((person) => person.id === elizaBefore.id)!;
    expect(elizaAfter.facts).toEqual([
      expect.objectContaining({ id: factBefore.id, source: sourceBefore.id })
    ]);
    const importedPeople = after.people.filter((person) => importedPersonIds.has(person.id));
    expect(importedPeople.flatMap((person) => person.facts)).toHaveLength(1);
    for (const person of importedPeople) {
      expect(new Set(person.relatives).size).toBe(person.relatives.length);
      expect(new Set(person.relatives)).toEqual(
        new Set([...importedPersonIds].filter((personId) => personId !== person.id))
      );
    }

    const renumberedFactExternalId = secondChanges.items.find((change) =>
      change.entityType === "fact" && change.classification !== "deletion"
    )!.externalId!;
    const renumberedCitationExternalId = secondChanges.items.find((change) =>
      change.entityType === "citation" && change.classification !== "deletion"
    )!.externalId!;
    const newExternalRefs = await query<{ entity_type: string; external_id: string; local_entity_id: string }>(
      `SELECT entity_type, external_id, local_entity_id
       FROM external_entity_refs
       WHERE archive_id = $1 AND connection_id = $2
         AND external_id = ANY($3::text[])
       ORDER BY entity_type, external_id`,
      [archiveId, connection.id, [
        "@G8@",
        "@P91@",
        renumberedFactExternalId,
        renumberedCitationExternalId,
        "@Q44@",
        "@O63@"
      ]],
      options
    );
    expect(newExternalRefs.rows.map((row) => `${row.entity_type}:${row.external_id}`)).toEqual([
      `citation:${renumberedCitationExternalId}`,
      `fact:${renumberedFactExternalId}`,
      "family:@G8@",
      "media:@O63@",
      "person:@P91@",
      "source:@Q44@"
    ]);
  });

  it("honors nested fact, citation, and relationship decisions after a parent accept", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Nested resolution tree"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticNormalizedGedcom({
      name: "Eliza /Northwood/",
      birthDate: "4 MAY 1888",
      sourceXref: "@S1@",
      includeChild: true
    }));
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    await processIntegrationSyncRun(firstRun.id, options);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-nested-resolution-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const before = await readWorkspace(options);
    const elizaBefore = before.people.find((person) => person.displayName === "Eliza Northwood")!;
    const childBefore = before.people.find((person) => person.displayName === "Mira Northwood")!;
    const oldSource = before.sources.find((source) => source.title === "Synthetic Lantern Bay register")!;
    const factBefore = elizaBefore.facts[0];
    await query(
      "UPDATE person_facts SET privacy = 'sensitive', confidence = 0.97 WHERE archive_id = $1 AND id = $2",
      [archiveId, factBefore.id],
      options
    );
    await query("UPDATE archives SET updated_at = now() + interval '1 second' WHERE id = $1", [archiveId], options);

    const secondArtifact = await stage(connection.id, syntheticNormalizedGedcom({
      name: "Eliza Nora /Northwood/",
      birthDate: "4 MAY 1889",
      sourceXref: "@S2@",
      sourceTitle: "Synthetic Vale register",
      includeChild: false
    }));
    const secondRun = await startSyncRun(connection.id, { artifactId: secondArtifact.id }, options);
    await processIntegrationSyncRun(secondRun.id, options);
    const changes = await listSyncChanges(secondRun.id, { pageSize: 100 }, options);
    const factChange = changes.items.find((change) => change.entityType === "fact")!;
    const citationChange = changes.items.find((change) => change.entityType === "citation")!;
    const relationshipDeletions = changes.items.filter((change) =>
      change.entityType === "relationship" && change.classification === "deletion"
    );
    expect(factChange).toMatchObject({ classification: "conflict", proposedAction: "review" });
    expect(citationChange).toMatchObject({ classification: "remote_only", proposedAction: "accept_incoming" });
    expect(relationshipDeletions.length).toBeGreaterThan(0);

    await applyPreparedIntegrationSyncRun(
      secondRun.id,
      {
        idempotencyKey: "apply-nested-resolution-v2",
        acceptAllSafeIncoming: true,
        resolutions: [
          { changeId: factChange.id, resolution: "accept_incoming" },
          { changeId: citationChange.id, resolution: "keep_local" }
        ]
      },
      options
    );
    const after = await readWorkspace(options);
    const elizaAfter = after.people.find((person) => person.id === elizaBefore.id)!;
    const childAfter = after.people.find((person) => person.id === childBefore.id)!;
    expect(elizaAfter).toMatchObject({ displayName: "Eliza Nora Northwood", birthDate: "4 MAY 1889" });
    expect(elizaAfter.facts).toEqual([
      expect.objectContaining({
        id: factBefore.id,
        date: "4 MAY 1889",
        source: oldSource.id,
        privacy: "sensitive",
        confidence: 0.97
      })
    ]);
    expect(elizaAfter.relatives).toContain(childBefore.id);
    expect(childAfter.relatives).toContain(elizaBefore.id);
  });

  it("keeps local parent research while applying an accepted nested citation", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Keep-local nested resolution tree"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticNormalizedGedcom({
      name: "Eliza /Northwood/",
      birthDate: "4 MAY 1888",
      sourceXref: "@S1@",
      includeChild: true
    }));
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    await processIntegrationSyncRun(firstRun.id, options);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-keep-local-nested-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const before = await readWorkspace(options);
    const elizaBefore = before.people.find((person) => person.displayName === "Eliza Northwood")!;
    const factBefore = elizaBefore.facts[0];
    await query(
      "UPDATE people SET notes = 'Local-only research note' WHERE archive_id = $1 AND id = $2",
      [archiveId, elizaBefore.id],
      options
    );
    await query("UPDATE archives SET updated_at = now() + interval '1 second' WHERE id = $1", [archiveId], options);

    const secondArtifact = await stage(connection.id, syntheticNormalizedGedcom({
      name: "Eliza /Northwood/",
      birthDate: "4 MAY 1888",
      sourceXref: "@S2@",
      sourceTitle: "Synthetic Vale register",
      includeChild: true
    }));
    const secondRun = await startSyncRun(connection.id, { artifactId: secondArtifact.id }, options);
    await processIntegrationSyncRun(secondRun.id, options);
    const changes = await listSyncChanges(secondRun.id, { pageSize: 100 }, options);
    const parentChange = changes.items.find((change) =>
      change.entityType === "person" && change.localEntityId === elizaBefore.id
    )!;
    const citationChange = changes.items.find((change) => change.entityType === "citation")!;
    expect(parentChange).toMatchObject({ classification: "local_only", proposedAction: "keep_local" });
    expect(citationChange).toMatchObject({ classification: "remote_only", proposedAction: "accept_incoming" });

    await applyPreparedIntegrationSyncRun(
      secondRun.id,
      { idempotencyKey: "apply-keep-local-nested-v2", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const after = await readWorkspace(options);
    const elizaAfter = after.people.find((person) => person.id === elizaBefore.id)!;
    const incomingSource = after.sources.find((source) => source.title === "Synthetic Vale register")!;
    expect(elizaAfter.facts.find((fact) => fact.id === factBefore.id)?.source).toBe(incomingSource.id);
    expect(elizaAfter.notes).toBe("Local-only research note");
  });

  it("requires review when renumbered xrefs have ambiguous identity candidates", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Lantern twins on Ancestry"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticDuplicateGedcom(["@I1@", "@I2@"]))
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    await processIntegrationSyncRun(firstRun.id, options);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-lantern-twins-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const beforeIds = new Set((await readWorkspace(options)).people
      .filter((person) => person.displayName === "Avery Lantern")
      .map((person) => person.id));

    const secondArtifact = await stage(connection.id, syntheticDuplicateGedcom(["@P41@", "@P73@"]))
    const secondRun = await startSyncRun(connection.id, { artifactId: secondArtifact.id }, options);
    await processIntegrationSyncRun(secondRun.id, options);
    const changes = await listSyncChanges(secondRun.id, { pageSize: 100 }, options);
    const conflicts = changes.items.filter((change) => change.classification === "conflict");
    expect(conflicts).toHaveLength(2);
    expect(conflicts.every((change) =>
      Array.isArray(change.resolutionPayload.ambiguousLocalEntityIds)
      && change.resolutionPayload.ambiguousLocalEntityIds.length === 2
    )).toBe(true);
    expect(changes.items.some((change) =>
      change.entityType === "person" && change.classification === "remote_only"
    )).toBe(false);

    const candidates = conflicts[0].resolutionPayload.ambiguousLocalEntityIds as string[];
    await applyPreparedIntegrationSyncRun(
      secondRun.id,
      {
        idempotencyKey: "apply-lantern-twins-v2",
        acceptAllSafeIncoming: true,
        resolutions: conflicts.map((change, index) => ({
          changeId: change.id,
          resolution: "accept_incoming" as const,
          localEntityId: candidates[index]
        }))
      },
      options
    );
    const afterIds = new Set((await readWorkspace(options)).people
      .filter((person) => person.displayName === "Avery Lantern")
      .map((person) => person.id));
    expect(afterIds).toEqual(beforeIds);
    const rememberedRefs = await query<{ external_id: string; local_entity_id: string }>(
      `SELECT external_id, local_entity_id FROM external_entity_refs
       WHERE archive_id = $1 AND connection_id = $2 AND entity_type = 'person'
         AND external_id = ANY($3::text[])
       ORDER BY external_id`,
      [archiveId, connection.id, ["@P41@", "@P73@"]],
      options
    );
    expect(new Set(rememberedRefs.rows.map((row) => row.local_entity_id))).toEqual(beforeIds);

    const thirdArtifact = await stage(
      connection.id,
      syntheticDuplicateGedcom(["@P41@", "@P73@"], "Reviewed refresh")
    );
    const thirdRun = await startSyncRun(connection.id, { artifactId: thirdArtifact.id }, options);
    await processIntegrationSyncRun(thirdRun.id, options);
    const thirdChanges = await listSyncChanges(thirdRun.id, { pageSize: 100 }, options);
    const thirdPeople = thirdChanges.items.filter((change) => change.entityType === "person");
    expect(new Set(thirdPeople.map((change) => change.localEntityId))).toEqual(beforeIds);
    expect(thirdPeople.some((change) => change.classification === "conflict")).toBe(false);
    expect(thirdPeople.some((change) => change.classification === "deletion")).toBe(false);
  });

  it("applies field-level conflict choices without overwriting other local research", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Field review tree on Ancestry"
      },
      options
    );
    const firstArtifact = await stage(connection.id, syntheticFieldConflictGedcom("Eliza /Northwood/", "Base note"));
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    await processIntegrationSyncRun(firstRun.id, options);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-field-review-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    const imported = (await readWorkspace(options)).people.find((person) => person.displayName === "Eliza Northwood")!;
    await query(
      `UPDATE people SET notes = 'Local research note' WHERE archive_id = $1 AND id = $2`,
      [archiveId, imported.id],
      options
    );
    await query("UPDATE archives SET updated_at = now() + interval '1 second' WHERE id = $1", [archiveId], options);

    const secondArtifact = await stage(
      connection.id,
      syntheticFieldConflictGedcom("Eliza Nora /Northwood/", "Incoming export note")
    );
    const secondRun = await startSyncRun(connection.id, { artifactId: secondArtifact.id }, options);
    await processIntegrationSyncRun(secondRun.id, options);
    const changes = await listSyncChanges(secondRun.id, { pageSize: 100 }, options);
    const conflict = changes.items.find((change) => change.entityType === "person");
    expect(conflict).toMatchObject({ classification: "conflict", proposedAction: "review" });

    await applyPreparedIntegrationSyncRun(
      secondRun.id,
      {
        idempotencyKey: "apply-field-review-v2",
        resolutions: [{
          changeId: conflict!.id,
          resolution: "keep_local",
          fields: { displayName: "accept_incoming", notes: "keep_local" }
        }]
      },
      options
    );
    expect((await readWorkspace(options)).people.find((person) => person.id === imported.id)).toMatchObject({
      displayName: "Eliza Nora Northwood",
      notes: "Local research note"
    });
  });

  async function stage(connectionId: string, content: string) {
    const bytes = Buffer.from(content, "utf8");
    return createIntegrationArtifact(
      connectionId,
      {
        fileName: "northwood-family.ged",
        contentType: "text/plain",
        size: bytes.length,
        bytes
      },
      options
    );
  }
});

function syntheticGedcom(birthDate: string): string {
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    "0 @I1@ INDI",
    "1 NAME Eliza /Northwood/",
    "1 BIRT",
    `2 DATE ${birthDate}`,
    "2 PLAC Lantern Bay, Wisconsin",
    "0 TRLR"
  ].join("\n");
}

function syntheticCurationGedcom(note: string): string {
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    "0 @I1@ INDI",
    "1 _UID synthetic-avery-lantern",
    "1 NAME Avery /Lantern/",
    "1 BIRT",
    "2 DATE 2 FEB 1882",
    `1 NOTE ${note}`,
    "1 _KS_PRIVACY public",
    "1 _KS_PUBLISHED Y",
    "1 _KS_LIVING deceased",
    "0 TRLR"
  ].join("\n");
}

function syntheticReorderedFactsGedcom(refreshed: boolean): string {
  const fact = (type: string, date: string, place: string) => [
    `1 ${type}`,
    `2 DATE ${date}`,
    `2 PLAC ${place}`
  ];
  const originalFacts = [
    ...fact("CENS", "1900", "Lantern Bay, Wisconsin"),
    ...fact("CENS", "1910", "Lantern Bay, Wisconsin"),
    ...fact("RESI", "1912", "Silver Pine, Wisconsin")
  ];
  const refreshedFacts = [
    ...fact("RESI", "1912", "Silver Pine, Wisconsin"),
    ...fact("CENS", "1910", "Lantern Bay, Wisconsin"),
    ...fact("CENS", "1905", "Lantern Bay, Wisconsin"),
    ...fact("CENS", "1900", "Lantern Bay, Wisconsin")
  ];
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    "0 @I1@ INDI",
    "1 _UID synthetic-avery-northwood",
    "1 NAME Avery /Northwood/",
    ...(refreshed ? refreshedFacts : originalFacts),
    "0 TRLR"
  ].join("\n");
}

function factChangesByTypeAndDate(changes: SyncChange[]) {
  return new Map(changes
    .filter((change) => change.entityType === "fact")
    .map((change) => {
      const values = change.resolutionPayload.values as Record<string, unknown>;
      const incoming = values.incoming as Record<string, unknown> | null;
      return [`${incoming?.type}:${incoming?.date}`, change];
    }));
}

function syntheticRelationshipGedcom(
  people: [string, string, string, string],
  families: [string, string]
): string {
  const [alexVale, martin, alexPike, rowan] = people;
  const [valeFamily, pikeFamily] = families;
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    `0 ${alexVale} INDI`,
    "1 NAME Alex /Northwood/",
    "1 BIRT",
    "2 DATE 14 APR 1884",
    `1 FAMS ${valeFamily}`,
    `0 ${martin} INDI`,
    "1 NAME Martin /Vale/",
    "1 BIRT",
    "2 DATE 3 MAR 1880",
    `1 FAMS ${valeFamily}`,
    `0 ${alexPike} INDI`,
    "1 NAME Alex /Northwood/",
    "1 BIRT",
    "2 DATE 14 APR 1884",
    `1 FAMS ${pikeFamily}`,
    `0 ${rowan} INDI`,
    "1 NAME Rowan /Pike/",
    "1 BIRT",
    "2 DATE 9 NOV 1879",
    `1 FAMS ${pikeFamily}`,
    `0 ${valeFamily} FAM`,
    `1 HUSB ${alexVale}`,
    `1 WIFE ${martin}`,
    `0 ${pikeFamily} FAM`,
    `1 HUSB ${alexPike}`,
    `1 WIFE ${rowan}`,
    "0 TRLR"
  ].join("\n");
}

function syntheticStableIdentityGedcom(people: Array<{
  xref: string;
  uid: string;
  name: string;
  birthDate: string;
}>): string {
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    ...people.flatMap((person) => [
      `0 ${person.xref} INDI`,
      `1 _UID ${person.uid}`,
      `1 NAME ${person.name}`,
      "1 BIRT",
      `2 DATE ${person.birthDate}`
    ]),
    "0 TRLR"
  ].join("\n");
}

function syntheticCorrectedRelationshipGedcom(
  people: [string, string],
  family: string,
  birthDate: string
): string {
  const [eliza, martin] = people;
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    `0 ${eliza} INDI`,
    "1 NAME Eliza /Northwood/",
    "1 BIRT",
    `2 DATE ${birthDate}`,
    `1 FAMS ${family}`,
    `0 ${martin} INDI`,
    "1 NAME Martin /Vale/",
    "1 BIRT",
    "2 DATE 3 MAR 1880",
    `1 FAMS ${family}`,
    `0 ${family} FAM`,
    `1 HUSB ${eliza}`,
    `1 WIFE ${martin}`,
    "0 TRLR"
  ].join("\n");
}

function syntheticNormalizedGedcom(input: {
  name: string;
  birthDate: string;
  sourceXref: string;
  sourceTitle?: string;
  includeChild: boolean;
}): string {
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    "0 @I1@ INDI",
    `1 NAME ${input.name}`,
    "1 BIRT",
    `2 DATE ${input.birthDate}`,
    "2 PLAC Lantern Bay, Wisconsin",
    `2 SOUR ${input.sourceXref}`,
    "3 PAGE register 8, entry 14",
    "1 OBJE @M1@",
    "0 @I2@ INDI",
    "1 NAME Martin /Vale/",
    "0 @I3@ INDI",
    "1 NAME Mira /Northwood/",
    "0 @F1@ FAM",
    "1 HUSB @I1@",
    "1 WIFE @I2@",
    ...(input.includeChild ? ["1 CHIL @I3@"] : []),
    `0 ${input.sourceXref} SOUR`,
    `1 TITL ${input.sourceTitle ?? "Synthetic Lantern Bay register"}`,
    "0 @M1@ OBJE",
    "1 FILE records/lantern-bay-register.jpg",
    "2 FORM image/jpeg",
    "2 TITL Synthetic register image",
    "0 TRLR"
  ].join("\n");
}

function syntheticRetainedExtensionGedcom(input: {
  personValue: string;
  factValue: string;
  sourceValue: string;
}): string {
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    "0 @I1@ INDI",
    "1 NAME Eliza /Northwood/",
    `1 _PRIVATE_LEDGER ${input.personValue}`,
    "1 BIRT",
    "2 DATE 4 MAY 1888",
    `2 _FACT_LEDGER ${input.factValue}`,
    "2 SOUR @S1@",
    "3 PAGE register 8, entry 14",
    "0 @S1@ SOUR",
    "1 TITL Synthetic Lantern Bay register",
    `1 _SOURCE_LEDGER ${input.sourceValue}`,
    "0 TRLR"
  ].join("\n");
}

function syntheticFullyRenumberedNormalizedGedcom(input: {
  people: [string, string, string];
  family: string;
  source: string;
  media: string;
}): string {
  const [eliza, martin, mira] = input.people;
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    `0 ${eliza} INDI`,
    "1 _UID synthetic-eliza-northwood",
    "1 NAME Eliza /Northwood/",
    "1 BIRT",
    "2 DATE 4 MAY 1888",
    "2 PLAC Lantern Bay, Wisconsin",
    `2 SOUR ${input.source}`,
    "3 PAGE register 8, entry 14",
    `1 OBJE ${input.media}`,
    `1 FAMS ${input.family}`,
    `0 ${martin} INDI`,
    "1 _UID synthetic-martin-vale",
    "1 NAME Martin /Vale/",
    `1 FAMS ${input.family}`,
    `0 ${mira} INDI`,
    "1 _UID synthetic-mira-northwood",
    "1 NAME Mira /Northwood/",
    `1 FAMC ${input.family}`,
    `0 ${input.family} FAM`,
    `1 HUSB ${eliza}`,
    `1 WIFE ${martin}`,
    `1 CHIL ${mira}`,
    `0 ${input.source} SOUR`,
    "1 _APID synthetic-lantern-bay-register",
    "1 TITL Synthetic Lantern Bay register",
    `0 ${input.media} OBJE`,
    "1 FILE records/lantern-bay-register.jpg",
    "2 FORM image/jpeg",
    "2 TITL Synthetic register image",
    "0 TRLR"
  ].join("\n");
}

function syntheticDuplicateGedcom(people: [string, string], note?: string): string {
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    ...people.flatMap((xref) => [
      `0 ${xref} INDI`,
      "1 NAME Avery /Lantern/",
      "1 BIRT",
      "2 DATE 2 FEB 1882",
      "2 PLAC Lantern Bay, Wisconsin",
      ...(note ? [`1 NOTE ${note}`] : [])
    ]),
    "0 TRLR"
  ].join("\n");
}

function syntheticFieldConflictGedcom(name: string, note: string): string {
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    "0 @I1@ INDI",
    `1 NAME ${name}`,
    "1 BIRT",
    "2 DATE 14 APR 1884",
    "2 PLAC Lantern Bay, Wisconsin",
    `1 NOTE ${note}`,
    "0 TRLR"
  ].join("\n");
}
