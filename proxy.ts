import { NextRequest, NextResponse } from "next/server";
import { allowedApiMethods, resolveApiAccess, resolveApiRoute } from "@/lib/api-access";
import { apiErrorResponse } from "@/lib/api-response";
import { getSessionContext } from "@/lib/auth-session";
import { ensureDatabaseSchema } from "@/lib/db";
import {
  isPublicArchivePath,
  publicArchiveEnabled
} from "@/lib/public-surface";

const protectedPagePrefixes = ["/app"];

// Next 16's proxy runs on the Node runtime, so full database-backed session
// validation stays centralized here. Refresh Set-Cookie headers from session
// renewal cannot be forwarded through NextResponse.next(); renewals happen on
// route-handler traffic instead (see lib/auth.ts).
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  const apiRoute = isApi ? resolveApiRoute(pathname) : null;
  const apiAccess = isApi ? resolveApiAccess(pathname, request.method) : null;
  const protectsApi = apiAccess?.kind === "permission";
  const disabledPublicArchive = isPublicArchivePath(pathname) && !publicArchiveEnabled();
  const protectsPage = disabledPublicArchive
    || protectedPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (isApi && !apiRoute) {
    return apiErrorResponse(404, "Not found");
  }

  if (isApi && apiRoute && !apiAccess) {
    return apiErrorResponse(405, "Method not allowed", {
      headers: { allow: allowedApiMethods(apiRoute).join(", ") }
    });
  }

  if (!process.env.AUTH_SECRET) {
    if (process.env.NODE_ENV === "production") {
      const requiresAuthConfiguration = apiRoute?.requiresAuthSecret === true;
      if (!requiresAuthConfiguration && !protectsApi && !protectsPage) {
        return NextResponse.next();
      }

      const message = "Private workspace authentication is not configured";
      return isApi
        ? apiErrorResponse(503, message)
        : new NextResponse(message, { status: 503 });
    }

    // Local development stays open until auth is configured, matching the
    // previous password-gate behavior; lib/auth-session.ts mirrors this.
    return NextResponse.next();
  }

  if (disabledPublicArchive) {
    const loginUrl = process.env.APP_BASE_URL
      ? new URL("/login", process.env.APP_BASE_URL)
      : new URL("/login", request.nextUrl);
    loginUrl.searchParams.set("next", "/app");
    return NextResponse.redirect(loginUrl);
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
    return apiErrorResponse(401, "Authentication required");
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
  matcher: [
    "/",
    "/people/:path*",
    "/places/:path*",
    "/stories/:path*",
    "/kinsleuth/:path*",
    "/app/:path*",
    "/api/:path*"
  ]
};
