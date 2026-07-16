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

import PublishingPage from "@/app/app/publishing/page";
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

describe("publishing readiness capability UI", () => {
  it("keeps readiness review but removes public links and launch claims in the hosted beta", async () => {
    stubHostedPrivateBeta();

    const html = await renderPage();

    expect(html).toMatch(/publication readiness/i);
    expect(html).toMatch(/readiness only/i);
    expect(html).toMatch(/public preview disabled/i);
    expect(html).not.toMatch(/href="\/people(?:\/|\")/i);
    expect(html).not.toMatch(/safe to publish/i);
    expect(html).not.toMatch(/>Published</i);
    expect(html).not.toMatch(/Keep published|Already public and ready|before publishing/i);
  });

  it("preserves the public index action for self-hosted deployments", async () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");

    const html = await renderPage();

    expect(html).toContain('href="/people"');
    expect(html).toMatch(/Public Index/i);
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({
      archiveId: "archive-private-beta"
    });
  });
});

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await PublishingPage({ searchParams: Promise.resolve({}) }));
}

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
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
}
