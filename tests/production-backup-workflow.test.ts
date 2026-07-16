import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "production-backup.yml"),
  "utf8"
);
const offsite = readFileSync(
  path.join(process.cwd(), "scripts", "recovery-offsite.mjs"),
  "utf8"
);

describe("protected production backup workflow", () => {
  it("runs manually through the protected release concurrency boundary until the pilot cell exists", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).not.toContain("cron:");
    expect(workflow).toContain("environment: production-backup");
    expect(workflow).toContain("group: kinresolve-beta-release");
    expect(workflow).toContain("queue: max");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain('test "${GITHUB_REF}" = "refs/heads/main"');
  });

  it("binds every backup to the exact healthy deployed main commit before production credentials", () => {
    const health = workflow.indexOf("${PRODUCTION_APP_BASE_URL}/api/internal/health");
    const release = workflow.indexOf("release_commit=$(jq -er '.releaseCommitSha'");
    const ancestry = workflow.indexOf('git merge-base --is-ancestor "${release_commit}" origin/main');
    const checkout = workflow.indexOf('git checkout --detach "${release_commit}"');
    const databaseCredential = workflow.indexOf("secrets.MIGRATION_DATABASE_URL");
    expect(health).toBeGreaterThan(-1);
    expect(workflow).toContain("secrets.KINRESOLVE_OBSERVABILITY_PROBE_SECRET");
    expect(workflow).toContain('.database.identity == $databaseIdentity');
    expect(workflow).toContain(".storage.identityVerified == true");
    expect(health).toBeLessThan(release);
    expect(release).toBeLessThan(ancestry);
    expect(ancestry).toBeLessThan(checkout);
    expect(checkout).toBeLessThan(databaseCredential);
  });

  it("fences, drains, and rejects any active work before capturing both data planes", () => {
    const acquire = workflow.indexOf("release:fence:control -- acquire");
    const drain = workflow.indexOf("sleep 360");
    const database = workflow.indexOf("scripts/capture-recovery-database.mjs");
    const objects = workflow.indexOf("scripts/capture-recovery-objects.mjs");
    expect(acquire).toBeGreaterThan(-1);
    expect(acquire).toBeLessThan(drain);
    expect(drain).toBeLessThan(database);
    expect(database).toBeLessThan(objects);
    for (const proof of [
      ".activeJobLeases == 0",
      ".unexpiredUploadIntents == 0",
      ".stragglerTransactions == 0",
      ".stragglerVisibilityVerified == true",
      ".candidateSemanticsVerified == true"
    ]) expect(workflow).toContain(proof);
  });

  it("encrypts and checksum-round-trips database and two-prefix object backups off-provider", () => {
    const encrypt = workflow.indexOf('age --recipient "${RECOVERY_AGE_RECIPIENT}"');
    const upload = workflow.indexOf("scripts/recovery-offsite.mjs upload");
    const download = workflow.indexOf("scripts/recovery-offsite.mjs download");
    const release = workflow.indexOf("release:fence:control -- release");
    const evidence = workflow.indexOf("scripts/assemble-production-backup-evidence.mjs");
    expect(workflow).toContain("scripts/recovery-database-tool.mjs");
    expect(workflow).toContain("manifests objects");
    expect(workflow).toContain("scripts/validate-supabase-recovery-point.mjs");
    expect(workflow).toContain('prefix="production-backup/$(date -u +%F)/${RELEASE_COMMIT}/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"');
    expect(encrypt).toBeGreaterThan(-1);
    expect(encrypt).toBeLessThan(upload);
    expect(upload).toBeLessThan(download);
    expect(download).toBeLessThan(release);
    expect(release).toBeLessThan(evidence);
    expect(offsite).toContain("production-backup\\/[0-9]{4}-[0-9]{2}-[0-9]{2}");
    expect(offsite).toContain('IfNoneMatch: "*"');
    expect(offsite).toContain("ChecksumSHA256");
    expect(offsite).toContain("GetBucketVersioningCommand");
    expect(offsite).toContain("GetObjectLockConfigurationCommand");
    expect(offsite).toContain("GetObjectRetentionCommand");
    expect(offsite).toContain('retention?.Mode !== "COMPLIANCE"');
    expect(offsite).toContain("VersionId: exactVersion");
    expect(workflow).toContain("RECOVERY_BACKUP_S3_MIN_RETENTION_DAYS");
    expect(workflow).toContain("database_version=$(jq -er '.storage.versionId'");
    expect(workflow).toContain("objects_version=$(jq -er '.storage.versionId'");
  });

  it("attests and uploads only a privacy-safe receipt, then signals completion", () => {
    const assemble = workflow.indexOf("scripts/assemble-production-backup-evidence.mjs");
    const attest = workflow.indexOf("actions/attest@");
    const upload = workflow.indexOf("actions/upload-artifact@", attest);
    const deadman = workflow.indexOf("BACKUP_DEADMAN_URL");
    expect(assemble).toBeLessThan(attest);
    expect(attest).toBeLessThan(upload);
    expect(upload).toBeLessThan(deadman);
    const artifactStep = workflow.slice(upload, workflow.indexOf("Signal the backup dead-man monitor"));
    expect(artifactStep).toContain("production-backup-evidence.json");
    expect(artifactStep).not.toContain(".dump.age");
    expect(artifactStep).not.toContain("objects.tar.age");
  });

  it("publishes cleanup authority before mutation and keeps the receipt schema exact-version bound", () => {
    const lease = workflow.indexOf("production-backup-cleanup-lease.mjs create");
    const leaseArtifact = workflow.indexOf(
      "Publish the immutable backup cleanup lease before fence acquisition"
    );
    const acquire = workflow.indexOf("release:fence:control -- acquire");
    expect(lease).toBeGreaterThan(-1);
    expect(lease).toBeLessThan(leaseArtifact);
    expect(leaseArtifact).toBeLessThan(acquire);
    expect(workflow).toContain("production-backup-cleanup-lease-${{ github.run_attempt }}");
  });

  it("releases interrupted fences and removes local private material on every outcome", () => {
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("fence-release-required");
    expect(workflow.match(/release:fence:control -- release/g)).toHaveLength(2);
    expect(workflow).toContain('rm -rf "${BACKUP_WORK}"');
    expect(workflow).not.toContain("destroy-recovery-database-target.mjs");
    expect(workflow).not.toContain("cleanup-recovery-objects.mjs");
    const jobEnvironment = workflow.slice(workflow.indexOf("    env:"), workflow.indexOf("    steps:"));
    expect(jobEnvironment).not.toContain("secrets.");
  });
});
