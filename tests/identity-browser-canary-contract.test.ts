import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { insecureLoopbackCanaryOriginAcknowledgement } from "@/lib/insecure-loopback-canary";
import {
  assertFreshDisposableIdentityCounts,
  identityBrowserCanaryMutationAcknowledgement,
  identityBrowserCanaryLegalEnvironment,
  passwordResetIdentifierDigest,
  resolveIdentityBrowserCanaryConfiguration,
  type DisposableIdentityCounts
} from "@/scripts/identity-browser-canary-contract";

const releaseSha = "a".repeat(40);
const baseEnvironment = {
  ...identityBrowserCanaryLegalEnvironment,
  NODE_ENV: "production",
  APP_BASE_URL: "http://127.0.0.1:3117",
  AUTH_SECRET: "auth-secret-distinct-0123456789abcdef",
  DATABASE_AUTO_MIGRATE: "false",
  DATABASE_URL: "postgres://kinresolve:kinresolve@127.0.0.1:5432/kinresolve_identity_canary",
  KINRESOLVE_API_CURSOR_SECRET: "cursor-secret-distinct-0123456789abcdef",
  KINRESOLVE_API_V1_ENABLED: "true",
  KINRESOLVE_BETA_PRIVACY_HMAC_SECRET: "privacy-secret-distinct-0123456789abcdef",
  KINRESOLVE_BUILD_COMMIT_SHA: releaseSha,
  KINRESOLVE_CANARY_RELEASE_SHA: releaseSha,
  KINRESOLVE_DATASET_MODE: "demo",
  KINRESOLVE_DEPLOYMENT_MODE: "hosted",
  KINRESOLVE_DNA_ENABLED: "false",
  KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
  KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
  KINRESOLVE_IDENTITY_CANARY_ALLOW_MUTATION: "true",
  KINRESOLVE_IDENTITY_CANARY_MUTATION_ACKNOWLEDGEMENT: identityBrowserCanaryMutationAcknowledgement,
  KINRESOLVE_IDENTITY_CANARY_ORIGIN: "http://127.0.0.1:3117",
  KINRESOLVE_IDENTITY_CANARY_RUN_ID: "run-0123456789abcdef",
  KINRESOLVE_INSECURE_LOOPBACK_CANARY_ACKNOWLEDGEMENT: insecureLoopbackCanaryOriginAcknowledgement,
  KINRESOLVE_INSECURE_LOOPBACK_CANARY_ORIGIN: "true",
  KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
  KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true",
  KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
  KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
  KINRESOLVE_SCHEDULED_WRITES_ENABLED: "false",
  KINSLEUTH_ALLOW_SIGNUPS: "false",
  KINSLEUTH_ARCHIVE_ID: "archive-identity-canary"
};

const emptyCounts: DisposableIdentityCounts = {
  accounts: 0,
  apiRateLimits: 0,
  apiTokens: 0,
  authRateLimits: 0,
  betaAuditEvents: 0,
  betaInvitations: 0,
  betaOperatorNonces: 0,
  betaTermsAcceptances: 0,
  betaVerificationTokens: 0,
  sessions: 0,
  securityEvents: 0,
  users: 0,
  verifications: 0
};

