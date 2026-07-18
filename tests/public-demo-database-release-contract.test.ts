import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "public-demo-release.yml"),
  "utf8"
);
const sessionStartRoute = readFileSync(
  path.join(process.cwd(), "app", "api", "demo", "sessions", "route.ts"),
  "utf8"
);
const sessionResetRoute = readFileSync(
  path.join(process.cwd(), "app", "api", "demo", "session", "reset", "route.ts"),
  "utf8"
);

function workflowStep(name: string): { contents: string; start: number } {
  const marker = `- name: ${name}`;
  const start = workflow.indexOf(marker);
  expect(start, `missing workflow step: ${name}`).toBeGreaterThan(-1);
  const end = workflow.indexOf("\n      - name:", start + marker.length);
  return {
    contents: workflow.slice(start, end === -1 ? workflow.length : end),
    start
  };
}

function workflowStepNames(): string[] {
  return [...workflow.matchAll(/^      - name: (.+)$/gm)].map((match) => match[1]);
}

describe("public demo database release contract", () => {
  it("attests the migration credential's exact database identity before any mutation", () => {
    const identity = workflowStep(
      "Attest the exact demo migration database before mutation"
    );
    const migration = workflowStep("Migrate and provision only the isolated demo database");

    expect(identity.start).toBeLessThan(migration.start);
    expect(identity.contents).toContain(
      "DATABASE_IDENTITY_URL: ${{ secrets.MIGRATION_DATABASE_URL }}"
    );
    expect(identity.contents).toContain(
      "EXPECTED_DATABASE_IDENTITY: ${{ vars.KINRESOLVE_DATABASE_IDENTITY }}"
    );
    expect(identity.contents).toContain(
      'actual_database_identity="$(npm run --silent db:identity)"'
    );
    expect(identity.contents).toContain(
      '[[ "$actual_database_identity" =~ ^[a-f0-9]{64}$ ]]'
    );
    expect(identity.contents).toContain(
      'test "$actual_database_identity" = "$EXPECTED_DATABASE_IDENTITY"'
    );
    expect(identity.contents).not.toMatch(/^\s*DATABASE_URL:/m);

    const firstDatabaseMutation = Math.min(
      workflow.indexOf("npm run db:migrate"),
      workflow.indexOf("npm run archive:rotate-public-demo-fixture"),
      workflow.indexOf("npm run archive:provision")
    );
    expect(firstDatabaseMutation).toBeGreaterThan(identity.start);
  });

  it("verifies the exact migration ledger and canonical archive before grants or deployment", () => {
    const migration = workflowStep("Migrate and provision only the isolated demo database");
    const verification = workflowStep(
      "Verify the exact demo migration ledger and canonical archive"
    );
    const runtimeGrant = workflowStep("Grant and re-attest public demo runtime access");
    const deployment = workflowStep("Deploy the unaliased public demo candidate");

    expect(verification.start).toBeGreaterThan(migration.start);
    expect(verification.start).toBeLessThan(runtimeGrant.start);
    expect(verification.start).toBeLessThan(deployment.start);
    expect(verification.contents).toContain(
      "MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}"
    );
    expect(verification.contents).toContain(
      "KINRESOLVE_DATABASE_IDENTITY: ${{ vars.KINRESOLVE_DATABASE_IDENTITY }}"
    );
    expect(verification.contents).toContain("EXPECTED_ARCHIVE_ID: kinresolve-demo-public");
    expect(verification.contents).toContain("npm run db:migrations:verify-production");
    expect(verification.contents).not.toMatch(/^\s*DATABASE_URL:/m);
  });

  it("rotates an explicitly expected stale canonical fixture before idempotent provisioning", () => {
    const migration = workflowStep("Migrate and provision only the isolated demo database");
    const rotation = migration.contents.indexOf("npm run archive:rotate-public-demo-fixture");
    const provisioning = migration.contents.indexOf("npm run archive:provision");

    expect(rotation).toBeGreaterThan(-1);
    expect(rotation).toBeLessThan(provisioning);
    expect(migration.contents).toContain("-- --from-version 4");
    expect(migration.contents).toContain(
      "DEMO_FIXTURE_ROTATION_CONFIRMATION: ROTATE-DEMO-FIXTURE:kinresolve-demo-public:4:5"
    );
    expect(migration.contents).toContain("KINRESOLVE_PUBLIC_DEMO_ENABLED: \"true\"");
  });

  it("uses the protected public-demo runtime credential and binds it to candidate health", () => {
    const runtimeGrant = workflowStep("Grant and re-attest public demo runtime access");
    const candidateHealth = workflowStep(
      "Prove protected public demo operational health on the candidate"
    );

    expect(runtimeGrant.contents).toContain("id: runtime_grants");
    expect(runtimeGrant.contents).toContain(
      "PUBLIC_DEMO_RUNTIME_DATABASE_URL: ${{ secrets.PUBLIC_DEMO_RUNTIME_DATABASE_URL }}"
    );
    expect(runtimeGrant.contents).toContain(
      'db:runtime-role:grant-beta-operations -- "$output" --public-demo'
    );
    expect(runtimeGrant.contents).not.toMatch(/^\s*DATABASE_URL:/m);
    expect(runtimeGrant.contents).toContain("runtime_role_identity_sha256=");
    expect(candidateHealth.contents).toContain(
      "EXPECTED_RUNTIME_ROLE_IDENTITY_SHA256: ${{ steps.runtime_grants.outputs.runtime_role_identity_sha256 }}"
    );
  });

  it("requires verified holding immediately after capture and before release work", () => {
    const capture = workflowStep("Capture the current healthy canonical deployment for rollback");
    const holdingOnly = workflowStep("Require verified holding before public demo release");
    const cleanup = workflowStep("Bootstrap lifecycle cleanup before staged candidate health");
    const migration = workflowStep("Migrate and provision only the isolated demo database");
    const runtimeGrant = workflowStep("Grant and re-attest public demo runtime access");
    const build = workflowStep("Build the immutable public demo artifact");
    const candidate = workflowStep("Deploy the unaliased public demo candidate");
    const health = workflowStep("Prove protected public demo operational health on the candidate");
    const canaries = workflowStep("Run the protected cross-browser public demo canaries");
    const load = workflowStep(
      "Prove 25-session capacity and five-second p95 on the held demo cell"
    );
    const names = workflowStepNames();

    expect(names.indexOf("Require verified holding before public demo release")).toBe(
      names.indexOf("Capture the current healthy canonical deployment for rollback") + 1
    );
    expect(holdingOnly.start).toBeGreaterThan(capture.start);
    for (const subsequent of [migration, runtimeGrant, cleanup, build, candidate, health, canaries, load]) {
      expect(holdingOnly.start).toBeLessThan(subsequent.start);
    }
    expect(holdingOnly.contents).toContain(
      "ROLLBACK_KIND: ${{ steps.previous.outputs.rollback_kind }}"
    );
    expect(holdingOnly.contents).toContain('test "$ROLLBACK_KIND" = "holding"');
    expect(capture.contents).toContain(
      "APPROVED_HOLDING_DEPLOYMENT_ID: ${{ secrets.DEMO_HOLDING_DEPLOYMENT_ID }}"
    );
    expect(capture.contents).toContain("validate-vercel-deployment.mjs holding-record");
    expect(capture.contents).toContain("rollback_kind=holding");
    expect(capture.contents).not.toContain("demo-rollback-or-holding");
  });

  it("enforces endpoint quiescence and revalidates exact holding before each drain", () => {
    const preflight = workflowStep(
      "Prove the captured rollback target is healthy before candidate deployment"
    );
    const protection = workflowStep("Prove every generated candidate origin remains protected");
    const reproof = workflowStep("Reprove canonical holding after request quiescence");
    const bootstrap = workflowStep("Bootstrap lifecycle cleanup before staged candidate health");
    const canaries = workflowStep("Run the protected cross-browser public demo canaries");
    const finalReproof = workflowStep(
      "Reprove canonical holding immediately before final lifecycle drain"
    );
    const finalDrain = workflowStep("Final zero-capacity lifecycle drain before load");
    const load = workflowStep(
      "Prove 25-session capacity and five-second p95 on the held demo cell"
    );
    const names = workflowStepNames();

    expect(sessionStartRoute).toContain("export const maxDuration = 60;");
    expect(sessionResetRoute).toContain("export const maxDuration = 60;");
    expect(preflight.contents).toContain("verified_at_epoch=");
    expect(reproof.start).toBeGreaterThan(protection.start);
    expect(reproof.start).toBeLessThan(bootstrap.start);
    expect(names.indexOf("Bootstrap lifecycle cleanup before staged candidate health")).toBe(
      names.indexOf("Reprove canonical holding after request quiescence") + 1
    );
    expect(reproof.contents).toContain("minimum_quiescence_seconds=65");
    expect(reproof.contents).toContain("steps.holding_preflight.outputs.verified_at_epoch");
    expect(reproof.contents).toContain("steps.previous.outputs.deployment_id");
    expect(reproof.contents).toContain(
      "APPROVED_HOLDING_DEPLOYMENT_ID: ${{ secrets.DEMO_HOLDING_DEPLOYMENT_ID }}"
    );
    expect(reproof.contents).toContain("validate-vercel-deployment.mjs holding-record");
    expect(reproof.contents).toContain("cmp \"$RUNNER_TEMP/public-demo-held-before-drain.html\" holding/login.html");
    expect(reproof.contents).toContain('test "$health_status" = "404"');
    expect(finalReproof.start).toBeGreaterThan(canaries.start);
    expect(finalReproof.start).toBeLessThan(finalDrain.start);
    expect(finalReproof.contents).toContain(
      "APPROVED_HOLDING_DEPLOYMENT_ID: ${{ secrets.DEMO_HOLDING_DEPLOYMENT_ID }}"
    );
    expect(finalReproof.contents).toContain("validate-vercel-deployment.mjs holding-record");
    expect(finalDrain.start).toBeLessThan(load.start);
    expect(names.indexOf("Final zero-capacity lifecycle drain before load")).toBe(
      names.indexOf("Reprove canonical holding immediately before final lifecycle drain") + 1
    );
    expect(names.indexOf("Prove 25-session capacity and five-second p95 on the held demo cell")).toBe(
      names.indexOf("Final zero-capacity lifecycle drain before load") + 1
    );
  });

  it("bootstraps lifecycle cleanup on the staged candidate after the holding precondition", () => {
    const runtimeGrant = workflowStep("Grant and re-attest public demo runtime access");
    const candidate = workflowStep("Fetch and validate the exact candidate record");
    const protection = workflowStep("Prove every generated candidate origin remains protected");
    const holdingOnly = workflowStep("Require verified holding before public demo release");
    const bootstrap = workflowStep("Bootstrap lifecycle cleanup before staged candidate health");
    const health = workflowStep("Prove protected public demo operational health on the candidate");

    expect(bootstrap.start).toBeGreaterThan(holdingOnly.start);
    expect(bootstrap.start).toBeGreaterThan(candidate.start);
    expect(bootstrap.start).toBeGreaterThan(protection.start);
    expect(bootstrap.start).toBeGreaterThan(runtimeGrant.start);
    expect(bootstrap.start).toBeLessThan(health.start);
    expect(bootstrap.contents).toContain(
      "EXPECTED_RUNTIME_ROLE_IDENTITY_SHA256: ${{ steps.runtime_grants.outputs.runtime_role_identity_sha256 }}"
    );
    expect(bootstrap.contents).toContain(
      "PUBLIC_DEMO_RUNTIME_DATABASE_URL: ${{ secrets.PUBLIC_DEMO_RUNTIME_DATABASE_URL }}"
    );
    expect(bootstrap.contents).toContain('DATABASE_AUTO_MIGRATE: "false"');
    expect(bootstrap.contents).toContain("KINRESOLVE_DATASET_MODE: demo");
    expect(bootstrap.contents).toContain('KINRESOLVE_PUBLIC_DEMO_ENABLED: "true"');
    expect(bootstrap.contents).toContain(
      "ROLLBACK_KIND: ${{ steps.previous.outputs.rollback_kind }}"
    );
    expect(bootstrap.contents).toContain("scripts/public-demo-cleanup-bootstrap.mjs");
    expect(bootstrap.contents).not.toContain("CRON_SECRET");
  });
});
