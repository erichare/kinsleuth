import { canonicalJson, recoveryObjectNamespaceNames, sha256Utf8 } from "./recovery-evidence-operations.ts";
import type { ReleaseFence } from "./release-fence.ts";

const digestPattern = /^[a-f0-9]{64}$/;
const gitShaPattern = /^[a-f0-9]{40}$/;
const archiveIdPattern = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const providerStoreIdPattern = /^[a-z0-9][a-z0-9-]{7,63}$/;
const migrationVersionPattern = /^[0-9]{3}_[a-z0-9_]{1,96}$/;
const maximumBackupAgeMs = 24 * 60 * 60_000;
const maximumClockSkewMs = 5 * 60_000;
export const demoPurgeInventoryLifetimeMs = 15 * 60_000;
export const demoPurgeBackupRecoveryWindowMs = 24 * 60 * 60_000;

export const demoPurgeProductTables = [
  "integration_media_write_claims",
  "integration_media_objects",
  "integration_upload_intents",
  "sync_changes",
  "external_entity_refs",
  "durable_jobs",
  "sync_runs",
  "integration_snapshots",
  "integration_artifacts",
  "integration_connections",
  "tasks",
  "evidence_items",
  "hypotheses",
  "research_cases",
  "dna_hypotheses",
  "person_facts",
  "embeddings",
  "ai_runs",
  "sources",
  "raw_records",
  "import_snapshots",
  "workspace_backups",
  "dna_matches",
  "people"
] as const;

// These archive-owned rows are identity, legal, or operational evidence. The
// purge inventory proves they did not change, and the executor never targets
// them for deletion.
export const demoPurgePreservedArchiveTables = [
  "memberships",
  "beta_invitations",
  "beta_email_verification_tokens",
  "beta_terms_acceptances",
  "beta_identity_audit_events",
  "beta_worker_heartbeats",
  "beta_data_operations"
] as const;

// These deployment-global tables contain short-lived bearer or replay
// capabilities. A hosted demo cell is physically isolated, so clearing every
// row is both archive-safe and required to prove that a reset revoked active
// sessions and recovery/operator capabilities.
export const demoPurgeMutableGlobalTables = [
  "session",
  "verification",
  "auth_rate_limit_buckets",
  "beta_operator_nonces"
] as const;

export const demoPurgePreservedGlobalTables = [
  "archives",
  "legacy_users",
  "user",
  "account",
  "schema_migrations",
  "release_write_fences",
  "beta_invitation_control",
] as const;

export type DemoPurgeBindings = {
  archiveId: string;
  databaseIdentity: string;
  objectStoreIdentity: string;
  objectStoreProviderId: string;
  releaseCommitSha: string;
};

export type DemoPurgeTableManifest = {
  name: string;
  rowCount: number;
  manifestSha256: string;
};

export type DemoPurgeObjectEntry = {
  pathnameDigest: string;
  size: number;
  contentSha256: string;
};

export type DemoPurgeObjectNamespaceManifest = {
  name: (typeof recoveryObjectNamespaceNames)[number];
  objectCount: number;
  totalBytes: number;
  manifestSha256: string;
  backupManifestSha256: string;
  entries: DemoPurgeObjectEntry[];
};

export type DemoPurgeSafetyState = {
  activeJobLeases: number;
  unexpiredUploadIntents: number;
  activeInvitationCapabilities: number;
  activeEmailVerificationCapabilities: number;
  oauthAccountCapabilities: number;
  otherActiveReleaseFences: number;
  activeClientTransactions: number;
  invitationsPaused: true;
  transactionVisibilityVerified: true;
};

export type DemoPurgeInventory = {
  schemaVersion: 1;
  kind: "kinresolve-demo-purge-inventory";
  datasetMode: "demo";
  releaseCommitSha: string;
  createdAt: string;
  expiresAt: string;
  archiveDigest: string;
  databaseIdentity: string;
  objectStoreIdentity: string;
  objectStoreProviderDigest: string;
  backupEvidenceDigest: string;
  backupCompletedAt: string;
  safety: DemoPurgeSafetyState;
  database: {
    productTables: DemoPurgeTableManifest[];
    mutableGlobalTables: DemoPurgeTableManifest[];
    preservedTables: DemoPurgeTableManifest[];
  };
  objectNamespaces: DemoPurgeObjectNamespaceManifest[];
  inventoryDigest: string;
};

export type DemoPurgeCurrentState = Pick<
  DemoPurgeInventory,
  "safety" | "database" | "objectNamespaces"
>;

export type ValidatedBackupEvidence = {
  digest: string;
  completedAt: string;
  databaseProductManifestSha256: string;
  objectNamespaces: Array<{
    name: (typeof recoveryObjectNamespaceNames)[number];
    objectCount: number;
    totalBytes: number;
    manifestSha256: string;
  }>;
};

export type DemoPurgePendingReceipt = Readonly<{
  schemaVersion: 1;
  kind: "kinresolve-demo-purge-pending-receipt";
  releaseCommitSha: string;
  archiveDigest: string;
  databaseIdentity: string;
  objectStoreIdentity: string;
  objectStoreProviderDigest: string;
  backupEvidenceDigest: string;
  inventoryDigest: string;
  fence: {
    fenceId: string;
    activatedAt: string;
    activationGeneration: number;
  };
  startedAt: string;
}>;

export type DemoPurgePreReleaseReceipt = Readonly<{
  schemaVersion: 1;
  kind: "kinresolve-demo-purge-pre-release-receipt";
  releaseCommitSha: string;
  archiveDigest: string;
  databaseIdentity: string;
  objectStoreIdentity: string;
  objectStoreProviderDigest: string;
  backupEvidenceDigest: string;
  inventoryDigest: string;
  fence: {
    fenceId: string;
    activatedAt: string;
    activationGeneration: number;
  };
  startedAt: string;
  verifiedEmptyAt: string;
}>;

