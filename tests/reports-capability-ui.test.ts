import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceMocks = vi.hoisted(() => ({ readWorkspace: vi.fn() }));
const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  workspaceOptionsForSession: vi.fn((session: { archiveId: string }) => ({
    archiveId: session.archiveId
  }))
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/workspace-store", () => workspaceMocks);
vi.mock("@/lib/auth-session", () => authMocks);

import { GET as getQualityReport } from "@/app/api/reports/quality/route";
import ReportsPage from "@/app/app/reports/page";
import { demoCases, demoDnaMatches, demoPeople } from "@/lib/demo-data";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  authMocks.getSessionContext.mockResolvedValue({
    kind: "member",
    userId: "owner-private-beta",
    email: "owner@example.test",
    name: "Owner",
    role: "owner",
    archiveId: "archive-private-beta"
  });
  workspaceMocks.readWorkspace.mockResolvedValue({
    archiveName: "Synthetic archive",
    people: demoPeople,
    dnaMatches: [{ ...demoDnaMatches[0], totalCm: 247, treeStatus: "none" }],
    cases: demoCases
  });
});

describe("quality report capability UI", () => {
  it("omits DNA and publishing claims when those hosted capabilities are disabled", async () => {
    stubHostedPrivateBeta();

    const html = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({}) }));

    expect(html).not.toMatch(/DNA/i);
    expect(html).not.toMatch(/fix before publishing/i);
    expect(html).toMatch(/review before sharing/i);
  });

  it("preserves DNA quality reporting for self-hosted deployments", async () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");

    const html = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toMatch(/DNA gaps/i);
    expect(html).toMatch(/meaningful DNA match/i);
  });

  it("omits disabled DNA from the hosted quality-report API and scopes the archive read", async () => {
    stubHostedPrivateBeta();

    const response = await getQualityReport(
      new Request("https://app.kinresolve.com/api/reports/quality")
    );
    const report = await response.json();

    expect(response.status).toBe(200);
    expect(report.summary.dnaGaps).toBe(0);
    expect(report.issues.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ area: "dna" })
    ]));
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({
      archiveId: "archive-private-beta"
    });
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
