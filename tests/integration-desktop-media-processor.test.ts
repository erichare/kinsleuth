import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import { cleanupExpiredIntegrationMediaWriteClaims } from "@/lib/integrations/media-claims";
import { processIntegrationSyncRun } from "@/lib/integrations/run-processor";
import {
  createIntegrationArtifact,
  createIntegrationConnection,
  startSyncRun
} from "@/lib/integrations/store";
import { DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION } from "@/lib/integrations/types";
import { createArchiveObjectStorage } from "@/lib/storage/object-storage";
import { readWorkspace } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase("desktop package media persistence", () => {
  const createdArchives = new Set<string>();

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (createdArchives.size > 0) {
      const archiveIds = [...createdArchives];
      createdArchives.clear();
      await query("DELETE FROM archives WHERE id = ANY($1::text[])", [archiveIds], {
        databaseUrl: databaseUrl!
      });
    }
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  it.each(["family_tree_maker", "rootsmagic"] as const)(
    "persists matched %s media as restricted only after every gate and acknowledgement",
    async (provider) => {
      vi.stubEnv("KINRESOLVE_DESKTOP_MEDIA_ENABLED", "true");
      vi.stubEnv("KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED", "true");
      const fixture = await createFixture(provider, true);

      const prepared = await processIntegrationSyncRun(fixture.runId, fixture.options);

      expect(prepared.counts).toMatchObject({ media: 1, retainedMedia: 1, missingMedia: 1 });
      const rows = await query<{
        object_key: string;
        source_provider: string;
        source_artifact_sha256: string;
        source_gedcom_path: string;
        source_normalized_path: string;
        source_archive_path: string;
        sha256: string;
        mime_type: string;
        size_bytes: string;
        license_class: string;
        privacy: string;
        publishable: boolean;
        ai_eligible: boolean;
        rights_acknowledgement_version: string;
        rights_acknowledged_by: string;
      }>("SELECT * FROM integration_media_objects WHERE archive_id = $1", [fixture.archiveId], fixture.options);
      expect(rows.rows).toEqual([
        expect.objectContaining({
          object_key: expect.stringMatching(new RegExp(`^archives/${fixture.archiveId}/integration-media/[a-f0-9]{64}$`)),
          source_provider: provider,
          source_artifact_sha256: fixture.artifactSha256,
          source_gedcom_path: "media\\portrait.jpg",
          source_normalized_path: "media/portrait.jpg",
          source_archive_path: "export/media/portrait.jpg",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          mime_type: "image/jpeg",
          size_bytes: String(fixture.portrait.length),
          license_class: "third_party_restricted",
          privacy: "private",
          publishable: false,
          ai_eligible: false,
          rights_acknowledgement_version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
          rights_acknowledged_by: "synthetic-owner"
        })
      ]);
      expect(fixture.put.mock.calls.filter(([input]) =>
        (input as { key: string }).key.includes("/integration-media/")
      )).toHaveLength(1);
      await expect(query<{ total: number }>(
        "SELECT count(*)::int AS total FROM integration_media_write_claims WHERE archive_id = $1",
        [fixture.archiveId],
        fixture.options
      )).resolves.toMatchObject({ rows: [{ total: 0 }] });
    }
  );

  it.each([
    { label: "legal review is closed", provider: "family_tree_maker" as const, legal: false, acknowledge: true },
    { label: "rights were not acknowledged", provider: "rootsmagic" as const, legal: true, acknowledge: false },
    { label: "the provider is Ancestry export", provider: "ancestry_export" as const, legal: true, acknowledge: true },
    { label: "the provider is generic GEDCOM", provider: "gedcom" as const, legal: true, acknowledge: true }
  ])("rejects attachment-bearing packages at staging when $label", async ({ provider, legal, acknowledge }) => {
    vi.stubEnv("KINRESOLVE_DESKTOP_MEDIA_ENABLED", "true");
    vi.stubEnv("KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED", legal ? "true" : "false");
    await expect(createFixture(provider, acknowledge)).rejects.toMatchObject({
      code: provider === "family_tree_maker" && !legal
        ? "DESKTOP_MEDIA_DISABLED"
        : provider === "rootsmagic" && !acknowledge
          ? "MEDIA_RIGHTS_REQUIRED"
          : "MEDIA_RIGHTS_NOT_APPLICABLE"
    });
  });

  it("reclaims a claimed private media object after the worker lease is lost before publication", async () => {
    vi.stubEnv("KINRESOLVE_DESKTOP_MEDIA_ENABLED", "true");
    vi.stubEnv("KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED", "true");
    const fixture = await createFixture("family_tree_maker", true);
    let leaseChecks = 0;

    await expect(processIntegrationSyncRun(fixture.runId, {
      ...fixture.options,
      assertLease: async () => {
        leaseChecks += 1;
        if (leaseChecks > 1) throw Object.assign(new Error("synthetic lease lost"), { code: "LEASE_LOST" });
      }
    })).rejects.toMatchObject({ code: "LEASE_LOST" });

    expect(fixture.remove).not.toHaveBeenCalled();
    const retained = await query<{ total: number }>(
      "SELECT count(*)::int AS total FROM integration_media_objects WHERE archive_id = $1",
      [fixture.archiveId],
      fixture.options
    );
    expect(retained.rows[0].total).toBe(0);
    await expect(query<{ total: number }>(
      "SELECT count(*)::int AS total FROM integration_media_write_claims WHERE archive_id = $1 AND expires_at <= now()",
      [fixture.archiveId],
      fixture.options
    )).resolves.toMatchObject({ rows: [{ total: 1 }] });

    await expect(cleanupExpiredIntegrationMediaWriteClaims(
      { limit: 10 },
      { ...fixture.options, now: () => new Date(Date.now() + 1_000) }
    )).resolves.toEqual({ scanned: 1, deleted: 1, failed: 0 });
    expect(fixture.remove).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringContaining("/integration-media/")
    }));
  });

  it("leaves a durable cleanup claim when strict GEDCOM parsing fails after media persistence", async () => {
    vi.stubEnv("KINRESOLVE_DESKTOP_MEDIA_ENABLED", "true");
    vi.stubEnv("KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED", "true");
    const malformed = mediaGedcom().replace("0 TRLR", "this is not a GEDCOM line\n0 TRLR");
    const fixture = await createFixture("rootsmagic", true, malformed);

    await expect(processIntegrationSyncRun(fixture.runId, fixture.options)).rejects.toThrow();
    expect(fixture.put.mock.calls.some(([input]) =>
      (input as { key: string }).key.includes("/integration-media/")
    )).toBe(true);
    expect(fixture.remove).not.toHaveBeenCalled();
    await expect(query<{ total: number }>(
      "SELECT count(*)::int AS total FROM integration_media_write_claims WHERE archive_id = $1 AND expires_at <= now()",
      [fixture.archiveId],
      fixture.options
    )).resolves.toMatchObject({ rows: [{ total: 1 }] });

    await expect(cleanupExpiredIntegrationMediaWriteClaims(
      { limit: 10 },
      { ...fixture.options, now: () => new Date(Date.now() + 1_000) }
    )).resolves.toEqual({ scanned: 1, deleted: 1, failed: 0 });
  });

  async function createFixture(
    provider: "family_tree_maker" | "rootsmagic" | "ancestry_export" | "gedcom",
    acknowledge: boolean,
    gedcom = mediaGedcom()
  ) {
    const archiveId = `test-desktop-media-${randomUUID()}`;
    createdArchives.add(archiveId);
    const objects = new Map<string, { bytes: Buffer; contentType: string }>();
    const put = vi.fn(async (input: { key: string; bytes: Uint8Array; contentType: string }) => {
      objects.set(input.key, { bytes: Buffer.from(input.bytes), contentType: input.contentType });
    });
    const remove = vi.fn(async ({ key }: { key: string }) => {
      objects.delete(key);
    });
    const backend = {
      stat: vi.fn(async ({ key }: { key: string }) => {
        const value = objects.get(key);
        return value ? { key, size: value.bytes.length, contentType: value.contentType } : undefined;
      }),
      put,
      read: vi.fn(async ({ key }: { key: string }) => {
        const value = objects.get(key);
        if (!value) throw new Error("object missing");
        return value.bytes;
      }),
      delete: remove
    };
    const objectStorage = createArchiveObjectStorage({ backend });
    const scan = vi.fn(async () => "clean" as const);
    const options = {
      archiveId,
      databaseUrl: databaseUrl!,
      objectStorage,
      malwareScanner: { scan }
    };
    await readWorkspace(options);
    const connection = await createIntegrationConnection({
      provider,
      authority: provider === "ancestry_export"
        ? "ancestry"
        : provider === "gedcom"
          ? "another_genealogy_app"
          : provider,
      displayName: `Synthetic ${provider} package`
    }, options);
    const portrait = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const bytes = makeZip([
      { name: "export/tree.ged", content: gedcom },
      { name: "export/media/portrait.jpg", content: portrait }
    ]);
    const artifact = await createIntegrationArtifact(connection.id, {
      fileName: "synthetic-desktop.zip",
      contentType: "application/zip",
      size: bytes.length,
      bytes,
      ...(acknowledge ? {
        mediaRightsAcknowledgement: {
          accepted: true as const,
          version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
          actorId: "synthetic-owner"
        }
      } : {})
    }, options);
    const run = await startSyncRun(connection.id, {
      artifactId: artifact.id,
      ...(acknowledge ? {
        mediaRightsAcknowledgement: {
          accepted: true as const,
          version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
          actorId: "synthetic-owner"
        }
      } : {})
    }, options);
    return {
      archiveId,
      runId: run.id,
      artifactSha256: artifact.sha256,
      portrait,
      put,
      remove,
      scan,
      options
    };
  }
});

function mediaGedcom(): string {
  return [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    "0 @I1@ INDI",
    "1 NAME Avery /Lantern/",
    "1 OBJE @M1@",
    "0 @M1@ OBJE",
    "1 FILE media\\portrait.jpg",
    "0 @M2@ OBJE",
    "1 FILE media\\missing.jpg",
    "0 TRLR"
  ].join("\n");
}

function makeZip(entries: Array<{ name: string; content: string | Uint8Array }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.from(entry.content);
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(content: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
