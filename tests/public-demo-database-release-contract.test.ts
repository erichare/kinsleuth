import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "public-demo-release.yml"),
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

  it("bootstraps lifecycle cleanup on the staged candidate before requiring fresh health", () => {
    const runtimeGrant = workflowStep("Grant and re-attest public demo runtime access");
    const candidate = workflowStep("Fetch and validate the exact candidate record");
    const protection = workflowStep("Prove every generated candidate origin remains protected");
    const bootstrap = workflowStep("Bootstrap lifecycle cleanup before staged candidate health");
    const health = workflowStep("Prove protected public demo operational health on the candidate");

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
