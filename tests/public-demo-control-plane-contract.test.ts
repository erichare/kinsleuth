import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("public demo holding and domain control plane", () => {
  it("creates the pinned holding deployment in the dedicated demo project", () => {
    const holding = source(".github/workflows/vercel-holding.yml");

    expect(holding).toMatch(/options:[\s\S]*- public-demo/);
    expect(holding).toContain("kinresolve-public-demo-release");
    expect(holding).toContain("demo-production");
    expect(holding).toContain("https://demo.kinresolve.com");
    expect(holding).toContain("PROMOTE KIN RESOLVE STATIC HOLDING TO DEMO.KINRESOLVE.COM");
    expect(holding).toContain("DEMO_HOLDING_DEPLOYMENT_ID");
    expect(holding).toContain("MARKETING_VERCEL_PROJECT_ID");
    expect(holding).toContain("EXPECTED_VERCEL_PROJECT_NAME");
    expect(holding).toContain("kinresolve-demo");
    expect(holding).toContain("npm run vercel:config:validate");
    expect(holding.indexOf("npm run vercel:config:validate")).toBeLessThan(
      holding.indexOf("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}")
    );
  });

  it("moves the hostname atomically and proves exact canonical holding bytes", () => {
    const holding = source(".github/workflows/vercel-holding.yml");

    expect(holding).toContain(
      "https://api.vercel.com/v1/projects/$MARKETING_VERCEL_PROJECT_ID/domains/$DEMO_DOMAIN/move"
    );
    expect(holding).toContain('"projectId": process.env.VERCEL_PROJECT_ID');
    expect(holding).toContain("scripts/validate-vercel-project-domain.mjs");
    expect(holding).toContain('cmp "$RUNNER_TEMP/static-holding-canonical.html" holding/login.html');
    expect(holding).toContain('test "$health_status" = "404"');
    expect(holding).not.toMatch(/DELETE[\s\S]*demo\.kinresolve\.com/);
  });

  it("blocks demo release until the legacy control path is retired and idle", () => {
    const release = source(".github/workflows/public-demo-release.yml");
    const holding = source(".github/workflows/vercel-holding.yml");

    expect(release).toContain("scripts/validate-legacy-demo-retirement.mjs");
    expect(holding).toContain("scripts/validate-legacy-demo-retirement.mjs");
    expect(release).toContain("KINRESOLVE_STAGING_DEMO_WORKFLOW_ID");
    expect(holding).toContain("KINRESOLVE_STAGING_DEMO_WORKFLOW_ID");
  });
});
