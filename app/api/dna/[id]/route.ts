import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { capabilityUnavailableResponse } from "@/lib/api-capabilities";
import type { DnaMatch, DnaSide, DnaTreeStatus } from "@/lib/models";
import { deleteDnaMatch, updateDnaMatch } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const sides = new Set<DnaSide>(["maternal", "paternal", "both", "unknown"]);
const treeStatuses = new Set<DnaTreeStatus>(["none", "private", "partial", "public", "unknown"]);
const triageStatuses = new Set<DnaMatch["triageStatus"]>(["needs_review", "triaged", "ignored", "high_priority"]);

export const PATCH = withPermission("dna:write", async (request: Request, _authorization, { params }: { params: Promise<{ id: string }> }) => {
  const unavailable = capabilityUnavailableResponse("dna");
  if (unavailable) return unavailable;

  const { id } = await params;
  const input = (await request.json()) as Partial<DnaMatch>;

  if (input.side && !sides.has(input.side)) {
    return NextResponse.json({ error: "Invalid DNA side" }, { status: 400 });
  }
  if (input.treeStatus && !treeStatuses.has(input.treeStatus)) {
    return NextResponse.json({ error: "Invalid tree status" }, { status: 400 });
  }
  if (input.triageStatus && !triageStatuses.has(input.triageStatus)) {
    return NextResponse.json({ error: "Invalid triage status" }, { status: 400 });
  }

  try {
    const result = await updateDnaMatch(id, input);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "DNA match update failed" }, { status: 400 });
  }
});

export const DELETE = withPermission("dna:write", async (_request: Request, _authorization, { params }: { params: Promise<{ id: string }> }) => {
  const unavailable = capabilityUnavailableResponse("dna");
  if (unavailable) return unavailable;

  const { id } = await params;

  try {
    const result = await deleteDnaMatch(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "DNA match delete failed" }, { status: 404 });
  }
});
