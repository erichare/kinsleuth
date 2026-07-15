import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  V0174_INITIAL_SHA256,
  verifyMigrationHistory,
  type MigrationChecksumManifest
} from "@/lib/migration-history";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function createFixture(files: Record<string, string>, manifestFiles: Record<string, string> = files): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "kinresolve-migration-history-"));
  scratchDirectories.push(repositoryRoot);
  const migrationsDirectory = path.join(repositoryRoot, "db", "migrations");
  await mkdir(migrationsDirectory, { recursive: true });

  await Promise.all(
    Object.entries(files).map(([name, contents]) => writeFile(path.join(migrationsDirectory, name), contents, "utf8"))
  );

  const manifest: MigrationChecksumManifest = {
    schemaVersion: 1,
    files: Object.fromEntries(Object.entries(manifestFiles).map(([name, contents]) => [name, sha256(contents)])),
    releaseAnchors: {}
  };
  await writeFile(path.join(migrationsDirectory, "checksums.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return repositoryRoot;
}

function verifyFixture(repositoryRoot: string) {
  return verifyMigrationHistory({ repositoryRoot, trustedReleaseAnchors: {} });
}

describe("migration checksum history", () => {
  it("accepts the checked-in migration set and the immutable v0.17.4 release anchor", async () => {
    await expect(verifyMigrationHistory({ repositoryRoot: process.cwd() })).resolves.toEqual({
      migrationFiles: [
        "001_initial.sql",
        "002_search_unaccent.sql",
        "003_auth_accounts.sql",
        "004_archive_scoped_keys.sql",
        "005_guided_research_loop.sql",
        "006_integration_sources.sql",
        "007_integration_change_filters.sql",
        "008_integration_upload_intents.sql",
        "009_integration_media_objects.sql",
        "010_integration_media_write_claims.sql",
        "011_integration_change_search.sql",
        "012_archive_dataset_mode.sql",
        "013_release_write_fence.sql",
        "014_beta_invitations.sql",
        "015_beta_operations.sql"
      ],
      releaseAnchors: ["v0.17.4"]
    });
  });

  it("rejects an edited migration after its checksum is recorded", async () => {
    const repositoryRoot = await createFixture({ "001_initial.sql": "SELECT 2;\n" }, { "001_initial.sql": "SELECT 1;\n" });

    await expect(verifyFixture(repositoryRoot)).rejects.toThrow(/checksum mismatch.*001_initial\.sql/i);
  });

  it("rejects an unmanifested SQL migration", async () => {
    const repositoryRoot = await createFixture(
      { "001_initial.sql": "SELECT 1;\n", "002_extra.sql": "SELECT 2;\n" },
      { "001_initial.sql": "SELECT 1;\n" }
    );

    await expect(verifyFixture(repositoryRoot)).rejects.toThrow(/not recorded.*002_extra\.sql/i);
  });

  it("rejects a manifest entry whose migration file is missing", async () => {
    const repositoryRoot = await createFixture(
      { "001_initial.sql": "SELECT 1;\n" },
      { "001_initial.sql": "SELECT 1;\n", "002_missing.sql": "SELECT 2;\n" }
    );

    await expect(verifyFixture(repositoryRoot)).rejects.toThrow(/missing.*002_missing\.sql/i);
  });

  it("rejects duplicate numeric migration prefixes before the runtime runner sees them", async () => {
    const repositoryRoot = await createFixture({
      "004_first.sql": "SELECT 1;\n",
      "004_second.sql": "SELECT 2;\n"
    });

    await expect(verifyFixture(repositoryRoot)).rejects.toThrow(/duplicate migration number 4/i);
  });

  it("requires the v0.17.4 release anchor in the checked-in manifest", async () => {
    const repositoryRoot = await createFixture({ "001_initial.sql": "SELECT 1;\n" });

    await expect(verifyMigrationHistory({ repositoryRoot })).rejects.toThrow(/required release anchor.*v0\.17\.4/i);
  });

  it("binds the checked-in 001 bytes directly to the hard-coded v0.17.4 trust anchor", async () => {
    const repositoryRoot = await createFixture({ "001_initial.sql": "SELECT 1;\n" });
    const manifestPath = path.join(repositoryRoot, "db", "migrations", "checksums.json");
    const manifest: MigrationChecksumManifest = {
      schemaVersion: 1,
      files: { "001_initial.sql": sha256("SELECT 1;\n") },
      releaseAnchors: {
        "v0.17.4": { "001_initial.sql": V0174_INITIAL_SHA256 }
      }
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const taggedInitial = execFileSync("git", ["show", "v0.17.4:db/migrations/001_initial.sql"], { cwd: process.cwd() });

    await expect(
      verifyMigrationHistory({ repositoryRoot, readReleaseFile: async () => taggedInitial })
    ).rejects.toThrow(new RegExp(`001_initial\\.sql.*${V0174_INITIAL_SHA256}`, "i"));
  });

  it("does not allow the shipped v0.17.4 trust anchor to be redefined by the manifest", async () => {
    const repositoryRoot = await createFixture({ "001_initial.sql": "SELECT 1;\n" });
    const manifestPath = path.join(repositoryRoot, "db", "migrations", "checksums.json");
    const manifest: MigrationChecksumManifest = {
      schemaVersion: 1,
      files: { "001_initial.sql": sha256("SELECT 1;\n") },
      releaseAnchors: {
        "v0.17.4": { "001_initial.sql": "0".repeat(64) }
      }
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(
      verifyMigrationHistory({
        repositoryRoot,
        readReleaseFile: async () => Buffer.from("release bytes that must never be trusted")
      })
    ).rejects.toThrow(new RegExp(V0174_INITIAL_SHA256, "i"));
  });
});
