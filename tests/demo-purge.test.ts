import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createDemoPurgeFenceId,
  createDemoPurgeInventory,
  demoPurgeProductManifestSha256,
  demoPurgeMutableGlobalTables,
  demoPurgePreservedArchiveTables,
  demoPurgePreservedGlobalTables,
  demoPurgeProductTables,
  objectStoreProviderDigest,
  validateDemoPurgeBackupEvidence,
  validateDemoPurgeConfirmations,
  validateDemoPurgeExecutionState,
  validateDemoPurgeInventory,
  validateDemoPurgePublicSchemaTables,
  validateDemoPurgeReceipt,
  validateDemoPurgeReceiptFenceContinuity,
  validateDemoPurgeSchemaTables,
  type DemoPurgeBindings,
  type DemoPurgeInventory,
  type DemoPurgeObjectNamespaceManifest,
  type DemoPurgeTableManifest
} from "@/lib/demo-purge";
import { canonicalJson, sha256Utf8 } from "@/lib/recovery-evidence-operations";

const now = new Date("2026-07-15T12:00:00.000Z");
const bindings: DemoPurgeBindings = {
  archiveId: "demo-cell-01",
  databaseIdentity: "a".repeat(64),
  objectStoreIdentity: "b".repeat(64),
  objectStoreProviderId: "demostore-123",
  releaseCommitSha: "c".repeat(40)
};

describe("demo-only purge evidence", () => {
  it("accepts a recent, exact, privacy-safe production backup receipt", () => {
    const result = validateDemoPurgeBackupEvidence(backupEvidence(), bindings, now);
    const approvedDigest = "9".repeat(64);
    const approved = validateDemoPurgeBackupEvidence(
      backupEvidence(),
      bindings,
      now,
      approvedDigest
    );

    expect(result.completedAt).toBe("2026-07-15T10:06:00.000Z");
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(approved.digest).toBe(approvedDigest);
  });

  it("requires a current recovery margin for new work but permits exact durable recovery", () => {
    const shortRetention = backupEvidence();
    for (const transfer of [shortRetention.ciphertext.database, shortRetention.ciphertext.objects]) {
      transfer.storage.bucketProtection.defaultRetention.value = 1;
      transfer.storage.objectRetention.validatedMinimumDays = 1;
      transfer.storage.objectRetention.retainUntil = "2026-07-16T10:02:00.000Z";
    }
    expect(() => validateDemoPurgeBackupEvidence(shortRetention, bindings, now)).toThrow(
      /recovery window/i
    );

    const recoveryTime = new Date("2026-07-17T12:00:00.000Z");
    expect(() => validateDemoPurgeBackupEvidence(
      backupEvidence(),
      bindings,
      recoveryTime,
      undefined,
      { allowStaleRecovery: true }
    )).not.toThrow();
    expect(() => validateDemoPurgeBackupEvidence(backupEvidence(), bindings, recoveryTime)).toThrow(
      /stale|timing/i
    );
  });

  it.each([
    ["archive", (value: any) => { value.archiveDigest = "f".repeat(64); }],
    ["database", (value: any) => { value.databaseIdentity = "f".repeat(64); }],
    ["object store", (value: any) => { value.objectStoreIdentity = "f".repeat(64); }],
    ["provider", (value: any) => { value.objectStoreProviderDigest = "f".repeat(64); }],
    ["release", (value: any) => { value.releaseCommitSha = "f".repeat(40); }]
  ])("rejects backup evidence for a different %s identity", (_label, mutate) => {
    const value = backupEvidence();
    mutate(value);
    expect(() => validateDemoPurgeBackupEvidence(value, bindings, now)).toThrow(/exact demo cell/i);
  });

  it("rejects stale, incomplete, or expanded backup receipts", () => {
    const stale = backupEvidence();
    stale.completedAt = "2026-07-13T10:06:00.000Z";
    expect(() => validateDemoPurgeBackupEvidence(stale, bindings, now)).toThrow(/stale|timing/i);

    const missingNamespace = backupEvidence();
    missingNamespace.objectNamespaces.pop();
    expect(() => validateDemoPurgeBackupEvidence(missingNamespace, bindings, now)).toThrow(/both object/i);

    const unexpected = { ...backupEvidence(), providerStoreId: bindings.objectStoreProviderId };
    expect(() => validateDemoPurgeBackupEvidence(unexpected, bindings, now)).toThrow(/fields/i);

    const legacy = backupEvidence();
    legacy.schemaVersion = 1;
    expect(() => validateDemoPurgeBackupEvidence(legacy, bindings, now)).toThrow(/exact demo cell/i);

    const splitBucket = backupEvidence();
    splitBucket.ciphertext.objects.storage.bucketDigest = "7".repeat(64);
    expect(() => validateDemoPurgeBackupEvidence(splitBucket, bindings, now)).toThrow(
      /protected offsite location/i
    );
  });
});

