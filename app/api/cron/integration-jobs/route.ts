import { NextResponse } from "next/server";

import { createApiRequestId } from "@/lib/api-response";
import {
  recordWorkerFailed,
  recordWorkerStarted,
  recordWorkerSucceeded
} from "@/lib/beta-operations";
import {
  integrationWorkerConfiguration,
  runIntegrationWorkerBatch,
  runIntegrationWorkerMaintenance
} from "@/lib/integrations/worker";
import {
  captureOperationalError,
  emitOperationalEvent,
  operationalErrorCode
} from "@/lib/observability";
import { getActiveReleaseFence } from "@/lib/release-fence";
import { resolvePublicDemoConfiguration } from "@/lib/public-demo-config";
import { cleanupPublicDemoSessions } from "@/lib/public-demo-session-store";
import { releaseFenceLockedResponse } from "@/lib/release-fence-http";
import { getScheduledWritesStatus } from "@/lib/scheduled-writes";
import { getArchiveId } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
const hostedWorkerSafetyMarginMs = 30_000;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret?.trim()) {
    return NextResponse.json({ error: "Scheduled integration work is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scheduledWrites = getScheduledWritesStatus();
  if (!scheduledWrites.valid || !scheduledWrites.enabled) {
    return NextResponse.json({ error: "Scheduled work is unavailable." }, { status: 503 });
  }

  const requestId = createApiRequestId();
  const operationOptions = { archiveId: getArchiveId() };
  try {
    const activeFence = await getActiveReleaseFence();
    if (activeFence) return releaseFenceLockedResponse(activeFence, { discloseControlIdentity: true });
    await recordWorkerStarted("integration-jobs", requestId, operationOptions);
    await emitOperationalEvent({
      event: "worker_started",
      severity: "info",
      requestId,
      route: "/api/cron/integration-jobs",
      workerKind: "integration-jobs"
    });
    // The public demo has no visitor uploads or external integration queue.
    // Reuse this five-minute authenticated cron slot exclusively for bounded
    // guest expiry/retirement rather than provisioning a third cron.
    if (resolvePublicDemoConfiguration().enabled) {
      const cleanup = await cleanupPublicDemoSessions({ limit: 100 });
      await recordWorkerSucceeded("integration-jobs", requestId, operationOptions);
      await emitOperationalEvent({
        event: "worker_succeeded",
        severity: "info",
        requestId,
        route: "/api/cron/integration-jobs",
        workerKind: "integration-jobs"
      });
      return NextResponse.json({ demoCleanup: cleanup });
    }
    const configuration = integrationWorkerConfiguration();
    // Cleanup is independent of parse-queue discovery, so a cron invocation
    // still performs bounded maintenance when there are no jobs or archives
    // waiting to be parsed.
    const [maintenance, result] = await Promise.all([
      runIntegrationWorkerMaintenance({
        databaseUrl: configuration.databaseUrl,
        maintenanceLimit: configuration.maintenanceLimit
      }),
      runIntegrationWorkerBatch({
        databaseUrl: configuration.databaseUrl,
        workerId: configuration.workerId,
        maximumJobs: 1,
        leaseDurationMs: configuration.leaseDurationMs,
        deadlineAt: new Date(Date.now() + maxDuration * 1_000 - hostedWorkerSafetyMarginMs),
        ...(configuration.malwareScanner ? { malwareScanner: configuration.malwareScanner } : {})
      })
    ]);
    await recordWorkerSucceeded("integration-jobs", requestId, operationOptions);
    await emitOperationalEvent({
      event: "worker_succeeded",
      severity: "info",
      requestId,
      route: "/api/cron/integration-jobs",
      workerKind: "integration-jobs"
    });
    return NextResponse.json({ ...result, maintenance });
  } catch (error) {
    try {
      await recordWorkerFailed(
        "integration-jobs",
        requestId,
        operationalErrorCode(error),
        operationOptions
      );
    } catch {
      // The privacy-safe tracker below remains available when the database is
      // the failed dependency.
    }
    await captureOperationalError({
      event: "integration_worker_failed",
      requestId,
      route: "/api/cron/integration-jobs",
      workerKind: "integration-jobs"
    }, error);
    return NextResponse.json({ error: "Scheduled integration work failed." }, { status: 500 });
  }
}
