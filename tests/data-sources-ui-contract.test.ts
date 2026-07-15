import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceMocks = vi.hoisted(() => ({
  readWorkspace: vi.fn()
}));
const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));
const headerMocks = vi.hoisted(() => ({
  headers: vi.fn()
}));
const integrationMocks = vi.hoisted(() => ({
  listIntegrationConnections: vi.fn()
}));

vi.mock("@/lib/workspace-store", () => workspaceMocks);
vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("next/headers", () => headerMocks);
vi.mock("@/lib/integrations/store", () => integrationMocks);
vi.mock("@/components/import-maintenance-panel", () => ({
  ImportMaintenancePanel: () => null
}));

import DataSourcesPage from "@/app/app/imports/page";

const ancestryConnection = {
  id: "source-ancestry-1",
  provider: "ancestry_export",
  authority: "ancestry",
  displayName: "Hartwell family on Ancestry",
  status: "active",
  capabilities: {
    snapshotImport: true,
    incrementalPull: false,
    media: false,
    oauth: false,
    writeback: false
  },
  remoteAccountId: "private-account-do-not-serialize",
  remoteTreeId: "private-tree-do-not-serialize",
  lastAppliedSnapshotId: "snapshot-1",
  lastRefreshedAt: "2026-07-14T18:30:00.000Z",
  disconnectedAt: "2026-07-14T18:31:00.000Z",
  createdAt: "2026-07-14T18:00:00.000Z",
  updatedAt: "2026-07-14T18:31:00.000Z"
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  const requestHeaders = new Headers();
  headerMocks.headers.mockResolvedValue(requestHeaders);
  authMocks.getSessionContext.mockResolvedValue({
    userId: "owner-synthetic",
    email: "owner@example.test",
    name: "Synthetic Owner",
    role: "owner",
    archiveId: "archive-synthetic"
  });
  integrationMocks.listIntegrationConnections.mockResolvedValue([ancestryConnection]);
  workspaceMocks.readWorkspace.mockResolvedValue({
    archiveName: "Synthetic Hartwell archive",
    imports: [],
    rawRecords: []
  });
});

