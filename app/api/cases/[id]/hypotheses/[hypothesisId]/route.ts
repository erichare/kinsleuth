import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth-session";
import { isGuidedResearchEnabled } from "@/lib/guided-research-config";
import { hasPermission } from "@/lib/rbac";
import { updateCaseHypothesis } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const timestampSchema = z.string().trim().max(64, "Timestamp is too long").datetime({ offset: true });

const updateHypothesisSchema = z
  .object({
    statement: z
      .string()
      .trim()
      .min(1, "Hypothesis statement cannot be empty")
      .max(1200, "Hypothesis statement is too long")
      .optional(),
    confidence: z.number().min(0, "Confidence cannot be below zero").max(1, "Confidence cannot exceed one").optional(),
    expectedUpdatedAt: timestampSchema,
    requestId: z.string().trim().min(1, "requestId is required").max(128, "requestId is too long").optional(),
    status: z.enum(["open", "supported", "weakened", "rejected"]).optional(),
    reason: z.string().trim().min(1, "A decision reason is required").max(2000, "Decision reason is too long").optional()
  })
  .superRefine((value, context) => {
    const hasEdit = value.statement !== undefined || value.confidence !== undefined;
    const hasDecision = value.status !== undefined;

    if (value.statement === undefined && value.confidence === undefined && value.status === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "At least one hypothesis change is required" });
    }

    if (hasEdit && hasDecision) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hypothesis edits and status decisions must be submitted separately"
      });
    }

    if (value.status !== undefined && (value.requestId === undefined || value.reason === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Status decisions require a requestId and reason"
      });
    }

    if (value.status === undefined && (value.requestId !== undefined || value.reason !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "requestId and reason may only accompany a status decision"
      });
    }
  });

type RouteContext = {
  params: Promise<{ id: string; hypothesisId: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
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

    // IDs, decision history, context references, timestamps, and actors other
    // than the caller are stripped before the scoped store mutation.
    const parsed = updateHypothesisSchema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid hypothesis update" },
        { status: 400 }
      );
    }

    const { id, hypothesisId } = await params;
    const result = await updateCaseHypothesis(
      id,
      hypothesisId,
      {
        ...parsed.data,
        actorId: session.userId,
        actorName: session.name
      },
      { archiveId: session.archiveId }
    );
    return NextResponse.json(result);
  } catch (error) {
    const knownResponse = mapHypothesisError(error);
    if (knownResponse) {
      return knownResponse;
    }

    console.error("Hypothesis update failed", error);
    return NextResponse.json({ error: "Unable to update the hypothesis" }, { status: 500 });
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

function mapHypothesisError(error: unknown): NextResponse | null {
  const code = errorCode(error);
  const message = errorMessage(error);

  if (
    code === "CASE_NOT_FOUND" ||
    code === "HYPOTHESIS_NOT_FOUND" ||
    code === "NOT_FOUND" ||
    /\b(case|hypothesis)\b.*\bnot found\b/.test(message)
  ) {
    return NextResponse.json({ error: "Case or hypothesis not found" }, { status: 404 });
  }

  if (
    code === "STALE_RESEARCH_STATE" ||
    code === "STALE_VERSION" ||
    code === "IDEMPOTENCY_CONFLICT" ||
    code === "CONFLICT" ||
    /\b(stale|conflict|idempot|updated by another request)\b/.test(message)
  ) {
    return NextResponse.json(
      { error: "This hypothesis changed. Refresh the case and try again." },
      { status: 409 }
    );
  }

  if (
    code === "INVALID_DECISION" ||
    code === "VALIDATION_ERROR" ||
    /\bdecisions? require\b|\bdoes not belong to this case\b/.test(message)
  ) {
    return NextResponse.json({ error: "The hypothesis change is not valid for this case" }, { status: 400 });
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
