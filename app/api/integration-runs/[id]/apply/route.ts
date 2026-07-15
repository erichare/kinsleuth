import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import { integrationErrorResponse, readJsonObject } from "@/lib/integrations/api-response";
import { toPublicSyncRun } from "@/lib/integrations/public-projections";
import { applyPreparedIntegrationSyncRun } from "@/lib/integrations/run-processor";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withPermission("imports:manage", async (request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
  }
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const resolutions = body.value.resolutions;
  if (!Array.isArray(resolutions)) {
    return NextResponse.json({ error: "Resolutions must be an array" }, { status: 400 });
  }
  const acceptAllSafeIncoming = body.value.acceptAllSafeIncoming;
  if (acceptAllSafeIncoming !== undefined && typeof acceptAllSafeIncoming !== "boolean") {
    return NextResponse.json({ error: "Safe incoming approval must be a boolean" }, { status: 400 });
  }

  try {
    const result = await applyPreparedIntegrationSyncRun(
      id,
      {
        idempotencyKey,
        resolutions,
        ...(acceptAllSafeIncoming === true ? { acceptAllSafeIncoming: true } : {})
      },
      { archiveId: authorization.archiveId }
    );
    const run = "run" in result ? result.run : result;
    return NextResponse.json({ run: toPublicSyncRun(run) });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to apply the refresh", "Refresh not found");
  }
});
