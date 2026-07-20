import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { insecureLoopbackCanaryOriginAcknowledgement } from "@/lib/insecure-loopback-canary";
import {
  resolveBrowserCanaryConfiguration,
  resolveBrowserCanaryStateConfiguration,
  syntheticMutationAcknowledgement
} from "@/scripts/browser-canary-contract";
import { pinnedAction } from "./helpers/action-pins";

const releaseSha = "a".repeat(40);
const probeSecret = "p".repeat(43);
const baseMutableEnvironment = {
  KINRESOLVE_CANARY_ORIGIN: "https://staging.kinresolve.test",
  KINRESOLVE_CANARY_APP_BASE_URL: "https://staging.kinresolve.test",
  KINRESOLVE_CANARY_RELEASE_SHA: releaseSha,
  KINRESOLVE_CANARY_DATASET_MODE: "demo",
  KINRESOLVE_CANARY_API_V1_ENABLED: "false",
  KINRESOLVE_CANARY_OBSERVABILITY_PROBE_SECRET: probeSecret,
  KINRESOLVE_CANARY_ARCHIVE_ID: "archive-browser-canary",
  KINSLEUTH_ARCHIVE_ID: "archive-browser-canary",
  KINRESOLVE_CANARY_USER_ID: "user-browser-canary",
  KINRESOLVE_CANARY_ALLOW_MUTATION: "true",
  KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT: syntheticMutationAcknowledgement,
  KINRESOLVE_CANARY_EMAIL: "synthetic-canary@example.test",
  KINRESOLVE_CANARY_PASSWORD: "synthetic-browser-canary-password"
};

