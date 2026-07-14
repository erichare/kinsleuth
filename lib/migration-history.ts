import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const migrationFilePattern = /^\d+_[a-z0-9_-]+\.sql$/i;
const checksumPattern = /^[a-f0-9]{64}$/;

export const V0174_INITIAL_SHA256 = "9023c8a546dcab04a1fb01ae37cd81c2819025e1251a3b9c95df08dea3617c40";
const defaultTrustedReleaseAnchors = {
  "v0.17.4": { "001_initial.sql": V0174_INITIAL_SHA256 }
} as const;

export type MigrationChecksumManifest = {
  schemaVersion: 1;
  files: Record<string, string>;
  releaseAnchors: Record<string, Record<string, string>>;
};

type VerifyMigrationHistoryOptions = {
  repositoryRoot: string;
  readReleaseFile?: (tag: string, repositoryPath: string) => Promise<Buffer>;
  trustedReleaseAnchors?: Record<string, Record<string, string>>;
};

type MigrationHistoryReport = {
  migrationFiles: string[];
  releaseAnchors: string[];
};

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseChecksumMap(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object whose values are SHA-256 checksums.`);
  }

  const result: Record<string, string> = {};
  for (const [fileName, checksum] of Object.entries(value)) {
    if (!migrationFilePattern.test(fileName)) {
      throw new Error(`${label} contains an invalid migration filename: ${fileName}.`);
    }
    if (typeof checksum !== "string" || !checksumPattern.test(checksum)) {
      throw new Error(`${label} contains an invalid SHA-256 checksum for ${fileName}.`);
    }
    result[fileName] = checksum;
  }
  return result;
}

function parseManifest(contents: string): MigrationChecksumManifest {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error("Migration checksum manifest is not valid JSON.", { cause: error });
  }

  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("Migration checksum manifest must use schemaVersion 1.");
  }

  const releaseAnchorsValue = value.releaseAnchors;
  if (!isRecord(releaseAnchorsValue)) {
    throw new Error("Migration checksum manifest releaseAnchors must be an object.");
  }

  const releaseAnchors: Record<string, Record<string, string>> = {};
  for (const [tag, files] of Object.entries(releaseAnchorsValue)) {
    if (!/^v\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(tag)) {
      throw new Error(`Migration checksum manifest contains an invalid release tag: ${tag}.`);
    }
    releaseAnchors[tag] = parseChecksumMap(files, `Release anchor ${tag}`);
  }

  return {
    schemaVersion: 1,
    files: parseChecksumMap(value.files, "Migration checksum manifest files"),
    releaseAnchors
  };
}

async function readTaggedFile(repositoryRoot: string, tag: string, repositoryPath: string): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync("git", ["show", `${tag}:${repositoryPath}`], {
      cwd: repositoryRoot,
      encoding: "buffer",
      maxBuffer: 2 * 1024 * 1024
    });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  } catch (error) {
    throw new Error(`Unable to read ${repositoryPath} from release tag ${tag}. Fetch full git history and tags.`, { cause: error });
  }
}

export async function verifyMigrationHistory(options: VerifyMigrationHistoryOptions): Promise<MigrationHistoryReport> {
  const migrationsDirectory = path.join(options.repositoryRoot, "db", "migrations");
  const manifestPath = path.join(migrationsDirectory, "checksums.json");
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  const migrationFiles = (await readdir(migrationsDirectory)).filter((name) => migrationFilePattern.test(name)).sort();
  const recordedFiles = Object.keys(manifest.files).sort();
  const trustedReleaseAnchors = options.trustedReleaseAnchors ?? defaultTrustedReleaseAnchors;

  const migrationNumbers = new Map<number, string>();
  for (const fileName of migrationFiles) {
    const number = Number.parseInt(fileName.match(migrationFilePattern)![0], 10);
    const existing = migrationNumbers.get(number);
    if (existing) {
      throw new Error(`Duplicate migration number ${number}: ${existing} and ${fileName} cannot be ordered.`);
    }
    migrationNumbers.set(number, fileName);
  }

  for (const fileName of migrationFiles) {
    if (!(fileName in manifest.files)) {
      throw new Error(`Migration is not recorded in db/migrations/checksums.json: ${fileName}.`);
    }
  }
  for (const fileName of recordedFiles) {
    if (!migrationFiles.includes(fileName)) {
      throw new Error(`Missing migration file: ${fileName} remains recorded in db/migrations/checksums.json.`);
    }
  }

  for (const fileName of migrationFiles) {
    const contents = await readFile(path.join(migrationsDirectory, fileName));
    const actualChecksum = sha256(contents);
    if (actualChecksum !== manifest.files[fileName]) {
      throw new Error(
        `Checksum mismatch for ${fileName}: expected ${manifest.files[fileName]}, received ${actualChecksum}. ` +
          "Published migrations are immutable; add a new numbered migration instead."
      );
    }
  }

  for (const [tag, trustedFiles] of Object.entries(trustedReleaseAnchors)) {
    for (const [fileName, trustedChecksum] of Object.entries(trustedFiles)) {
      const anchoredChecksum = manifest.releaseAnchors[tag]?.[fileName];
      if (anchoredChecksum === undefined) {
        throw new Error(`Required release anchor ${tag}/${fileName} is missing from db/migrations/checksums.json.`);
      }
      if (anchoredChecksum !== trustedChecksum) {
        throw new Error(`Release anchor ${tag}/${fileName} must remain ${trustedChecksum}; received ${anchoredChecksum}.`);
      }
      if (manifest.files[fileName] !== trustedChecksum) {
        throw new Error(
          `Checked-in ${fileName} must remain byte-identical to ${tag} at ${trustedChecksum}; ` +
            `the manifest records ${manifest.files[fileName] ?? "no checksum"}.`
        );
      }
    }
  }

  const readReleaseFile = options.readReleaseFile ??
    ((tag: string, repositoryPath: string) => readTaggedFile(options.repositoryRoot, tag, repositoryPath));
  for (const tag of Object.keys(manifest.releaseAnchors).sort()) {
    for (const [fileName, expectedChecksum] of Object.entries(manifest.releaseAnchors[tag]).sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      const contents = await readReleaseFile(tag, path.posix.join("db", "migrations", fileName));
      const actualChecksum = sha256(contents);
      if (actualChecksum !== expectedChecksum) {
        throw new Error(
          `Release anchor checksum mismatch for ${tag}/${fileName}: expected ${expectedChecksum}, received ${actualChecksum}.`
        );
      }
    }
  }

  return {
    migrationFiles,
    releaseAnchors: Object.keys(manifest.releaseAnchors).sort()
  };
}