export type DemoPurgeFinalReceipt = Readonly<{
  schemaVersion: 1;
  kind: "kinresolve-demo-purge-receipt";
  releaseCommitSha: string;
  archiveDigest: string;
  databaseIdentity: string;
  objectStoreIdentity: string;
  objectStoreProviderDigest: string;
  backupEvidenceDigest: string;
  inventoryDigest: string;
  database: {
    productRowsBefore: number;
    productRowsAfter: 0;
    mutableSecurityRowsBefore: number;
    mutableSecurityRowsAfter: 0;
    preservedManifestSha256: string;
  };
  objects: {
    objectsBefore: number;
    objectsAfter: 0;
    namespaces: Array<{
      name: (typeof recoveryObjectNamespaceNames)[number];
      objectCount: 0;
      totalBytes: 0;
      manifestSha256: string;
    }>;
  };
  fence: {
    fenceId: string;
    activatedAt: string;
    activationGeneration: number;
    releasedAt: string;
  };
  startedAt: string;
  completedAt: string;
}>;

export type DemoPurgeReceipt =
  | DemoPurgePendingReceipt
  | DemoPurgePreReleaseReceipt
  | DemoPurgeFinalReceipt;

export function validateDemoPurgeBindings(value: DemoPurgeBindings): DemoPurgeBindings {
  if (!archiveIdPattern.test(value.archiveId)) {
    throw new Error("The demo purge archive identity is invalid.");
  }
  if (!digestPattern.test(value.databaseIdentity)) {
    throw new Error("The demo purge database identity is invalid.");
  }
  if (!digestPattern.test(value.objectStoreIdentity)) {
    throw new Error("The demo purge object-store identity is invalid.");
  }
  if (!providerStoreIdPattern.test(value.objectStoreProviderId)) {
    throw new Error("The demo purge object provider identity is invalid.");
  }
  if (!gitShaPattern.test(value.releaseCommitSha)) {
    throw new Error("The demo purge release commit is invalid.");
  }
  return { ...value };
}

export function objectStoreProviderDigest(providerStoreId: string): string {
  if (!providerStoreIdPattern.test(providerStoreId)) {
    throw new Error("The demo purge object provider identity is invalid.");
  }
  return sha256Utf8(providerStoreId);
}

export function validateDemoPurgeBackupEvidence(
  value: unknown,
  bindings: DemoPurgeBindings,
  now = new Date(),
  approvedEvidenceSha256?: string,
  options: { allowStaleRecovery?: boolean } = {}
): ValidatedBackupEvidence {
  validateDemoPurgeBindings(bindings);
  if (Number.isNaN(now.getTime())) throw new Error("The demo purge validation time is invalid.");

  const evidence = exactRecord(value, [
    "schemaVersion",
    "kind",
    "releaseCommitSha",
    "runId",
    "runAttempt",
    "archiveDigest",
    "databaseIdentity",
    "databaseManifestSha256",
    "databaseProductManifestSha256",
    "migrationVersions",
    "objectStoreIdentity",
    "objectStoreProviderDigest",
    "objectNamespaces",
    "providerRecoveryPointCreatedAt",
    "ciphertext",
    "fence",
    "completedAt"
  ], "production backup evidence");

  if (
    evidence.schemaVersion !== 3
    || evidence.kind !== "kinresolve-encrypted-offsite-backup"
    || evidence.releaseCommitSha !== bindings.releaseCommitSha
    || evidence.archiveDigest !== sha256Utf8(bindings.archiveId)
    || evidence.databaseIdentity !== bindings.databaseIdentity
    || evidence.objectStoreIdentity !== bindings.objectStoreIdentity
    || evidence.objectStoreProviderDigest !== objectStoreProviderDigest(bindings.objectStoreProviderId)
    || typeof evidence.runId !== "string"
    || !/^[1-9][0-9]{0,19}$/.test(evidence.runId)
    || typeof evidence.runAttempt !== "string"
    || !/^[1-9][0-9]{0,5}$/.test(evidence.runAttempt)
    || !isDigest(evidence.databaseManifestSha256)
    || !isDigest(evidence.databaseProductManifestSha256)
  ) {
    throw new Error("The production backup evidence does not match this exact demo cell.");
  }

  if (
    !Array.isArray(evidence.migrationVersions)
    || evidence.migrationVersions.length === 0
    || evidence.migrationVersions.some((version) => (
      typeof version !== "string" || !migrationVersionPattern.test(version)
    ))
    || new Set(evidence.migrationVersions).size !== evidence.migrationVersions.length
  ) {
    throw new Error("The production backup migration evidence is invalid.");
  }
  const backupObjectNamespaces = validateBackupNamespaceSummaries(evidence.objectNamespaces);

  const fence = exactRecord(
    evidence.fence,
    ["fenceId", "activatedAt", "releasedAt", "durationSeconds"],
    "backup fence"
  );
  if (
    typeof fence.fenceId !== "string"
    || !/^fence-[a-z0-9][a-z0-9-]{7,63}$/.test(fence.fenceId)
    || !Number.isSafeInteger(fence.durationSeconds)
    || (fence.durationSeconds as number) <= 0
  ) {
    throw new Error("The production backup fence evidence is invalid.");
  }
  const activatedAt = timestamp(fence.activatedAt, "backup fence activation");
  const releasedAt = timestamp(fence.releasedAt, "backup fence release");
  const providerPointAt = timestamp(
    evidence.providerRecoveryPointCreatedAt,
    "provider recovery point"
  );
  const completedAt = timestamp(evidence.completedAt, "backup completion");
  const activatedTime = new Date(activatedAt).getTime();
  const releasedTime = new Date(releasedAt).getTime();
  const ciphertext = exactRecord(evidence.ciphertext, ["database", "objects"], "backup ciphertext");
  const databaseCiphertext = validateCiphertext(ciphertext.database, {
    label: "database",
    fileName: "database.dump.age",
    releaseCommitSha: bindings.releaseCommitSha,
    runId: evidence.runId as string,
    runAttempt: evidence.runAttempt as string,
    activatedTime,
    releasedTime
  });
  const objectsCiphertext = validateCiphertext(ciphertext.objects, {
    label: "objects",
    fileName: "objects.tar.age",
    releaseCommitSha: bindings.releaseCommitSha,
    runId: evidence.runId as string,
    runAttempt: evidence.runAttempt as string,
    activatedTime,
    releasedTime
  });
  const databasePrefix = databaseCiphertext.storage.key.slice(0, -"database.dump.age".length);
  const objectsPrefix = objectsCiphertext.storage.key.slice(0, -"objects.tar.age".length);
  if (
    databaseCiphertext.storage.bucketDigest !== objectsCiphertext.storage.bucketDigest
    || databasePrefix !== objectsPrefix
    || canonicalJson(databaseCiphertext.storage.bucketProtection)
      !== canonicalJson(objectsCiphertext.storage.bucketProtection)
    || databaseCiphertext.storage.objectRetention.validatedMinimumDays
      !== objectsCiphertext.storage.objectRetention.validatedMinimumDays
  ) {
    throw new Error("The production backup ciphertexts do not share one protected offsite location.");
  }
  const providerPointTime = new Date(providerPointAt).getTime();
  const completedTime = new Date(completedAt).getTime();
  if (
    releasedTime <= activatedTime
    || fence.durationSeconds !== Math.ceil((releasedTime - activatedTime) / 1_000)
    || completedTime < releasedTime
    || providerPointTime > completedTime + maximumClockSkewMs
    || completedTime - providerPointTime > maximumBackupAgeMs
    || completedTime > now.getTime() + maximumClockSkewMs
    || (!options.allowStaleRecovery && now.getTime() - completedTime > maximumBackupAgeMs)
  ) {
    throw new Error("The production backup evidence is stale or has invalid timing.");
  }

  if (approvedEvidenceSha256 !== undefined && !isDigest(approvedEvidenceSha256)) {
    throw new Error("The approved production backup evidence digest is invalid.");
  }
  if (
    !options.allowStaleRecovery
    && (
      new Date(databaseCiphertext.storage.objectRetention.retainUntil).getTime()
        < now.getTime() + demoPurgeBackupRecoveryWindowMs - maximumClockSkewMs
      || new Date(objectsCiphertext.storage.objectRetention.retainUntil).getTime()
        < now.getTime() + demoPurgeBackupRecoveryWindowMs - maximumClockSkewMs
    )
  ) {
    throw new Error("The production backup retention does not cover the demo purge recovery window.");
  }

  return {
    digest: approvedEvidenceSha256 ?? sha256Utf8(`${canonicalJson(evidence)}\n`),
    completedAt,
    databaseProductManifestSha256: evidence.databaseProductManifestSha256 as string,
    objectNamespaces: backupObjectNamespaces
  };
}

