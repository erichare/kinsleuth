import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import {
  integrationErrorResponse,
  nonEmptyString,
  readJsonObject
} from "@/lib/integrations/api-response";
import { toPublicIntegrationArtifact } from "@/lib/integrations/artifact-store";
import { completeDirectIntegrationUpload } from "@/lib/integrations/direct-upload";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = withPermission("imports:manage", async (request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  if (["storageKey", "artifactKey", "key", "pathname"].some((field) => field in body.value)) {
    return NextResponse.json({ error: "The request is invalid" }, { status: 400 });
  }
  const intentId = nonEmptyString(body.value.intentId, 128);
  if (!intentId) {
    return NextResponse.json({ error: "Upload intent identifier is required" }, { status: 400 });
  }

  try {
    const completed = await completeDirectIntegrationUpload(
      id,
      intentId,
      { archiveId: authorization.archiveId }
    );
    return NextResponse.json({
      artifact: toPublicIntegrationArtifact(completed.artifact),
      replayed: completed.replayed
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to complete the private upload");
  }
});
