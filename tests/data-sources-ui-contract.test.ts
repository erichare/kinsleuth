import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceMocks = vi.hoisted(() => ({
  readWorkspace: vi.fn()
}));

vi.mock("@/lib/workspace-store", () => workspaceMocks);
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
  lastAppliedSnapshotId: "snapshot-1",
  lastRefreshedAt: "2026-07-14T18:30:00.000Z"
};

beforeEach(() => {
  vi.resetAllMocks();
  workspaceMocks.readWorkspace.mockResolvedValue({
    archiveName: "Synthetic Hartwell archive",
    imports: [],
    rawRecords: [],
    integrationConnections: [ancestryConnection]
  });
});

describe("Data Sources page", () => {
  it("presents four honest import paths instead of one generic upload", async () => {
    const html = await renderPage();

    expect(html).toMatch(/<h1>Data sources<\/h1>/i);
    for (const sourceName of ["Ancestry", "Family Tree Maker", "RootsMagic", "GEDCOM"]) {
      expect(html, sourceName).toMatch(new RegExp(`<h[2-4][^>]*>[^<]*${sourceName}[^<]*<\\/h[2-4]>`, "i"));
    }
    expect(html).toMatch(/Import from Ancestry/i);
    expect(html).toMatch(/Refresh from an Ancestry export/i);
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
    expect(html).toMatch(/Last refreshed from Ancestry/i);
    expect(html).toMatch(/Jul(?:y)? 14, 2026/i);
    expect(html).toMatch(/>Refresh</i);
  });

  it("explains the restricted-media boundary before an FTM or RootsMagic package is selected", async () => {
    const html = await renderPage();

    expect(html).toMatch(/GEDCOM[^<]*(?:and|\+)[^<]*media/i);
    expect(html).toMatch(/restricted[^<]*private[^<]*by default/i);
    expect(html).toMatch(/cannot be published/i);
    expect(html).toMatch(/(?:not|never) (?:sent to|used by|included in)[^<]*AI/i);
  });
});

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await DataSourcesPage());
}
