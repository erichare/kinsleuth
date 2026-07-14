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
  getSyncRun,
  listSyncChanges,
  startSyncRun
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
      { idempotencyKey: "apply-northwood-v1", resolutions: [] },
      options
    );
    expect(applied.run).toMatchObject({ status: "applied", backupId: expect.any(String) });
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
      { idempotencyKey: "apply-northwood-v2", resolutions: [] },
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
