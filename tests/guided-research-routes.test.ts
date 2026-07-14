import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

const workspaceMocks = vi.hoisted(() => ({
  acceptGuideAssignment: vi.fn(),
  addCaseTask: vi.fn(),
  recordCaseTaskOutcome: vi.fn(),
  updateCaseTask: vi.fn()
}));

vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import { POST as postGuideAssignment } from "@/app/api/cases/[id]/guide/assignments/route";
import { POST as postTaskOutcome } from "@/app/api/cases/[id]/tasks/[taskId]/outcome/route";
import { PATCH as patchTask } from "@/app/api/cases/[id]/tasks/[taskId]/route";
import { POST as postTask } from "@/app/api/cases/[id]/tasks/route";

const editorSession = {
  userId: "editor-1",
  email: "editor@example.test",
  name: "Case Editor",
  role: "editor" as const,
  archiveId: "archive-from-session"
};

const guideKey = "guide:v1:case-1:review-evidence:ev-1:hyp-1";

beforeEach(() => {
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue(editorSession);
  workspaceMocks.acceptGuideAssignment.mockResolvedValue({
    created: true,
    task: { id: "task-guide-1", title: "Review the passenger list" }
  });
  workspaceMocks.addCaseTask.mockResolvedValue({ task: { id: "task-manual-1", status: "doing" } });
  workspaceMocks.recordCaseTaskOutcome.mockResolvedValue({
    task: { id: "task-guide-1", status: "done" },
    hypothesis: { id: "hyp-1", status: "weakened" }
  });
  workspaceMocks.updateCaseTask.mockResolvedValue({
    task: { id: "task-guide-1", status: "doing" }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  {
    label: "guide assignment",
    invoke: () => postGuideAssignment(assignmentRequest({ guideKey }), caseContext())
  },
  {
    label: "task outcome",
    invoke: () => postTaskOutcome(outcomeRequest(validOutcomeBody()), taskContext())
  }
])("guided research $label authorization", ({ invoke }) => {
  it("returns 401 without a session", async () => {
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
    expect(workspaceMocks.acceptGuideAssignment).not.toHaveBeenCalled();
    expect(workspaceMocks.recordCaseTaskOutcome).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer without cases:write", async () => {
    authMocks.getSessionContext.mockResolvedValue({
      ...editorSession,
      userId: "viewer-1",
      name: "Read Only",
      role: "viewer"
    });

    const response = await invoke();

    expect(response.status).toBe(403);
    expect(workspaceMocks.acceptGuideAssignment).not.toHaveBeenCalled();
    expect(workspaceMocks.recordCaseTaskOutcome).not.toHaveBeenCalled();
  });
});

describe("POST /api/cases/[id]/guide/assignments", () => {
  it("uses only the server-owned guide key and the session archive", async () => {
    const response = await postGuideAssignment(
      assignmentRequest({
        guideKey,
        title: "Forged client title",
        guidance: "Forged client guidance",
        targetHypothesisId: "hyp-other-case",
        contextRefs: [{ type: "evidence", id: "ev-other-case" }],
        origin: "manual"
      }),
      caseContext()
    );

    expect(response.ok).toBe(true);
    expect(workspaceMocks.acceptGuideAssignment).toHaveBeenCalledOnce();
    expect(workspaceMocks.acceptGuideAssignment).toHaveBeenCalledWith("case-1", guideKey, {
      archiveId: "archive-from-session"
    });
  });

  it("returns 400 when the guide key fails validation", async () => {
    const response = await postGuideAssignment(assignmentRequest({ guideKey: " " }), caseContext());

    expect(response.status).toBe(400);
    expect(workspaceMocks.acceptGuideAssignment).not.toHaveBeenCalled();
  });

  it("maps a stale server-owned guide key to 409 without leaking details", async () => {
    workspaceMocks.acceptGuideAssignment.mockRejectedValue(
      Object.assign(new Error("stale key for private family case"), { code: "STALE_GUIDE_KEY" })
    );

    const response = await postGuideAssignment(assignmentRequest({ guideKey }), caseContext());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(body.error).toBeTruthy();
    expect(body.error).not.toContain("private family case");
  });

  it("returns a safe 500 response for unexpected store failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    workspaceMocks.acceptGuideAssignment.mockRejectedValue(
      new Error("postgres://researcher:secret-password@db.internal/private-family")
    );

    const response = await postGuideAssignment(assignmentRequest({ guideKey }), caseContext());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(body.error).toBeTruthy();
    expect(body.error).not.toContain("secret-password");
    expect(body.error).not.toContain("private-family");
  });
});

