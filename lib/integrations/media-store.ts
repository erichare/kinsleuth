import { query, withTransaction, type DatabaseOptions } from "../db";
// Imported from ../db-rls directly so unit tests that mock "@/lib/db" keep
// the real scope helper.
import { withRlsArchiveScope } from "../db-rls";
import {
  createConfiguredArchiveObjectStorage,
  type ArchiveObjectStorage
} from "../storage/object-storage";
import {
  DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
  MEDIA_OWNERSHIP_ATTESTATION_VERSION,
  type IntegrationMedia,
  type MediaRightsAcknowledgement
} from "./types";

export {
  DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
  MEDIA_OWNERSHIP_ATTESTATION_VERSION
} from "./types";

export type PreparedIntegrationMediaObject = {
  objectKey: string;
  sha256: string;
  mimeType: string;
  size: number;
  storageDuplicate: boolean;
  sourceGedcomPath: string;
  sourceNormalizedPath: string;
  sourceArchivePath: string;
};

export type IntegrationMediaStoreOptions = DatabaseOptions & {
  archiveId: string;
  objectStorage?: ArchiveObjectStorage;
};

type MediaRow = {
  id: string;
  connection_id: string;
  snapshot_id: string;
  run_id: string;
  artifact_id: string;
  object_key: string;
  source_provider: "family_tree_maker" | "rootsmagic";
  source_artifact_sha256: string;
  source_gedcom_path: string;
  source_normalized_path: string;
  source_archive_path: string;
  sha256: string;
  mime_type: string;
  size_bytes: number | string;
  license_class: "third_party_restricted" | "user_owned";
  privacy: "private";
  publishable: false;
  ai_eligible: false;
  rights_acknowledgement_version: string;
  rights_acknowledged_by: string;
  rights_acknowledged_at: Date | string;
  ownership_attestation_version: string | null;
  ownership_attested_by: string | null;
  ownership_attested_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type RetentionProvider =
  | "family_tree_maker"
  | "rootsmagic"
  | "ancestry_export"
  | "gedcom"
  | "generic_gedcom";

export function shouldRetainDesktopMedia(input: {
  provider: RetentionProvider;
  desktopMediaEnabled: boolean;
  legalReviewApproved: boolean;
  rightsAcknowledgement?: MediaRightsAcknowledgement;
}): boolean {
  return (input.provider === "family_tree_maker" || input.provider === "rootsmagic")
    && input.desktopMediaEnabled
    && input.legalReviewApproved
    && input.rightsAcknowledgement?.version === DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION
    && Boolean(input.rightsAcknowledgement.actorId.trim())
    && Boolean(input.rightsAcknowledgement.acknowledgedAt);
}

export function isDesktopMediaLegalReviewApproved(
  environment: Record<string, string | undefined> = process.env
): boolean {
  const value = environment.KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED?.trim().toLowerCase();
  return value !== undefined && ["1", "true", "yes", "on"].includes(value);
}

export function detectSafeImportedMediaMime(content: Uint8Array): string | undefined {
  const bytes = Buffer.from(content);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
    return "image/gif";
  }
  if (bytes.length >= 4 && (
    bytes.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]))
    || bytes.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  )) {
    return "image/tiff";
  }
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString("ascii") === "BM") {
    return "image/bmp";
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  return undefined;
}

export async function listIntegrationMedia(
  input: { cursor?: string; pageSize?: number },
  options: IntegrationMediaStoreOptions
): Promise<{ items: IntegrationMedia[]; nextCursor: string | null }> {
  const archiveId = required(options.archiveId, "archive id");
  const pageSize = input.pageSize ?? 50;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw mediaError("INVALID_INPUT", "media page size must be between 1 and 100");
  }
  let cursorCreatedAt: Date | string | null = null;
  let cursorId: string | null = null;
  if (input.cursor) {
    const cursor = await query<{ created_at: Date | string; id: string }>(
      "SELECT created_at, id FROM integration_media_objects WHERE archive_id = $1 AND id = $2",
      [archiveId, required(input.cursor, "cursor")],
      options
    );
    if (!cursor.rows[0]) throw mediaError("INVALID_CURSOR", "media cursor is invalid");
    cursorCreatedAt = cursor.rows[0].created_at;
    cursorId = cursor.rows[0].id;
  }

  const result = await query<MediaRow>(
    `SELECT * FROM integration_media_objects
     WHERE archive_id = $1
       AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::text))
     ORDER BY created_at DESC, id DESC
     LIMIT $4`,
    [archiveId, cursorCreatedAt, cursorId, pageSize + 1],
    options
  );
  const hasMore = result.rows.length > pageSize;
  const rows = result.rows.slice(0, pageSize);
  return {
    items: rows.map(mapMedia),
    nextCursor: hasMore ? rows.at(-1)?.id ?? null : null
  };
}

