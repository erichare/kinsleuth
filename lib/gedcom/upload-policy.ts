export const gedcomUploadPrefix = "gedcom-imports/";
export const maximumGedcomFileSizeBytes = 25 * 1024 * 1024;
export const maximumCombinedGedcomSizeBytes = 32 * 1024 * 1024;
export const maximumInlineImportSizeBytes = 3_500_000;
export const gedcomUploadTokenLifetimeMs = 30 * 60 * 1000;
export const staleGedcomUploadAgeMs = 24 * 60 * 60 * 1000;
export const importDiffPreviewRecordLimit = 12;

const uploadIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const archiveIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export type GedcomUploadReference = {
  pathname: string;
  etag: string;
  size: number;
};

export type GedcomUploadClientPayload = {
  uploadId: string;
  originalName: string;
  size: number;
};

export function isGedcomFileName(fileName: string): boolean {
  return /\.(?:ged|gedcom)$/i.test(fileName.trim());
}

export function sanitizeGedcomFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const extension = trimmed.match(/\.(?:gedcom|ged)$/i)?.[0] ?? ".ged";
  const baseName = trimmed.slice(0, Math.max(0, trimmed.length - extension.length)).slice(0, 255 - extension.length);
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[.-]+/, "").replace(/^-+|-+$/g, "");
  return `${safeBaseName || "import"}${extension}`;
}

export function getGedcomUploadArchivePrefix(archiveId: string): string {
  if (!archiveIdPattern.test(archiveId)) {
    throw new Error("Invalid archive namespace");
  }
  return `${gedcomUploadPrefix}${archiveId}/`;
}

export function createGedcomUploadPath(archiveId: string, uploadId: string, originalName: string): string {
  if (!uploadIdPattern.test(uploadId)) {
    throw new Error("Invalid GEDCOM upload id");
  }
  if (!isGedcomFileName(originalName)) {
    throw new Error("GEDCOM uploads must use a .ged or .gedcom filename");
  }

  return `${getGedcomUploadArchivePrefix(archiveId)}${uploadId}/${sanitizeGedcomFileName(originalName)}`;
}

export function parseGedcomUploadClientPayload(value: string | null): GedcomUploadClientPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "");
  } catch {
    throw new Error("GEDCOM upload metadata is invalid");
  }

  if (!isRecord(parsed)) {
    throw new Error("GEDCOM upload metadata is invalid");
  }

  const uploadId = typeof parsed.uploadId === "string" ? parsed.uploadId : "";
  const originalName = typeof parsed.originalName === "string" ? parsed.originalName : "";
  const size = typeof parsed.size === "number" ? parsed.size : Number.NaN;

  if (!uploadIdPattern.test(uploadId) || !isGedcomFileName(originalName)) {
    throw new Error("GEDCOM upload metadata is invalid");
  }
  if (!Number.isSafeInteger(size) || size <= 0 || size > maximumGedcomFileSizeBytes) {
    throw new Error(`GEDCOM files must be between 1 byte and ${formatFileSize(maximumGedcomFileSizeBytes)}`);
  }

  return { uploadId, originalName, size };
}

export function validateGedcomUploadPath(pathname: string, archiveId: string): string {
  if (!pathname.startsWith(gedcomUploadPrefix)) {
    throw new Error("Invalid GEDCOM upload path");
  }

  const relativePath = pathname.slice(gedcomUploadPrefix.length);
  const [pathArchiveId, uploadId, fileName, ...extra] = relativePath.split("/");
  if (
    extra.length > 0
    || !archiveIdPattern.test(archiveId)
    || pathArchiveId !== archiveId
    || !uploadIdPattern.test(uploadId ?? "")
    || !fileName
    || !isGedcomFileName(fileName)
  ) {
    throw new Error("Invalid GEDCOM upload path");
  }
  if (fileName !== sanitizeGedcomFileName(fileName)) {
    throw new Error("Invalid GEDCOM upload path");
  }

  return pathname;
}

export function validateGedcomUploadRequest(
  pathname: string,
  clientPayload: string | null,
  archiveId: string
): GedcomUploadClientPayload {
  const payload = parseGedcomUploadClientPayload(clientPayload);
  if (pathname !== createGedcomUploadPath(archiveId, payload.uploadId, payload.originalName)) {
    throw new Error("GEDCOM upload path does not match its metadata");
  }
  return payload;
}

export function shouldStageGedcomFiles(files: Array<File | undefined>): boolean {
  return files.reduce((total, file) => total + (file?.size ?? 0), 0) > maximumInlineImportSizeBytes;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