export function createDemoPurgeInventory(input: {
  bindings: DemoPurgeBindings;
  backup: ValidatedBackupEvidence;
  safety: DemoPurgeSafetyState;
  productTables: DemoPurgeTableManifest[];
  mutableGlobalTables: DemoPurgeTableManifest[];
  preservedTables: DemoPurgeTableManifest[];
  objectNamespaces: DemoPurgeObjectNamespaceManifest[];
  now?: Date;
}): DemoPurgeInventory {
  const bindings = validateDemoPurgeBindings(input.bindings);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("The demo purge inventory time is invalid.");
  validateSafety(input.safety);
  const productTables = validateTableManifests(input.productTables, demoPurgeProductTables, "product");
  const mutableGlobalTables = validateTableManifests(
    input.mutableGlobalTables,
    demoPurgeMutableGlobalTables,
    "mutable global"
  );
  const preservedTables = validateTableManifests(
    input.preservedTables,
    [...demoPurgePreservedGlobalTables, ...demoPurgePreservedArchiveTables],
    "preserved"
  );
  const objectNamespaces = validateObjectNamespaces(input.objectNamespaces);
  if (!isDigest(input.backup.digest)) throw new Error("The demo purge backup evidence digest is invalid.");
  const backupCompletedAt = timestamp(input.backup.completedAt, "backup completion");
  if (new Date(backupCompletedAt).getTime() > now.getTime() + maximumClockSkewMs) {
    throw new Error("The demo purge backup completion time is in the future.");
  }
  if (
    demoPurgeProductManifestSha256(productTables) !== input.backup.databaseProductManifestSha256
    || input.backup.objectNamespaces.some((backupNamespace) => {
      const current = objectNamespaces.find((namespace) => namespace.name === backupNamespace.name);
      return current === undefined
        || current.objectCount !== backupNamespace.objectCount
        || current.totalBytes !== backupNamespace.totalBytes
        || current.backupManifestSha256 !== backupNamespace.manifestSha256;
    })
  ) {
    throw new Error("The demo purge inventory is not the exact state captured by the approved backup.");
  }

  const withoutDigest = {
    schemaVersion: 1 as const,
    kind: "kinresolve-demo-purge-inventory" as const,
    datasetMode: "demo" as const,
    releaseCommitSha: bindings.releaseCommitSha,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + demoPurgeInventoryLifetimeMs).toISOString(),
    archiveDigest: sha256Utf8(bindings.archiveId),
    databaseIdentity: bindings.databaseIdentity,
    objectStoreIdentity: bindings.objectStoreIdentity,
    objectStoreProviderDigest: objectStoreProviderDigest(bindings.objectStoreProviderId),
    backupEvidenceDigest: input.backup.digest,
    backupCompletedAt,
    safety: { ...input.safety },
    database: { productTables, mutableGlobalTables, preservedTables },
    objectNamespaces
  };
  return {
    ...withoutDigest,
    inventoryDigest: sha256Utf8(`${canonicalJson(withoutDigest)}\n`)
  };
}