describe("browser canary configuration", () => {
  it("admits an exact-origin invited staging identity only for a synthetic demo cell", () => {
    expect(resolveBrowserCanaryConfiguration("staging", baseMutableEnvironment)).toMatchObject({
      mode: "staging",
      origin: "https://staging.kinresolve.test",
      appBaseUrl: "https://staging.kinresolve.test",
      releaseSha,
      datasetMode: "demo",
      apiV1Enabled: false,
      mutable: true,
      bootstrapOwner: false
    });
  });

  it("permits loopback owner bootstrap only in disposable mode", () => {
    const environment = {
      ...baseMutableEnvironment,
      KINRESOLVE_CANARY_ORIGIN: "http://127.0.0.1:3107",
      KINRESOLVE_CANARY_APP_BASE_URL: "http://127.0.0.1:3107",
      KINRESOLVE_CANARY_BOOTSTRAP_OWNER: "true"
    };
    expect(resolveBrowserCanaryConfiguration("disposable", environment).bootstrapOwner).toBe(true);
    expect(() => resolveBrowserCanaryConfiguration("staging", {
      ...environment,
      KINRESOLVE_CANARY_ORIGIN: "https://staging.kinresolve.test",
      KINRESOLVE_CANARY_APP_BASE_URL: "https://staging.kinresolve.test"
    })).toThrow(/pre-provisioned invited identity/i);
  });

  it("admits production-server HTTP only through the exact disposable loopback profile", () => {
    const databaseUrl =
      "postgres://kinresolve:kinresolve@127.0.0.1:5432/kinresolve_browser_canary";
    expect(resolveBrowserCanaryConfiguration("disposable", {
      ...baseMutableEnvironment,
      NODE_ENV: "production",
      APP_BASE_URL: "http://127.0.0.1:3107",
      DATABASE_AUTO_MIGRATE: "false",
      DATABASE_URL: databaseUrl,
      KINRESOLVE_BUILD_COMMIT_SHA: releaseSha,
      KINRESOLVE_CANARY_APP_BASE_URL: "http://127.0.0.1:3107",
      KINRESOLVE_CANARY_OPERATOR_DATABASE_URL: databaseUrl,
      KINRESOLVE_CANARY_ORIGIN: "http://127.0.0.1:3107",
      KINRESOLVE_DATASET_MODE: "demo",
      KINRESOLVE_DEPLOYMENT_MODE: "self-hosted",
      KINRESOLVE_INSECURE_LOOPBACK_CANARY_ACKNOWLEDGEMENT:
        insecureLoopbackCanaryOriginAcknowledgement,
      KINRESOLVE_INSECURE_LOOPBACK_CANARY_ORIGIN: "true",
      KINRESOLVE_OBJECT_STORAGE_BACKEND: "s3",
      S3_ENDPOINT: "http://127.0.0.1:39000",
      S3_PUBLIC_ENDPOINT: "http://127.0.0.1:39000"
    })).toMatchObject({
      mode: "disposable",
      origin: "http://127.0.0.1:3107",
      mutable: true
    });
  });

  it("fails closed when a production-server disposable run lacks its global loopback acknowledgement", () => {
    expect(() => resolveBrowserCanaryConfiguration("disposable", {
      ...baseMutableEnvironment,
      NODE_ENV: "production",
      KINRESOLVE_CANARY_ORIGIN: "http://127.0.0.1:3107",
      KINRESOLVE_CANARY_APP_BASE_URL: "http://127.0.0.1:3107"
    })).toThrow(/loopback safety profile/i);
  });

  it.each([
    ["pilot dataset", { KINRESOLVE_CANARY_DATASET_MODE: "pilot" }],
    ["empty dataset", { KINRESOLVE_CANARY_DATASET_MODE: "empty" }],
    ["different app origin", { KINRESOLVE_CANARY_APP_BASE_URL: "https://other.kinresolve.test" }],
    ["missing opt-in", { KINRESOLVE_CANARY_ALLOW_MUTATION: undefined }],
    ["wrong acknowledgement", { KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT: "yes" }],
    ["missing email", { KINRESOLVE_CANARY_EMAIL: undefined }],
    ["missing password", { KINRESOLVE_CANARY_PASSWORD: undefined }],
    ["missing archive", { KINRESOLVE_CANARY_ARCHIVE_ID: undefined }],
    ["different runtime archive", { KINSLEUTH_ARCHIVE_ID: "archive-pilot" }],
    ["missing staging user ID", { KINRESOLVE_CANARY_USER_ID: undefined }],
    ["Vercel bypass", { VERCEL_AUTOMATION_BYPASS_SECRET: "b".repeat(43) }],
    ["external GEDCOM fixture", { KINRESOLVE_CANARY_GEDCOM_PATH: "/tmp/participant.ged" }]
  ])("refuses mutable staging with %s", (_label, override) => {
    expect(() => resolveBrowserCanaryConfiguration("staging", {
      ...baseMutableEnvironment,
      ...override
    })).toThrow();
  });

  it("admits an anonymous production candidate bound to the canonical app origin", () => {
    const config = resolveBrowserCanaryConfiguration("production", {
      KINRESOLVE_CANARY_ORIGIN: "https://candidate-abc.vercel.app",
      KINRESOLVE_CANARY_APP_BASE_URL: "https://app.kinresolve.com",
      KINRESOLVE_CANARY_RELEASE_SHA: releaseSha,
      KINRESOLVE_CANARY_DATASET_MODE: "pilot",
      KINRESOLVE_CANARY_API_V1_ENABLED: "true",
      KINRESOLVE_CANARY_OBSERVABILITY_PROBE_SECRET: probeSecret,
      VERCEL_AUTOMATION_BYPASS_SECRET: "b".repeat(43)
    });

    expect(config).toMatchObject({
      mode: "production",
      origin: "https://candidate-abc.vercel.app",
      appBaseUrl: "https://app.kinresolve.com",
      datasetMode: "pilot",
      apiV1Enabled: true,
      mutable: false,
      bootstrapOwner: false
    });
    expect(config).not.toHaveProperty("email");
    expect(config).not.toHaveProperty("password");
  });

  it.each([
    ["mutation opt-in", { KINRESOLVE_CANARY_ALLOW_MUTATION: "false" }],
    ["mutation acknowledgement", { KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT: syntheticMutationAcknowledgement }],
    ["owner bootstrap", { KINRESOLVE_CANARY_BOOTSTRAP_OWNER: "false" }],
    ["email", { KINRESOLVE_CANARY_EMAIL: "pilot@example.test" }],
    ["password", { KINRESOLVE_CANARY_PASSWORD: "must-not-be-used" }],
    ["GEDCOM fixture", { KINRESOLVE_CANARY_GEDCOM_PATH: "tests/fixtures/browser-canary.ged" }]
  ])("refuses production configuration containing %s", (_label, forbidden) => {
    expect(() => productionConfiguration(forbidden)).toThrow(/production browser smoke refuses/i);
  });

  it("requires canonical app.kinresolve.com for a cross-origin production candidate", () => {
    expect(() => productionConfiguration({
      KINRESOLVE_CANARY_APP_BASE_URL: "https://other.kinresolve.test"
    })).toThrow(/app\.kinresolve\.com/i);
  });

  it.each([
    ["arbitrary HTTPS origin", {
      KINRESOLVE_CANARY_ORIGIN: "https://evil.example",
      VERCEL_AUTOMATION_BYPASS_SECRET: "b".repeat(43)
    }],
    ["generated candidate without bypass", {
      KINRESOLVE_CANARY_ORIGIN: "https://candidate-abc.vercel.app"
    }],
    ["canonical origin with bypass", {
      VERCEL_AUTOMATION_BYPASS_SECRET: "b".repeat(43)
    }]
  ])("refuses production %s", (_label, override) => {
    expect(() => productionConfiguration(override)).toThrow();
  });
});