describe("Data Sources page", () => {
  it("shows only the plain GEDCOM path in the hosted private beta", async () => {
    stubHostedPrivateBeta();

    const html = await renderPage();
    const fileInputs = [...html.matchAll(/<input\b[^>]*type="file"[^>]*>/g)].map((match) => match[0]);

    expect(fileInputs).toHaveLength(1);
    expect(fileInputs[0]).toContain('data-provider="gedcom"');
    expect(fileInputs[0]).toMatch(/accept="[^"]*\.ged(?:,|\b)/i);
    expect(fileInputs[0]).not.toMatch(/\.zip|application\/zip/i);
    for (const unavailableProvider of ["Ancestry", "Family Tree Maker", "RootsMagic"]) {
      expect(html, unavailableProvider).not.toMatch(
        new RegExp(`<h[2-4][^>]*>[^<]*${unavailableProvider}[^<]*<\\/h[2-4]>`, "i")
      );
    }
    expect(html).not.toMatch(/Imported package media/i);
  });

  it("presents four honest import paths instead of one generic upload", async () => {
    const html = await renderPage();

    expect(html).toMatch(/<h1>Data sources<\/h1>/i);
    for (const sourceName of ["Ancestry", "Family Tree Maker", "RootsMagic", "GEDCOM"]) {
      expect(html, sourceName).toMatch(new RegExp(`<h[2-4][^>]*>[^<]*${sourceName}[^<]*<\\/h[2-4]>`, "i"));
    }
    expect(html).toMatch(/Import from Ancestry/i);
    expect(html).toMatch(/Refresh from an Ancestry export/i);
  });

  it("renders every import control disabled when the export-refresh rollout is off", async () => {
    vi.stubEnv("KINRESOLVE_EXPORT_REFRESH_ENABLED", "false");

    const html = await renderPage();
    const fileInputs = [...html.matchAll(/<input\b[^>]*type="file"[^>]*>/g)].map((match) => match[0]);

    expect(html).toMatch(/imports are paused[^<]*deployment/i);
    expect(html).toMatch(/export-refresh rollout flag/i);
    expect(fileInputs).toHaveLength(4);
    expect(fileInputs.every((input) => /\bdisabled=""/.test(input))).toBe(true);
  });

  it("never claims an unauthorized Ancestry account connection or live sync", async () => {
    const html = await renderPage();

    expect(html).not.toMatch(/connect (?:to |your )?Ancestry(?:\.com)? account/i);
    expect(html).not.toMatch(/sign in (?:to|with) Ancestry/i);
    expect(html).not.toMatch(/automatic(?:ally)? (?:two-way )?sync/i);
    expect(html).not.toMatch(/live sync/i);
    expect(html).toMatch(/(?:does not|never) (?:ask for|request|store)[^<]*Ancestry (?:password|credentials)/i);
  });

  it("asks where authoritative tree edits happen before import", async () => {
    const html = await renderPage();
    const authorityFieldset = html.match(
      /<fieldset\b[^>]*>[\s\S]*?<legend\b[^>]*>[^<]*authoritative tree edits[^<]*<\/legend>[\s\S]*?<\/fieldset>/i
    )?.[0];

    expect(authorityFieldset, "authority fieldset").toBeDefined();
    expect(authorityFieldset).toContain('name="authority"');
    for (const authority of ["Ancestry", "Family Tree Maker", "RootsMagic", "Another genealogy app"]) {
      expect(authorityFieldset, authority).toMatch(new RegExp(authority, "i"));
    }
  });

  it("accepts the ZIP Ancestry actually downloads as well as GEDCOM files", async () => {
    const html = await renderPage();
    const ancestryInput = [...html.matchAll(/<input\b[^>]*type="file"[^>]*>/g)].find((match) =>
      match[0].includes('data-provider="ancestry_export"')
    )?.[0];

    expect(ancestryInput, "Ancestry file input").toBeDefined();
    expect(ancestryInput).toMatch(/accept="[^"]*\.zip/i);
    expect(ancestryInput).toMatch(/accept="[^"]*\.ged(?:,|\b)/i);
    expect(ancestryInput).toMatch(/accept="[^"]*\.gedcom(?:,|\b)/i);
  });

  it("shows the remembered Ancestry tree and when it was last refreshed", async () => {
    const html = await renderPage();

    expect(html).toContain("Hartwell family on Ancestry");
    expect(html).toMatch(/Authoritative edits:[^<]*Ancestry/i);
    expect(html).toMatch(/Last refreshed from Ancestry/i);
    expect(html).toMatch(/Jul(?:y)? 14, 2026/i);
    expect(html).toMatch(/>Refresh</i);
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({
      archiveId: "archive-synthetic"
    });
    expect(integrationMocks.listIntegrationConnections).toHaveBeenCalledWith({
      archiveId: "archive-synthetic"
    });
  });

  it("denies callers without imports:manage before reading private page data", async () => {
    authMocks.getSessionContext.mockResolvedValue({
      userId: "viewer-synthetic",
      email: "viewer@example.test",
      name: "Synthetic Viewer",
      role: "viewer",
      archiveId: "archive-synthetic"
    });

    await expect(DataSourcesPage()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404")
    });
    expect(workspaceMocks.readWorkspace).not.toHaveBeenCalled();
    expect(integrationMocks.listIntegrationConnections).not.toHaveBeenCalled();
  });

  it("projects remembered sources before serializing them into the RSC payload", async () => {
    workspaceMocks.readWorkspace.mockResolvedValueOnce({
      archiveName: "Synthetic Hartwell archive",
      imports: [{
        id: "import-1",
        sourceName: "synthetic-tree.ged",
        appliedAt: "2026-07-14T18:30:00.000Z",
        recordCount: 12,
        backupId: "private-backup-do-not-serialize"
      }],
      rawRecords: []
    });

    const html = await renderPage();

    expect(html).not.toMatch(
      /private-account-do-not-serialize|private-tree-do-not-serialize|snapshot-1|private-backup-do-not-serialize/
    );
    expect(html).toMatch(/Backup available/i);
  });

  it("keeps an explicit name and add-another control available beside remembered sources", async () => {
    const html = await renderPage();

    expect(html).toMatch(/Name this Ancestry (?:tree|source)/i);
    expect(html).toMatch(/Add another Ancestry (?:tree|source)/i);
  });

  it("explains the restricted-media boundary before an FTM or RootsMagic package is selected", async () => {
    const html = await renderPage();

    expect(html).toMatch(/GEDCOM[^<]*(?:and|\+)[^<]*media/i);
    expect(html).toMatch(/restricted[^<]*private[^<]*by default/i);
    expect(html).toMatch(/cannot be published/i);
    expect(html).toMatch(/(?:not|never) (?:sent to|used by|included in)[^<]*AI/i);
  });

  it("requires a rights acknowledgement before the legally enabled desktop-media path can upload", async () => {
    vi.stubEnv("KINRESOLVE_DESKTOP_MEDIA_ENABLED", "true");
    vi.stubEnv("KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED", "true");

    const html = await renderPage();

    expect(html).toMatch(/Private media package/i);
    expect(html).toMatch(/I have the right to store every file/i);
    expect(html).toMatch(/third-party record images remain restricted/i);
    expect(html).toMatch(/Imported package media/i);
    expect(html).toMatch(/public publishing and AI use remain blocked/i);
  });

  it("links concise provider-specific export instructions without claiming proprietary database access", async () => {
    const html = await renderPage();

    expect(html).toMatch(/Download your (?:GEDCOM|tree) ZIP/i);
    expect(html).toMatch(/Import or Refresh from an Ancestry export/i);
    expect(html).toContain("https://ancestry.my.site.com/FrCa/articles/en_US/Support_Site/Uploading-and-Downloading-Trees");
    expect(html).toMatch(/Family Tree Maker[\s\S]*GEDCOM[\s\S]*referenced media[\s\S]*one ZIP/i);
    expect(html).toContain("https://support.mackiev.com/444769-Whats-Not-Synced-with-FamilySync-in-FTM-2024");
    expect(html).toMatch(/RootsMagic[\s\S]*GEDCOM[\s\S]*referenced media[\s\S]*one ZIP/i);
    expect(html).toContain("https://help.rootsmagic.com/RM11/ancestry-treeshare.html");
    expect(html).not.toMatch(/read(?:s|ing)? (?:your )?(?:FTM|Family Tree Maker|RootsMagic) database/i);
  });
});

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await DataSourcesPage());
}

function stubHostedPrivateBeta() {
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");
  vi.stubEnv("KINRESOLVE_DNA_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_EXTERNAL_AI_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PUBLIC_ARCHIVE_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PUBLIC_PUBLISHING_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PACKAGE_MEDIA_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PLAIN_GEDCOM_ENABLED", "true");
}
