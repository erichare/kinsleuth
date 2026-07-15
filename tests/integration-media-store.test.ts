import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  MEDIA_OWNERSHIP_ATTESTATION_VERSION,
  listIntegrationMedia,
  reclassifyIntegrationMedia,
  streamIntegrationMedia
} from "@/lib/integrations/media-store";
import { DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION } from "@/lib/integrations/types";
import { createArchiveObjectStorage } from "@/lib/storage/object-storage";
import { readWorkspace } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase("archive-scoped integration media store", () => {
  const firstArchiveId = `test-media-first-${randomUUID()}`;
  const secondArchiveId = `test-media-second-${randomUUID()}`;
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const backend = {
    stat: vi.fn(async ({ key }: { key: string }) => {
      const value = objects.get(key);
      return value ? { key, size: value.bytes.length, contentType: value.contentType } : undefined;
    }),
    put: vi.fn(async () => undefined),
    read: vi.fn(async ({ key }: { key: string }) => objects.get(key)?.bytes ?? Buffer.alloc(0)),
    stream: vi.fn(async ({ key }: { key: string }) => {
      const value = objects.get(key);
      if (!value) throw new Error("not found");
      return (async function* () {
        yield value.bytes;
      })();
    }),
    delete: vi.fn(async () => undefined)
  };
  const objectStorage = createArchiveObjectStorage({ backend });
  const firstOptions = { archiveId: firstArchiveId, databaseUrl: databaseUrl!, objectStorage };
  const secondOptions = { archiveId: secondArchiveId, databaseUrl: databaseUrl!, objectStorage };

  beforeEach(async () => {
    await Promise.all([readWorkspace(firstOptions), readWorkspace(secondOptions)]);
  });

  afterEach(async () => {
    await query("DELETE FROM archives WHERE id = ANY($1::text[])", [[firstArchiveId, secondArchiveId]], firstOptions);
    objects.clear();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  it("lists and streams only the session archive without exposing the private object key", async () => {
    const first = await seedMedia(firstArchiveId, "first synthetic portrait");
    const second = await seedMedia(secondArchiveId, "second synthetic portrait");

    const listed = await listIntegrationMedia({ pageSize: 25 }, firstOptions);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      id: first.id,
      licenseClass: "third_party_restricted",
      privacy: "private",
      publishable: false,
      aiEligible: false,
      mimeType: "image/jpeg"
    });
    expect(JSON.stringify(listed)).not.toContain(first.objectKey);
    expect(JSON.stringify(listed)).not.toContain("objectKey");

    const streamed = await streamIntegrationMedia(first.id, firstOptions);
    const chunks: Buffer[] = [];
    for await (const chunk of streamed.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(first.bytes);

    backend.stat.mockClear();
    await expect(streamIntegrationMedia(second.id, firstOptions)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(backend.stat).not.toHaveBeenCalled();
  });

  it("pages private media with a stable non-overlapping archive-scoped cursor", async () => {
    const seeded = [
      await seedMedia(firstArchiveId, "synthetic page one"),
      await seedMedia(firstArchiveId, "synthetic page two"),
      await seedMedia(firstArchiveId, "synthetic page three")
    ];

    const firstPage = await listIntegrationMedia({ pageSize: 2 }, firstOptions);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBe(firstPage.items[1]?.id);

    const secondPage = await listIntegrationMedia({
      pageSize: 2,
      cursor: firstPage.nextCursor as string
    }, firstOptions);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    const firstIds = firstPage.items.map((item) => item.id);
    const secondIds = secondPage.items.map((item) => item.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
    expect([...firstIds, ...secondIds].sort()).toEqual(seeded.map((item) => item.id).sort());
  });

  it("reclassifies only with the current ownership attestation and keeps publication and AI blocked", async () => {
    const first = await seedMedia(firstArchiveId, "owned synthetic portrait");
    const second = await seedMedia(secondArchiveId, "other archive portrait");

    await expect(reclassifyIntegrationMedia(first.id, {
      attestationVersion: "obsolete-ownership-v0",
      attestedBy: "owner-1"
    }, firstOptions)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(reclassifyIntegrationMedia(second.id, {
      attestationVersion: MEDIA_OWNERSHIP_ATTESTATION_VERSION,
      attestedBy: "owner-1"
    }, firstOptions)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const updated = await reclassifyIntegrationMedia(first.id, {
      attestationVersion: MEDIA_OWNERSHIP_ATTESTATION_VERSION,
      attestedBy: "owner-1"
    }, firstOptions);
    expect(updated).toMatchObject({
      licenseClass: "user_owned",
      privacy: "private",
      publishable: false,
      aiEligible: false,
      ownershipAttestation: {
        version: MEDIA_OWNERSHIP_ATTESTATION_VERSION,
        actorId: "owner-1",
        attestedAt: expect.any(String)
      }
    });

    await expect(query(
      "UPDATE integration_media_objects SET ai_eligible = true WHERE archive_id = $1 AND id = $2",
      [firstArchiveId, first.id],
      firstOptions
    )).rejects.toThrow();
    await expect(query(
      "UPDATE integration_media_objects SET publishable = true WHERE archive_id = $1 AND id = $2",
      [firstArchiveId, first.id],
      firstOptions
    )).rejects.toThrow();
  });

  async function seedMedia(archiveId: string, label: string) {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(label, "utf8")]);
    const mediaSha256 = createHash("sha256").update(bytes).digest("hex");
    const artifactSha256 = createHash("sha256").update(`${label}:artifact`).digest("hex");
    const suffix = randomUUID();
    const connectionId = `connection-${suffix}`;
    const artifactId = `artifact-${suffix}`;
    const snapshotId = `snapshot-${suffix}`;
    const runId = `run-${suffix}`;
    const mediaId = `integration-media-${suffix}`;
    const objectKey = `archives/${archiveId}/integration-media/${mediaSha256}`;
    const options = { archiveId, databaseUrl: databaseUrl! };

    await query(
      `INSERT INTO integration_connections (
         archive_id, id, provider, authority, display_name, capabilities
       ) VALUES ($1, $2, 'family_tree_maker', 'family_tree_maker', $3, '{"snapshotImport":true,"incrementalPull":false,"media":true,"oauth":false,"writeback":false}'::jsonb)`,
      [archiveId, connectionId, label],
      options
    );
    await query(
      `INSERT INTO integration_artifacts (
         archive_id, id, connection_id, file_name, artifact_key, sha256, content_type, size_bytes, state
       ) VALUES ($1, $2, $3, 'synthetic.zip', $4, $5, 'application/zip', 10, 'ready')`,
      [archiveId, artifactId, connectionId, `archives/${archiveId}/integration-artifacts/${artifactSha256}`, artifactSha256],
      options
    );
    await query(
      `INSERT INTO integration_snapshots (
         archive_id, id, connection_id, artifact_key, sha256, parser_version
       ) VALUES ($1, $2, $3, $4, $5, 'synthetic-v1')`,
      [archiveId, snapshotId, connectionId, `archives/${archiveId}/integration-artifacts/${artifactSha256}`, artifactSha256],
      options
    );
    await query(
      `INSERT INTO sync_runs (
         archive_id, id, connection_id, artifact_id, incoming_snapshot_id, status,
         media_rights_acknowledgement_version, media_rights_acknowledged_by, media_rights_acknowledged_at
       ) VALUES ($1, $2, $3, $4, $5, 'applied', $6, 'owner-1', now())`,
      [archiveId, runId, connectionId, artifactId, snapshotId, DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION],
      options
    );
    await query(
      `INSERT INTO integration_media_objects (
         archive_id, id, connection_id, snapshot_id, run_id, artifact_id,
         object_key, source_provider, source_artifact_sha256, source_gedcom_path,
         source_normalized_path, source_archive_path, sha256, mime_type, size_bytes,
         rights_acknowledgement_version, rights_acknowledged_by, rights_acknowledged_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'family_tree_maker', $8,
         'media\\portrait.jpg', 'media/portrait.jpg', 'export/media/portrait.jpg',
         $9, 'image/jpeg', $10, $11, 'owner-1', now()
       )`,
      [
        archiveId,
        mediaId,
        connectionId,
        snapshotId,
        runId,
        artifactId,
        objectKey,
        artifactSha256,
        mediaSha256,
        bytes.length,
        DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION
      ],
      options
    );
    objects.set(objectKey, { bytes, contentType: "image/jpeg" });
    return { id: mediaId, objectKey, bytes };
  }
});
