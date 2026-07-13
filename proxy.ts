import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySessionToken } from "@/lib/session";

const protectedPagePrefixes = ["/app"];
const protectedApiPrefixes = ["/api/ai", "/api/cases", "/api/dna", "/api/imports", "/api/people", "/api/publishing", "/api/reports", "/api/settings", "/api/sources", "/api/uploads"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectsApi = protectedApiPrefixes.some((prefix) => pathname.startsWith(prefix));
  const protectsPage = protectedPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const password = process.env.KINSLEUTH_APP_PASSWORD;
  const authSecret = process.env.AUTH_SECRET;

  if (!password || !authSecret) {
    if (process.env.NODE_ENV === "production") {
      const message = "Private workspace authentication is not configured";
      return protectsApi
        ? NextResponse.json({ error: message }, { status: 503 })
        : new NextResponse(message, { status: 503 });
    }

    return NextResponse.next();
  }

  if (!protectsApi && !protectsPage) {
    return NextResponse.next();
  }

  const isAuthenticated = await verifySessionToken(request.cookies.get(sessionCookieName)?.value, authSecret);
  if (isAuthenticated) {
    return NextResponse.next();
  }

  if (protectsApi) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/app/:path*", "/api/ai/:path*", "/api/cases/:path*", "/api/dna/:path*", "/api/imports/:path*", "/api/people/:path*", "/api/publishing/:path*", "/api/reports/:path*", "/api/settings/:path*", "/api/sources/:path*", "/api/uploads/:path*"]
};
