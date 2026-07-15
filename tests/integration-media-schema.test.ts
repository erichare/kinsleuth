import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const migrationName = "009_integration_media_objects.sql";

describe("integration media audit migration contract", () => {
  it("uses explicit zero-or-all tuple checks instead of nullable boolean expressions", async () => {
    const sql = (await readFile(path.join(process.cwd(), "db", "migrations", migrationName), "utf8"))
      .toLowerCase();

    expect(sql.match(/num_nonnulls\(/g)?.length).toBeGreaterThanOrEqual(8);
    expect(sql).toMatch(/integration_upload_intents_media_rights_acknowledgement_check[\s\S]*?= 0[\s\S]*?= 3/);
    expect(sql).toMatch(/integration_artifacts_media_rights_acknowledgement_check[\s\S]*?= 0[\s\S]*?= 3/);
    expect(sql).toMatch(/sync_runs_media_rights_acknowledgement_check[\s\S]*?= 0[\s\S]*?= 3/);
    expect(sql).toMatch(/license_class = 'third_party_restricted'[\s\S]*?= 0/);
    expect(sql).toMatch(/license_class = 'user_owned'[\s\S]*?= 3/);
  });
});

describeIfDatabase("installed integration media audit constraints", () => {
  const archiveId = `test-media-audit-${randomUUID()}`;
  const connectionId = `connection-${randomUUID()}`;
  const options = { databaseUrl: databaseUrl! };

  beforeEach(async () => {
    await query(
      `INSERT INTO archives (id, name, slug)
       VALUES ($1, 'Synthetic media audit archive', $2)`,
      [archiveId, archiveId],
      options
    );
    await query(
      `INSERT INTO integration_connections (
         archive_id, id, provider, authority, display_name, capabilities
       ) VALUES (
         $1, $2, 'family_tree_maker', 'family_tree_maker', 'Synthetic desktop source',
         '{"snapshotImport":true,"incrementalPull":false,"media":true,"oauth":false,"writeback":false}'::jsonb
       )`,
      [archiveId, connectionId],
      options
    );
  });

  afterEach(async () => {
    await query("DELETE FROM archives WHERE id = $1", [archiveId], options);
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  it.each([
    ["integration_upload_intents", insertPartialUploadIntent],
    ["integration_artifacts", insertPartialArtifact],
    ["sync_runs", insertPartialSyncRun]
  ])("rejects a partially populated rights-audit tuple in %s", async (_table, insertPartial) => {
    await expect(insertPartial({ archiveId, connectionId, options })).rejects.toThrow();
  });

  it("accepts only ownership attestations that match the media license class", async () => {
    const fixture = await seedMediaParents({ archiveId, connectionId, options });

    await expect(insertMedia(fixture, {
      licenseClass: "third_party_restricted",
      ownershipVersion: "media-ownership-v1",
      ownershipActor: "synthetic-owner",
      ownershipAt: new Date()
    })).rejects.toThrow();
    await expect(insertMedia(fixture, {
      licenseClass: "user_owned"
    })).rejects.toThrow();
    await expect(insertMedia(fixture, {
      licenseClass: "user_owned",
      ownershipVersion: "media-ownership-v1"
    })).rejects.toThrow();

    await expect(insertMedia(fixture, {
      licenseClass: "third_party_restricted"
    })).resolves.toBeUndefined();
    await expect(insertMedia(fixture, {
      licenseClass: "user_owned",
      ownershipVersion: "media-ownership-v1",
      ownershipActor: "synthetic-owner",
      ownershipAt: new Date()
    })).resolves.toBeUndefined();
  });
});

type FixtureOptions = {
  archiveId: string;
  connectionId: string;
  options: { databaseUrl: string };
};

async function insertPartialUploadIntent(fixture: FixtureOptions): Promise<void> {
  await query(
    `INSERT INTO integration_upload_intents (
       archive_id, id, connection_id, file_name, content_type, declared_size_bytes,
       staging_key, backend, expires_at, media_rights_acknowledgement_version
     ) VALUES ($1, $2, $3, 'synthetic.zip', 'application/zip', 100, $4, 's3', now() + interval '5 minutes', 'desktop-media-rights-v1')`,
    [fixture.archiveId, `intent-${randomUUID()}`, fixture.connectionId, `archives/${fixture.archiveId}/staging/${randomUUID()}`],
    fixture.options
  );
}

async function insertPartialArtifact(fixture: FixtureOptions): Promise<void> {
  const digest = sha256(randomUUID());
  await query(
    `INSERT INTO integration_artifacts (
       archive_id, id, connection_id, file_name, artifact_key, sha256, content_type,
       size_bytes, state, media_rights_acknowledged_by
     ) VALUES ($1, $2, $3, 'synthetic.zip', $4, $5, 'application/zip', 100, 'ready', 'synthetic-owner')`,
    [fixture.archiveId, `artifact-${randomUUID()}`, fixture.connectionId, `archives/${fixture.archiveId}/artifacts/${digest}`, digest],
    fixture.options
  );
}

async function insertPartialSyncRun(fixture: FixtureOptions): Promise<void> {
  await query(
    `INSERT INTO sync_runs (
       archive_id, id, connection_id, status, media_rights_acknowledged_at
     ) VALUES ($1, $2, $3, 'failed', now())`,
    [fixture.archiveId, `run-${randomUUID()}`, fixture.connectionId],
    fixture.options
  );
}

async function seedMediaParents(fixture: FixtureOptions) {
  const artifactId = `artifact-${randomUUID()}`;
  const snapshotId = `snapshot-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  const artifactSha256 = sha256(randomUUID());
  const artifactKey = `archives/${fixture.archiveId}/artifacts/${artifactSha256}`;
  await query(
    `INSERT INTO integration_artifacts (
       archive_id, id, connection_id, file_name, artifact_key, sha256, content_type,
       size_bytes, state, media_rights_acknowledgement_version,
       media_rights_acknowledged_by, media_rights_acknowledged_at
     ) VALUES (
       $1, $2, $3, 'synthetic.zip', $4, $5, 'application/zip', 100, 'ready',
       'desktop-media-rights-v1', 'synthetic-owner', now()
     )`,
    [fixture.archiveId, artifactId, fixture.connectionId, artifactKey, artifactSha256],
    fixture.options
  );
  await query(
    `INSERT INTO integration_snapshots (
       archive_id, id, connection_id, artifact_key, sha256, parser_version
     ) VALUES ($1, $2, $3, $4, $5, 'synthetic-v1')`,
    [fixture.archiveId, snapshotId, fixture.connectionId, artifactKey, artifactSha256],
    fixture.options
  );
  await query(
    `INSERT INTO sync_runs (
       archive_id, id, connection_id, artifact_id, incoming_snapshot_id, status,
       media_rights_acknowledgement_version, media_rights_acknowledged_by,
       media_rights_acknowledged_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'applied', 'desktop-media-rights-v1', 'synthetic-owner', now()
     )`,
    [fixture.archiveId, runId, fixture.connectionId, artifactId, snapshotId],
    fixture.options
  );
  return { ...fixture, artifactId, artifactSha256, snapshotId, runId };
}

async function insertMedia(
  fixture: Awaited<ReturnType<typeof seedMediaParents>>,
  ownership: {
    licenseClass: "third_party_restricted" | "user_owned";
    ownershipVersion?: string;
    ownershipActor?: string;
    ownershipAt?: Date;
  }
): Promise<void> {
  const mediaSha256 = sha256(randomUUID());
  const mediaId = `media-${randomUUID()}`;
  const sourcePath = `media/${mediaId}.jpg`;
  await query(
    `INSERT INTO integration_media_objects (
       archive_id, id, connection_id, snapshot_id, run_id, artifact_id, object_key,
       source_provider, source_artifact_sha256, source_gedcom_path,
       source_normalized_path, source_archive_path, sha256, mime_type, size_bytes,
       license_class, rights_acknowledgement_version, rights_acknowledged_by,
       rights_acknowledged_at, ownership_attestation_version, ownership_attested_by,
       ownership_attested_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, 'family_tree_maker', $8, $9, $9, $9,
       $10, 'image/jpeg', 100, $11, 'desktop-media-rights-v1', 'synthetic-owner',
       now(), $12, $13, $14
     )`,
    [
      fixture.archiveId,
      mediaId,
      fixture.connectionId,
      fixture.snapshotId,
      fixture.runId,
      fixture.artifactId,
      `archives/${fixture.archiveId}/integration-media/${mediaSha256}`,
      fixture.artifactSha256,
      sourcePath,
      mediaSha256,
      ownership.licenseClass,
      ownership.ownershipVersion ?? null,
      ownership.ownershipActor ?? null,
      ownership.ownershipAt ?? null
    ],
    fixture.options
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
