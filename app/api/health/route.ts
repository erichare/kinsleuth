import { NextResponse } from "next/server";
import { getRuntimeStatus, isRuntimeReady } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await getRuntimeStatus();
  const ready = isRuntimeReady(status);

  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      product: status.product,
      version: status.version
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" }
    }
  );
}