describe("POST /api/cases/[id]/tasks/[taskId]/outcome", () => {
  it("passes request identity and expected versions to the scoped atomic store mutation", async () => {
    const body = validOutcomeBody();

    const response = await postTaskOutcome(outcomeRequest(body), taskContext());

    expect(response.ok).toBe(true);
    expect(workspaceMocks.recordCaseTaskOutcome).toHaveBeenCalledOnce();
    const call = workspaceMocks.recordCaseTaskOutcome.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
      { archiveId: string }
    ];
    expect(call[0]).toBe("case-1");
    expect(call[1]).toBe("task-guide-1");
    expect(call[2]).toMatchObject({
      requestId: body.requestId,
      expectedTaskUpdatedAt: body.expectedTaskUpdatedAt,
      outcome: body.outcome,
      note: body.note,
      searchScope: body.searchScope,
      hypothesisDecision: {
        hypothesisId: body.hypothesisDecision.hypothesisId,
        status: body.hypothesisDecision.status,
        reason: body.hypothesisDecision.reason,
        expectedHypothesisUpdatedAt: body.hypothesisDecision.expectedHypothesisUpdatedAt
      }
    });
    expect(call[3]).toEqual({ archiveId: "archive-from-session" });
  });

  it("returns 400 instead of calling the store for an invalid outcome payload", async () => {
    const response = await postTaskOutcome(
      outcomeRequest({
        requestId: "",
        expectedTaskUpdatedAt: "not-a-timestamp",
        outcome: "proof",
        note: ""
      }),
      taskContext()
    );

    expect(response.status).toBe(400);
    expect(workspaceMocks.recordCaseTaskOutcome).not.toHaveBeenCalled();
  });

  it.each(["not_found", "already_tried"])(
    "returns 400 when %s omits its required search scope",
    async (outcome) => {
      const response = await postTaskOutcome(
        outcomeRequest({
          requestId: `request-${outcome}`,
          expectedTaskUpdatedAt: "2026-07-13T18:00:00.000Z",
          outcome,
          note: "The search did not locate the expected record."
        }),
        taskContext()
      );

      expect(response.status).toBe(400);
      expect(workspaceMocks.recordCaseTaskOutcome).not.toHaveBeenCalled();
    }
  );

  it("does not expose store or private case details in an unexpected error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    workspaceMocks.recordCaseTaskOutcome.mockRejectedValue(
      new Error("hypothesis hyp-private belongs to archive-secret; database password=hunter2")
    );

    const response = await postTaskOutcome(outcomeRequest(validOutcomeBody()), taskContext());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(body.error).toBeTruthy();
    expect(body.error).not.toContain("hyp-private");
    expect(body.error).not.toContain("archive-secret");
    expect(body.error).not.toContain("hunter2");
  });
});

describe("PATCH /api/cases/[id]/tasks/[taskId]", () => {
  it("requires the optimistic-lock timestamp", async () => {
    const response = await patchTask(
      jsonRequest("https://kinresolve.example/api/cases/case-1/tasks/task-guide-1", {
        status: "doing"
      }, "PATCH"),
      taskContext()
    );

    expect(response.status).toBe(400);
    expect(workspaceMocks.updateCaseTask).not.toHaveBeenCalled();
  });

  it("passes the required timestamp and session archive to the scoped store mutation", async () => {
    const response = await patchTask(
      jsonRequest("https://kinresolve.example/api/cases/case-1/tasks/task-guide-1", {
        status: "doing",
        expectedUpdatedAt: "2026-07-13T18:00:00.000Z"
      }, "PATCH"),
      taskContext()
    );

    expect(response.ok).toBe(true);
    expect(workspaceMocks.updateCaseTask).toHaveBeenCalledWith(
      "case-1",
      "task-guide-1",
      { status: "doing", expectedUpdatedAt: "2026-07-13T18:00:00.000Z" },
      { archiveId: "archive-from-session" }
    );
  });

  it("maps an active-assignment conflict to 409", async () => {
    workspaceMocks.updateCaseTask.mockRejectedValue(
      Object.assign(new Error("another assignment is already in progress"), { code: "ACTIVE_ASSIGNMENT_CONFLICT" })
    );

    const response = await patchTask(
      jsonRequest("https://kinresolve.example/api/cases/case-1/tasks/task-guide-1", {
        status: "doing",
        expectedUpdatedAt: "2026-07-13T18:00:00.000Z"
      }, "PATCH"),
      taskContext()
    );

    expect(response.status).toBe(409);
  });
});

