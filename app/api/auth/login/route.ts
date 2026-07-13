import { NextResponse } from "next/server";
import { createSessionToken, safeInternalPath, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as { password?: string; next?: string };
  const configuredPassword = process.env.KINSLEUTH_APP_PASSWORD;
  const authSecret = process.env.AUTH_SECRET;

  if (process.env.NODE_ENV === "production" && (!configuredPassword || !authSecret)) {
    return NextResponse.json({ error: "Private workspace authentication is not configured" }, { status: 503 });
  }

  if (configuredPassword && body.password !== configuredPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, next: safeInternalPath(body.next) });
  response.cookies.set({
    name: sessionCookieName,
    value: await createSessionToken(authSecret || "kinsleuth-dev-secret"),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds
  });
  return response;
}
