import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  const absolute = path.join(process.cwd(), relativePath);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

const browser = source("scripts/public-demo-browser-canary.mjs");
const load = source("scripts/public-demo-load-test.mjs");
const release = source(".github/workflows/public-demo-release.yml");
const monitoring = source(".github/workflows/public-demo-monitoring.yml");
const sessionStore = source("lib/public-demo-session-store.ts");

describe("public demo browser and capacity launch gates", () => {
  it("runs the guided journey in isolated desktop and 390-pixel Playwright contexts", () => {
    expect(browser).toMatch(/from ["']playwright["']/);
    expect(browser).toMatch(/from ["']axe-core["']/);
    expect(browser).toContain("desktopContext");
    expect(browser).toContain("mobileContext");
    expect(browser).toMatch(/width:\s*390/);
    expect(browser).toContain("Start guided demo");
    expect(browser).toContain("Likely the same writer");
    expect(browser).toContain("Not enough to decide");
    expect(browser).toContain("Curated external AI analysis");
    expect(browser).toContain("guidedOutcome");
    expect(browser).toContain("/api/demo/session/reset");
    expect(browser).toMatch(/stale[\s\S]*(?:401|403)|(?:401|403)[\s\S]*stale/i);
    expect(browser).toContain("/api/demo/session/end");
    expect(browser).not.toContain('runPublicDemoMonitor("full")');
  });

  it("audits keyboard, WCAG 2.2 AA, and mobile overflow states", () => {
    expect(browser).toContain("keyboard.press");
    expect(browser).toContain("wcag22aa");
    expect(browser).toContain("serious");
    expect(browser).toContain("critical");
    expect(browser).toContain("document.documentElement.scrollWidth");
    expect(browser).toContain("Confirm demo reset");
    expect(browser).toContain("Share feedback");
  });

  it("covers Chromium and WebKit desktop/mobile plus the Firefox core path", () => {
    expect(browser).toMatch(/import\s*\{[^}]*chromium[^}]*firefox[^}]*webkit[^}]*\}\s*from\s*["']playwright["']/s);
    expect(browser).toContain("KINRESOLVE_DEMO_BROWSER");
    expect(browser).toContain("chromium");
    expect(browser).toContain("webkit");
    expect(browser).toContain("firefox");
    expect(browser).toMatch(/browserName\s*!==\s*["']firefox["']/);
  });

  it("audits capacity fallback and completes feedback and beta CTA actions", () => {
    expect(browser).toContain("The public demo is at capacity");
    expect(browser).toContain("/family");
    expect(browser).toContain("/challenge");
    expect(browser).toContain("Send ratings");
    expect(browser).toContain("Feedback saved");
    expect(browser).toContain("Apply for the private beta");
    expect(browser).toContain("beta_cta_clicked");
  });

  it("rewrites protected candidate mutations to the canonical same-origin contract", () => {
    expect(browser).toContain("x-vercel-protection-bypass");
    expect(browser).toContain("x-kinresolve-demo-canary");
    expect(browser).toContain('origin: "https://demo.kinresolve.com"');
    expect(browser).toContain('"sec-fetch-site": "same-origin"');
    expect(browser).toMatch(/route\([\s\S]*request\(\)[\s\S]*route\.continue/);
  });

  it("starts 25 sessions concurrently, proves core reads, enforces p95, and always cleans up", () => {
    expect(load).toContain("/api/demo/sessions");
    expect(load).toContain("/api/demo/session");
    expect(load).toContain("/app/cases/case-mercer-march-identity?guide=1");
    expect(load).toContain("/api/demo/session/end");
    expect(load).toContain("maximumActiveSessions");
    expect(load).toContain('familyUrl');
    expect(load).toContain('challengeUrl');
    expect(load).toContain('retry-after');
    expect(load).toContain("KINRESOLVE_DEMO_CANARY_SECRET");
    expect(load).toContain("Promise.allSettled");
    expect(load).toContain("finally");
    expect(load).toMatch(/(?:simultaneousStarts|sessionCount)\s*=\s*25/);
    expect(load).toMatch(/(?:p95LimitMs|maxP95Ms)\s*=\s*5_?000/);
    expect(load).toMatch(/new Set\([\s\S]*cookie/);
    expect(load).not.toMatch(/x-forwarded-for|x-vercel-forwarded-for/i);
  });

  it("lets only an authenticated canary skip network buckets while preserving capacity admission", () => {
    const decision = sessionStore.indexOf("decidePublicDemoAdmission");
    const rateLimit = sessionStore.indexOf("consumePublicDemoNetworkRateLimit", decision);
    expect(decision).toBeGreaterThan(-1);
    expect(rateLimit).toBeGreaterThan(decision);
    const admission = sessionStore.slice(decision, rateLimit + 200);
    expect(admission).toMatch(/input\.isCanary\s*===\s*true/);
    expect(admission).toContain("consumePublicDemoNetworkRateLimit");
  });

  it("installs and runs browser and load gates before promotion and in full monitoring", () => {
    const install = release.indexOf("npx playwright install --with-deps chromium webkit firefox");
    const browserRun = release.indexOf("scripts/public-demo-browser-canary.mjs");
    const loadRun = release.indexOf("scripts/public-demo-load-test.mjs");
    const promote = release.indexOf('vercel promote "$CANDIDATE_DEPLOYMENT_URL"');

    expect(install).toBeGreaterThan(-1);
    expect(browserRun).toBeGreaterThan(install);
    expect(release).toContain("KINRESOLVE_DEMO_BROWSER");
    expect(release).toMatch(/for browser in chromium webkit firefox/);
    expect(loadRun).toBeGreaterThan(browserRun);
    expect(promote).toBeGreaterThan(loadRun);
    expect(monitoring).toContain("npm ci");
    expect(monitoring).toContain("npx playwright install --with-deps chromium");
    expect(monitoring).toContain("scripts/public-demo-browser-canary.mjs");
  });
});
