import type { NextRequest } from "next/server";

import { betaErrorResponse, betaJsonResponse } from "@/lib/beta-api-http";
import { consumeBetaOperatorRequest } from "@/lib/beta-invitations";
import { createApiRequestId } from "@/lib/api-response";
import { isHostedDeployment } from "@/lib/hosted-config";
import { emitOperationalEvent } from "@/lib/observability";
import { authenticateOperatorRequest } from "@/lib/operator-request";
import { getActiveReleaseFence } from "@/lib/release-fence";
import { releaseFenceLockedResponse } from "@/lib/release-fence-http";
import { getArchiveId } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = createApiRequestId();
  let authenticated: Awaited<ReturnType<typeof authenticateOperatorRequest>>;
  try {
    authenticated = await authenticateOperatorRequest(request);
  } catch {
    return betaErrorResponse(401, "Unauthorized", { requestId });
  }

  try {
    if (!isHostedDeployment()) return betaErrorResponse(404, "Not found", { requestId });
    const activeFence = await getActiveReleaseFence();
    if (activeFence) {
      return releaseFenceLockedResponse(activeFence, { discloseControlIdentity: true });
    }
  } catch {
    return betaErrorResponse(503, "Operator safety check unavailable.", { requestId });
  }

  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return betaErrorResponse(400, "The operator request is invalid.", { requestId });
  }
  try {
    const body: unknown = JSON.parse(authenticated.body);
    if (
      typeof body !== "object"
      || body === null
      || Array.isArray(body)
      || JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(["action"])
      || (body as { action?: unknown }).action !== "test-alert"
    ) {
      return betaErrorResponse(400, "The operator request is invalid.", { requestId });
    }
  } catch {
    return betaErrorResponse(400, "The operator request is invalid.", { requestId });
  }

  try {
    await consumeBetaOperatorRequest(authenticated.claim, { archiveId: getArchiveId() });
    await emitOperationalEvent({
      event: "operator_test_alert",
      severity: "error",
      code: "TEST_ALERT",
      requestId,
      route: "/api/operator/observability"
    }, { requireDelivery: true });
    return betaJsonResponse({ accepted: true }, { requestId, status: 202 });
  } catch {
    return betaErrorResponse(503, "The observability test alert could not be delivered.", { requestId });
  }
}
