import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth-session";
import { isGuidedResearchEnabled } from "@/lib/guided-research-config";
import { hasPermission } from "@/lib/rbac";
import { acceptGuideAssignment } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const assignmentSchema = z.object({
  guideKey: z.string().trim().min(1, "guideKey is required").max(512, "guideKey is too long")
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  if (!isGuidedResearchEnabled()) {
    return NextResponse.json({ error: "Guided research is disabled" }, { status: 404 });
  }

  try {
    const session = await getSessionContext(request.headers);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!hasPermission(session.role, "cases:write")) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    const body = await readJson(request);
    if (!body.ok) {
      return body.response;
    }

    // Zod objects strip unrecognized keys. The client may select only an
    // opaque guide key; all assignment metadata is recomputed by the store.
    const parsed = assignmentSchema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid guide assignment" }, { status: 400 });
    }

    const { id } = await params;
    const result = await acceptGuideAssignment(id, parsed.data.guideKey, { archiveId: session.archiveId });
    const created = isRecord(result) && result.created === false ? false : true;
    return NextResponse.json(result, { status: created ? 201 : 200 });
  } catch (error) {
    const knownResponse = mapAssignmentError(error);
    if (knownResponse) {
      return knownResponse;
    }

    console.error("Guide assignment failed", error);
    return NextResponse.json({ error: "Unable to accept the guide assignment" }, { status: 500 });
  }
}

async function readJson(
  request: Request
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request body must be JSON" }, { status: 400 })
    };
  }
}

function mapAssignmentError(error: unknown): NextResponse | null {
  const code = errorCode(error);
  const message = errorMessage(error);

  if (
    code === "CASE_NOT_FOUND" ||
    code === "NOT_FOUND" ||
    /\bcase\b.*\bnot found\b|\bnot found\b.*\bcase\b/.test(message)
  ) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  if (
    code === "STALE_GUIDE_KEY" ||
    code === "INVALID_GUIDE_KEY" ||
    code === "CONFLICT" ||
    /\b(stale|invalid|expired)\b.*\bguide\b|\bguide(?: key)?\b.*\b(stale|invalid|expired|not available)\b/.test(message)
  ) {
    return NextResponse.json(
      { error: "That guide assignment is no longer current. Refresh the case and try again." },
      { status: 409 }
    );
  }

  return null;
}

function errorCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== "string") {
    return "";
  }
  return error.code.toUpperCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