export function validateDemoPurgeInventory(
  value: unknown,
  bindings: DemoPurgeBindings,
  backup: ValidatedBackupEvidence,
  now = new Date(),
  options: { allowExpiredRecovery?: boolean } = {}
): DemoPurgeInventory {
  const inventory = exactRecord(value, [
    "schemaVersion",
    "kind",
    "datasetMode",
    "releaseCommitSha",
    "createdAt",
    "expiresAt",
    "archiveDigest",
    "databaseIdentity",
    "objectStoreIdentity",
    "objectStoreProviderDigest",
    "backupEvidenceDigest",
    "backupCompletedAt",
    "safety",
    "database",
    "objectNamespaces",
    "inventoryDigest"
  ], "demo purge inventory");
  if (!isDigest(inventory.inventoryDigest)) {
    throw new Error("The demo purge inventory digest is invalid.");
  }
  const { inventoryDigest, ...withoutDigest } = inventory;
  if (sha256Utf8(`${canonicalJson(withoutDigest)}\n`) !== inventoryDigest) {
    throw new Error("The demo purge inventory was modified after it was created.");
  }

  const normalized = createDemoPurgeInventory({
    bindings,
    backup,
    safety: inventory.safety as DemoPurgeSafetyState,
    productTables: exactRecord(
      inventory.database,
      ["productTables", "mutableGlobalTables", "preservedTables"],
      "inventory database"
    )
      .productTables as DemoPurgeTableManifest[],
    mutableGlobalTables: (inventory.database as Record<string, unknown>)
      .mutableGlobalTables as DemoPurgeTableManifest[],
    preservedTables: (inventory.database as Record<string, unknown>).preservedTables as DemoPurgeTableManifest[],
    objectNamespaces: inventory.objectNamespaces as DemoPurgeObjectNamespaceManifest[],
    now: new Date(timestamp(inventory.createdAt, "inventory creation"))
  });
  const expiresAt = timestamp(inventory.expiresAt, "inventory expiry");
  if (
    inventory.schemaVersion !== 1
    || inventory.kind !== "kinresolve-demo-purge-inventory"
    || inventory.datasetMode !== "demo"
    || inventory.inventoryDigest !== normalized.inventoryDigest
    || inventory.backupEvidenceDigest !== backup.digest
    || inventory.backupCompletedAt !== backup.completedAt
    || expiresAt !== normalized.expiresAt
    || (!options.allowExpiredRecovery && now.getTime() > new Date(expiresAt).getTime())
    || now.getTime() + maximumClockSkewMs < new Date(normalized.createdAt).getTime()
  ) {
    throw new Error("The demo purge inventory is expired or does not match this exact cell and backup.");
  }
  return normalized;
}

export function validateDemoPurgeConfirmations(
  inventory: DemoPurgeInventory,
  datasetModeConfirmation: string | undefined,
  purgeConfirmation: string | undefined
): void {
  if (datasetModeConfirmation !== "demo") {
    throw new Error("The exact demo dataset confirmation is required.");
  }
  const expected = `PURGE-DEMO:${inventory.archiveDigest}:${inventory.inventoryDigest}`;
  if (purgeConfirmation !== expected) {
    throw new Error("The exact inventory-bound demo purge confirmation is required.");
  }
}

export function validateDemoPurgeExecutionState(
  inventory: DemoPurgeInventory,
  current: DemoPurgeCurrentState,
  options: { allowResume: boolean }
): { databaseAlreadyPurged: boolean; objectsAlreadyPurged: boolean } {
  validateSafety(current.safety);
  const productTables = validateTableManifests(current.database.productTables, demoPurgeProductTables, "product");
  const mutableGlobalTables = validateTableManifests(
    current.database.mutableGlobalTables,
    demoPurgeMutableGlobalTables,
    "mutable global"
  );
  const preservedTables = validateTableManifests(
    current.database.preservedTables,
    [...demoPurgePreservedGlobalTables, ...demoPurgePreservedArchiveTables],
    "preserved"
  );
  const objectNamespaces = validateObjectNamespaces(current.objectNamespaces);
  if (canonicalJson(preservedTables) !== canonicalJson(inventory.database.preservedTables)) {
    throw new Error("Identity, legal, or operational evidence changed after the purge inventory was confirmed.");
  }

  const exactDatabase = canonicalJson(productTables) === canonicalJson(inventory.database.productTables);
  const exactMutableGlobal = canonicalJson(mutableGlobalTables)
    === canonicalJson(inventory.database.mutableGlobalTables);
  const databaseAlreadyPurged = productTables.every((table) => table.rowCount === 0)
    && mutableGlobalTables.every((table) => table.rowCount === 0);
  const exactObjects = canonicalJson(objectNamespaces) === canonicalJson(inventory.objectNamespaces);
  const objectsAlreadyPurged = objectNamespaces.every((namespace) => namespace.objectCount === 0);

  if (exactDatabase && exactMutableGlobal && exactObjects) {
    return { databaseAlreadyPurged, objectsAlreadyPurged };
  }
  if (!options.allowResume || !databaseAlreadyPurged) {
    throw new Error("Demo data changed after the purge inventory was confirmed.");
  }
  assertObjectSubset(inventory.objectNamespaces, objectNamespaces);
  return { databaseAlreadyPurged: true, objectsAlreadyPurged };
}

export function validateDemoPurgeSchemaTables(tableNames: readonly string[]): void {
  const expected = [...demoPurgeProductTables, ...demoPurgePreservedArchiveTables].sort(compareUtf8);
  const actual = [...tableNames].sort(compareUtf8);
  if (
    actual.length !== expected.length
    || new Set(actual).size !== actual.length
    || actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error("The archive-scoped database schema contains an unclassified or missing purge table.");
  }
}

