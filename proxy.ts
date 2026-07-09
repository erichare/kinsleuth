import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySessionToken } from "@/lib/session";

const protectedPagePrefixes = ["/app"];
const protectedApiPrefixes = ["/api/ai", "/api/cases", "/api/dna", "/api/imports", "/api/people", "/api/publishing", "/api/reports", "/api/sources", "/api/uploads"];

export async function proxy(request: NextRequest) {
  const password = process.env.KINSLEUTH_APP_PASSWORD;
  if (!password) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const protectsApi = protectedApiPrefixes.some((prefix) => pathname.startsWith(prefix));
  const protectsPage = protectedPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (!protectsApi && !protectsPage) {
    return NextResponse.next();
  }

  const isAuthenticated = await verifySessionToken(request.cookies.get(sessionCookieName)?.value, process.env.AUTH_SECRET || "kinsleuth-dev-secret");
  if (isAuthenticated) {
    return NextResponse.next();
  }

  if (protectsApi) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/app/:path*", "/api/ai/:path*", "/api/cases/:path*", "/api/dna/:path*", "/api/imports/:path*", "/api/people/:path*", "/api/publishing/:path*", "/api/reports/:path*", "/api/sources/:path*", "/api/uploads/:path*"]
};
