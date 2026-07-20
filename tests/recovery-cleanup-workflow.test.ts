import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pinnedAction } from "./helpers/action-pins";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "recovery-cleanup.yml"),
  "utf8"
);
const objectJanitor = readFileSync(
  path.join(process.cwd(), "scripts", "cleanup-recovery-object-target.mjs"),
  "utf8"
);

describe("failed recovery target janitor", () => {
  it("runs in its own queued safety group only for exact failed recovery events", () => {
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("- Production recovery evidence");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'cancelled'");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'timed_out'");
    expect(workflow).toContain("group: kinresolve-beta-recovery-cleanup");
    expect(workflow).toContain("queue: max");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("scripts/authorize-workflow-run-source.mjs");
    expect(workflow).toContain(
      "EXPECTED_SOURCE_WORKFLOW_PATH: .github/workflows/recovery-evidence.yml"
    );
    expect(workflow).toContain(
      "EXPECTED_SOURCE_WORKFLOW_ID: ${{ vars.RECOVERY_EVIDENCE_WORKFLOW_ID }}"
    );
    expect(workflow).toContain(
      'REQUIRE_EXPECTED_SOURCE_WORKFLOW_ID: "true"'
    );
    expect(workflow).not.toContain("EXPECTED_SOURCE_WORKFLOW_NAME");
    expect(workflow).not.toContain("DISPLAY_TITLE_TEMPLATES");
    expect(workflow).toContain("ALLOWED_SOURCE_EVENTS: workflow_dispatch");
    expect(workflow).toContain("ALLOWED_SOURCE_CONCLUSIONS: failure,cancelled,timed_out");
    expect(workflow).toContain("REQUIRED_HEAD_BRANCH: main");
  });

  it("authorizes without protected credentials and fails closed if a published lease disappears", () => {
    const authorizeStart = workflow.indexOf("  authorize:");
    const cleanupStart = workflow.indexOf("  cleanup:");
    const authorize = workflow.slice(authorizeStart, cleanupStart);
    expect(authorize).not.toContain("environment:");
    expect(authorize).not.toContain("secrets.");
    expect(authorize).toContain("actions: read");
    const trustedMainCheckout = authorize.indexOf(
      "Check out the trusted authorization gate from main"
    );
    const authorization = authorize.indexOf("scripts/authorize-workflow-run-source.mjs");
    const leaseDiscovery = authorize.indexOf(
      "artifacts?name=${RECOVERY_CLEANUP_LEASE_ARTIFACT_NAME}&per_page=100"
    );
    expect(trustedMainCheckout).toBeGreaterThan(-1);
    expect(trustedMainCheckout).toBeLessThan(authorization);
    expect(authorization).toBeGreaterThan(-1);
    expect(authorization).toBeLessThan(leaseDiscovery);
    expect(authorize).toContain("ref: main");
    expect(authorize).toContain("fetch-depth: 1");
    expect(authorize).toContain("persist-credentials: false");
    expect(authorize).toContain("production-recovery-cleanup-lease-${{ github.event.workflow_run.run_attempt }}");
    expect(authorize).toContain("artifacts?name=${RECOVERY_CLEANUP_LEASE_ARTIFACT_NAME}&per_page=100");
    expect(authorize).toContain("response.total_count !== artifacts.length");
    expect(authorize).toContain("artifacts.length !== 1");
    expect(authorize).toContain("artifact?.expired !== false");
    expect(authorize).toContain("expiresAt <= Date.now()");
    expect(authorize).toContain('artifact?.workflow_run?.head_sha !== process.env.SOURCE_HEAD_SHA');
    expect(authorize).toContain('appendFileSync(process.env.GITHUB_OUTPUT, "lease_present=false\\n")');
    expect(authorize).toContain("actions/runs/${SOURCE_RUN_ID}/attempts/${SOURCE_RUN_ATTEMPT}/jobs?per_page=100");
    expect(authorize).toContain('job?.name === "Prove encrypted production recovery"');
    expect(authorize).toContain('step?.name === "Publish the immutable source-run cleanup lease before protected mutations"');
    expect(authorize).toContain('publicationSteps[0]?.conclusion === "success"');
    expect(authorize).toContain("never published a cleanup lease");
    expect(authorize).toContain("actions/artifacts/${ARTIFACT_ID}/zip");
    expect(authorize).toContain("Check out the immutable trusted cleanup implementation");
    expect(authorize).toContain("ref: ${{ github.sha }}");
    expect(authorize).not.toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    expect(authorize).not.toContain("cache: npm");
    expect(authorize).toContain('test "$(git rev-parse --verify \'HEAD^{commit}\')" = "${GITHUB_SHA}"');
    expect(authorize).toContain('git merge-base --is-ancestor HEAD origin/main');
    expect(authorize).toContain('git merge-base --is-ancestor "${SOURCE_HEAD_SHA}" origin/main');
    expect(authorize).toContain("scripts/recovery-cleanup-lease.mjs validate-source");
  });

  it("enters the protected cleanup environment only for an authorized exact artifact", () => {
    expect(workflow).toContain("if: needs.authorize.result == 'success' && needs.authorize.outputs.authorized == 'true'");
    expect(workflow).toContain("environment: production-recovery-cleanup");
    const protectedStart = workflow.indexOf("  cleanup:");
    const protectedJob = workflow.slice(protectedStart);
    const identities = protectedJob.indexOf("Validate current protected identities before immutable checkout");
    const checkout = protectedJob.indexOf(pinnedAction("checkout"));
    const firstSecret = protectedJob.indexOf("secrets.");
    expect(identities).toBeGreaterThan(-1);
    expect(identities).toBeLessThan(checkout);
    expect(checkout).toBeLessThan(firstSecret);
    expect(protectedJob).toContain("Check out the immutable trusted cleanup implementation");
    expect(protectedJob).toContain("ref: ${{ github.sha }}");
    expect(protectedJob).not.toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    expect(protectedJob).not.toContain("cache: npm");
    expect(protectedJob).toContain('test "$(git rev-parse --verify \'HEAD^{commit}\')" = "${GITHUB_SHA}"');
    expect(protectedJob).toContain('git merge-base --is-ancestor HEAD origin/main');
    expect(protectedJob).toContain('git merge-base --is-ancestor "${SOURCE_HEAD_SHA}" origin/main');
    expect(protectedJob).toContain("artifact?.name !== process.env.RECOVERY_CLEANUP_LEASE_ARTIFACT_NAME");
  });

  it("re-downloads and validates the exact lease against protected variables before secrets", () => {
    const protectedStart = workflow.indexOf("  cleanup:");
    const protectedJob = workflow.slice(protectedStart);
    const requery = protectedJob.indexOf("Re-query the authorized immutable cleanup artifact by ID");
    const redownload = protectedJob.indexOf("Re-download only the authorized immutable cleanup artifact");
    const validate = protectedJob.indexOf("scripts/recovery-cleanup-lease.mjs validate");
    const firstSecret = protectedJob.indexOf("secrets.");
    expect(requery).toBeGreaterThan(-1);
    expect(requery).toBeLessThan(redownload);
    expect(redownload).toBeLessThan(validate);
    expect(validate).toBeLessThan(firstSecret);
    for (const marker of [
      "SOURCE_RUN_ID", "SOURCE_RUN_ATTEMPT", "SOURCE_HEAD_SHA", "EXPECTED_ARCHIVE_ID",
      "KINRESOLVE_DATABASE_IDENTITY", "KINRESOLVE_OBJECT_STORAGE_IDENTITY",
      "KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID", "RECOVERY_TARGET_DATABASE_IDENTITY",
      "RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY", "RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID",
      "SUPABASE_PROJECT_REF", "RECOVERY_TARGET_SUPABASE_PROJECT_REF"
    ]) expect(protectedJob).toContain(marker);
  });

  it("gates both destructive paths on successful exact lease validation", () => {
    expect(workflow).toContain("scripts/cleanup-recovery-object-target.mjs");
    expect(workflow).toContain("scripts/destroy-recovery-database-target.mjs");
    expect(workflow).toContain('RECOVERY_TARGET_DESTRUCTION_VERIFY_SOURCE: "false"');
    expect(workflow).toContain("RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN");
    expect(workflow).not.toContain("SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}");
    expect(workflow).toContain("steps.lease.outcome == 'success'");
    expect(workflow.split("steps.lease.outputs.authorized == 'true'")).toHaveLength(3);
    expect(workflow).toContain("always() &&");
    expect(workflow).toContain("steps.install.outcome == 'success'");
    expect(objectJanitor).toContain("recoveryNamespacePrefix(archiveId, name)");
    expect(objectJanitor).toContain("isRecoveryIdentitySentinel");
    expect(objectJanitor).toContain("providerStoreIdFromUrl");
    expect(objectJanitor).not.toContain('required("BLOB_READ_WRITE_TOKEN")');
    expect(workflow).not.toContain("upload-artifact");
  });
});
