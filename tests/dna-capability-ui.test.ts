import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  workspaceOptionsForSession: vi.fn((session: { archiveId: string }) => ({
    archiveId: session.archiveId
  }))
}));
const dnaQueryMocks = vi.hoisted(() => ({
  createDnaHypothesesForMatches: vi.fn(),
  listCaseOptions: vi.fn(),
  searchDnaMatchesPageFromDb: vi.fn()
}));
const navigationMocks = vi.hoisted(() => ({
  notFound: vi.fn()
}));
const peopleQueryMocks = vi.hoisted(() => ({
  readArchiveBranding: vi.fn()
}));

vi.mock("@/lib/store/dna-queries", () => dnaQueryMocks);
vi.mock("@/lib/store/people-queries", () => peopleQueryMocks);
vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => navigationMocks);

import DnaPage from "@/app/app/dna/page";
import { AppShell } from "@/components/app-shell";

type AppShellProps = Parameters<typeof AppShell>[0];
const AppShellWithElementChildren = AppShell as (
  props: Omit<AppShellProps, "children">
) => ReturnType<typeof AppShell>;

const capabilitySettings = {
  KINRESOLVE_DNA_ENABLED: "false",
  KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
  KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
  KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
  KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
  KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
  KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
} as const;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue({
    kind: "member",
    userId: "owner-capability",
    email: "owner@example.test",
    name: "Owner",
    role: "owner",
    archiveId: "archive-default"
  });
  navigationMocks.notFound.mockImplementation(() => {
    throw Object.assign(new Error("DNA workspace not found"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404"
    });
  });
  peopleQueryMocks.readArchiveBranding.mockResolvedValue({ name: "Synthetic archive", tagline: "" });
  dnaQueryMocks.searchDnaMatchesPageFromDb.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 25,
    totalPages: 1
  });
  dnaQueryMocks.listCaseOptions.mockResolvedValue([]);
  dnaQueryMocks.createDnaHypothesesForMatches.mockResolvedValue([]);
});

describe("DNA workspace capability UI", () => {
  it("hides DNA navigation throughout a hosted deployment when DNA is disabled", () => {
    stubHostedCapabilities();

    const html = renderToStaticMarkup(createElement(
      AppShellWithElementChildren,
      { title: "Dashboard", archiveName: "Synthetic archive" },
      createElement("p", null, "Private dashboard")
    ));

    expect(html).not.toContain('href="/app/dna"');
    expect(html).not.toMatch(/DNA Matches/i);
    expect(html).not.toMatch(/>Publishing</i);
    expect(html.match(/>Readiness</g)).toHaveLength(2);
  });

  it("short-circuits the direct DNA page before any private data read when DNA is disabled", async () => {
    stubHostedCapabilities();

    await expect(DnaPage()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404")
    });

    expect(navigationMocks.notFound).toHaveBeenCalledOnce();
    expect(peopleQueryMocks.readArchiveBranding).not.toHaveBeenCalled();
    expect(dnaQueryMocks.searchDnaMatchesPageFromDb).not.toHaveBeenCalled();
    expect(dnaQueryMocks.listCaseOptions).not.toHaveBeenCalled();
    expect(dnaQueryMocks.createDnaHypothesesForMatches).not.toHaveBeenCalled();
  });

  it("preserves DNA navigation and page loading for self-hosted deployments", async () => {
    stubSelfHostedCapabilities();

    const html = renderToStaticMarkup(createElement(
      AppShellWithElementChildren,
      { title: "Dashboard", archiveName: "Synthetic archive" },
      createElement("p", null, "Private dashboard")
    ));
    expect(html.match(/href="\/app\/dna"/g)).toHaveLength(2);
    expect(html.match(/>Publishing</g)).toHaveLength(2);

    await expect(DnaPage()).resolves.toBeDefined();
    expect(navigationMocks.notFound).not.toHaveBeenCalled();
    expect(peopleQueryMocks.readArchiveBranding).toHaveBeenCalledOnce();
    expect(dnaQueryMocks.searchDnaMatchesPageFromDb).toHaveBeenCalledOnce();
    expect(dnaQueryMocks.listCaseOptions).toHaveBeenCalledOnce();
    expect(dnaQueryMocks.createDnaHypothesesForMatches).toHaveBeenCalledWith(
      [],
      { archiveId: "archive-default" }
    );
  });
});

function stubHostedCapabilities(): void {
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");
  for (const [name, value] of Object.entries(capabilitySettings)) {
    vi.stubEnv(name, value);
  }
}

function stubSelfHostedCapabilities(): void {
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
  for (const name of Object.keys(capabilitySettings)) {
    vi.stubEnv(name, "");
  }
}
