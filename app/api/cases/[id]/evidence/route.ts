import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { projectCaseApiResponse } from "@/lib/api-case-projection";
import { capabilityUnavailableResponse } from "@/lib/api-capabilities";
import { linkDnaMatchToCase } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const POST = withPermission("evidence:write", async (request, _authorization, { params }: RouteContext) => {
  const unavailable = capabilityUnavailableResponse("dna");
  if (unavailable) return unavailable;

  const { id } = await params;
  const body = (await request.json()) as {
    linkedDnaMatchId?: string;
    title?: string;
    summary?: string;
    confidence?: number;
  };

  if (!body.linkedDnaMatchId?.trim()) {
    return NextResponse.json({ error: "linkedDnaMatchId is required" }, { status: 400 });
  }

  try {
    const result = await linkDnaMatchToCase(id, body.linkedDnaMatchId, {
      title: body.title,
      summary: body.summary,
      confidence: body.confidence
    });
    return NextResponse.json(projectCaseApiResponse(result), { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Evidence link failed" }, { status: 404 });
  }
});
