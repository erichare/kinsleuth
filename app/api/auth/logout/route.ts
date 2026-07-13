import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The app shell signs out with a plain HTML form post; this explicit route
// takes precedence over the better-auth catch-all and preserves the
// redirect-to-login behavior a non-JS form needs.
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);

  try {
    const signOut = await getAuth().api.signOut({ headers: request.headers, asResponse: true });
    for (const cookie of signOut.headers.getSetCookie()) {
      response.headers.append("set-cookie", cookie);
    }
  } catch {
    // An already-expired session still redirects to /login; clear any stale
    // cookie so the browser does not keep presenting it.
    response.cookies.set("better-auth.session_token", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  }

  return response;
}
