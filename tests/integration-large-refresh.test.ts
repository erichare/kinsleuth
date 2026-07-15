import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  applyPreparedIntegrationSyncRun,
  processIntegrationSyncRun
} from "@/lib/integrations/run-processor";
import {
  createIntegrationArtifact,
  createIntegrationConnection,
  startSyncRun
} from "@/lib/integrations/store";
import {
  createArchiveObjectStorage,
  type PrivateObjectStorageBackend
} from "@/lib/storage/object-storage";
import { readWorkspace } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const largeTestEnabled = process.env.RUN_LARGE_INTEGRATION_TEST === "true";
const describeIfLargeDatabase = databaseUrl && largeTestEnabled ? describe : describe.skip;

const personCount = 50_000;
const artifactCeilingBytes = 128 * 1024 * 1024;
const hostedPreviewBudgetMilliseconds = 270_000;

describeIfLargeDatabase("50,000-person repeatable integration refresh", () => {
  const archiveId = `test-large-integration-${randomUUID()}`;
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
      if (!object) throw new Error("synthetic performance object not found");
      return object.bytes;
    },
    async delete({ key }) {
      objects.delete(key);
    }
  };
  const objectStorage = createArchiveObjectStorage({ backend });
  const options = { archiveId, databaseUrl: databaseUrl!, objectStorage };

  beforeEach(async () => {
    await readWorkspace(options);
  });

  afterEach(async () => {
    await query("DELETE FROM archives WHERE id = $1", [archiveId], options);
    objects.clear();
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  it("previews and remembers a wholly synthetic tree after every GEDCOM xref is renumbered", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Synthetic 50,000-person performance tree"
      },
      options
    );

    const firstBytes = Buffer.from(syntheticLargeGedcom("I"), "utf8");
    expect(firstBytes.byteLength).toBeLessThanOrEqual(artifactCeilingBytes);
    const firstArtifact = await createIntegrationArtifact(
      connection.id,
      {
        fileName: "synthetic-performance-v1.ged",
        contentType: "text/plain",
        size: firstBytes.byteLength,
        bytes: firstBytes
      },
      options
    );
    const firstRun = await startSyncRun(connection.id, { artifactId: firstArtifact.id }, options);
    const firstPreviewStart = performance.now();
    const firstPreview = await processIntegrationSyncRun(firstRun.id, options);
    const firstPreviewMilliseconds = performance.now() - firstPreviewStart;

    expect(firstPreview.run.status).toBe("review_ready");
    expect(firstPreview.counts.people).toBe(personCount);
    expect(
      firstPreviewMilliseconds,
      `initial 50,000-person preview took ${Math.round(firstPreviewMilliseconds)}ms`
    ).toBeLessThan(hostedPreviewBudgetMilliseconds);

    await applyPreparedIntegrationSyncRun(
      firstRun.id,
      {
        idempotencyKey: "apply-synthetic-performance-v1",
        resolutions: [],
        acceptAllSafeIncoming: true
      },
      options
    );

    const secondBytes = Buffer.from(syntheticLargeGedcom("R"), "utf8");
    expect(secondBytes.byteLength).toBeLessThanOrEqual(artifactCeilingBytes);
    const secondArtifact = await createIntegrationArtifact(
      connection.id,
      {
        fileName: "synthetic-performance-renumbered.ged",
        contentType: "text/plain",
        size: secondBytes.byteLength,
        bytes: secondBytes
      },
      options
    );
    const secondRun = await startSyncRun(connection.id, { artifactId: secondArtifact.id }, options);
    const secondPreviewStart = performance.now();
    const secondPreview = await processIntegrationSyncRun(secondRun.id, options);
    const secondPreviewMilliseconds = performance.now() - secondPreviewStart;

    expect(secondPreview.run.status).toBe("review_ready");
    expect(secondPreview.counts.people).toBe(personCount);
    expect(
      secondPreviewMilliseconds,
      `renumbered 50,000-person preview took ${Math.round(secondPreviewMilliseconds)}ms`
    ).toBeLessThan(hostedPreviewBudgetMilliseconds);

    const classifications = await query<{
      entity_type: string;
      classification: string;
      total: number;
    }>(
      `SELECT entity_type, classification, count(*)::integer AS total
       FROM sync_changes
       WHERE archive_id = $1 AND run_id = $2
       GROUP BY entity_type, classification
       ORDER BY entity_type, classification`,
      [archiveId, secondRun.id],
      options
    );
    expect(classifications.rows).toEqual([
      { entity_type: "person", classification: "same", total: personCount }
    ]);

    const persisted = await query<{ people: number; stable_refs: number }>(
      `SELECT
         (SELECT count(*)::integer FROM people WHERE archive_id = $1 AND id LIKE 'integration-person-%') AS people,
         (SELECT count(*)::integer
            FROM external_entity_refs
           WHERE archive_id = $1 AND connection_id = $2
             AND entity_type = 'person' AND external_id LIKE '_UID:%') AS stable_refs`,
      [archiveId, connection.id],
      options
    );
    expect(persisted.rows[0]).toEqual({ people: personCount, stable_refs: personCount });

    process.stdout.write(
      `[large integration refresh] artifact=${firstBytes.byteLength}B initial=${Math.round(firstPreviewMilliseconds)}ms renumbered=${Math.round(secondPreviewMilliseconds)}ms\n`
    );
  }, 900_000);
});

function syntheticLargeGedcom(xrefPrefix: "I" | "R"): string {
  const lines = [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_PERFORMANCE_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    "1 CHAR UTF-8"
  ];
  for (let index = 0; index < personCount; index += 1) {
    const ordinal = String(index + 1).padStart(6, "0");
    lines.push(
      `0 @${xrefPrefix}${ordinal}@ INDI`,
      `1 NAME Synthetic${ordinal} /Fixture/`,
      `1 _UID KINRESOLVE-PERFORMANCE-${ordinal}`
    );
  }
  lines.push("0 TRLR");
  return lines.join("\n");
}
