import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

const workspaceMocks = vi.hoisted(() => ({
  updateCaseHypothesis: vi.fn()
}));

vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import { PATCH } from "@/app/api/cases/[id]/hypotheses/[hypothesisId]/route";

const editorSession = {
  userId: "editor-hypothesis",
  email: "editor@example.test",
  name: "Hypothesis Editor",
  role: "editor" as const,
  archiveId: "archive-from-session"
};

const expectedUpdatedAt = "2026-07-13T18:00:00.000Z";

beforeEach(() => {
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue(editorSession);
  workspaceMocks.updateCaseHypothesis.mockResolvedValue({
    hypothesis: { id: "hyp-1", status: "supported" }
  });
});

describe("PATCH /api/cases/[id]/hypotheses/[hypothesisId]", () => {
  it.each([
    ["statement", { statement: "A changed statement." }],
    ["confidence", { confidence: 0.9 }]
  ])("rejects a status decision combined with a %s edit", async (_label, edit) => {
    const response = await PATCH(
      request({
        ...edit,
        expectedUpdatedAt,
        requestId: "request-decision-1",
        status: "supported",
        reason: "Two independent records agree."
      }),
      context()
    );

    expect(response.status).toBe(400);
    expect(workspaceMocks.updateCaseHypothesis).not.toHaveBeenCalled();
  });

  it("accepts a decision-only mutation and derives its actor and archive from the session", async () => {
    const response = await PATCH(
      request({
        expectedUpdatedAt,
        requestId: "request-decision-1",
        status: "supported",
        reason: "Two independent records agree."
      }),
      context()
    );

    expect(response.ok).toBe(true);
    expect(workspaceMocks.updateCaseHypothesis).toHaveBeenCalledWith(
      "case-1",
      "hyp-1",
      {
        expectedUpdatedAt,
        requestId: "request-decision-1",
        status: "supported",
        reason: "Two independent records agree.",
        actorId: editorSession.userId,
        actorName: editorSession.name
      },
      { archiveId: editorSession.archiveId }
    );
  });

  it("accepts an edit-only mutation without a decision request id", async () => {
    const response = await PATCH(
      request({
        statement: "A narrower, testable statement.",
        confidence: 0.6,
        expectedUpdatedAt
      }),
      context()
    );

    expect(response.ok).toBe(true);
    expect(workspaceMocks.updateCaseHypothesis).toHaveBeenCalledWith(
      "case-1",
      "hyp-1",
      {
        statement: "A narrower, testable statement.",
        confidence: 0.6,
        expectedUpdatedAt,
        actorId: editorSession.userId,
        actorName: editorSession.name
      },
      { archiveId: editorSession.archiveId }
    );
  });
});

function request(body: unknown): Request {
  return new Request("https://kinresolve.example/api/cases/case-1/hypotheses/hyp-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function context() {
  return { params: Promise.resolve({ id: "case-1", hypothesisId: "hyp-1" }) };
}