export async function streamIntegrationMedia(
  mediaId: string,
  options: IntegrationMediaStoreOptions
): Promise<{ media: IntegrationMedia; body: AsyncIterable<Uint8Array> }> {
  const row = await getMediaRow(mediaId, options);
  const storage = options.objectStorage ?? createConfiguredArchiveObjectStorage();
  try {
    const metadata = await storage.stat({ archiveId: options.archiveId, key: row.object_key });
    if (!metadata || metadata.size !== Number(row.size_bytes) || metadata.contentType !== row.mime_type) {
      throw mediaError("STORAGE_UNAVAILABLE", "private media object failed integrity checks");
    }
    const body = await storage.stream({ archiveId: options.archiveId, key: row.object_key });
    return { media: mapMedia(row), body };
  } catch (error) {
    if (getErrorCode(error) === "STORAGE_UNAVAILABLE") throw error;
    throw mediaError("STORAGE_UNAVAILABLE", "private media is temporarily unavailable");
  }
}

export async function reclassifyIntegrationMedia(
  mediaId: string,
  input: { attestationVersion: string; attestedBy: string },
  options: IntegrationMediaStoreOptions
): Promise<IntegrationMedia> {
  const archiveId = required(options.archiveId, "archive id");
  if (input.attestationVersion !== MEDIA_OWNERSHIP_ATTESTATION_VERSION) {
    throw mediaError("INVALID_INPUT", "the current ownership attestation is required");
  }
  const attestedBy = required(input.attestedBy, "attestation actor");
  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    const selected = await client.query<MediaRow>(
      "SELECT * FROM integration_media_objects WHERE archive_id = $1 AND id = $2 FOR UPDATE",
      [archiveId, required(mediaId, "media id")]
    );
    if (!selected.rows[0]) throw mediaError("NOT_FOUND", "integration media not found");
    if (selected.rows[0].license_class === "user_owned") return mapMedia(selected.rows[0]);
    const updated = await client.query<MediaRow>(
      `UPDATE integration_media_objects
       SET license_class = 'user_owned',
           ownership_attestation_version = $3,
           ownership_attested_by = $4,
           ownership_attested_at = now(),
           updated_at = now()
       WHERE archive_id = $1 AND id = $2
       RETURNING *`,
      [archiveId, mediaId, MEDIA_OWNERSHIP_ATTESTATION_VERSION, attestedBy]
    );
    return mapMedia(updated.rows[0]);
  });
}

export function validatePreparedIntegrationMediaObject(input: PreparedIntegrationMediaObject): void {
  required(input.objectKey, "media object key");
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw mediaError("INVALID_INPUT", "media sha256 is invalid");
  if (!Number.isSafeInteger(input.size) || input.size < 1) throw mediaError("INVALID_INPUT", "media size is invalid");
  if (!safeMimeTypes.has(input.mimeType)) throw mediaError("INVALID_INPUT", "media MIME type is invalid");
  for (const [label, value] of [
    ["GEDCOM path", input.sourceGedcomPath],
    ["normalized path", input.sourceNormalizedPath],
    ["archive path", input.sourceArchivePath]
  ] as const) {
    const normalized = required(value, label);
    if (normalized.length > 2048 || /[\0\r\n]/.test(normalized)) {
      throw mediaError("INVALID_INPUT", `${label} is invalid`);
    }
  }
}

async function getMediaRow(mediaId: string, options: IntegrationMediaStoreOptions): Promise<MediaRow> {
  const result = await query<MediaRow>(
    "SELECT * FROM integration_media_objects WHERE archive_id = $1 AND id = $2",
    [required(options.archiveId, "archive id"), required(mediaId, "media id")],
    options
  );
  if (!result.rows[0]) throw mediaError("NOT_FOUND", "integration media not found");
  return result.rows[0];
}

function mapMedia(row: MediaRow): IntegrationMedia {
  const ownershipAttestation = row.ownership_attestation_version
    && row.ownership_attested_by
    && row.ownership_attested_at
    ? {
        version: row.ownership_attestation_version,
        actorId: row.ownership_attested_by,
        attestedAt: iso(row.ownership_attested_at)
      }
    : undefined;
  return {
    id: row.id,
    connectionId: row.connection_id,
    snapshotId: row.snapshot_id,
    runId: row.run_id,
    artifactId: row.artifact_id,
    provider: row.source_provider,
    sourceArtifactSha256: row.source_artifact_sha256,
    sourceGedcomPath: row.source_gedcom_path,
    sourceNormalizedPath: row.source_normalized_path,
    sourceArchivePath: row.source_archive_path,
    sha256: row.sha256,
    mimeType: row.mime_type,
    size: Number(row.size_bytes),
    licenseClass: row.license_class,
    privacy: row.privacy,
    publishable: row.publishable,
    aiEligible: row.ai_eligible,
    rightsAcknowledgement: {
      version: row.rights_acknowledgement_version,
      actorId: row.rights_acknowledged_by,
      acknowledgedAt: iso(row.rights_acknowledged_at)
    },
    ...(ownershipAttestation ? { ownershipAttestation } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

const safeMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/tiff",
  "image/bmp",
  "image/webp",
  "application/pdf"
]);

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw mediaError("INVALID_INPUT", `${label} is required`);
  return normalized;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function mediaError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
