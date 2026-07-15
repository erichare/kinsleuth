import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import { integrationErrorResponse, readJsonObject } from "@/lib/integrations/api-response";
import {
  MEDIA_OWNERSHIP_ATTESTATION_VERSION,
  reclassifyIntegrationMedia
} from "@/lib/integrations/media-store";
import { toPublicIntegrationMedia } from "@/lib/integrations/public-projections";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withPermission("imports:manage", async (request, authorization, context: RouteContext) => {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const attestation = body.value.ownershipAttestation;
  if (
    body.value.licenseClass !== "user_owned"
    || !isRecord(attestation)
    || attestation.accepted !== true
    || attestation.version !== MEDIA_OWNERSHIP_ATTESTATION_VERSION
  ) {
    return NextResponse.json({ error: "The current ownership attestation is required" }, { status: 400 });
  }

  const { id } = await context.params;
  try {
    const media = await reclassifyIntegrationMedia(
      id,
      {
        attestationVersion: MEDIA_OWNERSHIP_ATTESTATION_VERSION,
        attestedBy: authorization.userId
      },
      { archiveId: authorization.archiveId }
    );
    return NextResponse.json({ media: toPublicIntegrationMedia(media) }, {
      headers: { "cache-control": "private, no-store" }
    });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to reclassify private integration media", "Media not found");
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
