import { describe, expect, it } from "vitest";

import { isPublicArchivePath, publicArchiveEnabled } from "@/lib/public-surface";

const privateHostedEnvironment = {
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

describe("public surface policy", () => {
  it.each(["/", "/people", "/people/ada", "/places", "/stories", "/kinsleuth"])(
    "classifies %s as an archive surface",
    (pathname) => expect(isPublicArchivePath(pathname)).toBe(true)
  );

  it.each(["/peopleish", "/story", "/challenge", "/login", "/app"])(
    "does not overmatch %s",
    (pathname) => expect(isPublicArchivePath(pathname)).toBe(false)
  );

  it("fails closed when hosted capability configuration is disabled or invalid", () => {
    expect(publicArchiveEnabled(privateHostedEnvironment)).toBe(false);
    expect(publicArchiveEnabled({ KINRESOLVE_DEPLOYMENT_MODE: "hosted" })).toBe(false);
    expect(publicArchiveEnabled({ KINRESOLVE_DEPLOYMENT_MODE: "self-hosted" })).toBe(true);
  });
});
