import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";
import { isPublicArchivePath } from "@/lib/public-surface";

const publicDemoEnvironment = {
  KINRESOLVE_DEPLOYMENT_MODE: "hosted",
  KINRESOLVE_DATASET_MODE: "demo",
  KINRESOLVE_PUBLIC_DEMO_ENABLED: "true",
  KINRESOLVE_PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com",
  APP_BASE_URL: "https://demo.kinresolve.com",
  KINRESOLVE_DNA_ENABLED: "true",
  KINRESOLVE_EXTERNAL_AI_ENABLED: "true",
  KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "true",
  KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
  KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
  KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
  KINRESOLVE_PLAIN_GEDCOM_ENABLED: "false"
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public demo landing and guided entry", () => {
  it("presents the synthetic-data notice and exactly three primary visitor paths", async () => {
    const landing = await source("app/page.tsx", "components/demo-start-form.tsx");

    expect(landing).toMatch(/Start guided demo/i);
    expect(landing).toMatch(/Explore the fictional family/i);
    expect(landing).toMatch(/Try the research challenge/i);
    expect(landing).toMatch(/href=["']\/family["']/);
    expect(landing).toMatch(/href=["']\/challenge["']/);
    expect(landing).toMatch(/\/api\/demo\/sessions/);
    expect(landing).toMatch(/method=["']post["']/i);

    expect(landing).toMatch(/fictional/i);
    expect(landing).toMatch(/expire[s]? after 24 hours/i);
    expect(landing).toMatch(/do not enter real (?:family )?data/i);
    expect(landing).toMatch(/curated (?:synthetic|fictional) context[\s\S]*AI provider/i);
    expect(landing).toMatch(/coarse usage events[\s\S]*30 days/i);
  });

  it("pins a successful start to the Mercer-March guided case", async () => {
    const implementation = await source(
      "app/page.tsx",
      "components/demo-start-form.tsx",
      "lib/public-demo-contract.ts",
      "app/api/demo/sessions/route.ts"
    );

    expect(implementation).toContain("/app/cases/case-mercer-march-identity?guide=1");
    expect(implementation).toMatch(/The Mercer[–-]March passenger mystery/);
  });
});

describe("public demo workspace chrome", () => {
  it("mounts persistent expiry, quota, reset, and end controls in the app shell", async () => {
    const [shell, demoBar] = await Promise.all([
      source("components/app-shell.tsx"),
      source("components/demo-session-bar.tsx")
    ]);

    expect(shell).toMatch(/import\s+\{?\s*DemoSessionBar/);
    expect(shell).toMatch(/<DemoSessionBar\b/);
    expect(demoBar).toMatch(/Demo workspace/i);
    expect(demoBar).toMatch(/Expires/i);
    expect(demoBar).toMatch(/AI (?:attempts? remaining|runs? left)/i);
    expect(demoBar).toMatch(/Reset demo/i);
    expect(demoBar).toMatch(/End demo/i);
  });

  it("collects only the fixed feedback schema and no free-form text", async () => {
    const feedback = await source("components/demo-feedback-form.tsx");

    expect(feedback).toContain("/api/demo/feedback");
    expect(feedback).toMatch(/name=["']usefulness["']/);
    expect(feedback).toMatch(/name=["']clarity["']/);
    expect(feedback).toMatch(/name=["']featureInterest["']/);
    expect(feedback).toMatch(/name=["']betaInterest["']/);
    expect(feedback).not.toMatch(/<textarea\b/i);
    expect(feedback).not.toMatch(/<input\b[^>]*type=["']text["']/i);
    expect(feedback).not.toMatch(/contentEditable|name=["'](?:feedbackText|comments|message)["']/i);
  });

  it("shows only guest-supported workspace areas and rejects unsupported pages", async () => {
    const shell = await source("components/app-shell.tsx");
    expect(shell).toMatch(
      /!demoMode\s*\|\|\s*!\[\s*["']\/app\/imports["'],\s*["']\/app\/ai["'],\s*["']\/app\/publishing["'],\s*["']\/app\/settings["']\s*\]\.includes\(item\.href\)/
    );

    const unsupportedPages = await Promise.all([
      source("app/app/ai/page.tsx"),
      source("app/app/imports/page.tsx"),
      source("app/app/publishing/page.tsx"),
      source("app/app/settings/page.tsx")
    ]);
    for (const page of unsupportedPages) {
      expect(page).toMatch(/session\.kind\s*===\s*["']demo-guest["'][\s\S]{0,80}notFound\(\)/);
    }
  });
});

describe("public demo indexing boundary", () => {
  it("classifies the family landing as public and blocks every private or interactive root", async () => {
    for (const [name, value] of Object.entries(publicDemoEnvironment)) {
      vi.stubEnv(name, value);
    }

    expect(isPublicArchivePath("/family")).toBe(true);

    const policy = robots();
    const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
    const demoRule = rules[0];
    const allowed = Array.isArray(demoRule?.allow) ? demoRule.allow : [demoRule?.allow].filter(Boolean);
    const disallowed = Array.isArray(demoRule?.disallow) ? demoRule.disallow : [demoRule?.disallow].filter(Boolean);

    expect(allowed).toEqual(expect.arrayContaining(["/", "/family", "/people", "/places", "/stories"]));
    expect(disallowed).toEqual(
      expect.arrayContaining([
        "/app",
        "/api",
        "/challenge",
        "/login",
        "/setup",
        "/invite",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
        "/resend-verification"
      ])
    );

    const privateLayout = await source("app/app/layout.tsx");
    expect(privateLayout).toMatch(/robots[\s\S]*index:\s*false/);
    expect(privateLayout).toMatch(/follow:\s*false/);
    expect(privateLayout).toMatch(/noarchive:\s*true/);
  });
});

async function source(...paths: string[]): Promise<string> {
  const parts = await Promise.all(
    paths.map(async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
      }
    })
  );
  return parts.join("\n");
}
