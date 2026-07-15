import { NextResponse } from "next/server";

import { readJobLagHealth, readWorkerFreshness } from "@/lib/beta-operations";
import { deploymentReleaseCommitSha } from "@/lib/observability";
import { authenticateObservabilityProbe } from "@/lib/observability-probe";
import { getRuntimeStatus, isRuntimeReady } from "@/lib/runtime-status";
import { getArchiveId } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!authenticateObservabilityProbe(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const status = await getRuntimeStatus();
  const ready = isRuntimeReady(status);
  let workers: Awaited<ReturnType<typeof readWorkerFreshness>> | null = null;
  let jobLag: Awaited<ReturnType<typeof readJobLagHealth>> | null = null;
  try {
    [workers, jobLag] = await Promise.all([
      readWorkerFreshness({ archiveId: getArchiveId() }),
      readJobLagHealth({ archiveId: getArchiveId() })
    ]);
  } catch {
    // Database readiness already fails closed above. Do not surface connection
    // details or an exception through the protected probe either.
  }

  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      product: status.product,
      version: status.version,
      releaseCommitSha: deploymentReleaseCommitSha(),
      database: {
        configured: status.database.configured,
        connected: status.database.connected,
        identityConfigured: status.database.identityConfigured,
        identity: status.database.identity,
        identityMatchesConfigured: status.database.identityMatchesConfigured,
        transportVerified: status.database.transportVerified,
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
      scheduledWrites: status.scheduledWrites,
      storage: {
        configured: status.storage.configured,
        identityConfigured: status.storage.identityConfigured,
        identityVerified: status.storage.identityVerified
      },
      workers,
      jobLag
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" }
    }
  );
}
