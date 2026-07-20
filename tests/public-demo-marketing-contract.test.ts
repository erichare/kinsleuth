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
    expect(exportCheck).toContain('editorialDemoLink: "Work this mystery in the demo"');
    expect(exportCheck).toContain('data-demo-card-status="live"');
    expect(exportCheck).toContain('data-demo-card-status="pending"');
    expect(exportCheck).toContain('betaTryAnswer: "Yes—today, without applying."');
    expect(exportCheck).toContain(
      "Social-proof strip must never render while the demo launch is pending."
    );
  });

  it("keeps the demo-first home surfaces gated by the explicit demo mode", async () => {
    const [home, testimonials] = await Promise.all([
      readFile("site/app/page.tsx", "utf8"),
      readFile("site/lib/testimonials.ts", "utf8")
    ]);

    expect(home).toContain('import { demoLive, demoStatus } from "@/lib/demo-status"');
    expect(home).toContain('import { testimonials } from "@/lib/testimonials"');
    expect(home).toContain("{demoLive && testimonials.length > 0 && (");
    expect(home).toContain('data-social-proof-surface="home"');
    expect(home).toContain(
      'className={demoLive ? "button button-secondary hero-secondary-demoted" : "button button-secondary"}'
    );
    expect(home).toMatch(
      /\{demoLive\s*\?\s*<a className="arrow-link" href=\{demoStatus\.ctaHref\}>Work this mystery in the demo/
    );
    expect(home).toMatch(/:\s*<Link className="arrow-link" href="\/method">See the method/);
    expect(home).toContain('href="/pricing"');
    expect(home).toContain("Read the pricing intent");
    expect(home).toContain('href="/roadmap"');
    expect(home).toMatch(/href=\{site\.github\}>Browse the source/);
    expect(testimonials).toContain("export interface Testimonial");
    expect(testimonials).toContain("export const testimonials: readonly Testimonial[] = [];");
  });

  it("gives visitors something to evaluate on the beta page before applying", async () => {
    const beta = await readFile("site/app/beta/page.tsx", "utf8");

    expect(beta).toContain('import { demoLive } from "@/lib/demo-status"');
    expect(beta).toContain("You don’t need an invitation to evaluate Kin Resolve.");
    expect(beta).toContain('href: demoLive ? site.demoUrl : "/roadmap"');
    expect(beta).toContain('href: demoLive ? `${site.demoUrl}/family` : "/roadmap"');
    expect(beta).toContain('action: demoLive ? "Open the demo" : "Follow the demo launch"');
    expect(beta).toContain('action: demoLive ? "Browse the archive" : "Follow the demo launch"');
    expect(beta).toContain('{demoLive ? "What you can use today" : "What you can evaluate today"}');
    expect(beta).toContain('href: "/challenge"');
    expect(beta).toMatch(
      /status: demoLive\s*\?\s*\{ tone: "live", label: "Live · no signup" \}\s*:\s*\{ tone: "pending", label: "Launch pending" \}/
    );
    expect(beta).toContain("data-demo-card-status={path.status.tone}");
    expect(beta).toContain('"Can I just try it?"');
    expect(beta).toContain('"What will hosted plans cost?"');
    expect(beta).toContain('<Link href="/pricing">pricing page</Link>');
  });

  it("flips interior-page defaults to the demo without touching each page", async () => {
    const [pageHero, ctaStrip] = await Promise.all([
      readFile("site/components/page-hero.tsx", "utf8"),
      readFile("site/components/cta-strip.tsx", "utf8")
    ]);

    expect(pageHero).toContain('import { demoLive, demoStatus } from "@/lib/demo-status"');
    expect(pageHero).toMatch(
      /const defaultPrimary = demoLive\s*\?\s*\{ label: demoStatus\.ctaLabel, href: demoStatus\.ctaHref \}\s*:\s*\{ label: "Apply for the private beta", href: "\/beta" \}/
    );
    expect(ctaStrip).toContain('import { demoLive, demoStatus } from "@/lib/demo-status"');
    expect(ctaStrip).toContain("primaryLabel: demoStatus.ctaLabel");
    expect(ctaStrip).toContain('primaryLabel: "Apply for the private beta"');
    expect(ctaStrip).toContain('secondaryHref: "/beta"');
    expect(ctaStrip).toContain("secondaryHref: site.github");
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
    expect(desktop).toMatch(/navigation\.slice\(0,\s*3\)/);
    expect(desktop).toMatch(/<details className=["']desktop-nav-more["']>[\s\S]*<summary>More/);
    expect(desktop).toMatch(/navigation\.slice\(3\)/);
    expect(desktop).toMatch(/href=\{site\.github\}/);
    expect(site.indexOf('label: "Method"')).toBeLessThan(site.indexOf('label: "Pricing"'));
    expect(site.indexOf('label: "Pricing"')).toBeLessThan(site.indexOf('label: "Developers"'));
    expect(site.indexOf('label: "Developers"')).toBeLessThan(site.indexOf('label: "Open source"'));
    expect(site.indexOf('label: "Open source"')).toBeLessThan(site.indexOf('label: "Roadmap"'));
    expect(site.indexOf('label: "Roadmap"')).toBeLessThan(site.indexOf('label: "About"'));
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
