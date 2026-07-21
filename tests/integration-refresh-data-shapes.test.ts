import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  applyPreparedIntegrationSyncRun,
  processIntegrationSyncRun
} from "@/lib/integrations/run-processor";
import {
  createIntegrationArtifact,
  createIntegrationConnection,
  listSyncChanges,
  startSyncRun
} from "@/lib/integrations/store";
import {
  createArchiveObjectStorage,
  type PrivateObjectStorageBackend
} from "@/lib/storage/object-storage";
import { readWorkspace } from "@/lib/workspace-store";
import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

/**
 * Real provider exports repeat identifiers that are unique in a spec-perfect
 * file: a child linked to one family as both natural and adopted, duplicate
 * source catalog entries sharing an `_APID`, user reference numbers reused
 * across people. None of these shapes may kill preparation with a terminal
 * `invalid_input` failure — that regression rejected legitimate uploads with
 * an unactionable message.
 */
describeIfDatabase("integration refresh tolerates duplicated identifiers in legitimate exports", () => {
  const archiveId = `test-data-shapes-${randomUUID()}`;
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const backend: PrivateObjectStorageBackend = {
    async stat({ key }) {
      const object = objects.get(key);
      return object ? { key, size: object.bytes.length, contentType: object.contentType } : undefined;
    },
    async put({ key, bytes, contentType }) {
      objects.set(key, { bytes: Buffer.from(bytes), contentType });
    },
    async read({ key }) {
      const object = objects.get(key);
      if (!object) throw new Error("synthetic object not found");
      return object.bytes;
    },
    async delete({ key }) {
      objects.delete(key);
    }
  };
  const objectStorage = createArchiveObjectStorage({ backend });
  const options = { archiveId, databaseUrl: databaseUrl!, objectStorage };

  beforeEach(async () => {
    await provisionTestArchive(options);
  });

  afterEach(async () => {
    await query("DELETE FROM archives WHERE id = $1", [archiveId], options);
    objects.clear();
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  async function preview(gedcomLines: string[]) {
    const connection = await createIntegrationConnection(
      { provider: "ancestry_export", authority: "ancestry", displayName: "Synthetic shape export" },
      options
    );
    const followUp = await followUpPreview(connection.id, gedcomLines);
    return { connection, ...followUp };
  }

  async function followUpPreview(connectionId: string, gedcomLines: string[]) {
    const bytes = Buffer.from(gedcomLines.join("\r\n"), "utf8");
    const artifact = await createIntegrationArtifact(
      connectionId,
      { fileName: "synthetic-shapes.ged", contentType: "text/plain", size: bytes.byteLength, bytes },
      options
    );
    const run = await startSyncRun(connectionId, { artifactId: artifact.id }, options);
    const preview = await processIntegrationSyncRun(run.id, options);
    return { run, preview };
  }

  async function allChanges(runId: string) {
    const changes = [];
    let cursor: string | undefined;
    do {
      const page = await listSyncChanges(runId, { cursor, limit: 100 }, options);
      changes.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return changes;
  }

  const head = [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_SHAPE_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8"
  ];

  it("previews a child linked to the same family twice as one membership and one edge", async () => {
    const { run, preview: result } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "0 @I2@ INDI",
      "1 NAME Amarantha /Fictionford/",
      "0 @I3@ INDI",
      "1 NAME Peregrine /Fictionford/",
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 WIFE @I2@",
      "1 CHIL @I3@",
      "2 _FREL Natural",
      "2 _MREL Natural",
      "1 CHIL @I3@",
      "2 _FREL Adopted",
      "2 _MREL Adopted",
      "0 TRLR"
    ]);

    expect(result.run.status).toBe("review_ready");
    expect(result.counts.people).toBe(3);
    // One spouse edge plus one parent_child edge per parent; the repeated
    // CHIL pointer collapses into a single membership.
    expect(result.counts.relationships).toBe(3);
    const familyChanges = (await allChanges(run.id)).filter((change) => change.entityType === "family");
    expect(familyChanges).toHaveLength(1);
    expect(familyChanges[0].resolutionPayload).toMatchObject({
      values: { incoming: expect.objectContaining({ children: [expect.any(String)] }) }
    });
  });

  it("previews and applies two source catalog entries sharing one level-1 _APID", async () => {
    const { run, preview: result } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "1 BIRT",
      "2 DATE 1 JAN 1850",
      "2 SOUR @S1@",
      "3 PAGE Year: 1850",
      "3 _APID 1,8054::1234567",
      "0 @S1@ SOUR",
      "1 TITL 1850 Fictional Census",
      "1 AUTH Fictional Bureau",
      "1 _APID 1,8054::0",
      "0 @S2@ SOUR",
      "1 TITL 1850 Fictional Census (duplicate catalog entry)",
      "1 AUTH Fictional Bureau",
      "1 _APID 1,8054::0",
      "0 TRLR"
    ]);

    expect(result.run.status).toBe("review_ready");
    const sourceChanges = (await allChanges(run.id)).filter((change) => change.entityType === "source");
    expect(sourceChanges).toHaveLength(2);
    const localIds = new Set(sourceChanges.map((change) => change.localEntityId));
    expect(localIds.size).toBe(2);

    const applied = await applyPreparedIntegrationSyncRun(
      run.id,
      { idempotencyKey: "apply-shared-apid", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect(applied.run.status).toBe("applied");

    const refs = await query<{ external_id: string; local_entity_id: string }>(
      "SELECT external_id, local_entity_id FROM external_entity_refs WHERE archive_id = $1 AND entity_type = 'source'",
      [archiveId],
      options
    );
    const rememberedExternalIds = refs.rows.map((row) => row.external_id);
    expect(rememberedExternalIds).toEqual(expect.arrayContaining(["@S1@", "@S2@"]));
    // The shared catalog identifier maps to no single entity and is never
    // remembered as a one-to-one identity.
    expect(rememberedExternalIds.filter((externalId) => externalId.startsWith("_APID:"))).toEqual([]);
  });

  it("previews and applies two people sharing one level-1 REFN as distinct people", async () => {
    const { run, preview: result } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "1 REFN 42",
      "0 @I2@ INDI",
      "1 NAME Amarantha /Fictionford/",
      "1 REFN 42",
      "0 TRLR"
    ]);

    expect(result.run.status).toBe("review_ready");
    const personChanges = (await allChanges(run.id)).filter((change) => change.entityType === "person");
    expect(personChanges).toHaveLength(2);
    expect(new Set(personChanges.map((change) => change.localEntityId)).size).toBe(2);

    const applied = await applyPreparedIntegrationSyncRun(
      run.id,
      { idempotencyKey: "apply-shared-refn", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect(applied.run.status).toBe("applied");

    // Both people survive the apply as distinct workspace entities; a shared
    // reference number must not collapse them onto one local identity.
    const workspace = await readWorkspace(options);
    const workspaceIds = new Set(workspace.people.map((person) => person.id));
    for (const change of personChanges) {
      expect(workspaceIds.has(change.localEntityId!)).toBe(true);
    }
    const refs = await query<{ external_id: string }>(
      "SELECT external_id FROM external_entity_refs WHERE archive_id = $1 AND entity_type = 'person'",
      [archiveId],
      options
    );
    expect(refs.rows.map((row) => row.external_id)).toEqual(expect.arrayContaining(["@I1@", "@I2@"]));
    expect(refs.rows.filter((row) => row.external_id.startsWith("REFN:"))).toEqual([]);
  });

  it("keeps the original person stable when a remembered-unique REFN becomes duplicated on re-import", async () => {
    // Import 1: @I1@ carries a unique REFN, so `person:REFN:42 -> local id`
    // is remembered as a one-to-one identity mapping on apply.
    const { connection, run: firstRun, preview: firstResult } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "1 REFN 42",
      "0 TRLR"
    ]);
    expect(firstResult.run.status).toBe("review_ready");
    const firstPersonChanges = (await allChanges(firstRun.id)).filter(
      (change) => change.entityType === "person"
    );
    expect(firstPersonChanges).toHaveLength(1);
    const originalLocalId = firstPersonChanges[0].localEntityId!;
    const applied = await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-unique-refn-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect(applied.run.status).toBe("applied");

    // Import 2 on the same connection: the id is now shared — a second,
    // distinct person also claims REFN 42. The original record precedes the
    // newcomer in file order, matching how a provider export grows.
    const { run: secondRun, preview: secondResult } = await followUpPreview(connection.id, [
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "1 REFN 42",
      "0 @I2@ INDI",
      "1 NAME Amarantha /Fictionford/",
      "1 REFN 42",
      "0 TRLR"
    ]);
    expect(secondResult.run.status).toBe("review_ready");
    const personChanges = (await allChanges(secondRun.id)).filter(
      (change) => change.entityType === "person"
    );
    expect(personChanges).toHaveLength(2);

    // The original keeps its local id — review decisions and links attached
    // to that entity stay valid — and re-imports as an unchanged record.
    const original = personChanges.find((change) => change.externalId === "@I1@")!;
    expect(original.localEntityId).toBe(originalLocalId);
    expect(original.classification).toBe("same");

    // The newcomer is exactly one addition under a distinct local id; the
    // now-shared REFN must not manufacture a phantom add/delete pair for the
    // original entity.
    const added = personChanges.find((change) => change.externalId === "@I2@")!;
    expect(added.classification).toBe("remote_only");
    expect(added.localEntityId).not.toBe(originalLocalId);
    expect(personChanges.filter((change) => change.classification === "remote_only")).toHaveLength(1);
    expect(personChanges.some((change) => change.classification === "deletion")).toBe(false);

    const secondApplied = await applyPreparedIntegrationSyncRun(
      secondRun.id,
      { idempotencyKey: "apply-unique-refn-v2", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect(secondApplied.run.status).toBe("applied");
    const workspace = await readWorkspace(options);
    const workspaceIds = new Set(workspace.people.map((person) => person.id));
    expect(workspaceIds.has(originalLocalId)).toBe(true);
    expect(workspaceIds.has(added.localEntityId!)).toBe(true);

    // The remembered mapping still points the shared REFN at the original
    // entity; the second apply must not re-remember it for anyone else.
    const refs = await query<{ external_id: string; local_entity_id: string }>(
      "SELECT external_id, local_entity_id FROM external_entity_refs WHERE archive_id = $1 AND entity_type = 'person' AND external_id LIKE 'REFN:%'",
      [archiveId],
      options
    );
    expect(refs.rows).toEqual([{ external_id: "REFN:42", local_entity_id: originalLocalId }]);
  });

  it("pins first-come inheritance when a duplicated REFN's impostor precedes the original", async () => {
    // KNOWN pre-existing quirk (documented during review of the duplicate
    // provider-id fixes, not introduced by them): identity resolution walks
    // incoming records in file order and hands a remembered provider-id
    // mapping to the FIRST record that claims it. When a remembered-unique
    // REFN becomes duplicated AND the impostor precedes the original in file
    // order, the impostor inherits the original's local id and the original
    // is reseeded under a fresh id — the ids swap. This test pins the current
    // behavior so any future fix must consciously update these assertions
    // rather than regress silently.
    const { connection, run: firstRun } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "1 REFN 42",
      "0 TRLR"
    ]);
    const originalLocalId = (await allChanges(firstRun.id)).find(
      (change) => change.entityType === "person"
    )!.localEntityId!;
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-impostor-order-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );

    const { run: secondRun, preview: secondResult } = await followUpPreview(connection.id, [
      ...head,
      "0 @I9@ INDI",
      "1 NAME Amarantha /Fictionford/",
      "1 REFN 42",
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "1 REFN 42",
      "0 TRLR"
    ]);
    expect(secondResult.run.status).toBe("review_ready");
    const personChanges = (await allChanges(secondRun.id)).filter(
      (change) => change.entityType === "person"
    );
    expect(personChanges).toHaveLength(2);

    // CURRENT (undesired but tolerated) behavior: the impostor @I9@ inherits
    // the original's local id via the remembered `REFN:42` mapping...
    const impostor = personChanges.find((change) => change.externalId === "@I9@")!;
    expect(impostor.localEntityId).toBe(originalLocalId);
    // ...and the original @I1@ is pushed onto a fresh local id.
    const original = personChanges.find((change) => change.externalId === "@I1@")!;
    expect(original.localEntityId).not.toBe(originalLocalId);
    // Nothing is reported as a deletion, but the swap surfaces as churn on
    // both rows instead of `same` + one addition: the impostor reads as a
    // remote edit of the inherited entity, and the original — whose fresh
    // local id has no workspace row yet while its content still matches the
    // base snapshot — reads as a local-only divergence.
    expect(personChanges.some((change) => change.classification === "deletion")).toBe(false);
    expect(impostor.classification).toBe("remote_only");
    expect(original.classification).toBe("local_only");
  });

  it("keeps both people stable when a duplicated REFN becomes unique on re-import", async () => {
    // Import 1: two distinct people share REFN 42, so the shared id is never
    // remembered — but each raw xref -> local id mapping is.
    const { connection, run: firstRun, preview: firstResult } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "1 REFN 42",
      "0 @I2@ INDI",
      "1 NAME Amarantha /Fictionford/",
      "1 REFN 42",
      "0 TRLR"
    ]);
    expect(firstResult.run.status).toBe("review_ready");
    const firstPersonChanges = (await allChanges(firstRun.id)).filter(
      (change) => change.entityType === "person"
    );
    expect(firstPersonChanges).toHaveLength(2);
    const localIdByXref = new Map(
      firstPersonChanges.map((change) => [change.externalId, change.localEntityId!])
    );
    expect(new Set(localIdByXref.values()).size).toBe(2);
    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      { idempotencyKey: "apply-shared-refn-transition-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );

    // Import 2: the provider cleaned its data — REFN 42 now belongs only to
    // @I1@. Both people must keep their local ids via the remembered xrefs.
    const { run: secondRun, preview: secondResult } = await followUpPreview(connection.id, [
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "1 REFN 42",
      "0 @I2@ INDI",
      "1 NAME Amarantha /Fictionford/",
      "0 TRLR"
    ]);
    expect(secondResult.run.status).toBe("review_ready");
    const personChanges = (await allChanges(secondRun.id)).filter(
      (change) => change.entityType === "person"
    );
    expect(personChanges).toHaveLength(2);
    for (const change of personChanges) {
      expect(change.localEntityId).toBe(localIdByXref.get(change.externalId));
    }
    // No phantom churn: neither person is re-added under a new id and no
    // remembered entity is reported deleted.
    expect(personChanges.some((change) => change.classification === "remote_only")).toBe(false);
    expect(personChanges.some((change) => change.classification === "deletion")).toBe(false);

    const secondApplied = await applyPreparedIntegrationSyncRun(
      secondRun.id,
      { idempotencyKey: "apply-shared-refn-transition-v2", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect(secondApplied.run.status).toBe("applied");
    const workspace = await readWorkspace(options);
    const workspaceIds = new Set(workspace.people.map((person) => person.id));
    for (const localId of localIdByXref.values()) {
      expect(workspaceIds.has(localId)).toBe(true);
    }
    // With the duplication resolved, the now-unique REFN may be remembered —
    // and only for the single person that still carries it.
    const refs = await query<{ external_id: string; local_entity_id: string }>(
      "SELECT external_id, local_entity_id FROM external_entity_refs WHERE archive_id = $1 AND entity_type = 'person' AND external_id LIKE 'REFN:%'",
      [archiveId],
      options
    );
    expect(refs.rows).toEqual([{ external_id: "REFN:42", local_entity_id: localIdByXref.get("@I1@") }]);
  });

  it("previews a family whose parent slots repeat one person without a self-spouse edge", async () => {
    const { preview: result } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "0 @I3@ INDI",
      "1 NAME Peregrine /Fictionford/",
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 WIFE @I1@",
      "1 CHIL @I3@",
      "0 TRLR"
    ]);

    expect(result.run.status).toBe("review_ready");
    expect(result.counts.relationships).toBe(1);
  });
});
