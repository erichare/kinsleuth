import { NextResponse } from "next/server";
import { z } from "zod";

import { withPermission } from "@/lib/api-authorization";
import {
  projectCaseApiResponse,
  unavailableCaseMutationResponse
} from "@/lib/api-case-projection";
import { isGuidedResearchEnabled } from "@/lib/guided-research-config";
import { addCaseHypothesis } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const createHypothesisSchema = z.object({
  statement: z.string().trim().min(1, "Hypothesis statement is required").max(1200, "Hypothesis statement is too long"),
  confidence: z.number().min(0, "Confidence cannot be below zero").max(1, "Confidence cannot exceed one").optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const POST = withPermission("cases:write", async (request, authorization, { params }: RouteContext) => {
  if (!isGuidedResearchEnabled()) {
    return NextResponse.json({ error: "Guided research is disabled" }, { status: 404 });
  }

  try {
    const { id } = await params;
    const unavailable = await unavailableCaseMutationResponse(id, authorization.archiveId);
    if (unavailable) return unavailable;

    const body = await readJson(request);
    if (!body.ok) {
      return body.response;
    }

    // Status, decisions, actors, IDs, and timestamps are stripped. New
    // hypotheses always begin open and without fabricated decision history.
    const parsed = createHypothesisSchema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid hypothesis" },
        { status: 400 }
      );
    }

    const result = await addCaseHypothesis(id, parsed.data, { archiveId: authorization.archiveId });
    return NextResponse.json(projectCaseApiResponse(result), { status: 201 });
  } catch (error) {
    const knownResponse = mapHypothesisError(error);
    if (knownResponse) {
      return knownResponse;
    }

    console.error("Hypothesis creation failed", error);
    return NextResponse.json({ error: "Unable to create the hypothesis" }, { status: 500 });
  }
});

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

function mapHypothesisError(error: unknown): NextResponse | null {
  const code = errorCode(error);
  const message = errorMessage(error);
  if (code === "CASE_NOT_FOUND" || code === "NOT_FOUND" || /\bcase\b.*\bnot found\b/.test(message)) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
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
