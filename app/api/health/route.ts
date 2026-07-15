import { NextResponse } from "next/server";
import { getRuntimeStatus } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await getRuntimeStatus();
  const ready =
    status.capabilities.valid &&
    status.database.connected &&
    status.database.provisioned &&
    status.database.datasetModeMatches &&
    status.storage.configured;

  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      product: status.product,
      version: status.version,
      database: {
        configured: status.database.configured,
        connected: status.database.connected,
        provisioned: status.database.provisioned,
        datasetMode: status.database.datasetMode,
        expectedDatasetMode: status.database.expectedDatasetMode,
        datasetModeMatches: status.database.datasetModeMatches,
        demoFixtureVersion: status.database.demoFixtureVersion
      },
      ai: {
        enabled: status.ai.enabled,
        configured: status.ai.configured
      },
      capabilities: status.capabilities,
      storage: {
        configured: status.storage.configured
      }
    },
    { status: ready ? 200 : 503 }
  );
}
