import { createHash } from "node:crypto";

const digestPattern = /^[a-f0-9]{64}$/;
const archiveIdPattern = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export const recoveryObjectNamespaceNames = ["archive-private", "legacy-gedcom"] as const;

export type RecoveryObjectNamespaceName = (typeof recoveryObjectNamespaceNames)[number];

export type RecoveryObjectManifestEntry = {
  pathname: string;
  contentType: string;
  size: number;
  sha256: string;
};

export type RecoveryObjectNamespaceSummary = {
  name: RecoveryObjectNamespaceName;
  objectCount: number;
  totalBytes: number;
  manifestSha256: string;
};

export type RecoveryProviderPoint = {
  status: "available";
  createdAt: string;
  provider: "supabase";
};

export function recoveryNamespacePrefix(
  archiveId: string,
  name: RecoveryObjectNamespaceName
): string {
  validateArchiveId(archiveId);
  return name === "archive-private"
    ? `archives/${archiveId}/`
    : `gedcom-imports/${archiveId}/`;
}

export function isRecoveryIdentitySentinel(
  archiveId: string,
  pathname: string,
  expectedIdentity: string
): boolean {
  validateArchiveId(archiveId);
  if (!digestPattern.test(expectedIdentity)) {
    throw new Error("Recovery object-storage identity is invalid.");
  }
  const reservedPrefix = `archives/${archiveId}/release-readiness/`;
  if (!pathname.startsWith(reservedPrefix)) return false;
  if (pathname !== `${reservedPrefix}${expectedIdentity}`) {
    throw new Error("The recovery object namespace contains an unexpected reserved readiness object.");
  }
  return true;
}

export function summarizeRecoveryObjectManifest(
  name: RecoveryObjectNamespaceName,
  entries: readonly RecoveryObjectManifestEntry[]
): RecoveryObjectNamespaceSummary {
  if (!recoveryObjectNamespaceNames.includes(name)) {
    throw new Error("Recovery object namespace is invalid.");
  }
  const sorted = [...entries].sort((left, right) => compareUtf8(left.pathname, right.pathname));
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const entry of sorted) {
    if (
      !entry.pathname
      || paths.has(entry.pathname)
      || /[\0\r\n]/u.test(entry.pathname)
      || !entry.contentType
      || /[\0\r\n]/u.test(entry.contentType)
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || !digestPattern.test(entry.sha256)
    ) {
      throw new Error("Recovery object manifest entry is invalid or duplicated.");
    }
    paths.add(entry.pathname);
    totalBytes += entry.size;
    if (!Number.isSafeInteger(totalBytes)) {
      throw new Error("Recovery object manifest size exceeds the safe integer range.");
    }
  }

  return {
    name,
    objectCount: sorted.length,
    totalBytes,
    manifestSha256: sha256Utf8(`${canonicalJson(sorted)}\n`)
  };
}

export function combineRecoveryStateDigest(input: {
  databaseManifestSha256: string;
  objectNamespaces: readonly RecoveryObjectNamespaceSummary[];
}): string {
  if (!digestPattern.test(input.databaseManifestSha256)) {
    throw new Error("Recovery database state digest is invalid.");
  }
  const namespaces = exactNamespaceSummaries(input.objectNamespaces);
  return sha256Utf8(`${canonicalJson({
    databaseManifestSha256: input.databaseManifestSha256,
    objectNamespaces: namespaces
  })}\n`);
}

export function validateSupabaseRecoveryPoint(
  value: unknown,
  now = new Date()
): RecoveryProviderPoint {
  if (Number.isNaN(now.getTime())) {
    throw new Error("Recovery-point validation time is invalid.");
  }
  const response = record(value, "Supabase backup response");
  if (!Array.isArray(response.backups)) {
    throw new Error("Supabase backup response is missing the backups array.");
  }

  const completed = response.backups.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const backup = entry as Record<string, unknown>;
    if (backup.status !== "COMPLETED" || typeof backup.inserted_at !== "string") return [];
    const createdAt = new Date(backup.inserted_at);
    return Number.isNaN(createdAt.getTime()) ? [] : [createdAt];
  });

  const physical = typeof response.physical_backup_data === "object"
    && response.physical_backup_data !== null
    && !Array.isArray(response.physical_backup_data)
    ? response.physical_backup_data as Record<string, unknown>
    : undefined;
  const latestPhysical = typeof physical?.latest_physical_backup_date_unix === "number"
    && Number.isSafeInteger(physical.latest_physical_backup_date_unix)
    ? new Date(physical.latest_physical_backup_date_unix * 1_000)
    : undefined;
  if (response.pitr_enabled === true && latestPhysical && !Number.isNaN(latestPhysical.getTime())) {
    completed.push(latestPhysical);
  }

  const latest = completed
    .filter((createdAt) => createdAt.getTime() <= now.getTime() + 5 * 60_000)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  if (!latest || now.getTime() - latest.getTime() > 24 * 60 * 60_000) {
    throw new Error("Supabase does not report an available recovery point from the last 24 hours.");
  }

  return {
    provider: "supabase",
    status: "available",
    createdAt: latest.toISOString()
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactNamespaceSummaries(
  value: readonly RecoveryObjectNamespaceSummary[]
): RecoveryObjectNamespaceSummary[] {
  if (value.length !== recoveryObjectNamespaceNames.length) {
    throw new Error("Recovery state must include both object namespaces.");
  }
  const byName = new Map<RecoveryObjectNamespaceName, RecoveryObjectNamespaceSummary>();
  for (const summary of value) {
    if (
      !recoveryObjectNamespaceNames.includes(summary.name)
      || byName.has(summary.name)
      || !Number.isSafeInteger(summary.objectCount)
      || summary.objectCount < 0
      || !Number.isSafeInteger(summary.totalBytes)
      || summary.totalBytes < 0
      || !digestPattern.test(summary.manifestSha256)
    ) {
      throw new Error("Recovery object namespace summary is invalid or duplicated.");
    }
    byName.set(summary.name, summary);
  }
  return recoveryObjectNamespaceNames.map((name) => byName.get(name)!);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort(compareUtf8)) {
    result[key] = sortJson(source[key]);
  }
  return result;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function validateArchiveId(archiveId: string): void {
  if (!archiveIdPattern.test(archiveId)) {
    throw new Error("Recovery archive ID is invalid.");
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
