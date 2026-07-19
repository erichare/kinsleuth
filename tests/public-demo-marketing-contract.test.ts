import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("public demo marketing conversion", () => {
  it("makes Try Kin Resolve the primary home action and keeps beta secondary", async () => {
    const [home, site] = await Promise.all([
      readFile("site/app/page.tsx", "utf8"),
      readFile("site/lib/site.ts", "utf8")
    ]);
    const hero = home.slice(home.indexOf('className="hero-actions"'), home.indexOf('className="cta-note"'));

    expect(site).toContain('demoUrl: "https://demo.kinresolve.com"');
    expect(hero).toMatch(/href=\{site\.demoUrl\}[\s\S]*Try Kin Resolve/i);
    expect(hero).toMatch(/href=["']\/beta["'][\s\S]*Apply for the private beta/i);
    expect(hero.indexOf("Try Kin Resolve")).toBeLessThan(hero.indexOf("Apply for the private beta"));
  });

  it("keeps the public demo discoverable in the shared header and footer", async () => {
    const [header, footer] = await Promise.all([
      readFile("site/components/site-header.tsx", "utf8"),
      readFile("site/components/site-footer.tsx", "utf8")
    ]);

    expect(header).toMatch(/<a href=\{site\.demoUrl\}>Demo<\/a>/i);
    expect(footer).toMatch(/<a href=\{site\.demoUrl\}>Try the demo<\/a>/i);
  });

  it("offers the working demo after the final challenge dossier", async () => {
    const challenge = await readFile("site/shared/research-instincts-challenge.tsx", "utf8");
    const dossier = challenge.slice(challenge.indexOf("{dossierScore ?"), challenge.indexOf('className="challenge-reset"'));

    expect(dossier).toMatch(/Try Kin Resolve/i);
    expect(dossier).toMatch(/href=["']https:\/\/demo\.kinresolve\.com\/?["']/);
  });
});
