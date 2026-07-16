import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completePublicDemoAiAttempt: vi.fn(),
  readWorkspace: vi.fn(),
  recordPublicDemoEvent: vi.fn(),
  reservePublicDemoAiAttempt: vi.fn(),
  runAIAnalysis: vi.fn(),
  saveAIAnalysisRun: vi.fn()
}));

vi.mock("@/lib/api-authorization", () => ({
  withDemoGuestCapability: (
    capability: string,
    handler: (request: Request, context: Record<string, unknown>) => Promise<Response>
  ) => {
    expect(capability).toBe("demo:ai");
    return (request: Request) => handler(request, {
      archiveId: "demo-archive-alpha",
      expiresAt: "2026-07-17T16:00:00.000Z",
      generation: 1,
      kind: "demo-guest",
      requestId: "request-demo-ai",
      sessionId: "11111111-1111-4111-8111-111111111111"
    });
  }
}));
vi.mock("@/lib/ai", () => ({ runAIAnalysis: mocks.runAIAnalysis }));
vi.mock("@/lib/hosted-capabilities", () => ({
  resolveHostedCapabilities: () => ({ dna: true, externalAi: true })
}));
vi.mock("@/lib/public-demo-session-store", () => ({
  completePublicDemoAiAttempt: mocks.completePublicDemoAiAttempt,
  recordPublicDemoEvent: mocks.recordPublicDemoEvent,
  reservePublicDemoAiAttempt: mocks.reservePublicDemoAiAttempt
}));
vi.mock("@/lib/workspace-store", () => ({
  createWorkspaceDnaHypotheses: () => [],
  readWorkspace: mocks.readWorkspace,
  saveAIAnalysisRun: mocks.saveAIAnalysisRun
}));

import { POST } from "@/app/api/demo/ai/route";
import { publicDemoAiPrompts } from "@/lib/public-demo-ai-policy";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readWorkspace.mockResolvedValue(workspace());
  mocks.reservePublicDemoAiAttempt.mockResolvedValue({
    attemptId: "22222222-2222-4222-8222-222222222222",
    remaining: 2
  });
  mocks.completePublicDemoAiAttempt.mockResolvedValue(undefined);
  mocks.recordPublicDemoEvent.mockResolvedValue(undefined);
  mocks.runAIAnalysis.mockResolvedValue(providerResult());
  mocks.saveAIAnalysisRun.mockImplementation(async (input) => ({
    id: "ai-demo-1",
    createdAt: "2026-07-16T16:05:00.000Z",
    completedAt: "2026-07-16T16:05:01.000Z",
    ...input
  }));
});

describe("POST /api/demo/ai", () => {
  it("rejects arbitrary prompts and unknown fields before reserving an attempt", async () => {
    for (const body of [
      { question: "Tell me anything" },
      { questionId: "case_next_steps", extra: "persist me" },
      { questionId: "invented_prompt" }
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }

    expect(mocks.reservePublicDemoAiAttempt).not.toHaveBeenCalled();
    expect(mocks.runAIAnalysis).not.toHaveBeenCalled();
  });

  it("requires the guided outcome before debiting a curated attempt", async () => {
    mocks.readWorkspace.mockResolvedValue(workspace({ guideCompleted: false }));

    const response = await POST(request({
      caseId: "case-mercer-march-identity",
      questionId: "case_next_steps"
    }));

    expect(response.status).toBe(409);
    expect(mocks.reservePublicDemoAiAttempt).not.toHaveBeenCalled();
  });

  it("uses only the server-owned prompt, archive context, timeout, and output limit", async () => {
    const response = await POST(request({
      caseId: "case-mercer-march-identity",
      questionId: "case_next_steps"
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      analysis: {
        answer: "Provider-grounded fictional next steps.",
        fallback: false
      },
      remainingAiAttempts: 2
    });
    expect(mocks.readWorkspace).toHaveBeenCalledExactlyOnceWith({
      archiveId: "demo-archive-alpha"
    });
    expect(mocks.reservePublicDemoAiAttempt).toHaveBeenCalledExactlyOnceWith({
      promptId: "case_next_steps",
      sessionId: "11111111-1111-4111-8111-111111111111"
    });
    expect(mocks.runAIAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      provider: expect.objectContaining({
        maximumOutputTokens: 800,
        timeoutMs: 20_000
      }),
      question: publicDemoAiPrompts.case_next_steps,
      role: "owner",
      selectedCaseId: "case-mercer-march-identity"
    }));
    expect(mocks.reservePublicDemoAiAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runAIAnalysis.mock.invocationCallOrder[0]!
    );
    expect(mocks.saveAIAnalysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        question: publicDemoAiPrompts.case_next_steps
      }),
      { archiveId: "demo-archive-alpha" }
    );
    expect(mocks.completePublicDemoAiAttempt).toHaveBeenCalledWith({
      attemptId: "22222222-2222-4222-8222-222222222222",
      outcome: "completed"
    });
  });

  it("returns a labeled deterministic fallback without provider diagnostics and does not refund", async () => {
    mocks.runAIAnalysis.mockResolvedValue({
      ...providerResult(),
      answer: "Safe deterministic fictional analysis.",
      error: "provider-private-diagnostic",
      provider: "private-provider.example",
      providerStatus: "failed",
      status: "provider_error",
      uncertainty: ["Provider call failed: provider-private-diagnostic"]
    });

    const response = await POST(request({
      caseId: "case-mercer-march-identity",
      questionId: "evidence_gaps"
    }));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(serialized).toContain('"fallback":true');
    expect(serialized).toContain("Safe deterministic fictional analysis.");
    expect(serialized).not.toMatch(/provider-private-diagnostic|private-provider\.example/);
    expect(mocks.completePublicDemoAiAttempt).toHaveBeenCalledWith({
      attemptId: "22222222-2222-4222-8222-222222222222",
      outcome: "failed"
    });
  });
});

function request(body: Record<string, unknown>): Request {
  return new Request("https://demo.kinresolve.com/api/demo/ai", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
}

function workspace(input: { guideCompleted?: boolean } = {}) {
  const guideCompleted = input.guideCompleted ?? true;
  return {
    people: [],
    sources: [],
    dnaMatches: [],
    cases: [{
      id: "case-mercer-march-identity",
      title: "The Mercer–March passenger mystery",
      question: "Are the fictional travelers the same person?",
      status: "active",
      focus: "Fictional signatures",
      privacy: "private",
      hypotheses: [],
      evidence: [],
      tasks: [{
        id: "task-compare-signatures",
        title: "Compare signatures",
        status: guideCompleted ? "done" : "doing",
        origin: "manual",
        priority: "high",
        contextRefs: [],
        ...(guideCompleted ? { outcomes: [{ id: "outcome-demo" }] } : {})
      }]
    }]
  };
}

function providerResult() {
  return {
    anomalies: [],
    answer: "Provider-grounded fictional next steps.",
    contextReferences: [],
    evidenceUsed: [],
    model: "gpt-5-mini",
    promptPreview: "server prompt preview",
    provider: "api.openai.com",
    providerStatus: "completed",
    status: "ready",
    suggestions: [],
    uncertainty: ["Fictional evidence only."]
  };
}
