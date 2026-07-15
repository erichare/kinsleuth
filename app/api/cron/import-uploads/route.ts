import { NextResponse } from "next/server";
import { cleanupAllStaleGedcomUploads } from "@/lib/gedcom/blob-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Import cleanup is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await cleanupAllStaleGedcomUploads();
    return NextResponse.json({ deleted });
  } catch (error) {
    console.error("Scheduled GEDCOM upload cleanup failed", error);
    return NextResponse.json({ error: "Import cleanup failed." }, { status: 500 });
  }
}