describe("disposable identity browser canary configuration", () => {
  it("admits only the exact local hosted beta boundary", () => {
    expect(resolveIdentityBrowserCanaryConfiguration(baseEnvironment)).toEqual({
      appBaseUrl: "http://127.0.0.1:3117",
      archiveId: "archive-identity-canary",
      databaseName: "kinresolve_identity_canary",
      databaseUrl: baseEnvironment.DATABASE_URL,
      headless: true,
      origin: "http://127.0.0.1:3117",
      runId: "run-0123456789abcdef",
      timeoutMs: 45_000
    });
  });

  it.each([
    ["remote database", { DATABASE_URL: "postgres://kinresolve:secret@db.example.test/kinresolve_identity_canary" }],
    ["different database", { DATABASE_URL: "postgres://kinresolve:secret@127.0.0.1/persistent_staging" }],
    ["database host override", { DATABASE_URL: "postgres://kinresolve:secret@127.0.0.1/kinresolve_identity_canary?host=db.example.test" }],
    ["encoded database name", { DATABASE_URL: "postgres://kinresolve:secret@127.0.0.1/%6binresolve_identity_canary" }],
    ["localhost browser origin", { KINRESOLVE_IDENTITY_CANARY_ORIGIN: "http://localhost:3117" }],
    ["origin path", { KINRESOLVE_IDENTITY_CANARY_ORIGIN: "http://127.0.0.1:3117/app" }],
    ["origin mismatch", { APP_BASE_URL: "http://127.0.0.1:3118" }],
    ["missing acknowledgement", { KINRESOLVE_IDENTITY_CANARY_MUTATION_ACKNOWLEDGEMENT: undefined }],
    ["persistent staging mode", { KINRESOLVE_DATASET_MODE: "pilot" }],
    ["publishing enabled", { KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "true" }],
    ["binary uploads enabled", { KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "true" }],
    ["development server", { NODE_ENV: "development" }],
    ["missing production runtime", { NODE_ENV: undefined }],
    ["non-synthetic legal manifest", { KINRESOLVE_BETA_LEGAL_STATUS: "pending" }],
    ["missing insecure-loopback opt-in", { KINRESOLVE_INSECURE_LOOPBACK_CANARY_ORIGIN: undefined }],
    ["wrong insecure-loopback acknowledgement", { KINRESOLVE_INSECURE_LOOPBACK_CANARY_ACKNOWLEDGEMENT: "yes" }],
    ["short release SHA", { KINRESOLVE_CANARY_RELEASE_SHA: "a".repeat(39) }],
    ["build and release mismatch", { KINRESOLVE_BUILD_COMMIT_SHA: "b".repeat(40) }],
    ["mixed browser mutation profile", { KINRESOLVE_CANARY_ALLOW_MUTATION: "true" }],
    ["Vercel runtime marker", { VERCEL_URL: undefined }],
    ["email provider credential", { RESEND_API_KEY: "re_must-never-enter-disposable-canary" }],
    ["external AI credential", { OPENAI_API_KEY: "must-never-enter-disposable-canary" }],
    ["Vercel bypass credential", { VERCEL_AUTOMATION_BYPASS_SECRET: "must-never-enter-disposable-canary" }],
    ["shared private credential", { KINRESOLVE_API_CURSOR_SECRET: baseEnvironment.AUTH_SECRET }]
  ])("refuses %s", (_label, override) => {
    expect(() => resolveIdentityBrowserCanaryConfiguration({
      ...baseEnvironment,
      ...override
    })).toThrow();
  });
});

describe("disposable identity browser canary state contract", () => {
  it("accepts a truly fresh identity and API evidence database", () => {
    expect(() => assertFreshDisposableIdentityCounts(emptyCounts)).not.toThrow();
  });

  it.each(Object.keys(emptyCounts))("rejects pre-existing %s", (key) => {
    expect(() => assertFreshDisposableIdentityCounts({
      ...emptyCounts,
      [key]: 1
    })).toThrow(/pre-existing/i);
  });

  it("derives the Better Auth hashed reset identifier without retaining the raw token", () => {
    const token = "KnownSyntheticResetToken_123456";
    const expected = createHash("sha256")
      .update(`reset-password:${token}`, "utf8")
      .digest("base64url");

    expect(passwordResetIdentifierDigest(token)).toBe(expected);
    expect(expected).not.toContain(token);
    expect(() => passwordResetIdentifierDigest("short")).toThrow(/invalid/i);
  });
});

