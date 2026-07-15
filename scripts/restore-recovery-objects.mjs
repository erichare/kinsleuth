#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { get, list, put } from "@vercel/blob";

import {
  canonicalJson,
  isRecoveryIdentitySentinel,
  recoveryNamespacePrefix,
  recoveryObjectNamespaceNames,
  summarizeRecoveryObjectManifest
} from "../lib/recovery-evidence-operations.ts";

try {
  const [backupDirectory, outputPath, cleanupPath, ...unexpected] = process.argv.slice(2);
  if (!backupDirectory || !outputPath || !cleanupPath || unexpected.length > 0) {
    throw new Error("Usage: restore-recovery-objects.mjs <backup-directory> <output.json> <cleanup.json>.");
  }
  const token = required("RECOVERY_TARGET_BLOB_READ_WRITE_TOKEN");
  const archiveId = required("EXPECTED_ARCHIVE_ID");
  const targetIdentity = digest(required("RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY"), "target object identity");
  const expectedProviderStoreId = providerStoreId(required("RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID"));
  const actualProviderStoreId = await assertIdentity(token, archiveId, targetIdentity);
  if (actualProviderStoreId !== expectedProviderStoreId) {
    throw new Error("The recovery target provider store does not match its configured physical identity.");
  }

  const manifests = [];
  for (const name of recoveryObjectNamespaceNames) {
    const manifest = await readManifest(path.join(backupDirectory, "manifests", `${name}.json`));
    const prefix = recoveryNamespacePrefix(archiveId, name);
    if (
      manifest.schemaVersion !== 1
      || manifest.name !== name
      || manifest.archiveId !== archiveId
      || manifest.prefix !== prefix
      || !Array.isArray(manifest.entries)
      || JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify([
        "archiveId", "entries", "name", "prefix", "schemaVersion"
      ].sort())
    ) {
      throw new Error("A recovery object manifest does not match the requested archive namespace.");
    }
    summarizeRecoveryObjectManifest(name, manifest.entries);
    manifests.push(manifest);
  }

  const cleanupObjects = manifests.flatMap((manifest) => manifest.entries.map((entry) => ({
    pathname: entry.pathname,
    sha256: entry.sha256
  })));
  await writeFile(cleanupPath, `${canonicalJson({
    schemaVersion: 1,
    archiveId,
    objectStoreIdentity: targetIdentity,
    providerStoreId: actualProviderStoreId,
    objects: cleanupObjects
  })}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(cleanupPath, 0o600);

  for (const manifest of manifests) {
    const existing = (await listAll(token, manifest.prefix)).filter(
      (blob) => !isRecoveryIdentitySentinel(archiveId, blob.pathname, targetIdentity)
    );
    if (existing.length !== 0) {
      throw new Error("The recovery target object namespace must be empty before restore.");
    }
  }

  for (const manifest of manifests) {
    for (const entry of manifest.entries) {
      if (!entry.pathname.startsWith(manifest.prefix)) {
        throw new Error("A recovery object manifest contains a pathname outside its namespace.");
      }
      const bytes = await readFile(path.join(backupDirectory, "objects", `${entry.sha256}.bin`));
      if (
        bytes.length !== entry.size
        || createHash("sha256").update(bytes).digest("hex") !== entry.sha256
      ) {
        throw new Error("A recovery object backup does not match its manifest.");
      }
      await put(entry.pathname, bytes, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: entry.contentType,
        token
      });
    }
  }

  const objectNamespaces = [];
  for (const manifest of manifests) {
    const restoredEntries = [];
    const blobs = (await listAll(token, manifest.prefix)).filter(
      (blob) => !isRecoveryIdentitySentinel(archiveId, blob.pathname, targetIdentity)
    );
    for (const blob of blobs) {
      const result = await get(blob.pathname, { access: "private", token, useCache: false });
      if (!result || result.statusCode !== 200 || result.blob.pathname !== blob.pathname) {
        throw new Error("A restored recovery object could not be read exactly.");
      }
      const bytes = await readStream(result.stream);
      restoredEntries.push({
        pathname: blob.pathname,
        contentType: result.blob.contentType,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex")
      });
    }
    restoredEntries.sort((left, right) => Buffer.compare(Buffer.from(left.pathname), Buffer.from(right.pathname)));
    const sourceSummary = summarizeRecoveryObjectManifest(manifest.name, manifest.entries);
    const restoredSummary = summarizeRecoveryObjectManifest(manifest.name, restoredEntries);
    if (JSON.stringify(restoredSummary) !== JSON.stringify(sourceSummary)) {
      throw new Error("A restored recovery object namespace does not match its source manifest.");
    }
    objectNamespaces.push(restoredSummary);
  }

  await writeFile(outputPath, `${canonicalJson({
    archiveId,
    objectStoreIdentity: targetIdentity,
    providerStoreId: actualProviderStoreId,
    objectNamespaces
  })}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log("Restored and re-read both private recovery object namespaces.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery object restore failed.");
  process.exitCode = 1;
}

async function assertIdentity(token, archiveId, expectedIdentity) {
  const pathname = `archives/${archiveId}/release-readiness/${expectedIdentity}`;
  const result = await get(pathname, { access: "private", token, useCache: false });
  if (!result || result.statusCode !== 200 || result.blob.pathname !== pathname) {
    throw new Error("The recovery target object identity sentinel is unavailable.");
  }
  const actual = createHash("sha256").update(await readStream(result.stream)).digest("hex");
  if (actual !== expectedIdentity) throw new Error("The recovery target object store identity does not match.");
  return providerStoreIdFromUrl(result.blob.url);
}

async function listAll(token, prefix) {
  const result = [];
  let cursor;
  do {
    const page = await list({ token, prefix, limit: 1_000, ...(cursor ? { cursor } : {}) });
    result.push(...page.blobs);
    if (result.length > 100_000) throw new Error("A recovery object namespace exceeds the supported object count.");
    if (page.hasMore && !page.cursor) throw new Error("The object provider omitted a required pagination cursor.");
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return result.sort((left, right) => Buffer.compare(Buffer.from(left.pathname), Buffer.from(right.pathname)));
}

async function readManifest(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("A recovery object manifest is missing or invalid JSON.");
  }
}

async function readStream(stream) {
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    chunks.push(bytes);
    length += bytes.length;
    if (!Number.isSafeInteger(length)) throw new Error("A recovery object exceeds the safe integer range.");
  }
  return Buffer.concat(chunks, length);
}

function digest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`The recovery ${label} is invalid.`);
  return value;
}

function providerStoreId(value) {
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(value)) throw new Error("The object provider store ID is invalid.");
  return value;
}

function providerStoreIdFromUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The object provider did not return a valid store URL.");
  }
  const match = parsed.hostname.match(/^([a-z0-9][a-z0-9-]{7,63})\.private\.blob\.vercel-storage\.com$/);
  if (!match || parsed.protocol !== "https:") throw new Error("The object provider store URL is not private Vercel Blob.");
  return match[1];
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
