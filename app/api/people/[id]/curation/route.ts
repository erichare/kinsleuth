import { NextResponse } from "next/server";
import type { PersonSummary, PrivacyLevel } from "@/lib/models";
import { updatePersonCuration } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const privacyLevels = new Set<PrivacyLevel>(["public", "private", "sensitive"]);
const livingStatuses = new Set<PersonSummary["livingStatus"]>(["living", "deceased", "unknown"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as { published?: boolean; privacy?: PrivacyLevel; livingStatus?: PersonSummary["livingStatus"] };

  if (body.privacy && !privacyLevels.has(body.privacy)) {
    return NextResponse.json({ error: "Invalid privacy level" }, { status: 400 });
  }
  if (body.livingStatus && !livingStatuses.has(body.livingStatus)) {
    return NextResponse.json({ error: "Invalid living status" }, { status: 400 });
  }

  try {
    return NextResponse.json(await updatePersonCuration(id, body));
  } catch {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }
}
