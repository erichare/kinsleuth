import { NextResponse } from "next/server";
import { getRuntimeStatus } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await getRuntimeStatus();
  const ready = status.database.connected && status.storage.configured;

  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      product: status.product,
      version: status.version,
      database: {
        configured: status.database.configured,
        connected: status.database.connected
      },
      ai: {
        configured: status.ai.configured
      },
      storage: {
        configured: status.storage.configured
      }
    },
    { status: ready ? 200 : 503 }
  );
}
