#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { get, list } from "@vercel/blob";

import {
  canonicalJson,
  isRecoveryIdentitySentinel,
  recoveryNamespacePrefix,
  recoveryObjectNamespaceNames,
  summarizeRecoveryObjectManifest
} from "../lib/recovery-evidence-operations.ts";

try {
  const [backupDirectory, outputPath, ...unexpected] = process.argv.slice(2);
  if (!backupDirectory || !outputPath || unexpected.length > 0) {
    throw new Error("Usage: capture-recovery-objects.mjs <backup-directory> <output.json>.");
  }
  const token = required("RECOVERY_BLOB_READ_WRITE_TOKEN");
  const archiveId = required("EXPECTED_ARCHIVE_ID");
  const expectedIdentity = digest(required("EXPECTED_OBJECT_STORAGE_IDENTITY"), "object-storage identity");
  const expectedProviderStoreId = providerStoreId(required("EXPECTED_OBJECT_STORAGE_PROVIDER_ID"));
  const actualProviderStoreId = await assertIdentity(token, archiveId, expectedIdentity);
  if (actualProviderStoreId !== expectedProviderStoreId) {
    throw new Error("The private object provider store does not match its configured physical identity.");
  }
  await mkdir(path.join(backupDirectory, "objects"), { recursive: true, mode: 0o700 });
  await mkdir(path.join(backupDirectory, "manifests"), { recursive: true, mode: 0o700 });

  const objectNamespaces = [];
  for (const name of recoveryObjectNamespaceNames) {
    const prefix = recoveryNamespacePrefix(archiveId, name);
    const blobs = (await listAll(token, prefix)).filter(
      (blob) => !isRecoveryIdentitySentinel(archiveId, blob.pathname, expectedIdentity)
    );
    const entries = [];
    for (const blob of blobs) {
      if (!blob.pathname.startsWith(prefix)) {
        throw new Error("The object provider returned a pathname outside the requested namespace.");
      }
      const result = await get(blob.pathname, {
        access: "private",
        token,
        useCache: false
      });
      if (!result || result.statusCode !== 200 || result.blob.pathname !== blob.pathname) {
        throw new Error("A listed recovery object could not be read exactly.");
      }
      const bytes = await readStream(result.stream);
      if (bytes.length !== blob.size || bytes.length !== result.blob.size) {
        throw new Error("A recovery object changed size while it was captured.");
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const objectPath = path.join(backupDirectory, "objects", `${sha256}.bin`);
      try {
        await writeFile(objectPath, bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = await readFile(objectPath);
        if (!existing.equals(bytes)) throw new Error("A recovery object digest collision was detected.");
      }
      entries.push({
        pathname: blob.pathname,
        contentType: result.blob.contentType,
        size: bytes.length,
        sha256
      });
    }
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.pathname), Buffer.from(right.pathname)));
    const summary = summarizeRecoveryObjectManifest(name, entries);
    await writePrivateJson(path.join(backupDirectory, "manifests", `${name}.json`), {
      schemaVersion: 1,
      name,
      archiveId,
      prefix,
      entries
    });
    objectNamespaces.push(summary);
  }

  await writePrivateJson(outputPath, {
    archiveId,
    objectStoreIdentity: expectedIdentity,
    providerStoreId: actualProviderStoreId,
    objectNamespaces
  });
  console.log("Captured both private recovery object namespaces.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery object capture failed.");
  process.exitCode = 1;
}

async function assertIdentity(token, archiveId, expectedIdentity) {
  const pathname = `archives/${archiveId}/release-readiness/${expectedIdentity}`;
  const result = await get(pathname, { access: "private", token, useCache: false });
  if (!result || result.statusCode !== 200 || result.blob.pathname !== pathname) {
    throw new Error("The expected private object-storage identity sentinel is unavailable.");
  }
  const actual = createHash("sha256").update(await readStream(result.stream)).digest("hex");
  if (actual !== expectedIdentity) throw new Error("The private object store does not match its expected identity.");
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
  const paths = new Set();
  for (const blob of result) {
    if (paths.has(blob.pathname)) throw new Error("The object provider returned a duplicate pathname.");
    paths.add(blob.pathname);
  }
  return result.sort((left, right) => Buffer.compare(Buffer.from(left.pathname), Buffer.from(right.pathname)));
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

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${canonicalJson(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
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
