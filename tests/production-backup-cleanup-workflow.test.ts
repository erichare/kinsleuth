import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cleanupWorkflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "production-backup-cleanup.yml"),
  "utf8"
);
const sourceWorkflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "production-backup.yml"),
  "utf8"
);
const cleanupScript = readFileSync(
  path.join(process.cwd(), "scripts", "release-production-backup-fence.mjs"),
  "utf8"
);

describe("independent production backup fence cleanup", () => {
  it("runs independently after every failed, cancelled, or timed-out exact backup attempt", () => {
    expect(cleanupWorkflow).toContain("workflow_run:");
    expect(cleanupWorkflow).toContain("Production encrypted backup");
    expect(cleanupWorkflow).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(cleanupWorkflow).toContain("github.event.workflow_run.conclusion == 'cancelled'");
    expect(cleanupWorkflow).toContain("github.event.workflow_run.conclusion == 'timed_out'");
    expect(cleanupWorkflow).toContain('run?.path !== ".github/workflows/production-backup.yml"');
    expect(cleanupWorkflow).toContain(
      "EXPECTED_SOURCE_WORKFLOW_ID: ${{ vars.PRODUCTION_BACKUP_WORKFLOW_ID }}"
    );
    expect(cleanupWorkflow).toContain("run?.workflow_id");
    expect(cleanupWorkflow).not.toContain("run?.name");
    expect(cleanupWorkflow).toContain('run?.event !== "workflow_dispatch"');
    expect(cleanupWorkflow).toContain('run?.head_branch !== "main"');
  });

  it("publishes an immutable exact-attempt lease before the source can acquire a fence", () => {
    const create = sourceWorkflow.indexOf("production-backup-cleanup-lease.mjs create");
    const publish = sourceWorkflow.indexOf(
      "Publish the immutable backup cleanup lease before fence acquisition"
    );
    const acquire = sourceWorkflow.indexOf("release:fence:control -- acquire");
    expect(create).toBeGreaterThan(-1);
    expect(create).toBeLessThan(publish);
    expect(publish).toBeLessThan(acquire);
    expect(sourceWorkflow).toContain("production-backup-cleanup-lease-${{ github.run_attempt }}");
    expect(sourceWorkflow).toContain("retention-days: 30");
  });

  it("authorizes without credentials and proves an absent artifact means no fence mutation ran", () => {
    const authorizeStart = cleanupWorkflow.indexOf("  authorize:");
    const cleanupStart = cleanupWorkflow.indexOf("  cleanup:");
    const authorize = cleanupWorkflow.slice(authorizeStart, cleanupStart);
    expect(authorize).not.toContain("secrets.");
    expect(authorize).toContain("actions/runs/${SOURCE_RUN_ID}/artifacts");
    expect(authorize).toContain("attempts/${SOURCE_RUN_ATTEMPT}/jobs");
    expect(authorize).toContain(
      'step?.name === "Publish the immutable backup cleanup lease before fence acquisition"'
    );
    expect(authorize).toContain("production-backup-cleanup-lease.mjs validate-source");
    expect(authorize).toContain("git merge-base --is-ancestor \"${release_commit}\" origin/main");
  });

  it("uses trusted main code and protected cleanup credentials only after exact authorization", () => {
    expect(cleanupWorkflow).toContain("environment: production-backup-cleanup");
    const cleanupStart = cleanupWorkflow.indexOf("  cleanup:");
    const cleanup = cleanupWorkflow.slice(cleanupStart);
    expect(cleanup).toContain("needs.authorize.outputs.authorized == 'true'");
    expect(cleanup.match(/Check out the trusted cleanup implementation from protected main/g)).toHaveLength(1);
    expect(cleanup).toContain("ref: ${{ github.sha }}");
    expect(cleanup).toContain('test "$(git rev-parse --verify \'HEAD^{commit}\')" = "${GITHUB_SHA}"');
    expect(cleanup).toContain("Re-query the authorized immutable cleanup artifact by ID");
    expect(cleanup).toContain("Re-download only the authorized immutable cleanup artifact");
    expect(cleanup).toContain("production-backup-cleanup-lease.mjs validate");
  });

  it("releases only the exact lease-bound fence and safely no-ops when it does not exist", () => {
    expect(cleanupWorkflow).toContain("scripts/release-production-backup-fence.mjs");
    expect(cleanupWorkflow).toContain('.found == false and .transition == "not-found"');
    expect(cleanupWorkflow).toContain('.fence.fenceId == env.RELEASE_FENCE_ID');
    expect(cleanupWorkflow).toContain('.fence.releaseCommitSha == env.RELEASE_COMMIT');
    expect(cleanupScript).toContain('error.code === "NOT_FOUND"');
    expect(cleanupScript).toContain('transition: "not-found"');
    expect(cleanupScript).toContain("releaseReleaseFence(identity, options)");
    expect(cleanupScript).not.toContain("reacquireReleaseFence");
    expect(cleanupScript).not.toContain("acquireReleaseFence");
  });
});
