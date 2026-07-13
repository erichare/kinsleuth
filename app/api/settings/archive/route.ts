import { NextResponse } from "next/server";
import { z } from "zod";
import { updateArchiveBranding } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const brandingSchema = z.object({
  name: z.string().trim().min(1, "Archive name is required").max(120, "Archive name must be 120 characters or fewer"),
  tagline: z.string().trim().max(200, "Tagline must be 200 characters or fewer").default("")
});

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = brandingSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid archive branding";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    return NextResponse.json(await updateArchiveBranding(parsed.data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update archive branding" }, { status: 500 });
  }
}
