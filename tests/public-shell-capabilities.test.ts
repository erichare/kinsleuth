import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChallengePage from "@/app/challenge/page";
import { PublicShell } from "@/components/public-shell";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public shell capability boundary", () => {
  it("keeps hosted private-beta navigation and copy private", () => {
    stubPrivateHostedEnvironment();

    const html = renderToStaticMarkup(createElement(PublicShell, null, createElement("p", null, "Private content")));

    expect(html).not.toContain("Public Archive");
    expect(html).not.toContain('href="/people"');
    expect(html).not.toContain('href="/places"');
    expect(html).not.toContain('href="/stories"');
    expect(html).not.toContain("Family history. Openly shared.");
    expect(html).not.toContain("AGPL-3.0-only self-hosted");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Invitation-only hosted beta");
  });

  it("keeps the synthetic challenge available without archive navigation", () => {
    stubPrivateHostedEnvironment();

    const html = renderToStaticMarkup(createElement(ChallengePage));

    expect(html).toContain("Everything here is fictional");
    expect(html).not.toContain("Return to the public archive");
    expect(html).toContain('href="/login"');
  });

  it("preserves self-hosted public archive navigation", () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");

    const html = renderToStaticMarkup(createElement(PublicShell, null, createElement("p", null, "Public content")));

    expect(html).toContain("Public Archive");
    expect(html).toContain('href="/people"');
    expect(html).toContain("Family history. Openly shared.");
    expect(html).toContain("AGPL-3.0-only self-hosted");
  });
});

function stubPrivateHostedEnvironment(): void {
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
