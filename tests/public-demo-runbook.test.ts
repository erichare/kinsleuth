import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("public demo operating runbook", () => {
  it("documents configuration, release rehearsal, containment, monitoring, and launch gates", () => {
    const runbook = read("docs/public-demo-runbook.md");

    for (const heading of [
      "Control-plane prerequisites",
      "Protected environment inventory",
      "First holding cutover",
      "Release procedure",
      "Rollback and containment",
      "Rehearsal sequence",
      "Monitoring and incident response",
      "External launch checklist"
    ]) {
      expect(runbook).toContain(`## ${heading}`);
    }
    for (const marker of [
      "kinresolve-demo",
      "DEMO_HOLDING_DEPLOYMENT_ID",
      "PRODUCT_CI_WORKFLOW_ID",
      "KINRESOLVE_STAGING_DEMO_WORKFLOW_ID",
      "PUBLIC_DEMO_RUNTIME_DATABASE_URL",
      "PROMOTE KIN RESOLVE STATIC HOLDING TO DEMO.KINRESOLVE.COM",
      "demo-production",
      "demo-containment",
      "demo-monitoring",
      "holding -> candidate -> public -> rollback -> holding -> same-SHA re-promotion",
      "Five unfamiliar testers",
      "attributable tester quotes",
      "with written consent recorded",
      "first name and researcher type only",
      "public-demo-launch-materials.md"
    ]) {
      expect(runbook).toContain(marker);
    }
  });

  it("retires the old traffic-session instructions and declares current domain intent", () => {
    const readme = read("README.md");
    const domains = read("docs/brand-and-domain.md");
    const holding = read("docs/static-holding-deployment.md");

    expect(readme).toContain("docs/public-demo-runbook.md");
    expect(readme).toContain("legacy staging demo controller is retired");
    expect(readme).not.toContain("may open\n`demo.kinresolve.com`");
    expect(domains).toContain("Always-on isolated synthetic public demo");
    expect(domains).toContain("Primary call to action (demo live):** Solve the passenger mystery");
    expect(domains).toContain("Generic product call to action:** Try Kin Resolve");
    expect(domains).toContain(
      "Demo-live claims — publishable only after the public-demo runbook gates pass"
    );
    expect(domains).toContain("Visitor-facing pages carry one status line each");
    expect(holding).toContain("`public-demo`");
    expect(holding).toContain("DEMO_HOLDING_DEPLOYMENT_ID=dpl_");
  });

  it("documents the holding-only destructive release drain and unchanged load gate", () => {
    const runbook = read("docs/public-demo-runbook.md");
    const normalizedRunbook = runbook.replace(/\s+/g, " ");

    for (const requirement of [
      "Public-demo releases are holding-only",
      "use action `contain`",
      "captured canonical deployment is not verified holding",
      "Every release resets temporary visitor progress",
      "revoke every disposable guest sandbox",
      "AI lease",
      "clean their synthetic archives",
      "prove zero occupied capacity",
      "before any database or runtime-grant mutation",
      "at least 65 seconds",
      "60-second execution ceiling",
      "explicit zero-archive batch",
      "revalidates holding and repeats the zero-capacity drain immediately before",
      "unchanged 25-session capacity and five-second p95 gate"
    ]) {
      expect(normalizedRunbook).toContain(requirement);
    }
  });
});
