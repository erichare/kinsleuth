import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceMocks = vi.hoisted(() => ({
  readWorkspace: vi.fn()
}));
const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  workspaceOptionsForSession: vi.fn((session: { archiveId: string }) => ({
    archiveId: session.archiveId
  }))
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import AppPersonPage from "@/app/app/people/[id]/page";
import { PersonCurationPanel } from "@/components/person-curation-panel";
import { createDemoAiRuns } from "@/lib/demo-ai-runs";
import { demoPeople } from "@/lib/demo-data";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue({
    kind: "member",
    userId: "owner-private-beta",
    email: "owner@example.test",
    name: "Owner",
    role: "owner",
    archiveId: "archive-private-beta"
  });
  workspaceMocks.readWorkspace.mockResolvedValue({
    archiveName: "Synthetic private archive",
    people: [{ ...demoPeople[0], published: true }]
  });
});

describe("person curation publishing capability", () => {
  it("does not offer publication for an unpublished profile when publishing is disabled", () => {
    const html = render(false, false);

    expect(html).not.toMatch(/<input\b[^>]*type="checkbox"/i);
    expect(html).not.toMatch(/>Published</i);
    expect(html).toMatch(/publishing is disabled/i);
  });

  it("keeps a one-way unpublish recovery action for an already-published profile", () => {
    const html = render(false, true);

    expect(html).toMatch(/remove from public archive/i);
    expect(html).not.toMatch(/<input\b[^>]*type="checkbox"/i);
  });

  it("preserves the publication checkbox when publishing is enabled", () => {
    const html = render(true, false);

    expect(html).toMatch(/<input\b[^>]*type="checkbox"/i);
    expect(html).toMatch(/Published/i);
  });

  it("labels a legacy published flag as private beta on the hosted person page", async () => {
    stubHostedPrivateBeta();

    const html = renderToStaticMarkup(await AppPersonPage({
      params: Promise.resolve({ id: demoPeople[0].id })
    }));

    expect(html).toMatch(/>Private beta</i);
    expect(html).toMatch(/Fictional demo archive/i);
    expect(html).not.toMatch(/>Published</i);
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({
      archiveId: "archive-private-beta"
    });
  });

  it("does not serialize DNA case evidence or saved answers when DNA is disabled", async () => {
    stubHostedPrivateBeta();
    const person = { ...demoPeople[0], published: true };
    workspaceMocks.readWorkspace.mockResolvedValue({
      archiveName: "Synthetic private archive",
      people: [person],
      sources: [],
      cases: [{
        id: "case-secret-dna",
        title: "Secret DNA case",
        question: "Does the DNA match connect this branch?",
        status: "active",
        focus: "DNA",
        privacy: "sensitive",
        hypotheses: [],
        tasks: [],
        evidence: [{
          id: "evidence-secret-dna",
          title: "Secret DNA match",
          type: "DNA",
          summary: "SECRET_DNA_SUMMARY",
          confidence: 0.8,
          linkedPersonId: person.id,
          linkedDnaMatchId: "dna-secret"
        }]
      }],
      aiRuns: [{
        id: "run-secret-dna",
        question: "Interpret the DNA match",
        answer: "SECRET_DNA_ANSWER",
        status: "ready",
        evidenceUsed: [],
        uncertainty: [],
        anomalyCount: 0,
        suggestions: [],
        contextReferences: [{ id: person.id, type: "person", label: person.displayName }],
        linkedCaseId: "case-secret-dna",
        createdAt: "2026-07-16T12:00:00.000Z"
      }]
    });

    const html = renderToStaticMarkup(await AppPersonPage({
      params: Promise.resolve({ id: person.id })
    }));

    expect(html).not.toContain("SECRET_DNA_SUMMARY");
    expect(html).not.toContain("SECRET_DNA_ANSWER");
  });

  it("shows only exact seeded demo analyses when DNA is disabled in demo mode", async () => {
    stubHostedPrivateBeta({ datasetMode: "demo", externalAi: true });
    const person = { ...demoPeople[0], published: true };
    const seededRun = createDemoAiRuns().find((run) =>
      run.contextReferences.some((reference) => reference.type === "person" && reference.id === person.id)
    );
    if (!seededRun) throw new Error("Missing Nora's seeded demo analysis");
    workspaceMocks.readWorkspace.mockResolvedValue({
      archiveName: "Synthetic demo archive",
      people: [person],
      sources: [],
      cases: [],
      aiRuns: [
        { ...seededRun, provider: "local", model: "local" },
        {
          ...seededRun,
          id: "run-arbitrary-demo-answer",
          answer: "ARBITRARY_DEMO_SAVED_ANSWER"
        }
      ]
    });

    const html = renderToStaticMarkup(await AppPersonPage({
      params: Promise.resolve({ id: person.id })
    }));

    expect(html).toContain("The box and its surviving contents cannot have traveled together in 1907");
    expect(html).not.toContain("ARBITRARY_DEMO_SAVED_ANSWER");
    expect(html).not.toContain("local · local");
  });

  it("keeps a saved local analysis while hiding provider metadata when external AI is disabled", async () => {
    stubHostedPrivateBeta({ dna: true });
    const person = { ...demoPeople[0], published: true };
    workspaceMocks.readWorkspace.mockResolvedValue({
      archiveName: "Synthetic private archive",
      people: [person],
      sources: [],
      cases: [],
      aiRuns: [{
        id: "run-stale-provider-details",
        question: "Review this profile",
        answer: "SAVED_LOCAL_ANALYSIS",
        status: "ready",
        evidenceUsed: [],
        uncertainty: [],
        anomalyCount: 0,
        suggestions: [],
        contextReferences: [{ id: person.id, type: "person", label: person.displayName }],
        provider: "SECRET_PROVIDER_HOST",
        model: "SECRET_PROVIDER_MODEL",
        providerStatus: "completed",
        createdAt: "2026-07-16T12:00:00.000Z"
      }]
    });

    const html = renderToStaticMarkup(await AppPersonPage({
      params: Promise.resolve({ id: person.id })
    }));

    expect(html).toContain("SAVED_LOCAL_ANALYSIS");
    expect(html).not.toContain("SECRET_PROVIDER_HOST");
    expect(html).not.toContain("SECRET_PROVIDER_MODEL");
  });
});

function render(publicPublishingEnabled: boolean, published: boolean): string {
  return renderToStaticMarkup(createElement(PersonCurationPanel, {
    person: { ...demoPeople[0], published },
    publicPublishingEnabled
  }));
}

function stubHostedPrivateBeta(overrides: {
  datasetMode?: "demo" | "pilot";
  dna?: boolean;
  externalAi?: boolean;
} = {}): void {
  const environment = {
    KINRESOLVE_DEPLOYMENT_MODE: "hosted",
    KINRESOLVE_DATASET_MODE: overrides.datasetMode ?? "pilot",
    KINRESOLVE_DNA_ENABLED: String(overrides.dna ?? false),
    KINRESOLVE_EXTERNAL_AI_ENABLED: String(overrides.externalAi ?? false),
    KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
    KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
    KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
    KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
    KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
  };
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
}
