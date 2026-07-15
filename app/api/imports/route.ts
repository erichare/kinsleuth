import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { hostedDeploymentUnavailableResponse } from "@/lib/api-capabilities";
import { createImportSnapshot, diffImportSnapshots } from "@/lib/gedcom/importer";
import { prepareGedcomImport } from "@/lib/gedcom/apply";
import { decodeGedcomBuffer } from "@/lib/gedcom/charset";
import { deleteStagedGedcomUploads, GedcomUploadError, readStagedGedcomUpload } from "@/lib/gedcom/blob-storage";
import {
  importDiffPreviewRecordLimit,
  maximumCombinedGedcomSizeBytes,
  maximumGedcomFileSizeBytes,
  type GedcomUploadReference
} from "@/lib/gedcom/upload-policy";
import { applyPreparedGedcomImport } from "@/lib/workspace-store";
import { captureOperationalError, emitOperationalEvent } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = withPermission("imports:manage", async (request, authorization) => {
  const unavailable = hostedDeploymentUnavailableResponse();
  if (unavailable) return unavailable;

  let body: ResolvedImportRequest;
  try {
    body = await readImportRequest(request, authorization.archiveId);
  } catch (error) {
    return importErrorResponse(error, authorization.requestId);
  }

  if (!body.sourceName || !body.content) {
    return NextResponse.json({ error: "sourceName and content are required" }, { status: 400 });
  }

  try {
    const prepared = body.apply ? prepareGedcomImport(body.sourceName, body.content) : undefined;
    const next = prepared?.snapshot ?? createImportSnapshot(body.sourceName, body.content);
    const fullDiff = body.previousContent
      ? diffImportSnapshots(createImportSnapshot(`${body.sourceName}:previous`, body.previousContent), next)
      : undefined;
    const diff = fullDiff
      ? {
          ...fullDiff,
          records: fullDiff.records.slice(0, importDiffPreviewRecordLimit),
          omittedRecords: Math.max(0, fullDiff.records.length - importDiffPreviewRecordLimit)
        }
      : undefined;
    const applied = prepared
      ? await applyPreparedGedcomImport(prepared, { archiveId: authorization.archiveId })
      : undefined;

    if (applied && body.stagedPathnames.length > 0) {
      try {
        await deleteStagedGedcomUploads(body.stagedPathnames, authorization.archiveId);
      } catch (error) {
        await captureOperationalError({
          event: "api_error",
          severity: "warning",
          requestId: authorization.requestId,
          route: "/api/imports"
        }, error);
      }
    }

    await emitOperationalEvent({
      event: applied ? "import_applied" : "import_completed",
      severity: "info",
      requestId: authorization.requestId,
      route: "/api/imports"
    });

    return NextResponse.json({
      snapshot: {
        id: next.id,
        sourceName: next.sourceName,
        checksum: next.checksum,
        summary: next.summary,
        recordCount: next.records.length
      },
      diff,
      applied,
      warnings: body.warnings
    }, { status: applied ? 201 : 200 });
  } catch (error) {
    return importErrorResponse(error, authorization.requestId);
  }
});

type ImportRequestBody = {
  sourceName?: string;
  content?: string;
  previousContent?: string;
  currentUpload?: GedcomUploadReference;
  previousUpload?: GedcomUploadReference;
  apply?: boolean;
};

type ResolvedImportRequest = {
  sourceName?: string;
  content?: string;
  previousContent?: string;
  apply?: boolean;
  stagedPathnames: string[];
  warnings: string[];
};

