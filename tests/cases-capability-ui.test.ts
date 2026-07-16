import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  workspaceOptionsForSession: vi.fn((session: { archiveId: string }) => ({
    archiveId: session.archiveId
  }))
}));
const caseQueryMocks = vi.hoisted(() => ({
  caseEvidenceQueueFromDb: vi.fn(),
  searchCasesPageFromDb: vi.fn()
}));
const configMocks = vi.hoisted(() => ({ isGuidedResearchEnabled: vi.fn() }));
const navigationMocks = vi.hoisted(() => ({ notFound: vi.fn() }));
const peopleQueryMocks = vi.hoisted(() => ({ readArchiveBranding: vi.fn() }));
const workspaceMocks = vi.hoisted(() => ({ createNewCase: vi.fn(), readWorkspace: vi.fn() }));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => navigationMocks);
vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/guided-research-config", () => configMocks);
vi.mock("@/lib/store/case-queries", () => caseQueryMocks);
vi.mock("@/lib/store/people-queries", () => peopleQueryMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import { GET as getCases, POST as postCase } from "@/app/api/cases/route";
import CaseDetailPage from "@/app/app/cases/[id]/page";
import CasesPage from "@/app/app/cases/page";

const linkedEvidence = {
  id: "evidence-linked",
  caseId: "case-capability",
  caseTitle: "Archive trail",
  title: "Leaked genetic clue",
  type: "DNA",
  summary: "Leaked match summary",
  confidence: 0.2,
  linkedDnaMatchId: "dna-private"
};

const typedDnaEvidence = {
  id: "evidence-dna-analysis",
  caseId: "case-capability",
  caseTitle: "Archive trail",
  title: "Leaked cluster estimate",
  type: "  DNA analysis",
  summary: "Leaked relationship-range summary",
  confidence: 0.4
};

const documentaryEvidence = {
  id: "evidence-documentary",
  caseId: "case-capability",
  caseTitle: "Archive trail",
  title: "Parish register",
  type: "Vital record",
  summary: "Documentary evidence remains visible.",
  confidence: 0.8
};

const dnaCaseEvidence = {
  id: "evidence-dna-case-documentary",
  caseId: "case-northstar-dna-cluster",
  caseTitle: "The fictional Northstar Cove DNA cluster",
  title: "Rowan sibling register",
  type: "Vital record",
  summary: "A record nested inside a DNA-focused case.",
  confidence: 0.9
};

const dnaResearchCase = {
  id: "case-northstar-dna-cluster",
  title: "The fictional Northstar Cove DNA cluster",
  question: "Do the invented matches connect through Maeve Rowan Mercer's family?",
  status: "active" as const,
  focus: "Invented Mercer–Rowan DNA matches",
  privacy: "sensitive" as const,
  hypotheses: [],
  evidence: [
    {
      id: dnaCaseEvidence.id,
      title: dnaCaseEvidence.title,
      type: dnaCaseEvidence.type,
      summary: dnaCaseEvidence.summary,
      confidence: dnaCaseEvidence.confidence
    }
  ],
  tasks: []
};

const researchCase = {
  id: "case-capability",
  title: "Archive trail",
  question: "Which documentary record resolves this identity?",
  status: "active" as const,
  focus: "Parish and census records",
  privacy: "private" as const,
  hypotheses: [],
  evidence: [
    {
      id: linkedEvidence.id,
      title: linkedEvidence.title,
      type: linkedEvidence.type,
      summary: linkedEvidence.summary,
      confidence: linkedEvidence.confidence,
      linkedDnaMatchId: linkedEvidence.linkedDnaMatchId
    },
    {
      id: typedDnaEvidence.id,
      title: typedDnaEvidence.title,
      type: typedDnaEvidence.type,
      summary: typedDnaEvidence.summary,
      confidence: typedDnaEvidence.confidence
    },
    {
      id: documentaryEvidence.id,
      title: documentaryEvidence.title,
      type: documentaryEvidence.type,
      summary: documentaryEvidence.summary,
      confidence: documentaryEvidence.confidence
    }
  ],
  tasks: []
};

const caseResult = {
  items: [
    {
      id: researchCase.id,
      title: researchCase.title,
      question: researchCase.question,
      status: researchCase.status,
      privacy: researchCase.privacy,
      focus: researchCase.focus,
      hypothesisCount: 2,
      evidenceCount: 3,
      dnaEvidenceCount: 2,
      taskCount: 2,
      openTaskCount: 1,
      weakestEvidenceConfidence: 0.2
    },
    {
      id: dnaResearchCase.id,
      title: dnaResearchCase.title,
      question: dnaResearchCase.question,
      status: dnaResearchCase.status,
      privacy: dnaResearchCase.privacy,
      focus: dnaResearchCase.focus,
      hypothesisCount: 0,
      evidenceCount: 1,
      dnaEvidenceCount: 0,
      taskCount: 0,
      openTaskCount: 0,
      weakestEvidenceConfidence: 0.9
    }
  ],
  page: 1,
  pageSize: 25,
  pageCount: 1,
  total: 2,
  start: 1,
  end: 2,
  stats: {
    total: 2,
    active: 2,
    planning: 0,
    resolved: 0,
    evidenceItems: 4,
    dnaEvidence: 2,
    lowConfidenceEvidence: 2
  }
};

let dnaMatchesReadCount = 0;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  dnaMatchesReadCount = 0;

  navigationMocks.notFound.mockImplementation(() => {
    throw Object.assign(new Error("Case not found"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404"
    });
  });

  authMocks.getSessionContext.mockResolvedValue({
    kind: "member",
    userId: "owner-capability",
    email: "owner@example.test",
    name: "Owner",
    role: "owner",
    archiveId: "archive-capability"
  });
  configMocks.isGuidedResearchEnabled.mockReturnValue(false);
  peopleQueryMocks.readArchiveBranding.mockResolvedValue({ name: "Synthetic archive", tagline: "" });
  caseQueryMocks.searchCasesPageFromDb.mockResolvedValue(caseResult);
  caseQueryMocks.caseEvidenceQueueFromDb.mockResolvedValue([
    linkedEvidence,
    typedDnaEvidence,
    documentaryEvidence,
    dnaCaseEvidence
  ]);
  workspaceMocks.createNewCase.mockResolvedValue(dnaResearchCase);
  workspaceMocks.readWorkspace.mockImplementation(async () => ({
    archiveName: "Synthetic archive",
    cases: [researchCase, dnaResearchCase],
    get dnaMatches() {
      dnaMatchesReadCount += 1;
      return [{ id: "dna-private", displayName: "Leaked match name" }];
    }
  }));
});

