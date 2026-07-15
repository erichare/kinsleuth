import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  runAIAnalysis: vi.fn()
}));
const workspaceMocks = vi.hoisted(() => ({
  createWorkspaceDnaHypotheses: vi.fn(),
  readWorkspace: vi.fn(),
  saveAIAnalysisRun: vi.fn()
}));

vi.mock("@/lib/ai", () => aiMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);
vi.mock("@/lib/auth-session", () => ({
  getSessionContext: vi.fn(async () => ({
    userId: "owner-1",
    email: "owner@example.test",
    name: "Owner",
    role: "owner",
    archiveId: "archive-pilot"
  }))
}));

import { POST } from "@/app/api/ai/analyze/route";

beforeEach(() => {
  vi.clearAllMocks();
  stubHostedPrivateBeta();
  vi.stubEnv("AI_API_KEY", "stray-provider-key");
  workspaceMocks.readWorkspace.mockResolvedValue({
    people: [{ id: "person-1" }],
    cases: [{ id: "case-1" }],
    sources: [{ id: "source-1" }],
    dnaMatches: [{ id: "dna-private" }]
  });
  workspaceMocks.createWorkspaceDnaHypotheses.mockReturnValue([{ matchId: "dna-private" }]);
  aiMocks.runAIAnalysis.mockResolvedValue({
    answer: "Recommendation: review the cited source.",
    status: "configuration_required",
    evidenceUsed: [],
    uncertainty: [],
    anomalies: [],
    suggestions: [],
    contextReferences: [],
    provider: "local",
    model: "deterministic",
    providerStatus: "not_configured",
    promptPreview: "Local checks"
  });
  workspaceMocks.saveAIAnalysisRun.mockResolvedValue({ id: "run-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hosted AI analysis route capabilities", () => {
  it("omits DNA and strips provider credentials while preserving local analysis", async () => {
    const response = await POST(new Request("https://app.kinresolve.com/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Which source should I verify?", caseId: "case-1" })
    }));

    expect(response.status).toBe(200);
    expect(aiMocks.runAIAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      dnaMatches: [],
      dnaHypotheses: [],
      provider: expect.objectContaining({ apiKey: undefined })
    }));
    expect(workspaceMocks.createWorkspaceDnaHypotheses).not.toHaveBeenCalled();
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({ archiveId: "archive-pilot" });
    expect(workspaceMocks.saveAIAnalysisRun).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "local" }),
      { archiveId: "archive-pilot" }
    );
  });
});

function stubHostedPrivateBeta() {
  const environment = {
    KINRESOLVE_DEPLOYMENT_MODE: "hosted",
    KINRESOLVE_DATASET_MODE: "pilot",
    KINRESOLVE_DNA_ENABLED: "false",
    KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
    KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
    KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
    KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
    KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
    KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
  } as const;
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
}
