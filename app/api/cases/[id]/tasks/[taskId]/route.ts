import { NextResponse } from "next/server";
import { z } from "zod";

import { withPermission } from "@/lib/api-authorization";
import {
  projectCaseApiResponse,
  unavailableCaseMutationResponse
} from "@/lib/api-case-projection";
import { isGuidedResearchEnabled } from "@/lib/guided-research-config";
import { updateCaseTask } from "@/lib/workspace-store";
import { captureOperationalError } from "@/lib/observability";

export const dynamic = "force-dynamic";

const timestampSchema = z.string().trim().max(64, "Timestamp is too long").datetime({ offset: true });

const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Task title cannot be empty").max(240, "Task title is too long").optional(),
    status: z.enum(["todo", "doing", "done"]).optional(),
    priority: z.enum(["high", "normal", "low"]).optional(),
    guidance: z.string().trim().max(4000, "Task guidance is too long").optional(),
    expectedUpdatedAt: timestampSchema
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.status !== undefined ||
      value.priority !== undefined ||
      value.guidance !== undefined,
    { message: "At least one task change is required" }
  );

type RouteContext = {
  params: Promise<{ id: string; taskId: string }>;
};

export const PATCH = withPermission("cases:write", async (request, authorization, { params }: RouteContext) => {
  try {
    const { id, taskId } = await params;
    const unavailable = await unavailableCaseMutationResponse(id, authorization.archiveId);
    if (unavailable) return unavailable;

    const body = await readJson(request);
    if (!body.ok) {
      return body.response;
    }

    // Unknown keys are stripped so generated-guide metadata and outcome
    // history cannot be mutated through this generic manual-task endpoint.
    const parsed = updateTaskSchema.safeParse(body.value);
    if (!parsed.success) {
      return invalidTaskResponse(body.value, parsed.error.issues[0]?.message);
    }

    const guidedResearchEnabled = isGuidedResearchEnabled();
    if (parsed.data.status === "done" && guidedResearchEnabled) {
      return invalidTaskResponse(parsed.data);
    }

    const result = await updateCaseTask(id, taskId, parsed.data, {
      archiveId: authorization.archiveId,
      ...(!guidedResearchEnabled ? { allowManualCompletionWithoutOutcome: true } : {})
    });
    return NextResponse.json(projectCaseApiResponse(result));
  } catch (error) {
    const knownResponse = mapTaskError(error);
    if (knownResponse) {
      return knownResponse;
    }

    await captureOperationalError({
      event: "api_error",
      requestId: authorization.requestId,
      route: "/api/cases/[id]/tasks/[taskId]"
    }, error);
    return NextResponse.json({ error: "Unable to update the task" }, { status: 500 });
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

function invalidTaskResponse(body: unknown, message?: string): NextResponse {
  if (isRecord(body) && body.status === "done") {
    return NextResponse.json(
      { error: "Record an outcome to complete a task" },
      { status: 400 }
    );
  }
  return NextResponse.json({ error: message ?? "Invalid task update" }, { status: 400 });
}

function mapTaskError(error: unknown): NextResponse | null {
  const code = errorCode(error);
  const message = errorMessage(error);

  if (
    code === "CASE_NOT_FOUND" ||
    code === "TASK_NOT_FOUND" ||
    code === "NOT_FOUND" ||
    /\b(case|task)\b.*\bnot found\b/.test(message)
  ) {
    return NextResponse.json({ error: "Case or task not found" }, { status: 404 });
  }

  if (
    code === "STALE_RESEARCH_STATE" ||
    code === "STALE_VERSION" ||
    code === "ACTIVE_ASSIGNMENT_CONFLICT" ||
    code === "CONFLICT" ||
    /\b(stale|updated by another request|another assignment is already in progress)\b/.test(message)
  ) {
    return NextResponse.json(
      { error: "This task changed. Refresh the case and try again." },
      { status: 409 }
    );
  }

  if (
    code === "INVALID_TASK_UPDATE" ||
    code === "IMMUTABLE_GUIDE_METADATA" ||
    /\bcomplete tasks? by recording an outcome\b|\bcompleted tasks? (?:are|is) immutable\b|\bguide metadata\b/.test(message)
  ) {
    return NextResponse.json({ error: "This task change is not allowed" }, { status: 400 });
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
