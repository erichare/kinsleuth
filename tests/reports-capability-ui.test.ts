import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceMocks = vi.hoisted(() => ({ readWorkspace: vi.fn() }));

vi.mock("@/lib/workspace-store", () => workspaceMocks);

import ReportsPage from "@/app/app/reports/page";
import { demoCases, demoDnaMatches, demoPeople } from "@/lib/demo-data";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
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
    expect(html).not.toMatch(/publish/i);
    expect(html).toMatch(/review before sharing/i);
  });

  it("preserves DNA quality reporting for self-hosted deployments", async () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");

    const html = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toMatch(/DNA gaps/i);
    expect(html).toMatch(/meaningful DNA match/i);
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
