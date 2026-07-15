import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { exportGedcom } from "@/lib/gedcom/exporter";
import { readWorkspace } from "@/lib/workspace-store";
import { captureOperationalError, emitOperationalEvent } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export const GET = withPermission("archive:export", async (_request, authorization) => {
  try {
    const workspace = await readWorkspace();
    const result = exportGedcom({
      archiveName: workspace.archiveName,
      people: workspace.people,
      rawRecords: workspace.rawRecords,
      imports: workspace.imports
    });

    await emitOperationalEvent({
      event: "export_completed",
      severity: "info",
      requestId: authorization.requestId,
      route: "/api/exports/gedcom"
    });
    return new NextResponse(result.content, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    await captureOperationalError({
      event: "api_error",
      requestId: authorization.requestId,
      route: "/api/exports/gedcom"
    }, error);
    return NextResponse.json({ error: "GEDCOM export failed. Please retry or check the server logs." }, { status: 500 });
  }
});