describe("browser canary state configuration", () => {
  const stateEnvironment = {
    KINRESOLVE_CANARY_RELEASE_SHA: releaseSha,
    KINRESOLVE_CANARY_DATASET_MODE: "demo",
    KINRESOLVE_CANARY_ARCHIVE_ID: "archive-browser-canary",
    KINSLEUTH_ARCHIVE_ID: "archive-browser-canary",
    KINRESOLVE_CANARY_USER_ID: "user-browser-canary",
    KINRESOLVE_CANARY_ALLOW_MUTATION: "true",
    KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT: syntheticMutationAcknowledgement,
    KINRESOLVE_CANARY_RUN_ID: "gh-123-2"
  };

  it("binds the operator baseline before an origin or browser credential is available", () => {
    expect(resolveBrowserCanaryStateConfiguration("staging", stateEnvironment)).toEqual({
      mode: "staging",
      releaseSha,
      runId: "gh-123-2",
      archiveId: "archive-browser-canary",
      userId: "user-browser-canary"
    });
  });

  it.each([
    ["production mode", "production", {}],
    ["pilot data", "staging", { KINRESOLVE_CANARY_DATASET_MODE: "pilot" }],
    ["missing acknowledgement", "staging", { KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT: undefined }],
    ["missing mutation opt-in", "staging", { KINRESOLVE_CANARY_ALLOW_MUTATION: undefined }],
    ["invalid archive", "staging", { KINRESOLVE_CANARY_ARCHIVE_ID: "../pilot" }],
    ["different runtime archive", "staging", { KINSLEUTH_ARCHIVE_ID: "archive-pilot" }],
    ["missing staging user ID", "staging", { KINRESOLVE_CANARY_USER_ID: undefined }]
  ] as const)("refuses %s", (_label, mode, override) => {
    expect(() => resolveBrowserCanaryStateConfiguration(mode, {
      ...stateEnvironment,
      ...override
    })).toThrow();
  });
});