describe("demo purge inventory and confirmations", () => {
  it("creates an opaque inventory bound to the backup and exact physical cell", () => {
    const inventory = makeInventory();
    const serialized = JSON.stringify(inventory);

    expect(inventory.inventoryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(inventory.datasetMode).toBe("demo");
    expect(serialized).not.toContain(bindings.archiveId);
    expect(serialized).not.toContain(bindings.objectStoreProviderId);
    expect(inventory.objectStoreProviderDigest).toBe(objectStoreProviderDigest(bindings.objectStoreProviderId));
  });

  it("refuses to purge database rows or objects absent from the approved backup", () => {
    const productTables = demoProductTables();
    const objectNamespaces = demoObjectNamespaces();
    const backup = validateDemoPurgeBackupEvidence(backupEvidence(), bindings, now);

    const extraRow = structuredClone(productTables);
    extraRow[0]!.rowCount += 1;
    expect(() => createDemoPurgeInventory({
      bindings,
      backup,
      safety: demoSafety(),
      productTables: extraRow,
      mutableGlobalTables: demoMutableGlobalTables(),
      preservedTables: demoPreservedTables(),
      objectNamespaces,
      now
    })).toThrow(/exact state captured/i);

    const extraObject = structuredClone(objectNamespaces);
    extraObject[0]!.backupManifestSha256 = "f".repeat(64);
    expect(() => createDemoPurgeInventory({
      bindings,
      backup,
      safety: demoSafety(),
      productTables,
      mutableGlobalTables: demoMutableGlobalTables(),
      preservedTables: demoPreservedTables(),
      objectNamespaces: extraObject,
      now
    })).toThrow(/exact state captured/i);
  });

  it("requires both exact confirmation steps, including the complete inventory digest", () => {
    const inventory = makeInventory();
    const confirmation = `PURGE-DEMO:${inventory.archiveDigest}:${inventory.inventoryDigest}`;

    expect(() => validateDemoPurgeConfirmations(inventory, "demo", confirmation)).not.toThrow();
    expect(() => validateDemoPurgeConfirmations(inventory, "pilot", confirmation)).toThrow(/demo dataset/i);
    expect(() => validateDemoPurgeConfirmations(inventory, "demo", `${confirmation} `)).toThrow(
      /inventory-bound/i
    );
  });

  it("rejects modified or expired inventories", () => {
    const inventory = makeInventory();
    const backup = validateDemoPurgeBackupEvidence(backupEvidence(), bindings, now);
    const tampered = structuredClone(inventory);
    tampered.database.productTables[0]!.rowCount += 1;
    expect(() => validateDemoPurgeInventory(tampered, bindings, backup, now)).toThrow(/modified/i);

    expect(() => validateDemoPurgeInventory(
      inventory,
      bindings,
      backup,
      new Date("2026-07-15T12:16:00.000Z")
    )).toThrow(/expired/i);
    expect(() => validateDemoPurgeInventory(
      inventory,
      bindings,
      backup,
      new Date("2026-07-15T12:16:00.000Z"),
      { allowExpiredRecovery: true }
    )).not.toThrow();

    const expanded = structuredClone(inventory) as any;
    expanded.database.preservedTables[0].rawRows = ["secret"];
    const { inventoryDigest: _oldDigest, ...expandedBody } = expanded;
    expanded.inventoryDigest = sha256Utf8(`${canonicalJson(expandedBody)}\n`);
    expect(() => validateDemoPurgeInventory(expanded, bindings, backup, now)).toThrow(/fields/i);
  });

  it("derives a valid, deterministic, inventory-specific write fence", () => {
    const inventory = makeInventory();
    const fenceId = createDemoPurgeFenceId(inventory.inventoryDigest);
    expect(fenceId).toMatch(/^fence-demo-purge-[a-f0-9]{32}$/);
    expect(createDemoPurgeFenceId(inventory.inventoryDigest)).toBe(fenceId);
  });
});

describe("demo purge crash-recovery receipts", () => {
  it("validates the exact pending, pre-release, and final state transitions", () => {
    const inventory = makeInventory();
    const pending = pendingReceipt(inventory);
    const preRelease = preReleaseReceipt(inventory);
    const final = finalReceipt(inventory);

    expect(validateDemoPurgeReceipt(pending, inventory).kind).toBe(
      "kinresolve-demo-purge-pending-receipt"
    );
    expect(validateDemoPurgeReceipt(preRelease, inventory).kind).toBe(
      "kinresolve-demo-purge-pre-release-receipt"
    );
    expect(validateDemoPurgeReceipt(final, inventory).kind).toBe("kinresolve-demo-purge-receipt");
  });

  it("rejects receipts that can be replayed against another inventory or fence generation", () => {
    const inventory = makeInventory();
    const wrongInventory = structuredClone(inventory);
    wrongInventory.inventoryDigest = "f".repeat(64);
    expect(() => validateDemoPurgeReceipt(pendingReceipt(inventory), wrongInventory)).toThrow(
      /exact inventory|does not match/i
    );

    const wrongGeneration = preReleaseReceipt(inventory);
    wrongGeneration.fence.activationGeneration = 0;
    expect(() => validateDemoPurgeReceipt(wrongGeneration, inventory)).toThrow(/fence/i);

    const expanded = { ...pendingReceipt(inventory), operatorEmail: "operator@example.com" };
    expect(() => validateDemoPurgeReceipt(expanded, inventory)).toThrow(/fields/i);
  });

  it("never treats a released pending fence generation as crash-recovery authority", () => {
    const inventory = makeInventory();
    const pending = validateDemoPurgeReceipt(pendingReceipt(inventory), inventory);
    const activeFence = {
      fenceId: pending.fence.fenceId,
      releaseCommitSha: inventory.releaseCommitSha,
      state: "active" as const,
      activationGeneration: pending.fence.activationGeneration,
      firstActivatedAt: pending.fence.activatedAt,
      activatedAt: pending.fence.activatedAt,
      releasedAt: null,
      updatedAt: pending.fence.activatedAt
    };
    expect(() => validateDemoPurgeReceiptFenceContinuity(pending, activeFence)).not.toThrow();
    expect(() => validateDemoPurgeReceiptFenceContinuity(pending, {
      ...activeFence,
      state: "released",
      releasedAt: "2026-07-15T12:01:00.000Z"
    })).toThrow(/requires its exact active fence/i);
    expect(() => validateDemoPurgeReceiptFenceContinuity(pending, {
      ...activeFence,
      activationGeneration: activeFence.activationGeneration + 1
    })).toThrow(/generation/i);
  });

  it("requires empty database/object proof and monotonic fence timing before finalization", () => {
    const inventory = makeInventory();
    const nonEmpty = finalReceipt(inventory);
    nonEmpty.objects.namespaces[0]!.objectCount = 1 as 0;
    expect(() => validateDemoPurgeReceipt(nonEmpty, inventory)).toThrow(/namespace/i);

    const releasedTooEarly = finalReceipt(inventory);
    releasedTooEarly.fence.releasedAt = "2026-07-15T11:59:59.000Z";
    expect(() => validateDemoPurgeReceipt(releasedTooEarly, inventory)).toThrow(/timing/i);

    const verifiedTooEarly = preReleaseReceipt(inventory);
    verifiedTooEarly.verifiedEmptyAt = "2026-07-15T12:00:29.000Z";
    expect(() => validateDemoPurgeReceipt(verifiedTooEarly, inventory)).toThrow(/timing/i);
  });
});

describe("demo purge execution state", () => {
  it("accepts only an exact fresh state before destructive work", () => {
    const inventory = makeInventory();
    expect(validateDemoPurgeExecutionState(inventory, currentState(inventory), {
      allowResume: false
    })).toEqual({ databaseAlreadyPurged: false, objectsAlreadyPurged: false });

    const changed = currentState(inventory);
    changed.database.productTables[0]!.rowCount += 1;
    expect(() => validateDemoPurgeExecutionState(inventory, changed, { allowResume: false })).toThrow(
      /changed/i
    );
  });

  it("treats every session and short-lived global capability as destructive state", () => {
    const inventory = makeInventory();
    const changed = currentState(inventory);
    changed.database.mutableGlobalTables[0]!.rowCount += 1;
    expect(() => validateDemoPurgeExecutionState(inventory, changed, { allowResume: false })).toThrow(
      /changed/i
    );

    const purged = currentState(inventory);
    purged.database.productTables = emptyProductTables();
    purged.database.mutableGlobalTables = emptyMutableGlobalTables();
    purged.objectNamespaces = [
      emptyObjectNamespace("archive-private"),
      emptyObjectNamespace("legacy-gedcom")
    ];
    expect(validateDemoPurgeExecutionState(inventory, purged, { allowResume: true })).toEqual({
      databaseAlreadyPurged: true,
      objectsAlreadyPurged: true
    });
  });

  it("resumes only after all product tables are empty and remaining objects are a confirmed subset", () => {
    const inventory = makeInventory();
    const resumed = currentState(inventory);
    resumed.database.productTables = emptyProductTables();
    resumed.database.mutableGlobalTables = emptyMutableGlobalTables();
    resumed.objectNamespaces[0] = emptyObjectNamespace("archive-private");

    expect(validateDemoPurgeExecutionState(inventory, resumed, { allowResume: true })).toEqual({
      databaseAlreadyPurged: true,
      objectsAlreadyPurged: false
    });
    expect(() => validateDemoPurgeExecutionState(inventory, resumed, { allowResume: false })).toThrow(/changed/i);

    resumed.objectNamespaces[1]!.entries[0]!.contentSha256 = "f".repeat(64);
    resumed.objectNamespaces[1]!.manifestSha256 = sha256Utf8(
      `${canonicalJson(resumed.objectNamespaces[1]!.entries)}\n`
    );
    expect(() => validateDemoPurgeExecutionState(inventory, resumed, { allowResume: true })).toThrow(/subset/i);
  });

  it("never tolerates changes to identity, legal, or operational evidence", () => {
    const inventory = makeInventory();
    const current = currentState(inventory);
    current.database.preservedTables[0]!.manifestSha256 = "f".repeat(64);
    expect(() => validateDemoPurgeExecutionState(inventory, current, { allowResume: true })).toThrow(
      /identity, legal, or operational evidence/i
    );
  });

  it("fails closed when work, bearer capabilities, another fence, or live writes exist", () => {
    const inventory = makeInventory();
    for (const key of [
      "activeJobLeases",
      "unexpiredUploadIntents",
      "activeInvitationCapabilities",
      "activeEmailVerificationCapabilities",
      "oauthAccountCapabilities",
      "otherActiveReleaseFences",
      "activeClientTransactions"
    ] as const) {
      const current = currentState(inventory);
      current.safety[key] = 1;
      expect(() => validateDemoPurgeExecutionState(inventory, current, { allowResume: false })).toThrow(
        /zero active leases/i
      );
    }
    const openInvitations = currentState(inventory);
    openInvitations.safety.invitationsPaused = false as true;
    expect(() => validateDemoPurgeExecutionState(
      inventory,
      openInvitations,
      { allowResume: false }
    )).toThrow(/paused invitations/i);
    const hidden = currentState(inventory);
    hidden.safety.transactionVisibilityVerified = false as true;
    expect(() => validateDemoPurgeExecutionState(inventory, hidden, { allowResume: false })).toThrow(
      /client transactions/i
    );
  });
});

describe("demo purge schema and CLI contract", () => {
  it("classifies every archive-scoped table and keeps product deletion disjoint from evidence", () => {
    const classified = [...demoPurgeProductTables, ...demoPurgePreservedArchiveTables];
    expect(() => validateDemoPurgeSchemaTables(classified)).not.toThrow();
    expect(new Set(classified).size).toBe(classified.length);
    expect(demoPurgeProductTables).not.toContain("memberships");
    expect(demoPurgeProductTables).not.toContain("beta_terms_acceptances");
    expect(demoPurgeProductTables).not.toContain("beta_identity_audit_events");
    expect(demoPurgeProductTables).not.toContain("beta_data_operations");
    expect(() => validateDemoPurgeSchemaTables([...classified, "future_archive_rows"])).toThrow(
      /unclassified/i
    );
    const publicTables = [
      ...classified,
      ...demoPurgeMutableGlobalTables,
      ...demoPurgePreservedGlobalTables
    ];
    expect(() => validateDemoPurgePublicSchemaTables(publicTables)).not.toThrow();
    expect(() => validateDemoPurgePublicSchemaTables([...publicTables, "future_global_rows"])).toThrow(
      /unclassified/i
    );
  });

  it("keeps inventory and execution separate and refuses a non-demo configured mode before I/O", async () => {
    const script = await readFile(path.join(process.cwd(), "scripts", "demo-purge.mjs"), "utf8");
    const databaseExecutor = await readFile(
      path.join(process.cwd(), "lib", "demo-purge-database.ts"),
      "utf8"
    );
    expect(script).toContain('operation === "inventory"');
    expect(script).toContain('operation === "execute"');
    expect(script).toContain('process.env.KINRESOLVE_DATASET_MODE !== "demo"');
    expect(script).toContain("acquireReleaseFence");
    expect(script).toContain("releaseReleaseFence");
    expect(script).toContain("isRecoveryIdentitySentinel");
    expect(script).not.toMatch(/DELETE FROM public\.archives/i);
    for (const table of [...demoPurgePreservedGlobalTables, ...demoPurgePreservedArchiveTables]) {
      expect(script).not.toContain(`DELETE FROM public.${table}`);
    }
    expect(script).toContain("demoPurgeMutableGlobalTables");
    expect(databaseExecutor).toContain("IN SHARE ROW EXCLUSIVE MODE");
    expect(script).toContain("DEMO_PURGE_APPROVED_BACKUP_EVIDENCE_SHA256");
    expect(script).toContain("kinresolve-demo-purge-pending-receipt");
    expect(script).toContain("kinresolve-demo-purge-pre-release-receipt");
    expect(script.indexOf("destructiveWorkStarted = true")).toBeLessThan(
      script.indexOf("await purgeDatabase(")
    );
    expect(script.indexOf("const destructiveAuthorizationTime = new Date()"))
      .toBeLessThan(script.indexOf("destructiveWorkStarted = true"));
    const pendingInvalidation = script.indexOf("await invalidatePendingReceipt(receiptPath)");
    expect(pendingInvalidation).toBeGreaterThan(-1);
    expect(pendingInvalidation).toBeLessThan(
      script.indexOf("await releaseReleaseFence(fenceIdentity", pendingInvalidation)
    );
    expect(script).toContain('status,\n    inventoryDigest: receipt.inventoryDigest');
    expect(script).toContain("await rename(temporaryPath, filePath)");
  });
});

function backupEvidence(): any {
  const productTables = demoProductTables();
  const objectNamespaces = demoObjectNamespaces();
  const storage = (fileName: "database.dump.age" | "objects.tar.age", versionId: string) => ({
    bucketDigest: "6".repeat(64),
    key: `production-backup/2026-07-15/${bindings.releaseCommitSha}/12345-1/${fileName}`,
    versionId,
    bucketProtection: {
      versioning: "Enabled",
      objectLock: "Enabled",
      defaultRetention: { mode: "COMPLIANCE", unit: "days", value: 30 }
    },
    objectRetention: {
      mode: "COMPLIANCE",
      retainUntil: "2026-08-15T10:02:00.000Z",
      validatedMinimumDays: 30
    }
  });
  return {
    schemaVersion: 3,
    kind: "kinresolve-encrypted-offsite-backup",
    releaseCommitSha: bindings.releaseCommitSha,
    runId: "12345",
    runAttempt: "1",
    archiveDigest: sha256Utf8(bindings.archiveId),
    databaseIdentity: bindings.databaseIdentity,
    databaseManifestSha256: "d".repeat(64),
    databaseProductManifestSha256: demoPurgeProductManifestSha256(productTables),
    migrationVersions: ["001_initial", "015_beta_operations"],
    objectStoreIdentity: bindings.objectStoreIdentity,
    objectStoreProviderDigest: objectStoreProviderDigest(bindings.objectStoreProviderId),
    objectNamespaces: objectNamespaces.map((namespace) => ({
      name: namespace.name,
      objectCount: namespace.objectCount,
      totalBytes: namespace.totalBytes,
      manifestSha256: namespace.backupManifestSha256
    })),
    providerRecoveryPointCreatedAt: "2026-07-15T09:00:00.000Z",
    ciphertext: {
      database: {
        sha256: "1".repeat(64),
        size: 100,
        uploadedAt: "2026-07-15T10:02:00.000Z",
        verifiedDownloadAt: "2026-07-15T10:04:00.000Z",
        storage: storage("database.dump.age", "database-version-1")
      },
      objects: {
        sha256: "2".repeat(64),
        size: 200,
        uploadedAt: "2026-07-15T10:02:00.000Z",
        verifiedDownloadAt: "2026-07-15T10:04:00.000Z",
        storage: storage("objects.tar.age", "objects-version-1")
      }
    },
    fence: {
      fenceId: "fence-production-backup-12345",
      activatedAt: "2026-07-15T10:00:00.000Z",
      releasedAt: "2026-07-15T10:05:00.000Z",
      durationSeconds: 300
    },
    completedAt: "2026-07-15T10:06:00.000Z"
  };
}

function makeInventory(): DemoPurgeInventory {
  const backup = validateDemoPurgeBackupEvidence(backupEvidence(), bindings, now);
  return createDemoPurgeInventory({
    bindings,
    backup,
    safety: demoSafety(),
    productTables: demoProductTables(),
    mutableGlobalTables: demoMutableGlobalTables(),
    preservedTables: demoPreservedTables(),
    objectNamespaces: demoObjectNamespaces(),
    now
  });
}

function currentState(inventory: DemoPurgeInventory) {
  return {
    safety: structuredClone(inventory.safety),
    database: structuredClone(inventory.database),
    objectNamespaces: structuredClone(inventory.objectNamespaces)
  };
}

function receiptBindings(inventory: DemoPurgeInventory) {
  return {
    releaseCommitSha: inventory.releaseCommitSha,
    archiveDigest: inventory.archiveDigest,
    databaseIdentity: inventory.databaseIdentity,
    objectStoreIdentity: inventory.objectStoreIdentity,
    objectStoreProviderDigest: inventory.objectStoreProviderDigest,
    backupEvidenceDigest: inventory.backupEvidenceDigest,
    inventoryDigest: inventory.inventoryDigest
  };
}

function pendingReceipt(inventory: DemoPurgeInventory) {
  return {
    schemaVersion: 1 as const,
    kind: "kinresolve-demo-purge-pending-receipt" as const,
    ...receiptBindings(inventory),
    fence: {
      fenceId: createDemoPurgeFenceId(inventory.inventoryDigest),
      activatedAt: "2026-07-15T12:00:30.000Z",
      activationGeneration: 1
    },
    startedAt: "2026-07-15T12:00:00.000Z"
  };
}

function preReleaseReceipt(inventory: DemoPurgeInventory) {
  return {
    schemaVersion: 1 as const,
    kind: "kinresolve-demo-purge-pre-release-receipt" as const,
    ...receiptBindings(inventory),
    fence: {
      fenceId: createDemoPurgeFenceId(inventory.inventoryDigest),
      activatedAt: "2026-07-15T12:00:30.000Z",
      activationGeneration: 1
    },
    startedAt: "2026-07-15T12:00:00.000Z",
    verifiedEmptyAt: "2026-07-15T12:07:00.000Z"
  };
}

function finalReceipt(inventory: DemoPurgeInventory) {
  const emptyManifest = sha256Utf8(`${canonicalJson([])}\n`);
  return {
    schemaVersion: 1 as const,
    kind: "kinresolve-demo-purge-receipt" as const,
    ...receiptBindings(inventory),
    database: {
      productRowsBefore: inventory.database.productTables.reduce(
        (total, table) => total + table.rowCount,
        0
      ),
      productRowsAfter: 0 as const,
      mutableSecurityRowsBefore: inventory.database.mutableGlobalTables.reduce(
        (total, table) => total + table.rowCount,
        0
      ),
      mutableSecurityRowsAfter: 0 as const,
      preservedManifestSha256: sha256Utf8(
        `${canonicalJson(inventory.database.preservedTables)}\n`
      )
    },
    objects: {
      objectsBefore: inventory.objectNamespaces.reduce(
        (total, namespace) => total + namespace.objectCount,
        0
      ),
      objectsAfter: 0 as const,
      namespaces: [
        { name: "archive-private" as const, objectCount: 0 as const, totalBytes: 0, manifestSha256: emptyManifest },
        { name: "legacy-gedcom" as const, objectCount: 0 as const, totalBytes: 0, manifestSha256: emptyManifest }
      ]
    },
    fence: {
      fenceId: createDemoPurgeFenceId(inventory.inventoryDigest),
      activatedAt: "2026-07-15T12:00:30.000Z",
      activationGeneration: 1,
      releasedAt: "2026-07-15T12:07:30.000Z"
    },
    startedAt: "2026-07-15T12:00:00.000Z",
    completedAt: "2026-07-15T12:08:00.000Z"
  };
}

function emptyProductTables(): DemoPurgeTableManifest[] {
  return demoPurgeProductTables.map((name) => ({
    name,
    rowCount: 0,
    manifestSha256: sha256Utf8(`${canonicalJson([])}\n`)
  }));
}

function emptyMutableGlobalTables(): DemoPurgeTableManifest[] {
  return demoPurgeMutableGlobalTables.map((name) => ({
    name,
    rowCount: 0,
    manifestSha256: sha256Utf8(`${canonicalJson([])}\n`)
  }));
}

function emptyObjectNamespace(
  name: DemoPurgeObjectNamespaceManifest["name"]
): DemoPurgeObjectNamespaceManifest {
  return objectNamespace(name, []);
}

function objectNamespace(
  name: DemoPurgeObjectNamespaceManifest["name"],
  entries: DemoPurgeObjectNamespaceManifest["entries"]
): DemoPurgeObjectNamespaceManifest {
  return {
    name,
    objectCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
    manifestSha256: sha256Utf8(`${canonicalJson(entries)}\n`),
    backupManifestSha256: sha256Utf8(`${name}:${canonicalJson(entries)}\n`),
    entries
  };
}

function demoProductTables(): DemoPurgeTableManifest[] {
  return demoPurgeProductTables.map((name, index) => ({
    name,
    rowCount: index === 0 ? 2 : 0,
    manifestSha256: index === 0 ? "3".repeat(64) : sha256Utf8(`${canonicalJson([])}\n`)
  }));
}

function demoMutableGlobalTables(): DemoPurgeTableManifest[] {
  return demoPurgeMutableGlobalTables.map((name, index) => ({
    name,
    rowCount: index === 0 ? 1 : 0,
    manifestSha256: index === 0 ? "9".repeat(64) : sha256Utf8(`${canonicalJson([])}\n`)
  }));
}

function demoPreservedTables(): DemoPurgeTableManifest[] {
  return [...demoPurgePreservedGlobalTables, ...demoPurgePreservedArchiveTables].map(
    (name) => ({ name, rowCount: 1, manifestSha256: "4".repeat(64) })
  );
}

function demoObjectNamespaces(): DemoPurgeObjectNamespaceManifest[] {
  return [
    objectNamespace("archive-private", [objectEntry("5", 10, "6")]),
    objectNamespace("legacy-gedcom", [objectEntry("7", 20, "8")])
  ];
}

function demoSafety() {
  return {
    activeJobLeases: 0,
    unexpiredUploadIntents: 0,
    activeInvitationCapabilities: 0,
    activeEmailVerificationCapabilities: 0,
    oauthAccountCapabilities: 0,
    otherActiveReleaseFences: 0,
    activeClientTransactions: 0,
    invitationsPaused: true as const,
    transactionVisibilityVerified: true as const
  };
}

function objectEntry(pathCharacter: string, size: number, contentCharacter: string) {
  return {
    pathnameDigest: pathCharacter.repeat(64),
    size,
    contentSha256: contentCharacter.repeat(64)
  };
}
