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
    expect(html).not.toMatch(/>Published</i);
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({
      archiveId: "archive-private-beta"
    });
  });
});

function render(publicPublishingEnabled: boolean, published: boolean): string {
  return renderToStaticMarkup(createElement(PersonCurationPanel, {
    person: { ...demoPeople[0], published },
    publicPublishingEnabled
  }));
}

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