export function validateDemoPurgePublicSchemaTables(tableNames: readonly string[]): void {
  const expected = [
    ...demoPurgeProductTables,
    ...demoPurgePreservedArchiveTables,
    ...demoPurgeMutableGlobalTables,
    ...demoPurgePreservedGlobalTables
  ].sort(compareUtf8);
  const actual = [...tableNames].sort(compareUtf8);
  if (
    actual.length !== expected.length
    || new Set(actual).size !== actual.length
    || actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error("The public database schema contains an unclassified or missing purge table.");
  }
}

export function createDemoPurgeFenceId(inventoryDigest: string): string {
  if (!isDigest(inventoryDigest)) throw new Error("The demo purge inventory digest is invalid.");
  return `fence-demo-purge-${inventoryDigest.slice(0, 32)}`;
}

export function demoPurgeProductManifestSha256(
  manifests: DemoPurgeTableManifest[]
): string {
  const validated = validateTableManifests(manifests, demoPurgeProductTables, "product");
  return sha256Utf8(`${canonicalJson(validated)}\n`);
}

export function validateDemoPurgeReceipt(
  value: unknown,
  inventory: DemoPurgeInventory
): DemoPurgeReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The demo purge receipt must be an object.");
  }
  const source = value as Record<string, unknown>;
  const kind = source.kind;
  if (kind === "kinresolve-demo-purge-pending-receipt") {
    const receipt = exactRecord(source, [
      "schemaVersion", "kind", "releaseCommitSha", "archiveDigest", "databaseIdentity",
      "objectStoreIdentity", "objectStoreProviderDigest", "backupEvidenceDigest",
      "inventoryDigest", "fence", "startedAt"
    ], "pending demo purge receipt");
    validateReceiptBindings(receipt, inventory);
    const fence = exactRecord(
      receipt.fence,
      ["fenceId", "activatedAt", "activationGeneration"],
      "pending demo purge fence"
    );
    validateReceiptFence(fence, inventory);
    const startedAt = timestamp(receipt.startedAt, "demo purge start");
    const activatedAt = timestamp(fence.activatedAt, "demo purge fence activation");
    if (new Date(activatedAt).getTime() < new Date(startedAt).getTime()) {
      throw new Error("The pending demo purge receipt timing is invalid.");
    }
    return receipt as DemoPurgePendingReceipt;
  }
  if (kind === "kinresolve-demo-purge-pre-release-receipt") {
    const receipt = exactRecord(source, [
      "schemaVersion", "kind", "releaseCommitSha", "archiveDigest", "databaseIdentity",
      "objectStoreIdentity", "objectStoreProviderDigest", "backupEvidenceDigest",
      "inventoryDigest", "fence", "startedAt", "verifiedEmptyAt"
    ], "pre-release demo purge receipt");
    validateReceiptBindings(receipt, inventory);
    const fence = exactRecord(
      receipt.fence,
      ["fenceId", "activatedAt", "activationGeneration"],
      "pre-release demo purge fence"
    );
    validateReceiptFence(fence, inventory);
    const startedAt = timestamp(receipt.startedAt, "demo purge start");
    const activatedAt = timestamp(fence.activatedAt, "demo purge fence activation");
    const verifiedEmptyAt = timestamp(receipt.verifiedEmptyAt, "demo purge empty-state verification");
    if (
      new Date(activatedAt).getTime() < new Date(startedAt).getTime()
      || new Date(verifiedEmptyAt).getTime() < new Date(activatedAt).getTime()
    ) {
      throw new Error("The pre-release demo purge receipt timing is invalid.");
    }
    return receipt as DemoPurgePreReleaseReceipt;
  }
  if (kind === "kinresolve-demo-purge-receipt") {
    const receipt = exactRecord(source, [
      "schemaVersion", "kind", "releaseCommitSha", "archiveDigest", "databaseIdentity",
      "objectStoreIdentity", "objectStoreProviderDigest", "backupEvidenceDigest",
      "inventoryDigest", "database", "objects", "fence", "startedAt", "completedAt"
    ], "final demo purge receipt");
    validateReceiptBindings(receipt, inventory);
    validateFinalReceiptState(receipt, inventory);
    return receipt as DemoPurgeFinalReceipt;
  }
  throw new Error("The demo purge receipt kind is invalid.");
}

export function validateDemoPurgeReceiptFenceContinuity(
  receipt: DemoPurgeReceipt | undefined,
  fence: ReleaseFence | null
): void {
  if (receipt === undefined) return;
  if (fence === null) {
    throw new Error("The demo purge receipt exists without its exact durable write fence.");
  }
  const receiptFence = receipt.fence;
  if (
    receiptFence.fenceId !== fence.fenceId
    || receiptFence.activatedAt !== fence.activatedAt
    || receiptFence.activationGeneration !== fence.activationGeneration
  ) {
    throw new Error("The demo purge receipt fence generation does not match the database.");
  }
  if (receipt.kind === "kinresolve-demo-purge-pending-receipt") {
    if (fence.state !== "active") {
      throw new Error("The pending demo purge receipt requires its exact active fence generation.");
    }
    return;
  }
  if (receipt.kind === "kinresolve-demo-purge-pre-release-receipt") {
    if (
      fence.state === "released"
      && (
        fence.releasedAt === null
        || new Date(fence.releasedAt).getTime() < new Date(receipt.verifiedEmptyAt).getTime()
      )
    ) {
      throw new Error("The demo purge fence was released before empty-state verification.");
    }
    return;
  }
  if (
    fence.state !== "released"
    || fence.releasedAt === null
    || receipt.fence.releasedAt !== fence.releasedAt
  ) {
    throw new Error("The final demo purge receipt does not match the released database fence.");
  }
}

