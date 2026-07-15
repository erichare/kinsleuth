import { NextResponse } from "next/server";
import { z } from "zod";

import { withPermission } from "@/lib/api-authorization";
import {
  projectCaseApiResponse,
  unavailableCaseMutationResponse
} from "@/lib/api-case-projection";
import { addCaseTask } from "@/lib/workspace-store";
import { captureOperationalError } from "@/lib/observability";

export const dynamic = "force-dynamic";

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(240, "Task title is too long"),
  status: z.enum(["todo", "doing"]).optional(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  guidance: z.string().trim().max(4000, "Task guidance is too long").optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const POST = withPermission("cases:write", async (request, authorization, { params }: RouteContext) => {
  try {
    const { id } = await params;
    const unavailable = await unavailableCaseMutationResponse(id, authorization.archiveId);
    if (unavailable) return unavailable;

    const body = await readJson(request);
    if (!body.ok) {
      return body.response;
    }

    // Unknown keys are stripped. Guide ownership, references, fingerprints,
    // outcomes, and completion history are never accepted on this manual route.
    const parsed = createTaskSchema.safeParse(body.value);
    if (!parsed.success) {
      return invalidTaskResponse(body.value, parsed.error.issues[0]?.message);
    }

    const result = await addCaseTask(id, parsed.data, { archiveId: authorization.archiveId });
    return NextResponse.json(projectCaseApiResponse(result), { status: 201 });
  } catch (error) {
    const knownResponse = mapTaskError(error);
    if (knownResponse) {
      return knownResponse;
    }

    await captureOperationalError({
      event: "api_error",
      requestId: authorization.requestId,
      route: "/api/cases/[id]/tasks"
    }, error);
    return NextResponse.json({ error: "Unable to create the task" }, { status: 500 });
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
  return NextResponse.json({ error: message ?? "Invalid task" }, { status: 400 });
}

function mapTaskError(error: unknown): NextResponse | null {
  const code = errorCode(error);
  const message = errorMessage(error);

  if (code === "CASE_NOT_FOUND" || code === "NOT_FOUND" || /\bcase\b.*\bnot found\b/.test(message)) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  if (code === "ACTIVE_ASSIGNMENT_CONFLICT" || /\banother assignment is already in progress\b/.test(message)) {
    return NextResponse.json(
      { error: "Another assignment is already in progress for this case." },
      { status: 409 }
    );
  }

  if (/\bcomplete tasks? by recording an outcome\b/.test(message)) {
    return NextResponse.json({ error: "Record an outcome to complete a task" }, { status: 400 });
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
