import { after } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { hostedDeploymentUnavailableResponse } from "@/lib/api-capabilities";
import { cleanupStaleGedcomUploadsForArchive, deleteStagedGedcomUploads } from "@/lib/gedcom/blob-storage";
import {
  gedcomUploadTokenLifetimeMs,
  maximumGedcomFileSizeBytes,
  validateGedcomUploadRequest
} from "@/lib/gedcom/upload-policy";
import { captureOperationalError, emitOperationalEvent } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = withPermission("imports:manage", async (_request, authorization) => {
  return NextResponse.json({ archiveId: authorization.archiveId });
});

export const POST = withPermission("imports:manage", async (request, authorization) => {
  const unavailable = hostedDeploymentUnavailableResponse();
  if (unavailable) return unavailable;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Private GEDCOM upload storage is not configured." }, { status: 503 });
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "GEDCOM upload request is invalid." }, { status: 400 });
  }

  try {
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        validateGedcomUploadRequest(pathname, clientPayload, authorization.archiveId);

        return {
          allowedContentTypes: ["text/plain"],
          maximumSizeInBytes: maximumGedcomFileSizeBytes,
          validUntil: Date.now() + gedcomUploadTokenLifetimeMs,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60
        };
      }
    });

    if (body.type === "blob.generate-client-token") {
      after(async () => {
        try {
          await cleanupStaleGedcomUploadsForArchive(authorization.archiveId);
        } catch (error) {
          await captureOperationalError({
            event: "api_error",
            severity: "warning",
            requestId: authorization.requestId,
            route: "/api/imports/uploads"
          }, error);
        }
      });
    }

    await emitOperationalEvent({
      event: "import_staged",
      severity: "info",
      requestId: authorization.requestId,
      route: "/api/imports/uploads"
    });

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
});

export const DELETE = withPermission("imports:manage", async (request, authorization) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Private GEDCOM upload storage is not configured." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as { pathname?: unknown };
    if (typeof body.pathname !== "string") {
      throw new Error("GEDCOM upload path is required");
    }
    await deleteStagedGedcomUploads([body.pathname], authorization.archiveId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
