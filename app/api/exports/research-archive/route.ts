import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import {
  beginDataOperation,
  completeDataOperation,
  failDataOperation
} from "@/lib/beta-operations";
import { captureOperationalError, emitOperationalEvent } from "@/lib/observability";
import { createResearchArchiveExport } from "@/lib/research-archive-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = withPermission("archive:data-portability", async (_request, authorization) => {
  const options = { archiveId: authorization.archiveId };
  let operation: Awaited<ReturnType<typeof beginDataOperation>> | undefined;
  try {
    operation = await beginDataOperation({
      operationType: "research-export",
      requestId: authorization.requestId,
      userId: authorization.userId
    }, options);
    const result = await createResearchArchiveExport({ ...options, userId: authorization.userId });
    await completeDataOperation({
      id: operation.id,
      manifestDigest: result.manifestDigest,
      operationType: "research-export",
      userId: authorization.userId
    }, options);
    await emitOperationalEvent({
      event: "export_completed",
      severity: "info",
      operationType: "research-export",
      requestId: authorization.requestId,
      route: "/api/exports/research-archive"
    });
    return new NextResponse(result.content, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "content-type": "application/json; charset=utf-8",
        "x-content-sha256": result.manifestDigest
      }
    });
  } catch (error) {
    if (operation) {
      try {
        await failDataOperation({
          failureCode: "EXPORT_FAILED",
          id: operation.id,
          operationType: "research-export",
          userId: authorization.userId
        }, options);
      } catch {
        // The original failure remains authoritative and is reported below.
      }
    }
    await captureOperationalError({
      event: "api_error",
      requestId: authorization.requestId,
      route: "/api/exports/research-archive"
    }, error);
    return NextResponse.json({ error: "Research archive export failed." }, {
      status: 500,
      headers: { "cache-control": "private, no-store" }
    });
  }
});