describe("POST /api/cases/[id]/tasks", () => {
  it("keeps manual task creation available while the guide is disabled", async () => {
    const previousFlag = process.env.KINRESOLVE_GUIDED_RESEARCH_ENABLED;
    process.env.KINRESOLVE_GUIDED_RESEARCH_ENABLED = "false";

    try {
      const response = await postTask(
        jsonRequest("https://kinresolve.example/api/cases/case-1/tasks", {
          title: "A manual assignment"
        }),
        caseContext()
      );

      expect(response.status).toBe(201);
      expect(workspaceMocks.addCaseTask).toHaveBeenCalledWith(
        "case-1",
        { title: "A manual assignment" },
        { archiveId: "archive-from-session" }
      );
    } finally {
      restoreGuidedResearchFlag(previousFlag);
    }
  });

  it("maps a second active assignment to 409", async () => {
    workspaceMocks.addCaseTask.mockRejectedValue(
      Object.assign(new Error("another assignment is already in progress"), { code: "ACTIVE_ASSIGNMENT_CONFLICT" })
    );

    const response = await postTask(
      jsonRequest("https://kinresolve.example/api/cases/case-1/tasks", {
        title: "Start another assignment",
        status: "doing"
      }),
      caseContext()
    );

    expect(response.status).toBe(409);
  });
});

describe("manual task PATCH with the guide disabled", () => {
  it("keeps manual task completion available through the scoped store policy", async () => {
    const previousFlag = process.env.KINRESOLVE_GUIDED_RESEARCH_ENABLED;
    process.env.KINRESOLVE_GUIDED_RESEARCH_ENABLED = "false";

    try {
      const response = await patchTask(
        jsonRequest(
          "https://kinresolve.example/api/cases/case-1/tasks/task-guide-1",
          {
            status: "done",
            expectedUpdatedAt: "2026-07-13T18:00:00.000Z"
          },
          "PATCH"
        ),
        taskContext()
      );

      expect(response.ok).toBe(true);
      expect(workspaceMocks.updateCaseTask).toHaveBeenCalledWith(
        "case-1",
        "task-guide-1",
        { status: "done", expectedUpdatedAt: "2026-07-13T18:00:00.000Z" },
        {
          archiveId: "archive-from-session",
          allowManualCompletionWithoutOutcome: true
        }
      );
    } finally {
      restoreGuidedResearchFlag(previousFlag);
    }
  });

  it("still requires an outcome to complete a task while the guide is enabled", async () => {
    const previousFlag = process.env.KINRESOLVE_GUIDED_RESEARCH_ENABLED;
    process.env.KINRESOLVE_GUIDED_RESEARCH_ENABLED = "true";

    try {
      const response = await patchTask(
        jsonRequest(
          "https://kinresolve.example/api/cases/case-1/tasks/task-guide-1",
          {
            status: "done",
            expectedUpdatedAt: "2026-07-13T18:00:00.000Z"
          },
          "PATCH"
        ),
        taskContext()
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Record an outcome to complete a task" });
      expect(workspaceMocks.updateCaseTask).not.toHaveBeenCalled();
    } finally {
      restoreGuidedResearchFlag(previousFlag);
    }
  });
});

function assignmentRequest(body: unknown): Request {
  return jsonRequest("https://kinresolve.example/api/cases/case-1/guide/assignments", body);
}

function outcomeRequest(body: unknown): Request {
  return jsonRequest("https://kinresolve.example/api/cases/case-1/tasks/task-guide-1/outcome", body);
}

function jsonRequest(url: string, body: unknown, method: "POST" | "PATCH" = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function caseContext() {
  return { params: Promise.resolve({ id: "case-1" }) };
}

function taskContext() {
  return { params: Promise.resolve({ id: "case-1", taskId: "task-guide-1" }) };
}

function validOutcomeBody() {
  return {
    requestId: "request-outcome-1",
    expectedTaskUpdatedAt: "2026-07-13T18:00:00.000Z",
    outcome: "not_found",
    note: "Searched the fictional Lantern Bay probate index for 1890-1910 using both surname spellings.",
    searchScope: {
      repository: "Synthetic Lantern Bay Archive",
      collection: "Probate index",
      place: "Lantern Bay, Wisconsin",
      dateRange: "1890-1910",
      query: "Hartwell and Hartwel"
    },
    hypothesisDecision: {
      hypothesisId: "hyp-1",
      status: "weakened",
      reason: "The expected probate entry was not present in the searched index range.",
      expectedHypothesisUpdatedAt: "2026-07-13T17:30:00.000Z"
    }
  };
}

function restoreGuidedResearchFlag(previousFlag: string | undefined): void {
  if (previousFlag === undefined) {
    delete process.env.KINRESOLVE_GUIDED_RESEARCH_ENABLED;
    return;
  }
  process.env.KINRESOLVE_GUIDED_RESEARCH_ENABLED = previousFlag;
}
