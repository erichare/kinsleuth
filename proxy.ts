import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { ensureDatabaseSchema } from "@/lib/db";

const protectedPagePrefixes = ["/app"];
const protectedApiPrefixes = ["/api/ai", "/api/cases", "/api/dna", "/api/exports", "/api/imports", "/api/people", "/api/publishing", "/api/reports", "/api/settings", "/api/sources", "/api/uploads"];

// Next 16's proxy runs on the Node runtime, so full database-backed session
// validation stays centralized here. Refresh Set-Cookie headers from session
// renewal cannot be forwarded through NextResponse.next(); renewals happen on
// route-handler traffic instead (see lib/auth.ts).
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectsApi = protectedApiPrefixes.some((prefix) => pathname.startsWith(prefix));
  const protectsPage = protectedPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (!process.env.AUTH_SECRET) {
    if (process.env.NODE_ENV === "production") {
      const message = "Private workspace authentication is not configured";
      return protectsApi
        ? NextResponse.json({ error: message }, { status: 503 })
        : new NextResponse(message, { status: 503 });
    }

    // Local development stays open until auth is configured, matching the
    // previous password-gate behavior; lib/auth-session.ts mirrors this.
    return NextResponse.next();
  }

  if (!protectsApi && !protectsPage) {
    return NextResponse.next();
  }

  // Gate on archive MEMBERSHIP, not merely session existence: an
  // authenticated account with no membership (e.g. an open-signup account, or
  // one created by racing first-run setup) must not reach private data.
  // getSessionContext resolves session -> membership and returns null for
  // both anonymous callers and membership-less accounts.
  await ensureDatabaseSchema();
  const context = await getSessionContext(request.headers);
  if (context) {
    return NextResponse.next();
  }

  if (protectsApi) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const loginUrl = process.env.APP_BASE_URL
    ? new URL("/login", process.env.APP_BASE_URL)
    : request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/app/:path*", "/api/ai/:path*", "/api/cases/:path*", "/api/dna/:path*", "/api/exports/:path*", "/api/imports/:path*", "/api/people/:path*", "/api/publishing/:path*", "/api/reports/:path*", "/api/settings/:path*", "/api/sources/:path*", "/api/uploads/:path*"]
};