function validateReceiptBindings(
  receipt: Record<string, unknown>,
  inventory: DemoPurgeInventory
): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.releaseCommitSha !== inventory.releaseCommitSha
    || receipt.archiveDigest !== inventory.archiveDigest
    || receipt.databaseIdentity !== inventory.databaseIdentity
    || receipt.objectStoreIdentity !== inventory.objectStoreIdentity
    || receipt.objectStoreProviderDigest !== inventory.objectStoreProviderDigest
    || receipt.backupEvidenceDigest !== inventory.backupEvidenceDigest
    || receipt.inventoryDigest !== inventory.inventoryDigest
  ) {
    throw new Error("The demo purge receipt does not match the exact inventory and cell.");
  }
}

function validateReceiptFence(
  fence: Record<string, unknown>,
  inventory: DemoPurgeInventory
): void {
  if (
    fence.fenceId !== createDemoPurgeFenceId(inventory.inventoryDigest)
    || !Number.isSafeInteger(fence.activationGeneration)
    || (fence.activationGeneration as number) < 1
  ) {
    throw new Error("The demo purge receipt fence is invalid.");
  }
}

function validateFinalReceiptState(
  receipt: Record<string, unknown>,
  inventory: DemoPurgeInventory
): void {
  const database = exactRecord(receipt.database, [
    "productRowsBefore", "productRowsAfter", "mutableSecurityRowsBefore",
    "mutableSecurityRowsAfter", "preservedManifestSha256"
  ], "final demo purge database receipt");
  if (
    database.productRowsBefore !== totalTableRows(inventory.database.productTables)
    || database.productRowsAfter !== 0
    || database.mutableSecurityRowsBefore !== totalTableRows(inventory.database.mutableGlobalTables)
    || database.mutableSecurityRowsAfter !== 0
    || database.preservedManifestSha256 !== sha256Utf8(
      `${canonicalJson(inventory.database.preservedTables)}\n`
    )
  ) throw new Error("The final demo purge database receipt is invalid.");

  const objects = exactRecord(
    receipt.objects,
    ["objectsBefore", "objectsAfter", "namespaces"],
    "final demo purge object receipt"
  );
  if (
    objects.objectsBefore !== inventory.objectNamespaces.reduce(
      (total, namespace) => total + namespace.objectCount,
      0
    )
    || objects.objectsAfter !== 0
  ) throw new Error("The final demo purge object receipt is invalid.");
  validateEmptyReceiptNamespaces(objects.namespaces);

  const fence = exactRecord(
    receipt.fence,
    ["fenceId", "activatedAt", "activationGeneration", "releasedAt"],
    "final demo purge fence"
  );
  validateReceiptFence(fence, inventory);
  const startedAt = timestamp(receipt.startedAt, "demo purge start");
  const activatedAt = timestamp(fence.activatedAt, "demo purge fence activation");
  const releasedAt = timestamp(fence.releasedAt, "demo purge fence release");
  const completedAt = timestamp(receipt.completedAt, "demo purge completion");
  if (
    new Date(activatedAt).getTime() < new Date(startedAt).getTime()
    || new Date(releasedAt).getTime() < new Date(activatedAt).getTime()
    || new Date(completedAt).getTime() < new Date(releasedAt).getTime()
  ) throw new Error("The final demo purge receipt timing is invalid.");
}

function validateEmptyReceiptNamespaces(value: unknown): void {
  if (!Array.isArray(value) || value.length !== recoveryObjectNamespaceNames.length) {
    throw new Error("The final demo purge receipt must cover both object namespaces.");
  }
  const emptyManifest = sha256Utf8(`${canonicalJson([])}\n`);
  for (const [index, name] of recoveryObjectNamespaceNames.entries()) {
    const namespace = exactRecord(
      value[index],
      ["name", "objectCount", "totalBytes", "manifestSha256"],
      "final demo purge object namespace"
    );
    if (
      namespace.name !== name
      || namespace.objectCount !== 0
      || namespace.totalBytes !== 0
      || namespace.manifestSha256 !== emptyManifest
    ) throw new Error("The final demo purge object namespace receipt is invalid.");
  }
}

function totalTableRows(tables: DemoPurgeTableManifest[]): number {
  return tables.reduce((total, table) => {
    const next = total + table.rowCount;
    if (!Number.isSafeInteger(next)) throw new Error("The demo purge row total is invalid.");
    return next;
  }, 0);
}

function validateSafety(value: DemoPurgeSafetyState): void {
  exactRecord(value, [
    "activeJobLeases",
    "unexpiredUploadIntents",
    "activeInvitationCapabilities",
    "activeEmailVerificationCapabilities",
    "oauthAccountCapabilities",
    "otherActiveReleaseFences",
    "activeClientTransactions",
    "invitationsPaused",
    "transactionVisibilityVerified"
  ], "demo purge safety state");
  if (
    !isZero(value?.activeJobLeases)
    || !isZero(value?.unexpiredUploadIntents)
    || !isZero(value?.activeInvitationCapabilities)
    || !isZero(value?.activeEmailVerificationCapabilities)
    || !isZero(value?.oauthAccountCapabilities)
    || !isZero(value?.otherActiveReleaseFences)
    || !isZero(value?.activeClientTransactions)
    || value?.invitationsPaused !== true
    || value?.transactionVisibilityVerified !== true
  ) {
    throw new Error(
      "Demo purge requires paused invitations and zero active leases, upload intents, "
      + "invitation/email/OAuth capabilities, other release fences, and client transactions."
    );
  }
}

