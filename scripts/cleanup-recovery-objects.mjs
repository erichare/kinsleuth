#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";

import { del, get, list } from "@vercel/blob";

import {
  isRecoveryIdentitySentinel,
  recoveryNamespacePrefix,
  recoveryObjectNamespaceNames
} from "../lib/recovery-evidence-operations.ts";

try {
  const [cleanupPath, proofPath, ...unexpected] = process.argv.slice(2);
  if (!cleanupPath || unexpected.length > 0) {
    throw new Error("Usage: cleanup-recovery-objects.mjs <cleanup.json> [proof.json].");
  }
  const token = required("RECOVERY_TARGET_BLOB_READ_WRITE_TOKEN");
  const archiveId = required("EXPECTED_ARCHIVE_ID");
  const identity = required("RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY");
  const expectedProviderStoreId = required("RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID");
  const requireComplete = process.env.RECOVERY_TARGET_OBJECT_CLEANUP_REQUIRE_COMPLETE === "true";
  const cleanup = JSON.parse(await readFile(cleanupPath, "utf8"));
  if (
    JSON.stringify(Object.keys(cleanup).sort()) !== JSON.stringify([
      "archiveId", "objectStoreIdentity", "objects", "providerStoreId", "schemaVersion"
    ].sort())
    || cleanup.schemaVersion !== 1
    || cleanup.archiveId !== archiveId
    || cleanup.objectStoreIdentity !== identity
    || cleanup.providerStoreId !== expectedProviderStoreId
    || !Array.isArray(cleanup.objects)
  ) throw new Error("The recovery cleanup manifest is not bound to the expected target cell.");

  const sentinel = await get(`archives/${archiveId}/release-readiness/${identity}`, {
    access: "private", token, useCache: false
  });
  if (!sentinel || sentinel.statusCode !== 200) throw new Error("The recovery target identity sentinel is missing.");
  const sentinelDigest = createHash("sha256").update(await bytes(sentinel.stream)).digest("hex");
  if (sentinelDigest !== identity || providerStoreIdFromUrl(sentinel.blob.url) !== expectedProviderStoreId) {
    throw new Error("The recovery cleanup token does not address the expected physical object store.");
  }

  const expected = new Map();
  for (const object of cleanup.objects) {
    if (
      typeof object?.pathname !== "string"
      || !recoveryObjectNamespaceNames.some((name) => object.pathname.startsWith(recoveryNamespacePrefix(archiveId, name)))
      || isRecoveryIdentitySentinel(archiveId, object.pathname, identity)
      || !/^[a-f0-9]{64}$/.test(object.sha256)
      || expected.has(object.pathname)
    ) throw new Error("The recovery cleanup manifest contains an invalid or duplicate object.");
    expected.set(object.pathname, object.sha256);
  }
  const actual = [];
  for (const name of recoveryObjectNamespaceNames) {
    actual.push(...(await listAll(token, recoveryNamespacePrefix(archiveId, name))).filter(
      (blob) => !isRecoveryIdentitySentinel(archiveId, blob.pathname, identity)
    ));
  }
  if (actual.some((blob) => !expected.has(blob.pathname))) {
    throw new Error("The recovery target contains an unexpected object; refusing cleanup.");
  }
  if (requireComplete && actual.length !== expected.size) {
    throw new Error("The recovery target does not contain the exact restored object set required for cleanup proof.");
  }
  for (const blob of actual) {
    const result = await get(blob.pathname, { access: "private", token, useCache: false });
    if (!result || result.statusCode !== 200) throw new Error("A recovery cleanup object is unreadable.");
    const digest = createHash("sha256").update(await bytes(result.stream)).digest("hex");
    if (digest !== expected.get(blob.pathname)) throw new Error("A recovery cleanup object changed after restore.");
  }
  if (actual.length > 0) await del(actual.map((blob) => blob.pathname), { token });
  for (const name of recoveryObjectNamespaceNames) {
    const remaining = (await listAll(token, recoveryNamespacePrefix(archiveId, name))).filter(
      (blob) => !isRecoveryIdentitySentinel(archiveId, blob.pathname, identity)
    );
    if (remaining.length !== 0) throw new Error("Recovery target cleanup did not leave an empty namespace.");
  }
  if (proofPath) {
    await writeFile(proofPath, `${JSON.stringify({
      schemaVersion: 1,
      archiveId,
      objectStoreIdentity: identity,
      providerStoreId: expectedProviderStoreId,
      expectedObjectCount: expected.size,
      removedObjectCount: actual.length,
      completeSetObserved: actual.length === expected.size,
      targetObjectDataRemoved: true,
      verifiedAt: new Date().toISOString()
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(proofPath, 0o600);
  }
  console.log("Removed exactly the identity-bound objects restored by this recovery drill.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery target object cleanup failed.");
  process.exitCode = 1;
}

async function listAll(token, prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ token, prefix, limit: 1_000, ...(cursor ? { cursor } : {}) });
    blobs.push(...page.blobs);
    if (page.hasMore && !page.cursor) throw new Error("The object provider omitted a cleanup cursor.");
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

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