async function readImportRequest(request: Request, archiveId: string): Promise<ResolvedImportRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    const previousFile = formData.get("previousFile");
    const sourceName = getFormText(formData, "sourceName") || (file instanceof File ? file.name : undefined);
    const inlineContent = file instanceof File ? undefined : getFormText(formData, "content");
    const inlinePreviousContent = previousFile instanceof File ? undefined : getFormText(formData, "previousContent");
    validateCombinedImportSize(
      file instanceof File ? file.size : Buffer.byteLength(inlineContent ?? ""),
      previousFile instanceof File ? previousFile.size : Buffer.byteLength(inlinePreviousContent ?? "")
    );

    const decodedContent = file instanceof File ? decodeGedcomBuffer(await file.arrayBuffer()) : undefined;
    const decodedPreviousContent = previousFile instanceof File ? decodeGedcomBuffer(await previousFile.arrayBuffer()) : undefined;

    return {
      sourceName,
      content: decodedContent?.content ?? inlineContent,
      previousContent: decodedPreviousContent?.content ?? inlinePreviousContent,
      apply: getFormText(formData, "apply") === "true",
      stagedPathnames: [],
      warnings: mergeImportWarnings(decodedContent?.warnings, decodedPreviousContent?.warnings)
    };
  }

  const parsedBody = await request.json() as unknown;
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    throw new GedcomUploadError("GEDCOM import request is invalid");
  }
  const body = parsedBody as ImportRequestBody;
  if (
    (body.sourceName !== undefined && typeof body.sourceName !== "string") ||
    (body.content !== undefined && typeof body.content !== "string") ||
    (body.previousContent !== undefined && typeof body.previousContent !== "string") ||
    (body.apply !== undefined && typeof body.apply !== "boolean")
  ) {
    throw new GedcomUploadError("GEDCOM import request is invalid");
  }
  validateCombinedImportSize(
    body.currentUpload?.size ?? Buffer.byteLength(body.content ?? ""),
    body.previousUpload?.size ?? Buffer.byteLength(body.previousContent ?? "")
  );
  const [stagedContent, stagedPreviousContent] = await Promise.all([
    body.currentUpload ? readStagedGedcomUpload(body.currentUpload, archiveId) : Promise.resolve(undefined),
    body.previousUpload ? readStagedGedcomUpload(body.previousUpload, archiveId) : Promise.resolve(undefined)
  ]);

  return {
    sourceName: body.sourceName,
    content: stagedContent?.content ?? body.content,
    previousContent: stagedPreviousContent?.content ?? body.previousContent,
    apply: body.apply === true,
    stagedPathnames: [body.currentUpload?.pathname, body.previousUpload?.pathname].filter((pathname): pathname is string => Boolean(pathname)),
    warnings: mergeImportWarnings(stagedContent?.warnings, stagedPreviousContent?.warnings)
  };
}

function mergeImportWarnings(...warningLists: Array<string[] | undefined>): string[] {
  return Array.from(new Set(warningLists.flatMap((warnings) => warnings ?? [])));
}

function getFormText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validateCombinedImportSize(currentSize: number, previousSize: number): void {
  if (!Number.isSafeInteger(currentSize) || !Number.isSafeInteger(previousSize) || currentSize < 0 || previousSize < 0) {
    throw new GedcomUploadError("GEDCOM import size is invalid");
  }
  if (currentSize > maximumGedcomFileSizeBytes || previousSize > maximumGedcomFileSizeBytes) {
    throw new GedcomUploadError("A GEDCOM file exceeds the per-file import limit.", 413);
  }
  if (currentSize + previousSize > maximumCombinedGedcomSizeBytes) {
    throw new GedcomUploadError("The current and previous GEDCOM files exceed the combined import limit.", 413);
  }
}

async function importErrorResponse(error: unknown, requestId: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof GedcomUploadError) {
    return NextResponse.json({ error: message }, { status: error.status });
  }
  if (/Invalid GEDCOM line|sourceName and content are required|GEDCOM/i.test(message)) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  await captureOperationalError({
    event: "api_error",
    requestId,
    route: "/api/imports"
  }, error);
  return NextResponse.json({ error: "GEDCOM import failed. Please retry or check the server logs." }, { status: 500 });
}
