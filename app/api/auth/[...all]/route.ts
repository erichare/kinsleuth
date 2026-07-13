import { NextResponse, type NextRequest } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { countUsers } from "@/lib/auth-session";
import { ensureDatabaseSchema } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  await ensureDatabaseSchema();
  return toNextJsHandler(getAuth().handler).GET(request);
}

export async function POST(request: NextRequest) {
  await ensureDatabaseSchema();

  // Open sign-up is only for first-run setup: once an account exists, new
  // members arrive via invitations (a later slice), not self-registration.
  // This is a best-effort UX gate — it need not be perfectly atomic, because
  // any account slipping past a race stays membership-less, and only the
  // earliest account self-heals to owner (see resolveMembershipRole). A
  // membership-less account is denied at the proxy, so the worst a race can do
  // is create an extra, powerless account.
  if (request.nextUrl.pathname.startsWith("/api/auth/sign-up") && process.env.KINSLEUTH_ALLOW_SIGNUPS !== "true") {
    if ((await countUsers()) > 0) {
      return NextResponse.json(
        { error: "Sign-up is disabled. Ask the archive owner for an invitation." },
        { status: 403 }
      );
    }
  }

  return toNextJsHandler(getAuth().handler).POST(request);
}
