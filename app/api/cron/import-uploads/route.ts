import { NextResponse } from "next/server";
import { createApiRequestId } from "@/lib/api-response";
import { cleanupExpiredBetaStateForSystem } from "@/lib/beta-invitations";
import {
  recordWorkerFailed,
  recordWorkerStarted,
  recordWorkerSucceeded
} from "@/lib/beta-operations";
import { cleanupAllStaleGedcomUploads } from "@/lib/gedcom/blob-storage";
import { getActiveReleaseFence } from "@/lib/release-fence";
import { releaseFenceLockedResponse } from "@/lib/release-fence-http";
import { getScheduledWritesStatus } from "@/lib/scheduled-writes";
import { isHostedDeployment } from "@/lib/hosted-config";
import {
  captureOperationalError,
  emitOperationalEvent,
  operationalErrorCode
} from "@/lib/observability";
import { getArchiveId } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Import cleanup is not configured." }, { status: 503 });
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
    await recordWorkerStarted("import-upload-cleanup", requestId, operationOptions);
    if (isHostedDeployment()) {
      await recordWorkerStarted("retention-cleanup", requestId, operationOptions);
    }
    await emitOperationalEvent({
      event: "worker_started",
      severity: "info",
      requestId,
      route: "/api/cron/import-uploads",
      workerKind: "import-upload-cleanup"
    });
    const [deleted, retention] = await Promise.all([
      cleanupAllStaleGedcomUploads(),
      isHostedDeployment()
        ? cleanupExpiredBetaStateForSystem({ requestId }, operationOptions)
        : Promise.resolve(null)
    ]);
    await recordWorkerSucceeded("import-upload-cleanup", requestId, operationOptions);
    if (isHostedDeployment()) {
      await recordWorkerSucceeded("retention-cleanup", requestId, operationOptions);
      await emitOperationalEvent({
        event: "retention_cleanup_completed",
        severity: "info",
        requestId,
        route: "/api/cron/import-uploads",
        workerKind: "retention-cleanup"
      });
    }
    await emitOperationalEvent({
      event: "worker_succeeded",
      severity: "info",
      requestId,
      route: "/api/cron/import-uploads",
      workerKind: "import-upload-cleanup"
    });
    return NextResponse.json({ deleted, retention });
  } catch (error) {
    try {
      await recordWorkerFailed(
        "import-upload-cleanup",
        requestId,
        operationalErrorCode(error),
        operationOptions
      );
      if (isHostedDeployment()) {
        await recordWorkerFailed(
          "retention-cleanup",
          requestId,
          operationalErrorCode(error),
          operationOptions
        );
      }
    } catch {
      // A database failure also prevents durable heartbeats; the safe event
      // sink still receives a fixed error code when configured.
    }
    await captureOperationalError({
      event: "worker_failed",
      requestId,
      route: "/api/cron/import-uploads",
      workerKind: "import-upload-cleanup"
    }, error);
    return NextResponse.json({ error: "Import cleanup failed." }, { status: 500 });
  }
}
