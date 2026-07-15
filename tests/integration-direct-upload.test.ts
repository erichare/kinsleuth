import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  cleanupExpiredDirectIntegrationUploadIntents,
  completeDirectIntegrationUpload,
  maximumDirectIntegrationArtifactBytes,
  stageDirectIntegrationUpload
} from "@/lib/integrations/direct-upload";
import {
  createIntegrationArtifact,
  createIntegrationConnection,
  startSyncRun
} from "@/lib/integrations/store";
import { DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION } from "@/lib/integrations/types";
import { createArchiveObjectStorage } from "@/lib/storage/object-storage";
import type { DirectUploadTicketIssuer } from "@/lib/storage/direct-upload-ticket";
import { readWorkspace } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase("direct private integration uploads", () => {
  const firstArchiveId = `test-direct-upload-a-${randomUUID()}`;
  const secondArchiveId = `test-direct-upload-b-${randomUUID()}`;
  let now: Date;
  let backend: ReturnType<typeof createStreamingMemoryBackend>;
  let ticketIssuer: DirectUploadTicketIssuer;
  let issuedKey: string | undefined;
  let firstOptions: ReturnType<typeof optionsFor>;
  let secondOptions: ReturnType<typeof optionsFor>;

  beforeEach(async () => {
    now = new Date("2026-07-14T20:00:00.000Z");
    backend = createStreamingMemoryBackend();
    const objectStorage = createArchiveObjectStorage({ backend });
    ticketIssuer = {
      backend: "s3",
      issue: vi.fn(async (input) => {
        issuedKey = input.key;
        return {
          strategy: "presigned_post" as const,
          method: "POST" as const,
          url: "https://private-upload.example/presigned",
          fields: {
            key: input.key,
            "Content-Type": input.contentType,
            "Cache-Control": "private, no-store",
            policy: "synthetic-policy"
          },
          expiresAt: input.expiresAt.toISOString()
        };
      })
    };
    firstOptions = optionsFor(firstArchiveId, objectStorage, ticketIssuer, () => now);
    secondOptions = optionsFor(secondArchiveId, objectStorage, ticketIssuer, () => now);
    await readWorkspace(firstOptions);
    await readWorkspace(secondOptions);
  });

  afterEach(async () => {
    await query(
      "DELETE FROM archives WHERE id = ANY($1::text[])",
      [[firstArchiveId, secondArchiveId]],
      { databaseUrl: databaseUrl! }
    );
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  it("streams, validates, atomically consumes, and idempotently replays a direct upload", async () => {
    const connection = await ancestryConnection(firstOptions, "Synthetic direct upload");
    const bytes = Buffer.from("0 HEAD\n1 SOUR KIN_RESOLVE_SYNTHETIC\n0 TRLR", "utf8");
    const staged = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "synthetic-tree.ged", contentType: "text/plain", size: bytes.length },
      firstOptions
    );

    expect(staged.intent).not.toHaveProperty("stagingKey");
    expect(staged.intent).not.toHaveProperty("backend");
    expect(issuedKey).toMatch(new RegExp(`^archives/${firstArchiveId}/integration-upload-staging/[a-f0-9-]+\\.ged$`));
    backend.set(issuedKey!, bytes, "text/plain", "etag-v1");

    const completed = await completeDirectIntegrationUpload(connection.id, staged.intent.id, firstOptions);
    expect(completed).toMatchObject({
      replayed: false,
      artifact: {
        connectionId: connection.id,
        fileName: "synthetic-tree.ged",
        size: bytes.length,
        state: "staged",
        duplicate: false
      }
    });
    expect(backend.stream).toHaveBeenCalledTimes(2);
    expect(backend.read).not.toHaveBeenCalled();
    expect(completed.artifact.artifactKey).toMatch(
      new RegExp(`^archives/${firstArchiveId}/integration-artifacts/[a-f0-9]{64}$`)
    );
    expect(completed.artifact.artifactKey).not.toBe(issuedKey);

    const replay = await completeDirectIntegrationUpload(connection.id, staged.intent.id, firstOptions);
    expect(replay).toEqual({ ...completed, replayed: true });
    expect(backend.stream).toHaveBeenCalledTimes(2);

    const row = await query<{ status: string; consumed: boolean; artifact_id: string | null }>(
      `SELECT status, consumed_at IS NOT NULL AS consumed, artifact_id
       FROM integration_upload_intents WHERE archive_id = $1 AND id = $2`,
      [firstArchiveId, staged.intent.id],
      firstOptions
    );
    expect(row.rows[0]).toEqual({
      status: "completed",
      consumed: true,
      artifact_id: completed.artifact.id
    });
  });

  it("accepts UTF-16LE and UTF-16BE GEDCOM HEAD signatures only when their BOM is present", async () => {
    const connection = await ancestryConnection(firstOptions, "Synthetic UTF-16 source");
    const text = "0 HEAD\n1 CHAR UNICODE\n0 TRLR";
    const littleEndian = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    const little = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "synthetic-le.ged", contentType: "text/plain", size: littleEndian.length },
      firstOptions
    );
    backend.set(issuedKey!, littleEndian, "text/plain", "etag-utf16le");
    await expect(completeDirectIntegrationUpload(connection.id, little.intent.id, firstOptions))
      .resolves.toMatchObject({ replayed: false, artifact: { state: "staged" } });

    const bigEndianBody = Buffer.from(text, "utf16le");
    for (let index = 0; index < bigEndianBody.length; index += 2) {
      [bigEndianBody[index], bigEndianBody[index + 1]] = [bigEndianBody[index + 1], bigEndianBody[index]];
    }
    const bigEndian = Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndianBody]);
    const big = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "synthetic-be.ged", contentType: "text/plain", size: bigEndian.length },
      firstOptions
    );
    backend.set(issuedKey!, bigEndian, "text/plain", "etag-utf16be");
    await expect(completeDirectIntegrationUpload(connection.id, big.intent.id, firstOptions))
      .resolves.toMatchObject({ replayed: false, artifact: { state: "staged" } });
  });

  it("never resolves an intent through another connection or archive", async () => {
    const firstConnection = await ancestryConnection(firstOptions, "First synthetic source");
    const otherConnection = await ancestryConnection(firstOptions, "Other synthetic source");
    const otherArchiveConnection = await ancestryConnection(secondOptions, "Other synthetic archive source");
    const bytes = Buffer.from("0 HEAD\n0 TRLR", "utf8");
    const staged = await stageDirectIntegrationUpload(
      firstConnection.id,
      { fileName: "synthetic.ged", contentType: "text/plain", size: bytes.length },
      firstOptions
    );
    backend.set(issuedKey!, bytes, "text/plain", "etag-cross-scope");

    await expect(
      completeDirectIntegrationUpload(otherConnection.id, staged.intent.id, firstOptions)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      completeDirectIntegrationUpload(otherArchiveConnection.id, staged.intent.id, secondOptions)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(backend.delete).not.toHaveBeenCalled();

    await expect(
      completeDirectIntegrationUpload(firstConnection.id, staged.intent.id, firstOptions)
    ).resolves.toMatchObject({ replayed: false });
  });

  it("preserves one archive-scoped rights audit from intent through artifact and sync run", async () => {
    const featureFlags = {
      exportRefresh: true,
      desktopMedia: true,
      desktopMediaLegalReviewApproved: true,
      ancestryPartnerApi: false
    };
    const firstConnection = await desktopConnection(
      firstOptions,
      "family_tree_maker",
      "Synthetic rights audit"
    );
    const otherArchiveConnection = await desktopConnection(
      secondOptions,
      "family_tree_maker",
      "Other archive rights audit"
    );
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    const actorId = "synthetic-rights-actor";
    const stageInput = {
      fileName: "synthetic-ftm.zip",
      contentType: "application/zip",
      size: bytes.length,
      mediaRightsAcknowledgement: {
        accepted: true as const,
        version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
        actorId
      }
    };
    const scopedFirstOptions = { ...firstOptions, featureFlags };
    const scopedSecondOptions = { ...secondOptions, featureFlags };

    const staged = await stageDirectIntegrationUpload(
      firstConnection.id,
      stageInput,
      scopedFirstOptions
    );
    const stagingKey = issuedKey!;
    backend.set(stagingKey, bytes, "application/zip", "etag-rights-audit");

    const intentAudit = await acknowledgementAudit(
      "integration_upload_intents",
      staged.intent.id,
      firstArchiveId,
      scopedFirstOptions
    );
    expect(intentAudit).toEqual({
      version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
      actorId,
      acknowledgedAt: now.toISOString()
    });

    await expect(completeDirectIntegrationUpload(
      otherArchiveConnection.id,
      staged.intent.id,
      scopedSecondOptions
    )).rejects.toMatchObject({ code: "NOT_FOUND" });

    const completed = await completeDirectIntegrationUpload(
      firstConnection.id,
      staged.intent.id,
      scopedFirstOptions
    );
    expect(completed.artifact.mediaRightsAcknowledgement).toEqual(intentAudit);
    const artifactAudit = await acknowledgementAudit(
      "integration_artifacts",
      completed.artifact.id,
      firstArchiveId,
      scopedFirstOptions
    );
    expect(artifactAudit).toEqual(intentAudit);

    await expect(startSyncRun(
      otherArchiveConnection.id,
      {
        artifactId: completed.artifact.id,
        mediaRightsAcknowledgement: {
          accepted: true,
          version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
          actorId
        }
      },
      scopedSecondOptions
    )).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(startSyncRun(
      firstConnection.id,
      {
        artifactId: completed.artifact.id,
        mediaRightsAcknowledgement: {
          accepted: true,
          version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
          actorId: "different-actor"
        }
      },
      scopedFirstOptions
    )).rejects.toMatchObject({ code: "MEDIA_RIGHTS_MISMATCH" });

    const run = await startSyncRun(
      firstConnection.id,
      {
        artifactId: completed.artifact.id,
        mediaRightsAcknowledgement: {
          accepted: true,
          version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
          actorId
        }
      },
      scopedFirstOptions
    );
    expect(run.mediaRightsAcknowledgement).toEqual(intentAudit);
    const runAudit = await acknowledgementAudit(
      "sync_runs",
      run.id,
      firstArchiveId,
      scopedFirstOptions
    );
    expect(runAudit).toEqual(intentAudit);
  });

  it("rejects and removes expired, changed, spoofed, and size-mismatched objects", async () => {
    const connection = await ancestryConnection(firstOptions, "Rejected synthetic uploads");

    const expiredBytes = Buffer.from("0 HEAD\n0 TRLR", "utf8");
    const expired = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "expired.ged", contentType: "text/plain", size: expiredBytes.length },
      { ...firstOptions, intentLifetimeMilliseconds: 1_000 }
    );
    const expiredKey = issuedKey!;
    backend.set(expiredKey, expiredBytes, "text/plain", "etag-expired");
    now = new Date(now.getTime() + 2_000);
    await expect(completeDirectIntegrationUpload(connection.id, expired.intent.id, firstOptions))
      .rejects.toMatchObject({ code: "UPLOAD_EXPIRED" });
    expect(backend.has(expiredKey)).toBe(false);

    const spoofedBytes = Buffer.from("MZ", "ascii");
    const spoofed = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "spoofed.ged", contentType: "text/plain", size: spoofedBytes.length },
      firstOptions
    );
    const spoofedKey = issuedKey!;
    backend.set(spoofedKey, spoofedBytes, "text/plain", "etag-spoofed");
    await expect(completeDirectIntegrationUpload(connection.id, spoofed.intent.id, firstOptions))
      .rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    expect(backend.has(spoofedKey)).toBe(true);

    const changedBytes = Buffer.from("0 HEAD\n1 SOUR CHANGED\n0 TRLR", "utf8");
    const changed = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "changed.ged", contentType: "text/plain", size: changedBytes.length },
      firstOptions
    );
    const changedKey = issuedKey!;
    backend.set(changedKey, changedBytes, "text/plain", "etag-before", true);
    await expect(completeDirectIntegrationUpload(connection.id, changed.intent.id, firstOptions))
      .rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY" });
    expect(backend.has(changedKey)).toBe(true);

    const declaredBytes = Buffer.from("0 HEAD\n0 TRLR", "utf8");
    const wrongSize = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "wrong-size.ged", contentType: "text/plain", size: declaredBytes.length },
      firstOptions
    );
    const wrongSizeKey = issuedKey!;
    backend.set(wrongSizeKey, Buffer.concat([declaredBytes, Buffer.from("x")]), "text/plain", "etag-size");
    await expect(completeDirectIntegrationUpload(connection.id, wrongSize.intent.id, firstOptions))
      .rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY" });
    expect(backend.has(wrongSizeKey)).toBe(true);

    const states = await query<{ status: string; total: number }>(
      `SELECT status, count(*)::integer AS total
       FROM integration_upload_intents
       WHERE archive_id = $1 AND connection_id = $2
       GROUP BY status ORDER BY status`,
      [firstArchiveId, connection.id],
      firstOptions
    );
    expect(states.rows).toEqual([
      { status: "expired", total: 1 },
      { status: "rejected", total: 3 }
    ]);

    now = new Date(now.getTime() + 6 * 60 * 1000);
    await expect(cleanupExpiredDirectIntegrationUploadIntents(
      { limit: 10 },
      { databaseUrl: databaseUrl!, objectStorage: firstOptions.objectStorage, now: () => now }
    )).resolves.toEqual({ scanned: 3, deleted: 3, failed: 0 });
    expect(backend.has(spoofedKey)).toBe(false);
    expect(backend.has(changedKey)).toBe(false);
    expect(backend.has(wrongSizeKey)).toBe(false);
  });

  it("reuses identical connection-scoped artifacts and deletes only the redundant staging object", async () => {
    const connection = await ancestryConnection(firstOptions, "Duplicate synthetic source");
    const bytes = Buffer.from("0 HEAD\n1 SOUR DUPLICATE_SYNTHETIC\n0 TRLR", "utf8");

    const first = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "first.ged", contentType: "text/plain", size: bytes.length },
      firstOptions
    );
    backend.set(issuedKey!, bytes, "text/plain", "etag-first");
    const firstCompleted = await completeDirectIntegrationUpload(connection.id, first.intent.id, firstOptions);

    const second = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "renamed.ged", contentType: "text/plain", size: bytes.length },
      firstOptions
    );
    const redundantKey = issuedKey!;
    backend.set(redundantKey, bytes, "text/plain", "etag-second");
    const secondCompleted = await completeDirectIntegrationUpload(connection.id, second.intent.id, firstOptions);

    expect(secondCompleted).toMatchObject({
      replayed: false,
      artifact: { id: firstCompleted.artifact.id, duplicate: true }
    });
    expect(backend.has(redundantKey)).toBe(true);
    await expect(completeDirectIntegrationUpload(connection.id, second.intent.id, firstOptions)).resolves.toEqual({
      ...secondCompleted,
      replayed: true
    });
    now = new Date(now.getTime() + 6 * 60 * 1000);
    await expect(cleanupExpiredDirectIntegrationUploadIntents(
      { limit: 10 },
      { databaseUrl: databaseUrl!, objectStorage: firstOptions.objectStorage, now: () => now }
    )).resolves.toMatchObject({ deleted: 2, failed: 0 });
    expect(backend.has(redundantKey)).toBe(false);
  });

  it("promotes completed bytes away from the browser-writable key and reclaims staging only after expiry", async () => {
    const connection = await ancestryConnection(firstOptions, "Immutable promotion source");
    const bytes = Buffer.from("0 HEAD\n1 SOUR IMMUTABLE\n0 TRLR", "utf8");
    const staged = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "immutable.ged", contentType: "text/plain", size: bytes.length },
      { ...firstOptions, intentLifetimeMilliseconds: 1_000 }
    );
    const browserWritableKey = issuedKey!;
    backend.set(browserWritableKey, bytes, "text/plain", "etag-original");

    const completed = await completeDirectIntegrationUpload(connection.id, staged.intent.id, firstOptions);
    const durableKey = completed.artifact.artifactKey;
    expect(durableKey).not.toBe(browserWritableKey);
    expect(backend.has(browserWritableKey)).toBe(true);
    expect(backend.bytes(durableKey)).toEqual(bytes);

    const ticketReuse = Buffer.from("0 HEAD\n1 SOUR TICKET_REUSE\n0 TRLR", "utf8");
    backend.set(browserWritableKey, ticketReuse, "text/plain", "etag-reused");
    expect(backend.bytes(durableKey)).toEqual(bytes);

    await expect(cleanupExpiredDirectIntegrationUploadIntents(
      { limit: 10 },
      { databaseUrl: databaseUrl!, objectStorage: firstOptions.objectStorage, now: () => now }
    )).resolves.toEqual({ scanned: 0, deleted: 0, failed: 0 });
    expect(backend.has(browserWritableKey)).toBe(true);

    now = new Date(now.getTime() + 2_000);
    await expect(cleanupExpiredDirectIntegrationUploadIntents(
      { limit: 10 },
      { databaseUrl: databaseUrl!, objectStorage: firstOptions.objectStorage, now: () => now }
    )).resolves.toEqual({ scanned: 1, deleted: 1, failed: 0 });
    expect(backend.has(browserWritableKey)).toBe(false);
    expect(backend.bytes(durableKey)).toEqual(bytes);
  });

  it("rejects and removes an unreferenced provider promotion that fails destination hash verification", async () => {
    const connection = await ancestryConnection(firstOptions, "Corrupt promotion source");
    const bytes = Buffer.from("0 HEAD\n1 SOUR CORRUPT_PROMOTION\n0 TRLR", "utf8");
    const staged = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "corrupt-promotion.ged", contentType: "text/plain", size: bytes.length },
      firstOptions
    );
    const stagingKey = issuedKey!;
    backend.set(stagingKey, bytes, "text/plain", "etag-corrupt-source");
    backend.corruptNextPromotion();

    await expect(completeDirectIntegrationUpload(connection.id, staged.intent.id, firstOptions))
      .rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY" });

    const promotedKey = `archives/${firstArchiveId}/integration-artifacts/${
      createHash("sha256").update(bytes).digest("hex")
    }`;
    expect(backend.has(promotedKey)).toBe(false);
    expect(backend.has(stagingKey)).toBe(true);
  });

  it("enforces the provider rollout gate before issuing tickets or buffering multipart artifacts", async () => {
    const connection = await ancestryConnection(firstOptions, "Disabled synthetic source");
    const disabledFlags = {
      exportRefresh: false,
      desktopMedia: false,
      desktopMediaLegalReviewApproved: false,
      ancestryPartnerApi: false
    };
    const bytes = Buffer.from("0 HEAD\n0 TRLR", "utf8");

    await expect(stageDirectIntegrationUpload(
      connection.id,
      { fileName: "disabled.ged", contentType: "text/plain", size: bytes.length },
      { ...firstOptions, featureFlags: disabledFlags }
    )).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
    expect(ticketIssuer.issue).not.toHaveBeenCalled();

    await expect(createIntegrationArtifact(
      connection.id,
      { fileName: "disabled.ged", contentType: "text/plain", size: bytes.length, bytes },
      { ...firstOptions, featureFlags: disabledFlags }
    )).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });

  it("rejects unsafe declarations before creating an intent", async () => {
    const connection = await ancestryConnection(firstOptions, "Declaration validation source");
    await expect(stageDirectIntegrationUpload(
      connection.id,
      {
        fileName: "too-large.ged",
        contentType: "text/plain",
        size: maximumDirectIntegrationArtifactBytes + 1
      },
      firstOptions
    )).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(stageDirectIntegrationUpload(
      connection.id,
      { fileName: "tree.exe", contentType: "application/x-msdownload", size: 2 },
      firstOptions
    )).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    await expect(stageDirectIntegrationUpload(
      connection.id,
      { fileName: "tree.zip", contentType: "text/plain", size: 2 },
      firstOptions
    )).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    expect(ticketIssuer.issue).not.toHaveBeenCalled();
  });

  it("cleans expired pending staging objects in bounded, retryable batches", async () => {
    const connection = await ancestryConnection(firstOptions, "Synthetic cleanup source");
    const bytes = Buffer.from("0 HEAD\n0 TRLR", "utf8");
    const first = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "cleanup-one.ged", contentType: "text/plain", size: bytes.length },
      { ...firstOptions, intentLifetimeMilliseconds: 1_000 }
    );
    const firstKey = issuedKey!;
    backend.set(firstKey, bytes, "text/plain", "etag-cleanup-one");
    const second = await stageDirectIntegrationUpload(
      connection.id,
      { fileName: "cleanup-two.ged", contentType: "text/plain", size: bytes.length },
      { ...firstOptions, intentLifetimeMilliseconds: 1_000 }
    );
    const secondKey = issuedKey!;
    backend.set(secondKey, bytes, "text/plain", "etag-cleanup-two");
    now = new Date(now.getTime() + 2_000);
    backend.failNextDelete();

    await expect(cleanupExpiredDirectIntegrationUploadIntents(
      { limit: 1 },
      { databaseUrl: databaseUrl!, objectStorage: firstOptions.objectStorage, now: () => now }
    )).resolves.toEqual({ scanned: 1, deleted: 0, failed: 1 });
    expect(Number(backend.has(firstKey)) + Number(backend.has(secondKey))).toBe(2);
    await expect(cleanupExpiredDirectIntegrationUploadIntents(
      { limit: 1 },
      { databaseUrl: databaseUrl!, objectStorage: firstOptions.objectStorage, now: () => now }
    )).resolves.toEqual({ scanned: 1, deleted: 1, failed: 0 });
    expect(Number(backend.has(firstKey)) + Number(backend.has(secondKey))).toBe(1);
    await expect(cleanupExpiredDirectIntegrationUploadIntents(
      { limit: 1 },
      { databaseUrl: databaseUrl!, objectStorage: firstOptions.objectStorage, now: () => now }
    )).resolves.toEqual({ scanned: 1, deleted: 1, failed: 0 });
    expect(backend.has(firstKey)).toBe(false);
    expect(backend.has(secondKey)).toBe(false);

    const rows = await query<{ id: string; status: string; deleted: boolean }>(
      `SELECT id, status, staging_deleted_at IS NOT NULL AS deleted
       FROM integration_upload_intents
       WHERE archive_id = $1 AND id = ANY($2::text[])
       ORDER BY id`,
      [firstArchiveId, [first.intent.id, second.intent.id]],
      firstOptions
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row) => row.status === "expired" && row.deleted)).toBe(true);
  });
});

