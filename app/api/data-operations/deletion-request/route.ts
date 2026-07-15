import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import { beginDataOperation } from "@/lib/beta-operations";
import { captureOperationalError, emitOperationalEvent } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const confirmation = "REQUEST DELETION REVIEW";
const maximumBodyBytes = 128;

export const POST = withPermission("archive:data-portability", async (request, authorization) => {
  if (!(await readRequest(request))) {
    return NextResponse.json({ error: `Type ${confirmation} to request deletion review.` }, { status: 400 });
  }
  try {
    const operation = await beginDataOperation({
      operationType: "deletion-request",
      requestId: authorization.requestId,
      userId: authorization.userId
    }, { archiveId: authorization.archiveId });
    await emitOperationalEvent({
      event: "deletion_requested",
      severity: "warning",
      operationType: "deletion-request",
      requestId: authorization.requestId,
      route: "/api/data-operations/deletion-request"
    });
    return NextResponse.json({
      id: operation.id,
      state: operation.state,
      nextStep: "Kin Resolve support will verify export and whole-cell deletion with the archive owner."
    }, {
      status: 202,
      headers: { "cache-control": "private, no-store" }
    });
  } catch (error) {
    await captureOperationalError({
      event: "api_error",
      requestId: authorization.requestId,
      route: "/api/data-operations/deletion-request"
    }, error);
    return NextResponse.json({ error: "Deletion review could not be requested." }, {
      status: 503,
      headers: { "cache-control": "private, no-store" }
    });
  }
});

async function readRequest(request: Request): Promise<boolean> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return false;
  }
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) return false;
  try {
    const source = await request.text();
    if (Buffer.byteLength(source, "utf8") > maximumBodyBytes) return false;
    const value: unknown = JSON.parse(source);
    return typeof value === "object"
      && value !== null
      && !Array.isArray(value)
      && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["confirmation"])
      && (value as { confirmation?: unknown }).confirmation === confirmation;
  } catch {
    return false;
  }
}