describe("browser canary source and artifact boundary", () => {
  const source = readFileSync(path.join(process.cwd(), "scripts/browser-canary.ts"), "utf8");
  const stateSource = readFileSync(path.join(process.cwd(), "scripts/browser-canary-state.ts"), "utf8");
  const ciSource = readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

  it("uses the standalone Playwright library without Playwright Test", () => {
    expect(source).toContain('from "playwright"');
    expect(source).not.toContain("@playwright/test");
  });

  it("binds mutable cells to the canonical demo fixture version", () => {
    expect(source).toContain('import { demoFixtureVersion } from "../lib/archive-provisioning.ts"');
    expect(source).toContain("body.database.demoFixtureVersion !== demoFixtureVersion");
    expect(source).not.toMatch(/body\.database\.demoFixtureVersion\s*!==\s*\d+/);
  });

  it("keeps production anonymous and gates every failure screenshot on a synthetic mutable page", () => {
    expect(source).toContain('if (configuration.mode === "production")');
    expect(source).toContain("without credentials, writes, screenshots, or traces");
    expect(source).toContain("configuration.mutable && authenticatedSyntheticPage");
    expect(source).toContain('!current.pathname.startsWith("/app")');
    expect(source).toContain('path.join(process.cwd(), "output", "playwright")');
    expect(source).not.toMatch(/\.tracing\./);
  });

  it("proves the disposable topbar discloses the synthetic demo dataset exactly once", () => {
    expect(source).toContain('pageToUse.locator(".app-topbar .dataset-badge")');
    expect(source).toContain('!== "Synthetic demo"');
    expect(source).toContain("await topbarDatasetBadge.count() !== 1");
  });

  it("scopes a candidate bypass header to the exact generated deployment origin", () => {
    expect(source).not.toContain("extraHTTPHeaders");
    expect(source).toContain('if (target.origin !== config.origin)');
    expect(source).toContain('"x-vercel-protection-bypass": config.vercelBypassSecret');
  });

  it("never logs secrets, email addresses, response bodies, or Playwright error details", () => {
    expect(source).not.toMatch(/console\.(?:log|error|warn)\([^\n]*(?:email|password|secret|body|error\.message)/i);
    expect(source).not.toContain("console.error(error)");
    expect(source).not.toContain("page.content()");
  });

  it("rediscovers and deletes only the deterministic canary graph before matching the saved baseline", () => {
    expect(stateSource).toContain("resolveBrowserCanaryStateConfiguration");
    expect(stateSource).toContain("rollbackSyncRun");
    expect(stateSource).toContain("NOT (connection_id = ANY");
    expect(stateSource).toContain("NOT (run_id = ANY");
    expect(stateSource).toContain("Before applying browser-canary.ged");
    expect(stateSource).toContain("readCanonicalArchiveSnapshot");
    expect(stateSource).toContain("sameCanonicalSnapshot");
    expect(stateSource).toContain("restoreTemporalBaseline");
    expect(stateSource).toContain('column !== "created_at" && column !== "updated_at"');
    expect(stateSource).toContain('sortOrderColumn: "sort_order" | null');
    expect(stateSource).toContain('tableBaseline.sortOrderColumn');
    expect(stateSource).not.toContain("to_jsonb(canonical_row) -");
    expect(stateSource).toContain("sessionIds");
    expect(stateSource).toContain('DELETE FROM public."session"');
    expect(stateSource).toContain('flags[0] === "--expect-complete"');
    expect(stateSource).not.toMatch(/DELETE FROM (?:people|person_facts|sources|raw_records)\s+WHERE archive_id = \$1\s*$/m);
  });

  it("admits the enriched demo baseline while retaining a bounded state file", () => {
    expect(stateSource).toContain("const maxStateBytes = 64 * 1024;");
    expect(stateSource).toContain("metadata.size > maxStateBytes");
    expect(stateSource).not.toContain("metadata.size > 32 * 1024");
  });

  it("runs the full browser journey only in an ephemeral synthetic CI cell with guaranteed cleanup", () => {
    const job = ciSource.slice(
      ciSource.indexOf("  browser-canary:"),
      ciSource.indexOf("\n  release-contract:")
    );
    expect(job).toContain("timeout-minutes: 30");
    expect(job).toContain(pinnedAction("checkout"));
    expect(job).toContain(pinnedAction("setupNode"));
    expect(job).toContain("git rev-parse HEAD");
    expect(job).toContain("npm run build");
    expect(job).toContain("npm run start -- --hostname 127.0.0.1 --port 3107");
    expect(job).not.toContain("npm run dev");
    expect(job).toContain("scripts/browser-canary-state.ts prepare disposable");
    expect(job).toContain("npm run test:e2e");
    expect(job).toContain("KINRESOLVE_INSECURE_LOOPBACK_CANARY_ACKNOWLEDGEMENT");
    expect(job).toContain("KINRESOLVE_INSECURE_LOOPBACK_CANARY_ORIGIN: \"true\"");
    expect(job).toMatch(/name: Run the authenticated synthetic journey[\s\S]*?NODE_ENV: production[\s\S]*?npm run test:e2e/);
    expect(job).toContain("scripts/browser-canary-state.ts cleanup disposable");
    expect(job).toContain("Restore the exact archive, identity, and object baseline");
    expect(job).toContain("steps.browser-baseline.outcome == 'success'");
    expect(job).toContain("if: ${{ always() }}");
    expect(job).toContain('kill -- -"$app_pid"');
    expect(job).toContain('kill -KILL -- -"$app_pid"');
    expect(job).toContain("browser-canary-app-log-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(job).toContain("synthetic-browser-canary@example.test");
    expect(job).toContain("KINRESOLVE_API_CURSOR_SECRET:");
    expect(job).toContain("minio/minio@sha256:");
    expect(ciSource).toContain("needs: [static, database, release-upgrade, release-compatibility, large-import, large-integration-import, browser-canary, identity-canary, release-contract]");
  });
});

function productionConfiguration(overrides: Record<string, string | undefined> = {}) {
  return resolveBrowserCanaryConfiguration("production", {
    KINRESOLVE_CANARY_ORIGIN: "https://app.kinresolve.com",
    KINRESOLVE_CANARY_APP_BASE_URL: "https://app.kinresolve.com",
    KINRESOLVE_CANARY_RELEASE_SHA: releaseSha,
    KINRESOLVE_CANARY_DATASET_MODE: "pilot",
    KINRESOLVE_CANARY_API_V1_ENABLED: "false",
    KINRESOLVE_CANARY_OBSERVABILITY_PROBE_SECRET: probeSecret,
    ...overrides
  });
}
