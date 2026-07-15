import { NextResponse } from "next/server";
import { z } from "zod";

import { withPermission } from "@/lib/api-authorization";
import {
  projectCaseApiResponse,
  unavailableCaseMutationResponse
} from "@/lib/api-case-projection";
import { isGuidedResearchEnabled } from "@/lib/guided-research-config";
import { recordCaseTaskOutcome } from "@/lib/workspace-store";
import { captureOperationalError } from "@/lib/observability";

export const dynamic = "force-dynamic";

const timestampSchema = z.string().trim().max(64, "Timestamp is too long").datetime({ offset: true });
const optionalScopeValue = z.string().trim().max(500);

const searchScopeSchema = z.object({
  repository: z.string().trim().min(1, "Search repository is required").max(240),
  collection: optionalScopeValue.optional(),
  place: optionalScopeValue.optional(),
  dateRange: z.string().trim().max(120).optional(),
  query: z.string().trim().max(1200).optional()
});

const hypothesisDecisionSchema = z.object({
  hypothesisId: z.string().trim().min(1).max(256),
  status: z.enum(["open", "supported", "weakened", "rejected"]),
  reason: z.string().trim().min(1, "A hypothesis decision reason is required").max(2000),
  expectedHypothesisUpdatedAt: timestampSchema
});

const outcomeSchema = z
  .object({
    requestId: z.string().trim().min(1, "requestId is required").max(128),
    expectedTaskUpdatedAt: timestampSchema,
    outcome: z.enum(["found", "not_found", "inconclusive", "blocked", "already_tried"]),
    note: z.string().trim().min(1, "An outcome note is required").max(4000),
    searchScope: searchScopeSchema.optional(),
    correctsOutcomeId: z.string().trim().min(1).max(256).optional(),
    hypothesisDecision: hypothesisDecisionSchema.optional()
  })
  .superRefine((value, context) => {
    if ((value.outcome === "not_found" || value.outcome === "already_tried") && !value.searchScope?.repository) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["searchScope"],
        message: "Negative search outcomes require a repository or search location"
      });
    }
  });

type RouteContext = {
  params: Promise<{ id: string; taskId: string }>;
};

export const POST = withPermission("cases:write", async (request, authorization, { params }: RouteContext) => {
  if (!isGuidedResearchEnabled()) {
    return NextResponse.json({ error: "Guided research is disabled" }, { status: 404 });
  }

  try {
    const { id, taskId } = await params;
    const unavailable = await unavailableCaseMutationResponse(id, authorization.archiveId);
    if (unavailable) return unavailable;

    const body = await readJson(request);
    if (!body.ok) {
      return body.response;
    }

    const parsed = outcomeSchema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid research outcome" }, { status: 400 });
    }

    const { hypothesisDecision, ...outcome } = parsed.data;
    const result = await recordCaseTaskOutcome(
      id,
      taskId,
      {
        ...outcome,
        actorId: authorization.userId,
        actorName: authorization.name,
        ...(hypothesisDecision
          ? {
              hypothesisDecision: {
                ...hypothesisDecision,
                // The public route uses the explicit field name while the
                // store keeps its generic optimistic-lock input name.
                expectedUpdatedAt: hypothesisDecision.expectedHypothesisUpdatedAt
              }
            }
          : {})
      },
      { archiveId: authorization.archiveId }
    );

    return NextResponse.json(projectCaseApiResponse(result));
  } catch (error) {
    const knownResponse = mapOutcomeError(error);
    if (knownResponse) {
      return knownResponse;
    }

    await captureOperationalError({
      event: "api_error",
      requestId: authorization.requestId,
      route: "/api/cases/[id]/tasks/[taskId]/outcome"
    }, error);
    return NextResponse.json({ error: "Unable to record the task outcome" }, { status: 500 });
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

function mapOutcomeError(error: unknown): NextResponse | null {
  const code = errorCode(error);
  const message = errorMessage(error);

  if (
    code === "CASE_NOT_FOUND" ||
    code === "TASK_NOT_FOUND" ||
    code === "HYPOTHESIS_NOT_FOUND" ||
    code === "NOT_FOUND" ||
    /\b(case|task|hypothesis)\b.*\bnot found\b|\bnot found\b.*\b(case|task|hypothesis)\b/.test(message)
  ) {
    return NextResponse.json({ error: "Case, task, or hypothesis not found" }, { status: 404 });
  }

  if (
    code === "STALE_RESEARCH_STATE" ||
    code === "STALE_WRITE" ||
    code === "STALE_VERSION" ||
    code === "IDEMPOTENCY_CONFLICT" ||
    code === "REQUEST_CONFLICT" ||
    code === "CONFLICT" ||
    /\b(stale|conflict|idempot)\b/.test(message)
  ) {
    return NextResponse.json(
      { error: "This research record changed. Refresh the case and try again." },
      { status: 409 }
    );
  }

  if (
    code === "INVALID_OUTCOME" ||
    code === "INVALID_DECISION" ||
    code === "VALIDATION_ERROR" ||
    code === "DECISION_INVARIANT" ||
    /\b(decision invariant|cross-case|another case|does not belong|invalid (?:outcome|decision|target|reference))\b/.test(message)
  ) {
    return NextResponse.json({ error: "The research outcome is not valid for this case" }, { status: 400 });
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
