import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as { password?: string; next?: string };
  const configuredPassword = process.env.KINSLEUTH_APP_PASSWORD;

  if (configuredPassword && body.password !== configuredPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, next: safeNextPath(body.next) });
  response.cookies.set({
    name: sessionCookieName,
    value: await createSessionToken(process.env.AUTH_SECRET || "kinsleuth-dev-secret"),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds
  });
  return response;
}

function safeNextPath(next: string | undefined): string {
  if (!next?.startsWith("/") || next.startsWith("//")) {
    return "/app";
  }
  return next;
}
