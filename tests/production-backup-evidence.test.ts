import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const script = path.join(process.cwd(), "scripts", "assemble-production-backup-evidence.mjs");
const releaseCommit = "b".repeat(40);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true
  })));
});

describe("production backup evidence assembly", () => {
  it("emits only a privacy-safe receipt for an exact encrypted round trip", async () => {
    const fixture = validFixture();
    const result = await run(fixture);
    expect(result.status).toBe(0);
    const evidence = JSON.parse(await readFile(result.outputPath, "utf8"));
    expect(evidence).toMatchObject({
      schemaVersion: 3,
      kind: "kinresolve-encrypted-offsite-backup",
      releaseCommitSha: releaseCommit,
      runId: "1234",
      runAttempt: "2",
      archiveDigest: digest(fixture.database.archiveId),
      databaseIdentity: fixture.database.databaseIdentity,
      databaseProductManifestSha256: fixture.database.demoPurgeProductManifestSha256,
      objectStoreIdentity: fixture.objects.objectStoreIdentity,
      objectStoreProviderDigest: digest(fixture.objects.providerStoreId),
      objectNamespaces: fixture.objects.objectNamespaces,
      ciphertext: {
        database: {
          sha256: fixture.databaseUpload.sha256,
          size: 128,
          uploadedAt: fixture.databaseUpload.completedAt,
          verifiedDownloadAt: fixture.databaseDownload.completedAt,
          storage: fixture.databaseUpload.storage
        },
        objects: {
          sha256: fixture.objectsUpload.sha256,
          size: 256,
          uploadedAt: fixture.objectsUpload.completedAt,
          verifiedDownloadAt: fixture.objectsDownload.completedAt,
          storage: fixture.objectsUpload.storage
        }
      }
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(fixture.database.archiveId);
    expect(serialized).not.toContain(fixture.objects.providerStoreId);
    expect(serialized).not.toContain("pathname");
  });

  it.each([
    ["active job", (fixture: BackupFixture) => { fixture.database.activeJobLeases = 1; }],
    ["object namespace", (fixture: BackupFixture) => { fixture.objects.objectNamespaces.pop(); }],
    ["ciphertext mismatch", (fixture: BackupFixture) => { fixture.databaseDownload.sha256 = digest("wrong"); }],
    ["version mismatch", (fixture: BackupFixture) => {
      fixture.databaseDownload.storage.versionId = "different-version";
    }],
    ["bucket mismatch", (fixture: BackupFixture) => {
      fixture.objectsDownload.storage.bucketDigest = digest("different bucket");
    }],
    ["split buckets", (fixture: BackupFixture) => {
      fixture.objectsUpload.storage.bucketDigest = digest("different bucket");
      fixture.objectsDownload.storage.bucketDigest = digest("different bucket");
    }],
    ["split prefixes", (fixture: BackupFixture) => {
      fixture.objectsUpload.storage.key = fixture.objectsUpload.storage.key.replace("2026-07-15", "2026-07-14");
      fixture.objectsDownload.storage.key = fixture.objectsDownload.storage.key.replace("2026-07-15", "2026-07-14");
    }],
    ["wrong key", (fixture: BackupFixture) => {
      fixture.databaseUpload.storage.key = fixture.databaseUpload.storage.key.replace("database", "objects");
    }],
    ["governance retention", (fixture: BackupFixture) => {
      fixture.databaseUpload.storage.objectRetention.mode = "GOVERNANCE";
    }],
    ["short retention", (fixture: BackupFixture) => {
      const short = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString();
      fixture.objectsUpload.storage.objectRetention.retainUntil = short;
      fixture.objectsDownload.storage.objectRetention.retainUntil = short;
    }],
    ["stale provider point", (fixture: BackupFixture) => {
      fixture.providerPoint.createdAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    }],
    ["release mismatch", (fixture: BackupFixture) => { fixture.database.releaseCommitSha = "c".repeat(40); }],
    ["completion before fence release", (fixture: BackupFixture) => {
      fixture.released.fence.releasedAt = new Date(Date.now() + 60_000).toISOString();
    }]
  ])("fails closed on invalid %s evidence", async (_label, mutate) => {
    const fixture = validFixture();
    mutate(fixture);
    const result = await run(fixture);
    expect(result.status).toBe(1);
  });
});

type BackupFixture = ReturnType<typeof validFixture>;

function validFixture() {
  const now = Date.now();
  const fenceId = "fence-backup-1234-2";
  const databaseSha = digest("encrypted database");
  const objectsSha = digest("encrypted objects");
  const uploadAt = new Date(now - 7 * 60_000).toISOString();
  const downloadAt = new Date(now - 6 * 60_000).toISOString();
  const retainUntil = new Date(now + 31 * 24 * 60 * 60_000).toISOString();
  const storage = (fileName: "database.dump.age" | "objects.tar.age", versionId: string) => ({
    bucketDigest: digest("offsite backup bucket"),
    key: `production-backup/2026-07-15/${releaseCommit}/1234-2/${fileName}`,
    versionId,
    bucketProtection: {
      versioning: "Enabled",
      objectLock: "Enabled",
      defaultRetention: { mode: "COMPLIANCE", unit: "days", value: 30 }
    },
    objectRetention: {
      mode: "COMPLIANCE",
      retainUntil,
      validatedMinimumDays: 30
    }
  });
  return {
    database: {
      capturePhase: "candidate-final",
      candidateSemanticsVerified: true,
      databaseIdentity: digest("database"),
      archiveId: "private-family-archive",
      fenceId,
      releaseCommitSha: releaseCommit,
      migrationVersions: ["001_initial", "015_beta_operations"],
      activeJobLeases: 0,
      unexpiredUploadIntents: 0,
      stragglerTransactions: 0,
      stragglerVisibilityVerified: true,
      manifestSha256: digest("database manifest"),
      demoPurgeProductManifestSha256: digest("demo purge product manifest")
    },
    objects: {
      archiveId: "private-family-archive",
      objectStoreIdentity: digest("object store"),
      providerStoreId: "private-provider-store",
      objectNamespaces: [
        { name: "archive-private", objectCount: 2, totalBytes: 44, manifestSha256: digest("private") },
        { name: "legacy-gedcom", objectCount: 1, totalBytes: 22, manifestSha256: digest("gedcom") }
      ]
    },
    databaseUpload: {
      operation: "upload",
      sha256: databaseSha,
      size: 128,
      storage: storage("database.dump.age", "database-version-123"),
      completedAt: uploadAt
    },
    databaseDownload: {
      operation: "download",
      sha256: databaseSha,
      size: 128,
      storage: storage("database.dump.age", "database-version-123"),
      completedAt: downloadAt
    },
    objectsUpload: {
      operation: "upload",
      sha256: objectsSha,
      size: 256,
      storage: storage("objects.tar.age", "objects-version-123"),
      completedAt: uploadAt
    },
    objectsDownload: {
      operation: "download",
      sha256: objectsSha,
      size: 256,
      storage: storage("objects.tar.age", "objects-version-123"),
      completedAt: downloadAt
    },
    providerPoint: {
      provider: "supabase",
      status: "available",
      createdAt: new Date(now - 30 * 60_000).toISOString()
    },
    acquired: {
      found: true,
      transition: "acquired",
      fence: {
        fenceId,
        releaseCommitSha: releaseCommit,
        state: "active",
        activatedAt: new Date(now - 10 * 60_000).toISOString()
      }
    },
    released: {
      found: true,
      transition: "released",
      fence: {
        fenceId,
        releaseCommitSha: releaseCommit,
        state: "released",
        releasedAt: new Date(now - 60_000).toISOString()
      }
    }
  };
}

async function run(fixture: BackupFixture) {
  const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-production-backup-"));
  temporaryDirectories.push(directory);
  const files: Record<string, unknown> = {
    "database-state.json": fixture.database,
    "object-state.json": fixture.objects,
    "database-upload.json": fixture.databaseUpload,
    "database-download.json": fixture.databaseDownload,
    "objects-upload.json": fixture.objectsUpload,
    "objects-download.json": fixture.objectsDownload,
    "provider-recovery-point.json": fixture.providerPoint,
    "fence-acquire.json": fixture.acquired,
    "fence-release.json": fixture.released
  };
  await Promise.all(Object.entries(files).map(([name, value]) => writeFile(
    path.join(directory, name),
    `${JSON.stringify(value)}\n`,
    { mode: 0o600 }
  )));
  const outputPath = path.join(directory, "evidence.json");
  const result = spawnSync(process.execPath, [script, directory, outputPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      RELEASE_COMMIT: releaseCommit,
      GITHUB_RUN_ID: "1234",
      GITHUB_RUN_ATTEMPT: "2"
    }
  });
  return { ...result, outputPath };
}
