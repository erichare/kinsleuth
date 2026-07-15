import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import {
  integrationErrorResponse,
  nonEmptyString,
  readJsonObject
} from "@/lib/integrations/api-response";
import { stageDirectIntegrationUpload } from "@/lib/integrations/direct-upload";
import { DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION } from "@/lib/integrations/types";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = withPermission("imports:manage", async (request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  if (containsClientStorageIdentity(body.value)) {
    return NextResponse.json({ error: "The request is invalid" }, { status: 400 });
  }
  const fileName = nonEmptyString(body.value.fileName, 240);
  const contentType = nonEmptyString(body.value.contentType, 255);
  const size = body.value.size;
  if (!fileName || !contentType || typeof size !== "number") {
    return NextResponse.json({ error: "File name, content type, and size are required" }, { status: 400 });
  }
  const mediaAcknowledgement = body.value.mediaRightsAcknowledgement;
  if (
    mediaAcknowledgement !== undefined
    && (
      !isRecord(mediaAcknowledgement)
      || mediaAcknowledgement.accepted !== true
      || mediaAcknowledgement.version !== DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION
    )
  ) {
    return NextResponse.json(
      { error: "The current desktop-media rights acknowledgement is required" },
      { status: 400 }
    );
  }

  try {
    const staged = await stageDirectIntegrationUpload(
      id,
      {
        fileName,
        contentType,
        size,
        ...(isRecord(mediaAcknowledgement) ? {
          mediaRightsAcknowledgement: {
            accepted: true,
            version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
            actorId: authorization.userId
          }
        } : {})
      },
      { archiveId: authorization.archiveId }
    );
    return NextResponse.json(staged, {
      status: 201,
      headers: { "cache-control": "private, no-store" }
    });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to prepare the private upload");
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsClientStorageIdentity(body: Record<string, unknown>): boolean {
  return ["storageKey", "artifactKey", "key", "pathname"].some((field) => field in body);
}
