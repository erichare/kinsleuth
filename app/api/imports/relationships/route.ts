import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { repairGedcomRelationshipLinks } from "@/lib/workspace-store";
import { captureOperationalError } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withPermission("imports:manage", async (_request, authorization) => {
  try {
    return NextResponse.json(await repairGedcomRelationshipLinks());
  } catch (error) {
    await captureOperationalError({
      event: "api_error",
      requestId: authorization.requestId,
      route: "/api/imports/relationships"
    }, error);
    return NextResponse.json({ error: "Relationship repair failed" }, { status: 500 });
  }
});
