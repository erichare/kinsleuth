import { NextResponse } from "next/server";
import { linkDnaMatchToCase } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Evidence link failed" }, { status: 404 });
  }
}