describe("identity canary artifact boundary", () => {
  it("binds the disposable database to the canonical demo fixture version", () => {
    const state = readFileSync(path.join(process.cwd(), "scripts/identity-browser-canary-state.ts"), "utf8");
    expect(state).toContain('import { demoFixtureVersion } from "../lib/archive-provisioning.ts"');
    expect(state).toContain("row.demo_fixture_version !== demoFixtureVersion");
    expect(state).not.toMatch(/row\.demo_fixture_version\s*!==\s*\d+/);
  });

  it("keeps browser credentials out of environment configuration and forbids provider access", () => {
    const contract = readFileSync(path.join(process.cwd(), "scripts/identity-browser-canary-contract.ts"), "utf8");
    expect(contract).not.toMatch(/CANARY_(?:EMAIL|PASSWORD|TOKEN)/);
    expect(contract).toContain('"RESEND_API_KEY"');
    expect(contract).toContain('"OPENAI_API_KEY"');
    expect(contract).toContain('"VERCEL_AUTOMATION_BYPASS_SECRET"');
  });

  it("labels providerless acceptance precisely and emits no browser artifacts", () => {
    const runner = readFileSync(path.join(process.cwd(), "scripts/identity-browser-canary.ts"), "utf8");
    expect(runner).toContain("providerless UI/service harness");
    expect(runner).toContain("transactional email delivery remains a separate launch gate");
    expect(runner).toContain("page.route(acceptUrl");
    expect(runner).toContain("acceptBetaInvitation");
    expect(runner).not.toMatch(/screenshot|\.tracing\.|trace:\s|video:\s/);
    expect(runner).not.toMatch(
      /console\.(?:log|error|warn)\([^\n]*\$\{[^}\n]*(?:email|password|token|secret)/i
    );
  });

  it("runs as a required production job in one explicitly destroyed disposable cell", () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    const start = workflow.indexOf("  identity-canary:");
    const end = workflow.indexOf("\n  release-contract:", start);
    const job = workflow.slice(start, end);

    expect(packageJson.scripts?.["test:identity-e2e"]).toBe(
      "node --import tsx scripts/identity-browser-canary.ts"
    );
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(job).toContain("NODE_ENV: production");
    expect(job).toContain("kinresolve_identity_canary");
    expect(job).toContain("archive-identity-canary");
    expect(job).toContain("KINRESOLVE_BUILD_COMMIT_SHA=$release_sha");
    expect(job).toContain("KINRESOLVE_CANARY_RELEASE_SHA=$release_sha");
    for (const [name, value] of Object.entries(identityBrowserCanaryLegalEnvironment)) {
      expect(job).toContain(`${name}: "${value}"`);
    }
    expect(job).toContain("npm ci --include=dev");
    expect(job).toContain("npm run build");
    expect(job).toContain("npm run start -- --hostname 127.0.0.1 --port 3117");
    expect(job).toContain("npm run test:identity-e2e");
    expect(job).toContain("--tmpfs /var/lib/postgresql/data");
    expect(job).toContain("docker rm --force kinresolve-identity-canary-postgres");
    expect(job).toContain("if: ${{ always() }}");
    expect(job).toContain("actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5");
    expect(job).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
    expect(job).not.toMatch(/RESEND_API_KEY|OPENAI_API_KEY|VERCEL_AUTOMATION_BYPASS_SECRET/);
    expect(job).not.toMatch(/upload-artifact|screenshot|\.tracing\.|trace:\s|video:\s/);
    expect(job.indexOf("Start the disposable identity database")).toBeLessThan(job.indexOf("npm run build"));
    expect(job.indexOf("npm run test:identity-e2e")).toBeLessThan(
      job.indexOf("Destroy the disposable identity cell")
    );
    expect(workflow).toContain("IDENTITY_CANARY_RESULT: ${{ needs['identity-canary'].result }}");
    expect(workflow).toContain('test "$IDENTITY_CANARY_RESULT" = "success"');
  });
});