function optionsFor(
  archiveId: string,
  objectStorage: ReturnType<typeof createArchiveObjectStorage>,
  ticketIssuer: DirectUploadTicketIssuer,
  now: () => Date
) {
  return { archiveId, databaseUrl: databaseUrl!, objectStorage, ticketIssuer, now };
}

function ancestryConnection(options: ReturnType<typeof optionsFor>, displayName: string) {
  return createIntegrationConnection(
    { provider: "ancestry_export", authority: "ancestry", displayName },
    options
  );
}

function desktopConnection(
  options: ReturnType<typeof optionsFor>,
  provider: "family_tree_maker" | "rootsmagic",
  displayName: string
) {
  return createIntegrationConnection(
    { provider, authority: provider, displayName },
    options
  );
}

async function acknowledgementAudit(
  table: "integration_upload_intents" | "integration_artifacts" | "sync_runs",
  id: string,
  archiveId: string,
  options: ReturnType<typeof optionsFor>
) {
  const result = await query<{
    version: string | null;
    actor_id: string | null;
    acknowledged_at: Date | string | null;
  }>(
    `SELECT media_rights_acknowledgement_version AS version,
            media_rights_acknowledged_by AS actor_id,
            media_rights_acknowledged_at AS acknowledged_at
     FROM ${table}
     WHERE archive_id = $1 AND id = $2`,
    [archiveId, id],
    options
  );
  const row = result.rows[0];
  return {
    version: row.version,
    actorId: row.actor_id,
    acknowledgedAt: row.acknowledged_at instanceof Date
      ? row.acknowledged_at.toISOString()
      : row.acknowledged_at === null
        ? null
        : new Date(row.acknowledged_at).toISOString()
  };
}

