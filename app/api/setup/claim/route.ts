import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Completes first-run setup: resolving the session context creates the owner
// membership for the sole account (see resolveMembershipRole's self-heal).
export async function POST(request: Request) {
  const context = await getSessionContext(request.headers);
  if (!context) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  return NextResponse.json({ role: context.role, archiveId: context.archiveId });
}
