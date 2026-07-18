import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolvePublicDemoFixtureRotationRequest } from "@/scripts/rotate-public-demo-fixture-command";

const validEnvironment = {
  DATABASE_URL: "postgres://demo.invalid/kinresolve",
  DEMO_FIXTURE_ROTATION_CONFIRMATION: "ROTATE-DEMO-FIXTURE:kinresolve-demo-public:4:5",
  KINSLEUTH_ARCHIVE_ID: "kinresolve-demo-public",
  KINRESOLVE_DATASET_MODE: "demo",
  KINRESOLVE_DEPLOYMENT_MODE: "hosted",
  KINRESOLVE_PUBLIC_DEMO_ENABLED: "true"
};

describe("public demo fixture rotation command", () => {
  it("binds an exact v4-to-v5 request to the hosted canonical public demo", () => {
    expect(
      resolvePublicDemoFixtureRotationRequest(["--from-version", "4"], validEnvironment)
    ).toEqual({
      archiveId: "kinresolve-demo-public",
      databaseUrl: validEnvironment.DATABASE_URL,
      expectedPreviousFixtureVersion: 4
    });
  });

  it.each([
    [{ ...validEnvironment, KINSLEUTH_ARCHIVE_ID: "demo-other" }, /canonical public demo archive/i],
    [{ ...validEnvironment, KINRESOLVE_DATASET_MODE: "pilot" }, /hosted demo dataset/i],
    [{ ...validEnvironment, KINRESOLVE_DEPLOYMENT_MODE: "self-hosted" }, /hosted demo dataset/i],
    [{ ...validEnvironment, KINRESOLVE_PUBLIC_DEMO_ENABLED: "false" }, /public demo must be enabled/i],
    [{ ...validEnvironment, DEMO_FIXTURE_ROTATION_CONFIRMATION: "wrong" }, /exact fixture rotation confirmation/i]
  ])("refuses an unsafe environment", (environment, message) => {
    expect(() =>
      resolvePublicDemoFixtureRotationRequest(["--from-version", "4"], environment)
    ).toThrow(message);
  });

  it("refuses implicit, stale, or malformed version transitions", () => {
    expect(() => resolvePublicDemoFixtureRotationRequest([], validEnvironment)).toThrow(/usage/i);
    expect(() =>
      resolvePublicDemoFixtureRotationRequest(["--from-version", "3"], validEnvironment)
    ).toThrow(/confirmation/i);
    expect(() =>
      resolvePublicDemoFixtureRotationRequest(["--from-version", "three"], validEnvironment)
    ).toThrow(/positive integer/i);
  });

  it("exposes the guarded operator command through package scripts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["archive:rotate-public-demo-fixture"]).toBe(
      "node --import tsx scripts/rotate-public-demo-fixture-command.ts"
    );
  });
});
