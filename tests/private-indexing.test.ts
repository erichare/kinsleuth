import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "inter" }),
  Newsreader: () => ({ variable: "newsreader" })
}));

import { generateMetadata } from "@/app/layout";
import robots from "@/app/robots";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("private deployment indexing", () => {
  it("marks every hosted private-beta page and crawler route as private", () => {
    stubPrivateHostedEnvironment();

    expect(generateMetadata().robots).toMatchObject({
      index: false,
      follow: false,
      noarchive: true
    });
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
  });

  it("allows public self-hosted archive paths but blocks private surfaces", () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");

    expect(generateMetadata().robots).toBeUndefined();
    expect(robots().rules).toEqual([
      { userAgent: "*", allow: "/", disallow: ["/app", "/api", "/login", "/setup"] }
    ]);
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
