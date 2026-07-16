import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capabilities: [] as string[],
  readResearchCase: vi.fn(),
  recordCaseTaskOutcome: vi.fn(),
  updateCaseHypothesis: vi.fn(),
  recordPublicDemoEvent: vi.fn(),
  runSampleImport: vi.fn()
}));

vi.mock("@/lib/api-authorization", () => ({
  withDemoGuestCapability: (
    capability: string,
    handler: (request: Request, guest: object, route?: object) => Promise<Response>
  ) => {
    mocks.capabilities.push(capability);
    return (request: Request, route?: object) => handler(request, {
      kind: "demo-guest",
      sessionId: "session-demo",
      archiveId: "archive-demo-private",
      generation: 2,
      expiresAt: "2026-07-17T12:00:00.000Z",
      requestId: "request-demo"
    }, route);
  }
}));

vi.mock("@/lib/workspace-store", () => ({
  readResearchCase: mocks.readResearchCase,
  recordCaseTaskOutcome: mocks.recordCaseTaskOutcome,
  updateCaseHypothesis: mocks.updateCaseHypothesis
}));

vi.mock("@/lib/public-demo-session-store", () => ({
  recordPublicDemoEvent: mocks.recordPublicDemoEvent
}));

vi.mock("@/lib/public-demo-sample-import", () => ({
  publicDemoSampleFixtureId: "hartwell-mercer-sample-v1",
  runPublicDemoSampleImport: mocks.runSampleImport
}));

function jsonRequest(pathname: string, body: unknown): Request {
  return new Request(`https://demo.kinresolve.com${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("public demo command routes", () => {
  beforeEach(() => {
    mocks.readResearchCase.mockReset();
    mocks.recordCaseTaskOutcome.mockReset();
    mocks.updateCaseHypothesis.mockReset();
    mocks.recordPublicDemoEvent.mockReset();
    mocks.runSampleImport.mockReset();
    mocks.readResearchCase.mockResolvedValue({
      id: "case-mercer-march-identity",
      tasks: [{
        id: "task-compare-signatures",
        status: "doing",
        updatedAt: "2026-07-16T12:00:00.000Z"
      }],
      hypotheses: [{
        id: "hyp-mercer-march-same",
        status: "open",
        updatedAt: "2026-07-16T12:00:00.000Z"
      }]
    });
    mocks.recordCaseTaskOutcome.mockResolvedValue({
      task: { id: "task-compare-signatures", status: "done" }
    });
    mocks.updateCaseHypothesis.mockResolvedValue({
      hypothesis: { id: "hyp-mercer-march-same", status: "supported" }
    });
    mocks.runSampleImport.mockResolvedValue({ action: "review", fixtureId: "hartwell-mercer-sample-v1" });
  });

  it("records only the fixed guided outcome in the guest archive", async () => {
    const { POST } = await import("@/app/api/demo/cases/[caseId]/guide/route");
    const response = await POST(
      jsonRequest("/api/demo/cases/case-mercer-march-identity/guide", {
        command: "record_outcome",
        outcome: "found"
      }),
      { params: Promise.resolve({ caseId: "case-mercer-march-identity" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.recordCaseTaskOutcome).toHaveBeenCalledWith(
      "case-mercer-march-identity",
      "task-compare-signatures",
      expect.objectContaining({
        outcome: "found",
        expectedTaskUpdatedAt: "2026-07-16T12:00:00.000Z",
        actorId: "demo:session-demo",
        actorName: "Demo Guest",
        note: expect.stringMatching(/fictional signatures/i)
      }),
      { archiveId: "archive-demo-private" }
    );
    expect(mocks.recordPublicDemoEvent).toHaveBeenCalledWith({
      sessionId: "session-demo",
      eventName: "outcome_completed"
    });
  });

  it("rejects unknown guide fields instead of persisting visitor prose", async () => {
    const { POST } = await import("@/app/api/demo/cases/[caseId]/guide/route");
    const response = await POST(
      jsonRequest("/api/demo/cases/case-mercer-march-identity/guide", {
        command: "record_outcome",
        outcome: "found",
        note: "visitor supplied prose"
      }),
      { params: Promise.resolve({ caseId: "case-mercer-march-identity" }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.recordCaseTaskOutcome).not.toHaveBeenCalled();
  });

  it("records a fixed hypothesis decision without accepting a visitor reason", async () => {
    const { POST } = await import("@/app/api/demo/cases/[caseId]/guide/route");
    const response = await POST(
      jsonRequest("/api/demo/cases/case-mercer-march-identity/guide", {
        command: "hypothesis_decision",
        decision: "supported"
      }),
      { params: Promise.resolve({ caseId: "case-mercer-march-identity" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.updateCaseHypothesis).toHaveBeenCalledWith(
      "case-mercer-march-identity",
      "hyp-mercer-march-same",
      expect.objectContaining({
        status: "supported",
        reason: expect.stringMatching(/fictional signature/i),
        actorId: "demo:session-demo"
      }),
      { archiveId: "archive-demo-private" }
    );
  });

  it("runs only the named bundled GEDCOM operation in the guest archive", async () => {
    const { POST } = await import("@/app/api/demo/sample-import/route");
    const response = await POST(jsonRequest("/api/demo/sample-import", {
      fixtureId: "hartwell-mercer-sample-v1",
      action: "review"
    }));

    expect(response.status).toBe(200);
    expect(mocks.runSampleImport).toHaveBeenCalledWith(
      "review",
      "hartwell-mercer-sample-v1",
      { archiveId: "archive-demo-private" }
    );
  });

  it("stores fixed feedback fields and rejects additional data", async () => {
    const { POST } = await import("@/app/api/demo/feedback/route");
    const accepted = await POST(jsonRequest("/api/demo/feedback", {
      usefulness: 5,
      clarity: 4,
      featureInterest: "sources",
      betaInterest: true
    }));
    const rejected = await POST(jsonRequest("/api/demo/feedback", {
      usefulness: 5,
      clarity: 4,
      featureInterest: "sources",
      betaInterest: true,
      email: "somebody@example.test"
    }));

    expect(accepted.status).toBe(201);
    expect(rejected.status).toBe(400);
    expect(mocks.recordPublicDemoEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordPublicDemoEvent).toHaveBeenCalledWith({
      sessionId: "session-demo",
      eventName: "feedback_submitted",
      feedback: {
        usefulness: 5,
        clarity: 4,
        featureInterest: "sources",
        betaInterest: true
      }
    });
  });

  it("uses a dedicated capability for every command route", async () => {
    await Promise.all([
      import("@/app/api/demo/cases/[caseId]/guide/route"),
      import("@/app/api/demo/sample-import/route"),
      import("@/app/api/demo/feedback/route")
    ]);

    expect(mocks.capabilities).toEqual(expect.arrayContaining([
      "demo:guide",
      "demo:sample-import",
      "demo:feedback"
    ]));
  });
});
