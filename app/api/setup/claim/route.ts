import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-response";
import { getSessionContext } from "@/lib/auth-session";
import { isHostedDeployment } from "@/lib/hosted-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Completes self-hosted first-run setup: resolving the session context creates the owner
// membership for the sole account (see resolveMembershipRole's self-heal).
export async function POST(request: Request) {
  if (isHostedDeployment()) {
    return apiErrorResponse(404, "Not found");
  }

  const context = await getSessionContext(request.headers);
  if (!context) {
    return apiErrorResponse(401, "Authentication required");
  }

  return NextResponse.json({ role: context.role, archiveId: context.archiveId });
}