function validateTableManifests(
  value: DemoPurgeTableManifest[],
  expectedNames: readonly string[],
  label: string
): DemoPurgeTableManifest[] {
  if (!Array.isArray(value) || value.length !== expectedNames.length) {
    throw new Error(`The demo purge ${label} database inventory is incomplete.`);
  }
  const byName = new Map<string, DemoPurgeTableManifest>();
  for (const item of value) {
    const manifest = exactRecord(
      item,
      ["name", "rowCount", "manifestSha256"],
      `demo purge ${label} table manifest`
    );
    if (
      typeof manifest.name !== "string"
      || !expectedNames.includes(manifest.name)
      || byName.has(manifest.name)
      || !Number.isSafeInteger(manifest.rowCount)
      || (manifest.rowCount as number) < 0
      || !isDigest(manifest.manifestSha256)
      || (
        manifest.rowCount === 0
        && manifest.manifestSha256 !== sha256Utf8(`${canonicalJson([])}\n`)
      )
    ) {
      throw new Error(`The demo purge ${label} database inventory is invalid.`);
    }
    byName.set(manifest.name, {
      name: manifest.name,
      rowCount: manifest.rowCount as number,
      manifestSha256: manifest.manifestSha256
    });
  }
  return expectedNames.map((name) => byName.get(name)!);
}

function validateObjectNamespaces(
  value: DemoPurgeObjectNamespaceManifest[]
): DemoPurgeObjectNamespaceManifest[] {
  if (!Array.isArray(value) || value.length !== recoveryObjectNamespaceNames.length) {
    throw new Error("The demo purge must inventory both private object namespaces.");
  }
  const byName = new Map<string, DemoPurgeObjectNamespaceManifest>();
  for (const namespace of value) {
    const namespaceRecord = exactRecord(namespace, [
      "name",
      "objectCount",
      "totalBytes",
      "manifestSha256",
      "backupManifestSha256",
      "entries"
    ], "demo purge object namespace manifest");
    if (
      typeof namespaceRecord.name !== "string"
      || !recoveryObjectNamespaceNames.includes(
        namespaceRecord.name as (typeof recoveryObjectNamespaceNames)[number]
      )
      || byName.has(namespaceRecord.name)
      || !Array.isArray(namespaceRecord.entries)
      || namespaceRecord.entries.length !== namespaceRecord.objectCount
      || !Number.isSafeInteger(namespaceRecord.totalBytes)
      || (namespaceRecord.totalBytes as number) < 0
      || !isDigest(namespaceRecord.manifestSha256)
      || !isDigest(namespaceRecord.backupManifestSha256)
    ) {
      throw new Error("The demo purge object namespace inventory is invalid.");
    }
    const paths = new Set<string>();
    let totalBytes = 0;
    const entries = namespaceRecord.entries.map((entry) => {
      const entryRecord = exactRecord(
        entry,
        ["pathnameDigest", "size", "contentSha256"],
        "demo purge object entry manifest"
      );
      if (
        !isDigest(entryRecord.pathnameDigest)
        || paths.has(entryRecord.pathnameDigest)
        || !Number.isSafeInteger(entryRecord.size)
        || (entryRecord.size as number) < 0
        || !isDigest(entryRecord.contentSha256)
      ) {
        throw new Error("The demo purge object entry inventory is invalid or duplicated.");
      }
      paths.add(entryRecord.pathnameDigest);
      totalBytes += entryRecord.size as number;
      if (!Number.isSafeInteger(totalBytes)) {
        throw new Error("The demo purge object inventory exceeds the safe integer range.");
      }
      return {
        pathnameDigest: entryRecord.pathnameDigest,
        size: entryRecord.size as number,
        contentSha256: entryRecord.contentSha256
      };
    }).sort((left, right) => compareUtf8(left.pathnameDigest, right.pathnameDigest));
    if (
      totalBytes !== namespaceRecord.totalBytes
      || sha256Utf8(`${canonicalJson(entries)}\n`) !== namespaceRecord.manifestSha256
    ) {
      throw new Error("The demo purge object namespace manifest does not match its entries.");
    }
    byName.set(namespaceRecord.name, {
      name: namespaceRecord.name as (typeof recoveryObjectNamespaceNames)[number],
      objectCount: entries.length,
      totalBytes,
      manifestSha256: namespaceRecord.manifestSha256,
      backupManifestSha256: namespaceRecord.backupManifestSha256,
      entries
    });
  }
  return recoveryObjectNamespaceNames.map((name) => byName.get(name)!);
}

function assertObjectSubset(
  original: DemoPurgeObjectNamespaceManifest[],
  current: DemoPurgeObjectNamespaceManifest[]
): void {
  for (const name of recoveryObjectNamespaceNames) {
    const originalNamespace = original.find((namespace) => namespace.name === name)!;
    const currentNamespace = current.find((namespace) => namespace.name === name)!;
    const originalEntries = new Map(
      originalNamespace.entries.map((entry) => [entry.pathnameDigest, entry])
    );
    for (const entry of currentNamespace.entries) {
      const expected = originalEntries.get(entry.pathnameDigest);
      if (!expected || canonicalJson(expected) !== canonicalJson(entry)) {
        throw new Error("The remaining demo objects are not a strict subset of the confirmed inventory.");
      }
    }
  }
}

function validateBackupNamespaceSummaries(value: unknown): ValidatedBackupEvidence["objectNamespaces"] {
  if (!Array.isArray(value) || value.length !== recoveryObjectNamespaceNames.length) {
    throw new Error("The production backup evidence must cover both object namespaces.");
  }
  const names = new Set<string>();
  const byName = new Map<string, ValidatedBackupEvidence["objectNamespaces"][number]>();
  for (const item of value) {
    const summary = exactRecord(
      item,
      ["name", "objectCount", "totalBytes", "manifestSha256"],
      "backup object namespace"
    );
    if (
      typeof summary.name !== "string"
      || !recoveryObjectNamespaceNames.includes(summary.name as (typeof recoveryObjectNamespaceNames)[number])
      || names.has(summary.name)
      || !Number.isSafeInteger(summary.objectCount)
      || (summary.objectCount as number) < 0
      || !Number.isSafeInteger(summary.totalBytes)
      || (summary.totalBytes as number) < 0
      || !isDigest(summary.manifestSha256)
    ) {
      throw new Error("The production backup object namespace evidence is invalid.");
    }
    names.add(summary.name);
    byName.set(summary.name, {
      name: summary.name as (typeof recoveryObjectNamespaceNames)[number],
      objectCount: summary.objectCount as number,
      totalBytes: summary.totalBytes as number,
      manifestSha256: summary.manifestSha256
    });
  }
  return recoveryObjectNamespaceNames.map((name) => byName.get(name)!);
}

