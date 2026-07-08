import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readWorkspace, saveSourceDocument } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const workspace = await readWorkspace();
  return NextResponse.json(workspace.sources);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const title = getFormText(formData, "title") || (file instanceof File ? file.name : "");
  const transcript = getFormText(formData, "transcript");

  if (!title || (!(file instanceof File) && !transcript)) {
    return NextResponse.json({ error: "title plus file or transcript is required" }, { status: 400 });
  }

  const upload = file instanceof File ? await persistUpload(file) : undefined;
  const source = await saveSourceDocument({
    title,
    sourceType: getFormText(formData, "sourceType") || "Document",
    fileName: upload?.fileName,
    storageKey: upload?.storageKey,
    mimeType: upload?.mimeType,
    size: upload?.size,
    repository: getFormText(formData, "repository"),
    citationDate: getFormText(formData, "citationDate"),
    linkedPersonId: getFormText(formData, "linkedPersonId"),
    linkedCaseId: getFormText(formData, "linkedCaseId"),
    transcript,
    notes: getFormText(formData, "notes"),
    privacy: getFormText(formData, "privacy") === "public" ? "public" : getFormText(formData, "privacy") === "sensitive" ? "sensitive" : "private",
    confidence: parseConfidence(getFormText(formData, "confidence"))
  });

  return NextResponse.json({ ...source, status: "accepted" }, { status: 201 });
}

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

function parseConfidence(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, parsed));
}