describe("case workspace DNA capability boundary", () => {
  it("omits DNA metrics, filters, counts, badges, and linked evidence from the hosted cases page", async () => {
    stubHostedPrivateBeta();

    const html = renderToStaticMarkup(await CasesPage());

    expect(html).not.toMatch(/DNA/i);
    expect(html).not.toContain(linkedEvidence.title);
    expect(html).not.toContain(linkedEvidence.summary);
    expect(html).not.toContain(typedDnaEvidence.title);
    expect(html).not.toContain(typedDnaEvidence.summary);
    expect(html).not.toContain(dnaResearchCase.title);
    expect(html).not.toContain(dnaResearchCase.question);
    expect(html).not.toContain(dnaResearchCase.focus);
    expect(html).not.toContain("<th>Tasks</th>");
    expect(html).toContain(documentaryEvidence.title);
  });

  it("removes linked-DNA evidence and counts from hosted cases API projections", async () => {
    stubHostedPrivateBeta();

    const casesResponse = await getCases(
      new Request("https://app.kinresolve.com/api/cases?evidence=dna")
    );
    const cases = await casesResponse.json();
    const queueResponse = await getCases(
      new Request("https://app.kinresolve.com/api/cases?view=evidence-queue")
    );
    const queue = await queueResponse.json();

    expect(cases.items[0]).toMatchObject({
      hypothesisCount: 0,
      evidenceCount: 1,
      dnaEvidenceCount: 0,
      taskCount: 0,
      openTaskCount: 0
    });
    expect(cases.items[0].weakestEvidenceConfidence).toBeUndefined();
    expect(cases.items).toHaveLength(1);
    expect(cases.total).toBe(1);
    expect(cases.stats).toMatchObject({
      evidenceItems: 1,
      dnaEvidence: 0
    });
    expect(caseQueryMocks.searchCasesPageFromDb).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: "all" }),
      expect.any(Object),
      {
        archiveId: "archive-capability",
        includeDnaEvidence: false
      }
    );
    expect(queue).toEqual([documentaryEvidence]);
  });

  it("does not read DNA matches or render linked-DNA evidence on a hosted case detail", async () => {
    stubHostedPrivateBeta();

    const html = renderToStaticMarkup(
      await CaseDetailPage({ params: Promise.resolve({ id: researchCase.id }) })
    );

    expect(dnaMatchesReadCount).toBe(0);
    expect(html).not.toContain(linkedEvidence.title);
    expect(html).not.toContain(linkedEvidence.summary);
    expect(html).not.toContain(typedDnaEvidence.title);
    expect(html).not.toContain(typedDnaEvidence.summary);
    expect(html).not.toMatch(/DNA linked|Linked match|Leaked match name/i);
    expect(html).toContain(documentaryEvidence.title);
    expect(html).toContain(documentaryEvidence.summary);
  });

  it("returns not found for a whole DNA research case in the hosted workspace", async () => {
    stubHostedPrivateBeta();

    await expect(
      CaseDetailPage({ params: Promise.resolve({ id: dnaResearchCase.id }) })
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404")
    });

    expect(navigationMocks.notFound).toHaveBeenCalledOnce();
    expect(dnaMatchesReadCount).toBe(0);
  });

  it("rejects creating a whole DNA research case before persisting it", async () => {
    stubHostedPrivateBeta();

    const response = await postCase(new Request("https://app.kinresolve.com/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: dnaResearchCase.title,
        question: dnaResearchCase.question,
        focus: dnaResearchCase.focus
      })
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(workspaceMocks.createNewCase).not.toHaveBeenCalled();
  });

  it("preserves linked-DNA cases and detail evidence for self-hosted deployments", async () => {
    stubSelfHosted();

    const casesHtml = renderToStaticMarkup(await CasesPage());
    const detailHtml = renderToStaticMarkup(
      await CaseDetailPage({ params: Promise.resolve({ id: researchCase.id }) })
    );

    expect(casesHtml).toMatch(/DNA linked/i);
    expect(casesHtml).toContain(linkedEvidence.title);
    expect(casesHtml).toContain(typedDnaEvidence.title);
    expect(casesHtml).toContain(dnaResearchCase.title);
    expect(casesHtml).toContain("Do the invented matches connect through Maeve Rowan");
    expect(casesHtml).toContain(dnaResearchCase.focus);
    expect(detailHtml).toMatch(/DNA linked/i);
    expect(detailHtml).toContain(linkedEvidence.title);
    expect(detailHtml).toContain(linkedEvidence.summary);
    expect(detailHtml).toContain(typedDnaEvidence.title);
    expect(detailHtml).toContain(typedDnaEvidence.summary);
    expect(detailHtml).toContain("Leaked match name");
    expect(dnaMatchesReadCount).toBe(1);
  });
});

function stubHostedPrivateBeta(): void {
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
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
}

function stubSelfHosted(): void {
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
}
