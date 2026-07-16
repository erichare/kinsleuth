import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers())
}));

vi.mock("@/lib/auth-session", () => ({
  getSessionContext: settingsMocks.getSessionContext
}));

vi.mock("@/components/archive-branding-form", () => ({
  ArchiveBrandingForm: ({ publicArchiveEnabled }: { publicArchiveEnabled: boolean }) => (
    publicArchiveEnabled ? "branding-public" : "branding-private"
  )
}));

import SettingsPage from "@/app/app/settings/page";

beforeEach(() => {
  vi.clearAllMocks();
  settingsMocks.getSessionContext.mockResolvedValue({
    kind: "member",
    userId: "owner-private-beta",
    email: "owner@example.test",
    name: "Owner",
    role: "owner",
    archiveId: "archive-private-beta"
  });
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AI_API_KEY", "stray-key-must-not-surface");
});

describe("settings capability UI", () => {
  it("shows the effective hosted beta manifest without suggesting an AI provider or public archive", async () => {
    stubHostedPrivateBeta();

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toMatch(/beta capabilities/i);
    expect(html).toMatch(/DNA[\s\S]*Disabled/i);
    expect(html).toMatch(/External AI[\s\S]*Disabled/i);
    expect(html).toMatch(/Plain GEDCOM[\s\S]*Enabled/i);
    expect(html).toMatch(/10 MiB/i);
    expect(html).toMatch(/40,000/i);
    expect(html).toMatch(/deterministic local analysis/i);
    expect(html).toMatch(/no external provider/i);
    expect(html).not.toMatch(/<span>Base URL<\/span>|<span>Chat model<\/span>|<span>Embedding model<\/span>/i);
    expect(html).not.toMatch(/API key stored server-side only/i);
    expect(html).not.toMatch(/name and tagline appear[^<]*public archive/i);
    expect(html).toMatch(/branding-private/i);
  });

  it("preserves provider details for a self-hosted deployment", async () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toMatch(/AI provider/i);
    expect(html).toMatch(/<span>Base URL<\/span>/i);
    expect(html).toMatch(/Provider key configured/i);
    expect(html).toMatch(/branding-public/i);
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
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
}