function createStreamingMemoryBackend() {
  type Stored = {
    bytes: Buffer;
    contentType: string;
    etag: string;
    mutateAfterStream: boolean;
  };
  const objects = new Map<string, Stored>();
  let deleteFailures = 0;
  let corruptPromotions = 0;
  const backend = {
    stat: vi.fn(async ({ key }: { key: string }) => {
      const object = objects.get(key);
      return object
        ? { key, size: object.bytes.length, contentType: object.contentType, etag: object.etag }
        : undefined;
    }),
    put: vi.fn(async () => undefined),
    read: vi.fn(async () => {
      throw new Error("buffering reads are forbidden in direct upload completion");
    }),
    stream: vi.fn(async ({ key }: { key: string }) => {
      const object = objects.get(key);
      if (!object) throw new Error("object not found");
      async function* chunks() {
        const midpoint = Math.max(1, Math.floor(object!.bytes.length / 2));
        yield object!.bytes.subarray(0, midpoint);
        yield object!.bytes.subarray(midpoint);
        if (object!.mutateAfterStream) object!.etag = `${object!.etag}-changed`;
      }
      return chunks();
    }),
    promote: vi.fn(async (input: {
      sourceKey: string;
      destinationKey: string;
      expectedSourceEtag: string;
      contentType: string;
    }) => {
      const source = objects.get(input.sourceKey);
      if (!source || source.etag !== input.expectedSourceEtag) {
        throw new Error("synthetic source precondition failure");
      }
      if (!objects.has(input.destinationKey)) {
        const bytes = Buffer.from(source.bytes);
        if (corruptPromotions > 0) {
          corruptPromotions -= 1;
          bytes[bytes.length - 1] ^= 1;
        }
        objects.set(input.destinationKey, {
          bytes,
          contentType: input.contentType,
          etag: `promoted-${source.etag}`,
          mutateAfterStream: false
        });
      }
    }),
    delete: vi.fn(async ({ key }: { key: string }) => {
      if (deleteFailures > 0) {
        deleteFailures -= 1;
        throw new Error("synthetic object deletion failure");
      }
      objects.delete(key);
    }),
    set(key: string, bytes: Buffer, contentType: string, etag: string, mutateAfterStream = false) {
      objects.set(key, { bytes, contentType, etag, mutateAfterStream });
    },
    has(key: string) {
      return objects.has(key);
    },
    bytes(key: string) {
      const object = objects.get(key);
      return object ? Buffer.from(object.bytes) : undefined;
    },
    failNextDelete() {
      deleteFailures += 1;
    },
    corruptNextPromotion() {
      corruptPromotions += 1;
    }
  };
  return backend;
}
