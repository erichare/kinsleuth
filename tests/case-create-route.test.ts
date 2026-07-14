import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

const workspaceMocks = vi.hoisted(() => ({
  createCase: vi.fn(),
  createNewCase: vi.fn()
}));

vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import { POST } from "@/app/api/cases/route";

const editorSession = {
  userId: "editor-case-create",
  email: "editor@example.test",
  name: "Case Editor",
  role: "editor" as const,
  archiveId: "archive-from-session"
};

beforeEach(() => {
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue(editorSession);
  workspaceMocks.createCase.mockResolvedValue({ id: "legacy-case" });
  workspaceMocks.createNewCase.mockResolvedValue({
    id: "case-server-generated",
    title: "A bounded identity question"
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/cases", () => {
  it("requires an authenticated archive member", async () => {
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await POST(caseRequest(validCaseInput()));

    expect(response.status).toBe(401);
    expect(workspaceMocks.createCase).not.toHaveBeenCalled();
    expect(workspaceMocks.createNewCase).not.toHaveBeenCalled();
  });

  it("denies a viewer without cases:write", async () => {
    authMocks.getSessionContext.mockResolvedValue({
      ...editorSession,
      userId: "viewer-case-create",
      role: "viewer"
    });

    const response = await POST(caseRequest(validCaseInput()));

    expect(response.status).toBe(403);
    expect(workspaceMocks.createCase).not.toHaveBeenCalled();
    expect(workspaceMocks.createNewCase).not.toHaveBeenCalled();
  });

  it("rejects archive ownership, ids, tasks, histories, and guide metadata supplied by the client", async () => {
    const response = await POST(
      caseRequest({
        ...validCaseInput(),
        id: "case-existing-private",
        archiveId: "archive-forged",
        tasks: [
          {
            id: "task-forged",
            title: "Forged completed guide task",
            status: "done",
            origin: "guide",
            guideKey: "guide:forged",
            outcomes: [{ actorName: "Forged Researcher" }]
          }
        ],
        hypotheses: [
          {
            id: "hyp-existing-private",
            statement: "A forged historical conclusion.",
            confidence: 1,
            status: "rejected",
            updatedAt: "2026-07-13T00:00:00.000Z",
            decisions: [{ actorId: "owner", actorName: "Forged Owner" }]
          }
        ]
      })
    );

    expect(response.status).toBe(400);
    expect(workspaceMocks.createCase).not.toHaveBeenCalled();
    expect(workspaceMocks.createNewCase).not.toHaveBeenCalled();
  });

  it("creates only the strict new-case DTO in the session archive", async () => {
    const input = validCaseInput();

    const response = await POST(caseRequest(input));

    expect(response.status).toBe(201);
    expect(workspaceMocks.createCase).not.toHaveBeenCalled();
    expect(workspaceMocks.createNewCase).toHaveBeenCalledWith(input, {
      archiveId: "archive-from-session"
    });
  });

  it("maps an insert conflict to 409 without exposing database details", async () => {
    workspaceMocks.createNewCase.mockRejectedValue(
      Object.assign(new Error("duplicate key value violates unique constraint research_cases_pkey"), {
        code: "23505"
      })
    );

    const response = await POST(caseRequest(validCaseInput()));
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/could not be created|already exists/i);
    expect(body.error).not.toContain("research_cases_pkey");
  });

  it("returns a safe 500 response for unexpected store failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    workspaceMocks.createNewCase.mockRejectedValue(
      new Error("postgres://researcher:secret-password@db.internal/private-family")
    );

    const response = await POST(caseRequest(validCaseInput()));
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe("Unable to create the case");
    expect(body.error).not.toContain("secret-password");
  });
});

function validCaseInput() {
  return {
    title: "A bounded identity question",
    question: "Do these two fictional records describe the same person?",
    focus: "Compare independent identifiers",
    hypotheses: [
      {
        statement: "The two fictional records describe the same person.",
        confidence: 0.45
      }
    ],
    evidence: [
      {
        title: "Initial evidence note",
        type: "Research note",
        summary: "Two signatures share an unusual final stroke.",
        confidence: 0.5
      }
    ]
  };
}

function caseRequest(body: unknown): Request {
  return new Request("https://kinresolve.example/api/cases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
