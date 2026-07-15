import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import { emitOperationalEvent } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maximumBodyBytes = 128;

export const POST = withPermission("archive:read-private", async (request, authorization) => {
  const requestId = authorization.requestId;
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return response(400, requestId);
  }
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) {
    return response(400, requestId);
  }

  try {
    const source = await request.text();
    if (Buffer.byteLength(source, "utf8") > maximumBodyBytes) return response(400, requestId);
    const value: unknown = JSON.parse(source);
    if (
      typeof value !== "object"
      || value === null
      || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["event"])
      || (value as { event?: unknown }).event !== "browser-unhandled-error"
    ) {
      return response(400, requestId);
    }
  } catch {
    return response(400, requestId);
  }

  await emitOperationalEvent({
    event: "browser_unhandled_error",
    severity: "error",
    code: "UNEXPECTED_ERROR",
    requestId,
    route: "/app"
  });
  return response(202, requestId);
});

function response(status: number, requestId: string) {
  return NextResponse.json(
    status === 202 ? { accepted: true } : { error: "Invalid error signal" },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId
      }
    }
  );
}
