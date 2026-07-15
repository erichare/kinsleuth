import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import {
  integrationErrorResponse,
  nonEmptyString,
  readJsonObject
} from "@/lib/integrations/api-response";
import { toPublicSyncRun } from "@/lib/integrations/public-projections";
import {
  getLatestSyncRunForConnection,
  startSyncRun
} from "@/lib/integrations/store";
import { DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION } from "@/lib/integrations/types";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withPermission("imports:manage", async (_request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  try {
    const run = await getLatestSyncRunForConnection(id, {
      archiveId: authorization.archiveId
    });
    return NextResponse.json({ run: run ? toPublicSyncRun(run) : null });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to resume the latest refresh");
  }
});

export const POST = withPermission("imports:manage", async (request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const artifactId = nonEmptyString(body.value.artifactId, 128);
  if (!artifactId) {
    return NextResponse.json({ error: "A staged artifact is required" }, { status: 400 });
  }
  const declaredAuthority = body.value.declaredAuthority === undefined
    ? undefined
    : nonEmptyString(body.value.declaredAuthority, 64);
  if (body.value.declaredAuthority !== undefined && !declaredAuthority) {
    return NextResponse.json({ error: "Choose where authoritative tree edits happen" }, { status: 400 });
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
    const run = await startSyncRun(
      id,
      {
        artifactId,
        ...(declaredAuthority ? { declaredAuthority } : {}),
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
    return NextResponse.json({ run: toPublicSyncRun(run) }, { status: 202 });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to start the refresh");
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
