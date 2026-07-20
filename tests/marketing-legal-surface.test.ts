import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseMarketingReleaseMode } from "../site/lib/marketing-release-mode";

const files = {
  betaStatus: "site/lib/beta-status.ts",
  releaseMode: "site/lib/marketing-release-mode.ts",
  beta: "site/app/beta/page.tsx",
  privacy: "site/app/privacy/page.tsx",
  product: "site/app/product/page.tsx",
  cta: "site/components/cta-strip.tsx",
  exportCheck: "site/scripts/check-export.mjs",
  contract: "docs/hosted-beta-contract.md",
  brand: "docs/brand-and-domain.md",
  legalHandoff: "docs/private-beta-legal-handoff.md",
  launchMaterials: "docs/private-beta-launch-materials.md",
  demoLaunchMaterials: "docs/public-demo-launch-materials.md"
} as const;

async function contents(...paths: string[]) {
  return (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");
}

describe("private-beta marketing and legal surface", () => {
  it("uses one strict evidence-bound release mode and rejects the former rollout claim", async () => {
    const status = await readFile(files.betaStatus, "utf8");
    const releaseMode = await readFile(files.releaseMode, "utf8");
    const publicCopy = await contents(
      files.betaStatus,
      files.beta,
      files.privacy,
      files.product,
      files.contract,
      files.brand
    );

    expect(status).toContain('phase: "applications-open-prelaunch"');
    expect(status).toContain('phase: "hosted-private-beta-live"');
    expect(status).toContain('phase: "hosted-private-beta-api-live"');
    expect(status).toContain("Private beta applications are open.");
    expect(status).toContain("Invitations have not started; hosted access begins only after the launch gates pass.");
    expect(status).toContain("Hosted private beta is live.");
    expect(status).toContain("Access is invitation-only for approved participants; the hosted API is not available in this release.");
    expect(status).toContain("Hosted private beta and API v1 are live.");
    expect(status).toContain("Access remains invitation-only; API v1 is available only to approved participants for archives they own.");
    expect(status).toContain("This is proof of the source product—not a claim that hosted invitations or the API are already live.");
    expect(status).toContain("Hosted availability is limited to approved private-beta participants, and the API is not available in this release.");
    expect(status).toContain("Hosted private-beta and API access are limited to approved participants and archives they own.");
    expect(releaseMode).toContain("KINRESOLVE_MARKETING_RELEASE_MODE must be exactly prelaunch, application, or api-launch.");
    expect(parseMarketingReleaseMode(undefined)).toBe("prelaunch");
    expect(parseMarketingReleaseMode("prelaunch")).toBe("prelaunch");
    expect(parseMarketingReleaseMode("application")).toBe("application");
    expect(parseMarketingReleaseMode("api-launch")).toBe("api-launch");
    expect(() => parseMarketingReleaseMode("")).toThrow(/must be exactly prelaunch, application, or api-launch/);
    expect(() => parseMarketingReleaseMode("application ")).toThrow(/must be exactly prelaunch, application, or api-launch/);
    expect(publicCopy).not.toMatch(/Hosted access is rolling out in small invitation cohorts/i);

    const exportCheck = await readFile(files.exportCheck, "utf8");
    expect(exportCheck).toContain("hosted access is rolling out");
    expect(exportCheck).toContain("Invitations have not started; hosted access begins only after the launch gates pass.");
    expect(exportCheck).toContain('data-marketing-release-mode="${marketingReleaseMode}"');
  });

  it("states the admitted cohort boundary before collecting an application", async () => {
    const beta = await readFile(files.beta, "utf8");
    const cta = await readFile(files.cta, "utf8");

    expect(beta).toMatch(/plain \.ged or \.gedcom/i);
    expect(beta).toMatch(/10 MiB \(10,485,760 bytes\).*40,000 people/i);
    expect(beta).toMatch(/Source work is limited to metadata, links, and pasted text or transcripts/i);
    expect(beta).toMatch(/DNA, external-provider AI, binary source attachments, media packages, and real-data public publishing are disabled for cohort one/i);
    expect(beta).toContain('betaStatus.hostedLive ? "The first" : "The proposed first"');
    expect(beta).toMatch(/30-day pilot is free.*no billing or payment-information step/i);
    expect(beta).toMatch(/one-business-day support acknowledgement target.*not an uptime or response-time SLA/i);
    expect(beta).toMatch(/Submitting consents only to beta communications.*does not accept participation terms/i);
    expect(beta).toContain('<Link href="/privacy">data-practices disclosure</Link>');
    expect(beta).toMatch(/The support and security routes must be delivery-tested before invitations begin/i);
    expect(beta).toMatch(/Do not email family records, GEDCOM files, screenshots of private research, credentials, API tokens, or genetic information/i);
    expect(cta).toMatch(/GEDCOM review, source, research-case, deterministic-check, and export workflows/i);
    expect(cta).toMatch(/Apply with the workflow—not private records/i);
    expect(cta).not.toMatch(/DNA-triage workflows|publishing.*workflows/i);
  });

  it("distinguishes implemented controls from live and legally approved behavior", async () => {
    const privacy = await readFile(files.privacy, "utf8");

    expect(privacy).toMatch(/Implemented does not mean deployed or approved for private family data/i);
    expect(privacy).toMatch(/one isolated deployment, database, object store, secret set, and archive—not shared multi-family tenancy/i);
    expect(privacy).toMatch(/A deletion request is not a completed deletion/i);
    expect(privacy).toMatch(/authoritative real-pilot finish is operator-reviewed destruction of the dedicated database and object resources/i);
    expect(privacy).toMatch(/Primary deletion and retained-backup expiry are separate/i);
    expect(privacy).toMatch(/planning values—not live promises/i);
    expect(privacy).toMatch(/approved participation terms, privacy notice, and cohort boundary have not been published/i);
    expect(privacy).toMatch(/beta application consents only to beta communications; it does not accept hosted participation terms/i);
    expect(privacy).toMatch(/hosted API remains unavailable until its release, edge-limit, canary, and revocation gates pass/i);
    expect(privacy).toMatch(/support@kinresolve\.com/);
    expect(privacy).toMatch(/security@kinresolve\.com/);
  });

  it("keeps legal drafts non-operative and defines exact approval and publication gates", async () => {
    const handoff = await readFile(files.legalHandoff, "utf8");

    expect(handoff).toMatch(/Status:\*\* Operational draft for owner and counsel review/);
    expect(handoff).toMatch(/Legal effect:\*\* None/);
    expect(handoff).toMatch(/not legal advice, participation\s+terms, a privacy notice, counsel approval, or permission to accept real family data/i);
    expect(handoff).toMatch(/Private-beta participation terms/);
    expect(handoff).toMatch(/Private-beta privacy notice/);
    expect(handoff).toMatch(/Cohort-one boundary/);
    expect(handoff).toMatch(/approved version,\s+versioned [^\n]+ URL, and lowercase SHA-256 digest/i);
    expect(handoff).toMatch(/Application consent is not participation consent/i);
    expect(handoff).toMatch(/Engineering planning targets, not promises/i);
    expect(handoff).toMatch(/hash the raw response bytes with SHA-256/i);
    expect(handoff).toMatch(/Existing acceptance evidence is immutable/i);
    expect(handoff).toMatch(/\| Product owner \| All three \| — \| — \| Pending \|/);
  });

  it("provides separate prelaunch, launch-only, maintenance, and end-of-pilot material", async () => {
    const materials = await readFile(files.launchMaterials, "utf8");

    expect(materials).toMatch(/not authorization to claim launch/i);
    expect(materials).toMatch(/## Current prelaunch message/);
    expect(materials).toMatch(/## Email templates/);
    expect(materials).toMatch(/### Invitation — launch-only/);
    expect(materials).toMatch(/### Maintenance/);
    expect(materials).toMatch(/### End of pilot and export/);
    expect(materials).toMatch(/## Screenshot and demo brief/);
    expect(materials).toMatch(/## Ninety-second synthetic demo/);
    expect(materials).toMatch(/### Prelaunch/);
    expect(materials).toMatch(/### Demo-launch/);
    expect(materials).toMatch(/### Launch-only/);
    expect(materials).toMatch(/## Public link readiness/);
    expect(materials).toMatch(/## Claim switch checklist/);
    expect(materials).toMatch(/Do not publish launch-only copy until the signed launch record/i);
    expect(materials).toMatch(/Do not publish the demo-launch variant until every external gate/i);
    expect(materials).toContain("public-demo-launch-materials.md");
    expect(materials).toContain(
      "**Primary action (after the demo-live flip):** Solve the passenger mystery",
    );
    expect(materials).toContain("**Primary support line:** No signup · about 2 minutes · every record is fictional.");
    expect(materials).toContain(
      "**Secondary action (after the demo-live flip):** Apply for the private beta",
    );
  });

  it("keeps demo-launch materials gated with an exact message set, counter contract, and flip checklist", async () => {
    const demo = await readFile(files.demoLaunchMaterials, "utf8");

    expect(demo).toMatch(/not authorization to claim the demo is live/i);
    expect(demo).toContain("## Approved demo-live message set");
    expect(demo).toContain("Solve the passenger mystery");
    expect(demo).toContain("No signup · about 2 minutes · every record is fictional.");
    expect(demo).toMatch(/\*\*Forbidden phrases\.\*\*/);
    expect(demo).toMatch(/“the beta is open,”/);
    expect(demo).toMatch(/“production-ready,”/);
    expect(demo).toMatch(/any hosted-availability claim/);
    expect(demo).toContain("## Show HN draft");
    expect(demo).toContain("### Prepared first comment (founder)");
    expect(demo).toContain("## Genealogy community variants");
    expect(demo).toMatch(/I built a fictional records mystery — can you solve it\?/);
    expect(demo).toMatch(/r\/Genealogy/);
    expect(demo).toMatch(/r\/opensource/);
    expect(demo).toMatch(/r\/selfhosted/);
    expect(demo).toMatch(/self-promotion rules/);
    expect(demo).toContain("## Tester quotes and usage counter");
    expect(demo).toMatch(/written consent/);
    expect(demo).toMatch(/first name plus researcher type/);
    expect(demo).toContain("GET https://demo.kinresolve.com/api/public/demo-stats");
    expect(demo).toContain('{"mysteriesSolved": <number>, "since": <ISO-timestamp>}');
    expect(demo).toContain("cache-control: public, s-maxage=60, stale-while-revalidate=300");
    expect(demo).toContain("access-control-allow-origin: https://kinresolve.com");
    expect(demo).toContain("## Launch-day flip checklist");
    expect(demo).toContain("KINRESOLVE_MARKETING_DEMO_MODE=live");
    expect(demo).toContain("KINRESOLVE_MARKETING_DEMO_MODE=pending");
    expect(demo).toContain("gh variable set KINRESOLVE_MARKETING_DEMO_MODE --body live");
    expect(demo).toContain("gh variable set KINRESOLVE_MARKETING_DEMO_MODE --body pending");
    expect(demo).toMatch(/silently\s+rebuild `kinresolve\.com` with the pending homepage copy/);
    expect(demo).toMatch(/invitation-only/);
    expect(demo).toMatch(/`contain` action/);
  });
});
