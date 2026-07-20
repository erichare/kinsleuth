import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  parsePublicDemoAnalyticsMode,
  publicDemoAnalyticsScriptEnabled
} from "@/lib/public-demo-analytics";

const enabledPublicDemoEnvironment = {
  KINRESOLVE_DEPLOYMENT_MODE: "hosted",
  KINRESOLVE_DATASET_MODE: "demo",
  KINRESOLVE_PUBLIC_DEMO_ENABLED: "true",
  KINRESOLVE_PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com",
  APP_BASE_URL: "https://demo.kinresolve.com"
} as const;

describe("public demo aggregate analytics", () => {
  it("records a fixed landing event and keeps the database funnel identifier-free", async () => {
    const landing = await source("app/page.tsx");

    expect(landing).toContain('eventName: "landing_viewed"');
    expect(landing).toContain("recordPublicDemoEvent");
    expect(landing).not.toMatch(/posthog|segment|google-analytics|gtag|mixpanel/i);
  });

  it("accepts only the fixed beta CTA event for an authenticated demo session", async () => {
    const [route, registry] = await Promise.all([
      source("app/api/demo/events/route.ts"),
      source("lib/api-access.ts")
    ]);

    expect(route).toMatch(/z\.object\(\{[\s\S]*eventName:\s*z\.literal\(["']beta_cta_clicked["']\)[\s\S]*\}\)\.strict\(\)/);
    expect(route).toContain('withDemoGuestCapability("demo:analytics"');
    expect(route).toContain('eventName: "beta_cta_clicked"');
    expect(route).toContain("sessionId: guest.sessionId");
    expect(registry).toMatch(/path:\s*["']\/api\/demo\/events["'][\s\S]{0,180}demo:analytics/);
  });

  it("shows a tracked private-beta CTA only after the guided outcome", async () => {
    const journey = await source("components/demo-guided-case-journey.tsx");

    expect(journey).toContain("https://kinresolve.com/beta");
    expect(journey).toContain("/api/demo/events");
    expect(journey).toContain('eventName: "beta_cta_clicked"');
    expect(journey).toMatch(/outcomeCompleted[\s\S]*Apply for the private beta/);
  });

  it("keeps the Plausible analytics mode explicit, strict, and off by default", () => {
    expect(parsePublicDemoAnalyticsMode(undefined)).toBe("off");
    expect(parsePublicDemoAnalyticsMode("off")).toBe("off");
    expect(parsePublicDemoAnalyticsMode("plausible")).toBe("plausible");
    expect(() => parsePublicDemoAnalyticsMode("")).toThrow(/must be exactly off or plausible/);
    expect(() => parsePublicDemoAnalyticsMode("plausible ")).toThrow(/must be exactly off or plausible/);
    expect(() => parsePublicDemoAnalyticsMode("on")).toThrow(/must be exactly off or plausible/);

    expect(publicDemoAnalyticsScriptEnabled({
      ...enabledPublicDemoEnvironment,
      KINRESOLVE_PUBLIC_DEMO_ANALYTICS: "plausible"
    })).toBe(true);
    expect(publicDemoAnalyticsScriptEnabled({ ...enabledPublicDemoEnvironment })).toBe(false);
    expect(publicDemoAnalyticsScriptEnabled({
      KINRESOLVE_PUBLIC_DEMO_ENABLED: "false",
      KINRESOLVE_PUBLIC_DEMO_ANALYTICS: "plausible"
    })).toBe(false);
  });

  it("serves the cookieless Plausible script only for the enabled public demo", async () => {
    const layout = await source("app/layout.tsx");

    expect(layout).toContain("publicDemoAnalyticsScriptEnabled()");
    expect(layout).toContain('data-domain="demo.kinresolve.com"');
    expect(layout).toContain('src="https://plausible.io/js/script.js"');
  });

  it("fires only fixed-name Plausible events with no props or personal details", async () => {
    const [client, startForm, journey] = await Promise.all([
      source("lib/plausible-client.ts"),
      source("components/demo-start-form.tsx"),
      source("components/demo-guided-case-journey.tsx")
    ]);

    // A single-argument call cannot attach props, revenue, or identifiers.
    expect(client).toMatch(/window\.plausible\?\.\(eventName\)/);
    expect(client).toContain('"demo_session_started"');
    expect(client).toContain('"mystery_outcome_recorded"');
    expect(client).toContain('"beta_cta_clicked"');
    expect(startForm).toContain('recordPlausibleEvent("demo_session_started")');
    expect(journey).toContain('recordPlausibleEvent("mystery_outcome_recorded")');
    expect(journey).toContain('recordPlausibleEvent("beta_cta_clicked")');
  });

  it("excludes the browser canary from Plausible before any navigation", async () => {
    const canary = await source("scripts/public-demo-browser-canary.mjs");

    expect(canary).toContain("addInitScript");
    expect(canary).toContain('window.localStorage.setItem("plausible_ignore", "true")');
  });

  it("names Plausible in the landing notice only when analytics are enabled and versions the change", async () => {
    const [landing, contract] = await Promise.all([
      source("app/page.tsx"),
      source("lib/public-demo-contract.ts")
    ]);

    expect(landing).toMatch(/publicDemoAnalyticsMode\(\)\s*===\s*"plausible"/);
    expect(landing).toMatch(/Cookieless aggregate page and event counts also go to Plausible Analytics/);
    expect(contract).toContain('publicDemoNoticeVersion = "public-demo-2026-07-20"');
  });
});

function source(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
}
