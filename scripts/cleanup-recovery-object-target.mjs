#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";

import { del, get, list } from "@vercel/blob";

import {
  isRecoveryIdentitySentinel,
  recoveryNamespacePrefix,
  recoveryObjectNamespaceNames
} from "../lib/recovery-evidence-operations.ts";

try {
  const [outputPath, ...unexpected] = process.argv.slice(2);
  if (!outputPath || unexpected.length > 0) {
    throw new Error("Usage: cleanup-recovery-object-target.mjs <proof.json>.");
  }
  const token = required("RECOVERY_TARGET_BLOB_READ_WRITE_TOKEN");
  const archiveId = required("EXPECTED_ARCHIVE_ID");
  const identity = digest(required("RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY"));
  const expectedProviderStoreId = providerStoreId(required("RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID"));
  await assertIdentity(token, archiveId, identity, expectedProviderStoreId);

  const objects = [];
  for (const name of recoveryObjectNamespaceNames) {
    const prefix = recoveryNamespacePrefix(archiveId, name);
    objects.push(...(await listAll(token, prefix)).filter(
      (blob) => !isRecoveryIdentitySentinel(archiveId, blob.pathname, identity)
    ));
  }
  for (let offset = 0; offset < objects.length; offset += 1_000) {
    await del(objects.slice(offset, offset + 1_000).map((blob) => blob.pathname), { token });
  }
  for (const name of recoveryObjectNamespaceNames) {
    const remaining = (await listAll(token, recoveryNamespacePrefix(archiveId, name))).filter(
      (blob) => !isRecoveryIdentitySentinel(archiveId, blob.pathname, identity)
    );
    if (remaining.length !== 0) {
      throw new Error("Recovery target janitor did not leave an empty object namespace.");
    }
  }

  await writeFile(outputPath, `${JSON.stringify({
    schemaVersion: 1,
    archiveId,
    objectStoreIdentity: identity,
    providerStoreId: expectedProviderStoreId,
    removedObjectCount: objects.length,
    targetObjectDataRemoved: true,
    verifiedAt: new Date().toISOString()
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log("Verified cleanup of the exact disposable recovery object namespaces.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery target object janitor failed.");
  process.exitCode = 1;
}

async function assertIdentity(token, archiveId, expectedIdentity, expectedProviderStoreId) {
  const pathname = `archives/${archiveId}/release-readiness/${expectedIdentity}`;
  const result = await get(pathname, { access: "private", token, useCache: false });
  if (!result || result.statusCode !== 200 || result.blob.pathname !== pathname) {
    throw new Error("The recovery target object identity sentinel is unavailable.");
  }
  const actualIdentity = createHash("sha256").update(await bytes(result.stream)).digest("hex");
  if (actualIdentity !== expectedIdentity || providerStoreIdFromUrl(result.blob.url) !== expectedProviderStoreId) {
    throw new Error("The recovery janitor token does not address the expected physical object store.");
  }
}

async function listAll(token, prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ token, prefix, limit: 1_000, ...(cursor ? { cursor } : {}) });
    blobs.push(...page.blobs);
    if (blobs.length > 100_000) throw new Error("A recovery object namespace exceeds the janitor limit.");
    if (page.hasMore && !page.cursor) throw new Error("The object provider omitted a janitor cursor.");
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function bytes(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function providerStoreIdFromUrl(value) {
  const parsed = new URL(value);
  const match = parsed.hostname.match(/^([a-z0-9][a-z0-9-]{7,63})\.private\.blob\.vercel-storage\.com$/);
  if (!match || parsed.protocol !== "https:") throw new Error("The cleanup provider URL is invalid.");
  return match[1];
}

function providerStoreId(value) {
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(value)) {
    throw new Error("The recovery object provider store ID is invalid.");
  }
  return value;
}

function digest(value) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("The recovery object identity is invalid.");
  return value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
