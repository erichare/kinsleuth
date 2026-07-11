import { del, get, head, list } from "@vercel/blob";
import { decodeGedcomBuffer, type DecodedGedcom } from "./charset";
import {
  gedcomUploadPrefix,
  maximumGedcomFileSizeBytes,
  staleGedcomUploadAgeMs,
  type GedcomUploadReference,
  validateGedcomUploadPath
} from "./upload-policy";

const allowedGedcomContentTypes = new Set(["text/plain", "application/octet-stream", "application/x-gedcom"]);

export class GedcomUploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "GedcomUploadError";
  }
}

export async function readStagedGedcomUpload(reference: GedcomUploadReference): Promise<DecodedGedcom> {
  validateReference(reference);

  let metadata;
  try {
    metadata = await head(reference.pathname);
  } catch (error) {
    const message = uploadStorageMessage(error);
    throw new GedcomUploadError(message, /not found/i.test(message) ? 404 : 502);
  }

  if (normalizeEtag(metadata.etag) !== normalizeEtag(reference.etag)) {
    throw new GedcomUploadError("The staged GEDCOM upload changed after it was selected. Please upload the file again.", 409);
  }
  if (metadata.size !== reference.size) {
    throw new GedcomUploadError("The staged GEDCOM upload size does not match the selected file.", 409);
  }
  if (metadata.size <= 0 || metadata.size > maximumGedcomFileSizeBytes) {
    throw new GedcomUploadError("The staged GEDCOM upload exceeds the supported file size.", 413);
  }
  if (!allowedGedcomContentTypes.has(normalizeContentType(metadata.contentType))) {
    throw new GedcomUploadError("The staged file is not a supported GEDCOM text upload.", 415);
  }

  let result;
  try {
    result = await get(reference.pathname, { access: "private", useCache: false });
  } catch (error) {
    throw new GedcomUploadError(uploadStorageMessage(error), 502);
  }

  if (!result || result.statusCode !== 200) {
    throw new GedcomUploadError("The staged GEDCOM upload was not found. Please upload the file again.", 404);
  }

  try {
    return decodeGedcomBuffer(await new Response(result.stream).arrayBuffer());
  } catch (error) {
    throw new GedcomUploadError(`The staged GEDCOM upload could not be read: ${errorMessage(error)}`, 502);
  }
}

export async function deleteStagedGedcomUploads(pathnames: Array<string | undefined>): Promise<void> {
  const validPathnames = Array.from(new Set(pathnames.filter((pathname): pathname is string => Boolean(pathname)).map(validateGedcomUploadPath)));
  if (validPathnames.length === 0) {
    return;
  }
  await del(validPathnames);
}

export async function cleanupStaleGedcomUploads(now = new Date()): Promise<number> {
  const staleBefore = now.getTime() - staleGedcomUploadAgeMs;
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const page = await list({ prefix: gedcomUploadPrefix, limit: 1000, cursor });
    const stale = page.blobs.filter((blob) => blob.uploadedAt.getTime() < staleBefore).map((blob) => blob.pathname);
    if (stale.length > 0) {
      await del(stale);
      deleted += stale.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return deleted;
}

function validateReference(reference: GedcomUploadReference): void {
  if (!reference || typeof reference.pathname !== "string" || typeof reference.etag !== "string") {
    throw new GedcomUploadError("GEDCOM upload reference is invalid");
  }
  if (!reference.etag.trim()) {
    throw new GedcomUploadError("GEDCOM upload reference is invalid");
  }
  if (!Number.isSafeInteger(reference.size) || reference.size <= 0 || reference.size > maximumGedcomFileSizeBytes) {
    throw new GedcomUploadError("GEDCOM upload reference has an invalid size");
  }
  try {
    validateGedcomUploadPath(reference.pathname);
  } catch (error) {
    throw new GedcomUploadError(errorMessage(error));
  }
}

function normalizeContentType(contentType: string): string {
  return contentType.split(";", 1)[0].trim().toLowerCase();
}

function normalizeEtag(etag: string): string {
  return etag.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

function uploadStorageMessage(error: unknown): string {
  const detail = errorMessage(error);
  if (/token|store|environment|configured/i.test(detail)) {
    return "Private GEDCOM upload storage is not configured.";
  }
  return `The staged GEDCOM upload could not be loaded: ${detail}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