function validateCiphertext(value: unknown, expected: {
  label: "database" | "objects";
  fileName: "database.dump.age" | "objects.tar.age";
  releaseCommitSha: string;
  runId: string;
  runAttempt: string;
  activatedTime: number;
  releasedTime: number;
}) {
  const ciphertext = exactRecord(
    value,
    ["sha256", "size", "uploadedAt", "verifiedDownloadAt", "storage"],
    `${expected.label} backup ciphertext`
  );
  if (
    !isDigest(ciphertext.sha256)
    || !Number.isSafeInteger(ciphertext.size)
    || (ciphertext.size as number) <= 0
  ) {
    throw new Error(`The ${expected.label} backup ciphertext evidence is invalid.`);
  }
  const uploadedAt = timestamp(ciphertext.uploadedAt, `${expected.label} backup upload`);
  const verifiedDownloadAt = timestamp(
    ciphertext.verifiedDownloadAt,
    `${expected.label} backup verified download`
  );
  const uploadedTime = new Date(uploadedAt).getTime();
  const verifiedDownloadTime = new Date(verifiedDownloadAt).getTime();
  if (
    uploadedTime < expected.activatedTime
    || verifiedDownloadTime < uploadedTime
    || verifiedDownloadTime > expected.releasedTime
  ) {
    throw new Error(`The ${expected.label} backup ciphertext timing is invalid.`);
  }

  const storage = exactRecord(ciphertext.storage, [
    "bucketDigest",
    "key",
    "versionId",
    "bucketProtection",
    "objectRetention"
  ], `${expected.label} backup storage proof`);
  const expectedKey = new RegExp(
    `^production-backup/[0-9]{4}-[0-9]{2}-[0-9]{2}/${expected.releaseCommitSha}/`
    + `${expected.runId}-${expected.runAttempt}/${expected.fileName.replaceAll(".", "\\.")}$`
  );
  if (
    !isDigest(storage.bucketDigest)
    || typeof storage.key !== "string"
    || !expectedKey.test(storage.key)
    || typeof storage.versionId !== "string"
    || !/^[^\u0000-\u0020\u007f]{1,1024}$/u.test(storage.versionId)
  ) {
    throw new Error(`The ${expected.label} backup storage locator is invalid.`);
  }

  const bucketProtection = exactRecord(storage.bucketProtection, [
    "versioning",
    "objectLock",
    "defaultRetention"
  ], `${expected.label} backup bucket protection`);
  const defaultRetention = exactRecord(bucketProtection.defaultRetention, [
    "mode",
    "unit",
    "value"
  ], `${expected.label} backup default retention`);
  if (
    bucketProtection.versioning !== "Enabled"
    || bucketProtection.objectLock !== "Enabled"
    || defaultRetention.mode !== "COMPLIANCE"
    || !["days", "years"].includes(defaultRetention.unit as string)
    || !Number.isSafeInteger(defaultRetention.value)
    || (defaultRetention.value as number) <= 0
  ) {
    throw new Error(`The ${expected.label} backup bucket protection is invalid.`);
  }

  const objectRetention = exactRecord(storage.objectRetention, [
    "mode",
    "retainUntil",
    "validatedMinimumDays"
  ], `${expected.label} backup object retention`);
  const retainUntil = timestamp(
    objectRetention.retainUntil,
    `${expected.label} backup retention expiry`
  );
  const minimumDays = objectRetention.validatedMinimumDays;
  const defaultDays = defaultRetention.unit === "days"
    ? defaultRetention.value as number
    : (defaultRetention.value as number) * 365;
  if (
    objectRetention.mode !== "COMPLIANCE"
    || !Number.isSafeInteger(minimumDays)
    || (minimumDays as number) < 1
    || (minimumDays as number) > 3_650
    || !Number.isSafeInteger(defaultDays)
    || defaultDays < (minimumDays as number)
    || new Date(retainUntil).getTime()
      < uploadedTime + (minimumDays as number) * 24 * 60 * 60_000 - maximumClockSkewMs
  ) {
    throw new Error(`The ${expected.label} backup COMPLIANCE retention proof is invalid.`);
  }

  return {
    sha256: ciphertext.sha256,
    size: ciphertext.size as number,
    uploadedAt,
    verifiedDownloadAt,
    storage: {
      bucketDigest: storage.bucketDigest,
      key: storage.key,
      versionId: storage.versionId,
      bucketProtection: {
        versioning: "Enabled" as const,
        objectLock: "Enabled" as const,
        defaultRetention: {
          mode: "COMPLIANCE" as const,
          unit: defaultRetention.unit as "days" | "years",
          value: defaultRetention.value as number
        }
      },
      objectRetention: {
        mode: "COMPLIANCE" as const,
        retainUntil,
        validatedMinimumDays: minimumDays as number
      }
    }
  };
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The ${label} must be an object.`);
  }
  const source = value as Record<string, unknown>;
  const actualKeys = Object.keys(source).sort(compareUtf8);
  const expectedKeys = [...keys].sort(compareUtf8);
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`The ${label} fields are invalid.`);
  }
  return source;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`The ${label} timestamp is invalid.`);
  }
  return new Date(value).toISOString();
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && digestPattern.test(value);
}

function isZero(value: unknown): value is 0 {
  return Number.isSafeInteger(value) && value === 0;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
