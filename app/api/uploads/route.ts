import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { capabilityUnavailableResponse } from "@/lib/api-capabilities";
import type { SourceDocument } from "@/lib/models";
import { readWorkspace, saveSourceDocument } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withPermission("archive:read-private", async (_request, authorization) => {
  const binaryUnavailable = capabilityUnavailableResponse("evidenceBinaryUploads");
  if (binaryUnavailable?.status === 503) return binaryUnavailable;
  const workspace = await readWorkspace({ archiveId: authorization.archiveId });
  return NextResponse.json(
    binaryUnavailable ? workspace.sources.map(withoutBinarySourceMetadata) : workspace.sources
  );
});

export const POST = withPermission("sources:write", async (request, authorization) => {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const jsonRequest = contentType.includes("application/json");
  const binaryUnavailable = capabilityUnavailableResponse("evidenceBinaryUploads");
  if (binaryUnavailable?.status === 503 || (binaryUnavailable && !jsonRequest)) {
    return binaryUnavailable;
  }

  const input = jsonRequest ? await readTranscriptSource(request) : await readMultipartSource(request);

  if (!input.title || (!input.file && !input.transcript)) {
    return NextResponse.json({ error: "title plus file or transcript is required" }, { status: 400 });
  }

  const upload = input.file ? await persistUpload(input.file) : undefined;
  const source = await saveSourceDocument({
    title: input.title,
    sourceType: input.sourceType || "Document",
    fileName: upload?.fileName,
    storageKey: upload?.storageKey,
    mimeType: upload?.mimeType,
    size: upload?.size,
    repository: input.repository,
    citationDate: input.citationDate,
    linkedPersonId: input.linkedPersonId,
    linkedCaseId: input.linkedCaseId,
    transcript: input.transcript,
    notes: input.notes,
    privacy: input.privacy === "public" ? "public" : input.privacy === "sensitive" ? "sensitive" : "private",
    confidence: parseConfidence(input.confidence)
  }, { archiveId: authorization.archiveId });

  return NextResponse.json({ ...source, status: "accepted" }, { status: 201 });
});

async function persistUpload(file: File): Promise<{ storageKey: string; fileName: string; mimeType: string; size: number }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-") || "upload.bin";
  const storageKey = `uploads/sources/${randomUUID()}-${safeName}`;
  const storagePath = path.join(/*turbopackIgnore: true*/ process.cwd(), storageKey);
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));

  return {
    storageKey,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size
  };
}

function getFormText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

type SourceRequest = {
  title: string;
  sourceType: string;
  repository: string;
  citationDate: string;
  linkedPersonId: string;
  linkedCaseId: string;
  transcript: string;
  notes: string;
  privacy: string;
  confidence: string;
  file?: File;
};

async function readMultipartSource(request: Request): Promise<SourceRequest> {
  const formData = await request.formData();
  const selected = formData.get("file");
  const file = selected instanceof File && selected.size > 0 ? selected : undefined;
  return {
    title: getFormText(formData, "title") || file?.name || "",
    sourceType: getFormText(formData, "sourceType"),
    repository: getFormText(formData, "repository"),
    citationDate: getFormText(formData, "citationDate"),
    linkedPersonId: getFormText(formData, "linkedPersonId"),
    linkedCaseId: getFormText(formData, "linkedCaseId"),
    transcript: getFormText(formData, "transcript"),
    notes: getFormText(formData, "notes"),
    privacy: getFormText(formData, "privacy"),
    confidence: getFormText(formData, "confidence"),
    file
  };
}

async function readTranscriptSource(request: Request): Promise<SourceRequest> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const value = isRecord(body) ? body : {};
  return {
    title: text(value.title),
    sourceType: text(value.sourceType),
    repository: text(value.repository),
    citationDate: text(value.citationDate),
    linkedPersonId: text(value.linkedPersonId),
    linkedCaseId: text(value.linkedCaseId),
    transcript: text(value.transcript),
    notes: text(value.notes),
    privacy: text(value.privacy),
    confidence: text(value.confidence)
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfidence(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, parsed));
}

function withoutBinarySourceMetadata(source: SourceDocument): SourceDocument {
  const projected = { ...source };
  delete projected.fileName;
  delete projected.storageKey;
  delete projected.mimeType;
  delete projected.size;
  return projected;
}
