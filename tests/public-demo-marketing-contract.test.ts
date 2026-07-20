import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("public demo marketing conversion", () => {
  it("makes the demo-mode CTA the primary home action and keeps beta secondary", async () => {
    const [home, site, demoStatus] = await Promise.all([
      readFile("site/app/page.tsx", "utf8"),
      readFile("site/lib/site.ts", "utf8"),
      readFile("site/lib/demo-status.ts", "utf8")
    ]);
    const hero = home.slice(home.indexOf('className="hero-actions"'), home.indexOf('className="cta-note"'));

    expect(site).toContain('demoUrl: "https://demo.kinresolve.com"');
    expect(hero).toMatch(/href=\{demoStatus\.ctaHref\}[\s\S]*\{demoStatus\.ctaLabel\}/);
    expect(hero).toMatch(/href=["']\/beta["'][\s\S]*Apply for the private beta/i);
    expect(hero.indexOf("demoStatus.ctaLabel")).toBeLessThan(hero.indexOf("Apply for the private beta"));
    expect(home).toContain('<p className="cta-note">{demoStatus.ctaNote} {demoStatus.statusLine}</p>');
    expect(demoStatus).toContain('ctaLabel: "Try Kin Resolve"');
    expect(demoStatus).toContain('ctaLabel: "Solve the passenger mystery"');
    expect(demoStatus.match(/ctaHref: site\.demoUrl/g)).toHaveLength(2);
    expect(demoStatus).toContain("ctaNote: betaStatus.rollout");
    expect(demoStatus).toContain('statusLine: "Source available under AGPL-3.0-only."');
  });

  it("keeps the demo launch a single explicit pending-or-live flag", async () => {
    const [demoStatus, exportCheck] = await Promise.all([
      readFile("site/lib/demo-status.ts", "utf8"),
      readFile("site/scripts/check-export.mjs", "utf8")
    ]);

    expect(demoStatus).toContain("KINRESOLVE_MARKETING_DEMO_MODE must be exactly pending or live.");
    expect(demoStatus).toContain('if (value === undefined || value === "pending") return "pending";');
    expect(demoStatus).toContain('if (value === "live") return "live";');
    expect(demoStatus).toContain('export const demoLive = marketingDemoMode === "live";');
    expect(demoStatus).toContain('ctaNote: "No signup · about 2 minutes · every record is fictional."');
    expect(demoStatus).toContain(
      'statusLine: "The public demo is live. The hosted workspace remains an invitation-only private beta."'
    );
    expect(exportCheck).toContain("KINRESOLVE_MARKETING_DEMO_MODE must be exactly pending or live.");
    expect(exportCheck).toContain('heroCtaLabel: "Solve the passenger mystery"');
    expect(exportCheck).toContain(
      'heroStatusLine: "The public demo is live. The hosted workspace remains an invitation-only private beta."'
    );
    expect(exportCheck).toContain("contains live-demo claim");
    expect(exportCheck).toContain("Live-demo homepage still contains the");
  });

  it("keeps the public demo discoverable in the shared header and footer", async () => {
    const [header, footer] = await Promise.all([
      readFile("site/components/site-header.tsx", "utf8"),
      readFile("site/components/site-footer.tsx", "utf8")
    ]);

    expect(header).toMatch(/<a href=\{site\.demoUrl\}>Demo<\/a>/i);
    expect(footer).toMatch(/<a href=\{site\.demoUrl\}>Try the demo<\/a>/i);
  });

  it("keeps desktop navigation focused while mobile navigation stays flat", async () => {
    const [header, site] = await Promise.all([
      readFile("site/components/site-header.tsx", "utf8"),
      readFile("site/lib/site.ts", "utf8")
    ]);
    const desktop = header.slice(header.indexOf("function DesktopNavigation"), header.indexOf("function MobileNavigation"));
    const mobile = header.slice(header.indexOf("function MobileNavigation"), header.indexOf("export function SiteHeader"));
    const headerActions = header.slice(header.indexOf('className="header-actions"'), header.indexOf('className="mobile-menu"'));

    expect(site).toMatch(/href:\s*["']\/method["'],\s*label:\s*["']Method["']/);
    expect(desktop).toMatch(/navigation\.slice\(0,\s*2\)/);
    expect(desktop).toMatch(/<details className=["']desktop-nav-more["']>[\s\S]*<summary>More/);
    expect(desktop).toMatch(/navigation\.slice\(2\)/);
    expect(desktop).toMatch(/href=\{site\.github\}/);
    expect(site.indexOf('label: "Developers"')).toBeLessThan(site.indexOf('label: "Open source"'));
    expect(site.indexOf('label: "Open source"')).toBeLessThan(site.indexOf('label: "About"'));
    expect(site.indexOf('label: "About"')).toBeLessThan(site.indexOf('label: "Privacy"'));
    expect(mobile).toMatch(/navigation\.map/);
    expect(mobile).toMatch(/href=\{site\.github\}/);
    expect(headerActions).not.toMatch(/href=\{site\.github\}/);
  });

  it("offers the working demo after the final challenge dossier", async () => {
    const challenge = await readFile("site/shared/research-instincts-challenge.tsx", "utf8");
    const dossier = challenge.slice(challenge.indexOf("{dossierScore ?"), challenge.indexOf('className="challenge-reset"'));

    expect(dossier).toMatch(/Try Kin Resolve/i);
    expect(dossier).toMatch(/href=["']https:\/\/demo\.kinresolve\.com\/?["']/);
  });
});
