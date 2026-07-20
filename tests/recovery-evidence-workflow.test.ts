import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pinnedActionWithComment } from "./helpers/action-pins";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "recovery-evidence.yml"),
  "utf8"
);
const databaseTool = readFileSync(
  path.join(process.cwd(), "scripts", "recovery-database-tool.mjs"),
  "utf8"
);
const databaseCommand = readFileSync(
  path.join(process.cwd(), "lib", "recovery-database-command.ts"),
  "utf8"
);
const objectOperations = readFileSync(
  path.join(process.cwd(), "lib", "recovery-evidence-operations.ts"),
  "utf8"
);
const runtimeAttestation = readFileSync(
  path.join(process.cwd(), "scripts", "attest-recovery-runtime-database.mjs"),
  "utf8"
);
const databaseDestruction = readFileSync(
  path.join(process.cwd(), "scripts", "destroy-recovery-database-target.mjs"),
  "utf8"
);
const recoveryHealth = readFileSync(
  path.join(process.cwd(), "scripts", "validate-recovery-health.mjs"),
  "utf8"
);
const runtimeGrant = readFileSync(
  path.join(process.cwd(), "scripts", "grant-beta-operations-runtime-role.mjs"),
  "utf8"
);
const evidenceAssembler = readFileSync(
  path.join(process.cwd(), "scripts", "assemble-recovery-evidence.mjs"),
  "utf8"
);

describe("protected production recovery evidence workflow", () => {
  it("dispatches only an exact main SHA and version through the protected environment", () => {
    expect(workflow).toContain("environment: production-recovery");
    expect(workflow).toContain("group: kinresolve-beta-release");
    expect(workflow).toContain("queue: max");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain('test "${GITHUB_REF}" = "refs/heads/main"');
    expect(workflow).toContain('test "${GITHUB_SHA}" = "${RELEASE_COMMIT}"');
    expect(workflow).toContain('test "$(git rev-parse origin/main)" = "${RELEASE_COMMIT}"');
    expect(workflow.match(/^      [a-z_]+:\n        description:/gm)).toHaveLength(6);
  });

  it("requires exact infrastructure, protection, destruction, and writer acknowledgements before secrets", () => {
    const acknowledgementGate = workflow.indexOf(
      'test "${AUTO_ASSIGNMENT_ACKNOWLEDGEMENT}" = "I acknowledge Vercel production deployment auto-assignment is disabled in the protected project dashboard."'
    );
    const protectionGate = workflow.indexOf(
      'test "${DEPLOYMENT_PROTECTION_ACKNOWLEDGEMENT}" = "I acknowledge Vercel Standard Protection covers every generated deployment URL and has no exceptions."'
    );
    const destructionGate = workflow.indexOf(
      'test "${TARGET_DESTRUCTION_ACKNOWLEDGEMENT}" = "DESTROY DISPOSABLE KIN RESOLVE RECOVERY TARGET AFTER PROOF"'
    );
    const writerGate = workflow.indexOf("I acknowledge the production writer perimeter contains only the canonical Vercel runtime");
    const checkout = workflow.indexOf("Check out the exact candidate");
    const firstSecret = workflow.indexOf("secrets.");
    for (const gate of [acknowledgementGate, protectionGate, destructionGate, writerGate]) {
      expect(gate).toBeGreaterThan(-1);
      expect(gate).toBeLessThan(checkout);
      expect(gate).toBeLessThan(firstSecret);
    }
  });

  it("validates the Vercel deployment bypass guard before credentials or database access", () => {
    const guard = workflow.indexOf("npm run vercel:config:validate");
    const dependencyInstall = workflow.indexOf("npm ci");
    const vercelCredentials = workflow.indexOf("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    const productionDatabase = workflow.indexOf("RECOVERY_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}");

    expect(guard).toBeGreaterThan(workflow.indexOf("Verify candidate provenance and version"));
    expect(guard).toBeLessThan(dependencyInstall);
    expect(guard).toBeLessThan(vercelCredentials);
    expect(guard).toBeLessThan(productionDatabase);
  });

  it("proves a fail-closed 31-minute fence and exact final activation assertion", () => {
    expect(workflow).toContain("sleep 1860");
    expect(workflow).toContain(".stragglerTransactions == 0");
    expect(readFileSync(path.join(process.cwd(), "scripts", "capture-recovery-database.mjs"), "utf8"))
      .toContain("The recovery database does not contain the exact active release fence.");
    expect(workflow).toContain("/api/cron/import-uploads");
    expect(workflow).toContain("/api/cron/integration-jobs");
    expect(workflow).toContain("secrets.RELEASE_FENCE_SECRET");
    expect(workflow.split('[[ "${RELEASE_FENCE_SECRET}" =~ ^[A-Za-z0-9_-]{43,128}$ ]]')).toHaveLength(3);
    expect(workflow).toContain("fence-recovery-${RELEASE_COMMIT}");
    expect(workflow).toContain("npm run --silent release:fence:control -- acquire");
    const acquire = workflow.indexOf("npm run --silent release:fence:control -- acquire");
    const deploy = workflow.indexOf("vercel deploy --prebuilt --prod --skip-domain");
    const candidateAssert = workflow.indexOf("/api/release/fence/assert");
    const drain = workflow.indexOf("sleep 1860");
    const finalAssert = workflow.lastIndexOf("/api/release/fence/assert");
    const assemble = workflow.indexOf("scripts/assemble-recovery-evidence.mjs");
    expect(acquire).toBeGreaterThan(-1);
    expect(acquire).toBeLessThan(deploy);
    expect(deploy).toBeLessThan(candidateAssert);
    expect(candidateAssert).toBeLessThan(drain);
    expect(drain).toBeLessThan(finalAssert);
    expect(finalAssert).toBeLessThan(assemble);
    expect(workflow).not.toContain("/api/release/fence/release");
  });

  it("round-trips encrypted database and both object namespaces into distinct targets", () => {
    for (const marker of [
      "pg_dump",
      "pg_restore",
      "age --recipient",
      "scripts/recovery-offsite.mjs upload",
      "scripts/recovery-offsite.mjs download",
      "archive-private",
      "legacy-gedcom",
      "RECOVERY_TARGET_DATABASE_IDENTITY",
      "RECOVERY_TARGET_SUPABASE_PROJECT_REF",
      "RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY",
      "RECOVERY_TARGET_RUNTIME_DATABASE_URL",
      "npm run db:migrate:production",
      "npm run db:migrations:verify-production",
      "scripts/validate-recovery-health.mjs",
      'KINRESOLVE_SCHEDULED_WRITES_ENABLED: "true"',
      'KINRESOLVE_API_V1_ENABLED: "false"'
    ]) expect(`${workflow}\n${databaseTool}\n${databaseCommand}\n${objectOperations}`).toContain(marker);
    expect(recoveryHealth).toContain('expectedReleaseCommit: gitSha(required("RELEASE_COMMIT"))');
    expect(workflow).toContain('test "${KINRESOLVE_DATABASE_IDENTITY}" != "${RECOVERY_TARGET_DATABASE_IDENTITY}"');
    expect(workflow).toContain('test "${KINRESOLVE_OBJECT_STORAGE_IDENTITY}" != "${RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY}"');
    expect(workflow).toContain('test "${KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID}" != "${RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID}"');
    expect(workflow).toContain('test "${SUPABASE_PROJECT_REF}" != "${RECOVERY_TARGET_SUPABASE_PROJECT_REF}"');
    expect(workflow).toContain('DATABASE_URL: ${{ secrets.RECOVERY_TARGET_RUNTIME_DATABASE_URL }}');
    expect(databaseTool).not.toContain("--no-privileges");
    expect(workflow).toContain("RECOVERY_BACKUP_S3_MIN_RETENTION_DAYS");
    expect(workflow).toContain("database_version=$(jq -er '.storage.versionId'");
    expect(workflow).toContain("objects_version=$(jq -er '.storage.versionId'");
    expect(workflow).toContain(
      '"${database_version}" "${RECOVERY_WORK}/database-restored.dump.age"'
    );
    expect(workflow).toContain(
      '"${objects_version}" "${RECOVERY_WORK}/objects-restored.tar.age"'
    );
    expect(evidenceAssembler).toContain(
      '["completedAt", "operation", "sha256", "size", "storage"]'
    );
    expect(evidenceAssembler).toContain("offsite backup exact-version locator is invalid");
    expect(evidenceAssembler).toContain("offsite backup COMPLIANCE retention proof is invalid");
    expect(workflow).toContain('RECOVERY_TARGET_DATABASE_REPLACEMENT_POLICY: ${{ vars.RECOVERY_TARGET_DATABASE_REPLACEMENT_POLICY }}');
    expect(databaseTool).toContain("identity-bound-disposable-v1");
    expect(databaseTool).toContain("validateConfiguredDatabaseIdentity");
    expect(databaseTool).toContain("assertSupabaseDatabaseProjectBinding");
    expect(databaseCommand.match(/"--dbname",\s+databaseName/g)).toHaveLength(2);
    expect(databaseCommand).toContain('command: "pg_restore"');
    expect(databaseCommand).toContain('"--no-password"');
    expect(databaseTool).toContain('stdio: "ignore"');
    const restoreStep = workflow.slice(
      workflow.indexOf("Restore raw database into the distinct recovery target"),
      workflow.indexOf("Apply candidate migrations and require the exact candidate ledger")
    );
    expect(restoreStep).toContain(
      "RECOVERY_TARGET_SUPABASE_PROJECT_REF: ${{ vars.RECOVERY_TARGET_SUPABASE_PROJECT_REF }}"
    );
    expect(restoreStep).toContain("scripts/recovery-database-tool.mjs");
    expect(restoreStep).toContain("restore \"${RECOVERY_WORK}/database-restored.dump\"");
  });

  it("attests a distinct bounded runtime role on the exact target without granting fence control", () => {
    for (const marker of [
      "sameDatabaseSessionVerified",
      "has_privileged_membership",
      "has_owner_membership",
      "release_fence_readable",
      "release_fence_mutable",
      "public_schema_create",
      "representativeAppWriteRolledBack",
      "pg_catalog.pg_stat_activity",
      "routine.proowner",
      "type_record.typowner"
    ]) expect(runtimeAttestation).toContain(marker);
    expect(runtimeAttestation).toContain("'pg_write_all_data'");
    expect(runtimeAttestation).toContain('runtime.release_fence_mutable !== false');
    expect(runtimeAttestation).toContain('runtime.rolsuper !== false');
    expect(runtimeAttestation).toContain('runtime.owns_database !== false');
    expect(runtimeAttestation).not.toContain('runtime.rolbypassrls !== false');
  });

  it("grants and re-attests the exact beta operations contract on the restored runtime role", () => {
    const migrationComplete = workflow.indexOf("migration-completed-at.txt");
    const grant = workflow.indexOf("Grant and re-attest recovery beta operations runtime access");
    const runtimeAttest = workflow.indexOf(
      "Attest a distinct bounded-privilege runtime credential on the exact target"
    );
    expect(grant).toBeGreaterThan(migrationComplete);
    expect(grant).toBeLessThan(runtimeAttest);
    const grantStep = workflow.slice(grant, runtimeAttest);
    expect(grantStep).toContain("secrets.RECOVERY_TARGET_DATABASE_URL");
    expect(grantStep).toContain("secrets.RECOVERY_TARGET_RUNTIME_DATABASE_URL");
    expect(grantStep).toContain("db:runtime-role:grant-beta-operations");
    expect(grantStep).toContain("--recovery-target");
    expect(grantStep).not.toContain("PUBLIC_DEMO_RUNTIME_DATABASE_URL");
    expect(grantStep).not.toContain("--public-demo");
    expect(grantStep).toContain('grantContract == "beta-operations-v1"');
    expect(grantStep).toContain("beta_data_operations");
    expect(grantStep).toContain("beta_worker_heartbeats");
    expect(runtimeGrant).toContain("RECOVERY_TARGET_DATABASE_URL");
    expect(runtimeGrant).toContain("RECOVERY_TARGET_RUNTIME_DATABASE_URL");
  });

  it("requires non-null, well-formed operational diagnostics from restored protected health", () => {
    expect(recoveryHealth).toContain("requireOperationalDiagnostics: true");
  });

  it("restores the exact evidenced prefix before applying only remaining candidate migrations", () => {
    const rawCapture = workflow.indexOf('"${RECOVERY_WORK}/raw-restore-database.json"');
    const preMigrationTime = workflow.indexOf("pre-migration-restored-at.txt");
    const migrationStart = workflow.indexOf("migration-started-at.txt");
    const migrate = workflow.indexOf("npm run db:migrate:production", migrationStart);
    const exactLedger = workflow.indexOf("npm run db:migrations:verify-production", migrate);
    const postCapture = workflow.indexOf('"${RECOVERY_WORK}/post-migration-database.json"', exactLedger);
    const migrationComplete = workflow.indexOf("migration-completed-at.txt", postCapture);
    expect(workflow).toContain("RECOVERY_DATABASE_CAPTURE_PHASE: source-prefix");
    expect(workflow).toContain("RECOVERY_DATABASE_CAPTURE_PHASE: restored-prefix");
    expect(workflow).toContain("RECOVERY_DATABASE_CAPTURE_PHASE: candidate-final");
    expect(rawCapture).toBeGreaterThan(-1);
    expect(rawCapture).toBeLessThan(preMigrationTime);
    expect(preMigrationTime).toBeLessThan(migrationStart);
    expect(migrationStart).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(exactLedger);
    expect(exactLedger).toBeLessThan(postCapture);
    expect(postCapture).toBeLessThan(migrationComplete);
    const migrationStep = workflow.slice(
      workflow.lastIndexOf("- name:", migrationStart),
      workflow.indexOf("- name:", migrationComplete)
    );
    expect(migrationStep).not.toContain("source-after-database.json");
  });

  it("uses an exact-SHA unaliased Vercel control candidate while canonical remains the approved holding", () => {
    expect(workflow).toContain("secrets.FIRST_CUTOVER_HOLDING_DEPLOYMENT_ID");
    expect(workflow).toContain("scripts/validate-vercel-deployment.mjs holding");
    expect(workflow).toContain("vercel deploy --prebuilt --prod --skip-domain");
    expect(workflow).toContain('githubCommitSha=${RELEASE_COMMIT}');
    expect(workflow).toContain("scripts/validate-vercel-deployment.mjs candidate");
    expect(workflow).toContain("RECOVERY_CONTROL_ORIGIN: ${{ steps.recovery-candidate.outputs.deployment_url }}");
    expect(workflow).toContain("Remove pulled production secrets and prebuilt output");
    expect(workflow).toContain("Prove the generated recovery URL is protected without a bypass");
    expect(workflow).toContain('test "${status}" = "401" || test "${status}" = "403"');
    expect(workflow).not.toContain('test "${status}" =~ ^3');
  });

  it("does not place secrets in job scope and proves identity-bound target cleanup before evidence", () => {
    const jobEnvironment = workflow.slice(workflow.indexOf("    env:"), workflow.indexOf("    steps:"));
    expect(jobEnvironment).not.toContain("secrets.");
    expect(workflow).toContain("scripts/cleanup-recovery-objects.mjs");
    expect(workflow).toContain("target-object-cleanup.json");
    expect(workflow).toContain("target-object-cleanup-proof.json");
    expect(workflow).toContain("destroy-recovery-database-target.mjs");
    expect(workflow).toContain("target-database-destruction.json");
    expect(workflow).toContain("RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN");
    expect(workflow).toContain("RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID");
    expect(databaseDestruction).toContain('deletionResponse.status !== 200');
    expect(databaseDestruction).toContain('deletedProject.ref !== targetProjectRef');
    expect(databaseDestruction).toContain('response.status === 404');
    expect(databaseDestruction).toContain("validateConfiguredDatabaseIdentity");
    const objectCleanup = workflow.indexOf("Remove and prove removal of all restored target object data");
    const databaseCleanup = workflow.indexOf("Destroy and prove deletion of the disposable recovery database project");
    const finalFenceAssert = workflow.lastIndexOf("/api/release/fence/assert");
    const assemble = workflow.indexOf("scripts/assemble-recovery-evidence.mjs");
    const attest = workflow.indexOf("actions/attest@");
    expect(objectCleanup).toBeLessThan(databaseCleanup);
    expect(databaseCleanup).toBeLessThan(finalFenceAssert);
    expect(finalFenceAssert).toBeLessThan(assemble);
    expect(assemble).toBeLessThan(attest);
  });

  it("publishes an exact source-run cleanup lease before any protected mutation or secret", () => {
    const install = workflow.indexOf("npm ci");
    const create = workflow.indexOf("scripts/recovery-cleanup-lease.mjs create");
    const leaseUpload = workflow.indexOf("name: production-recovery-cleanup-lease");
    const firstSecret = workflow.indexOf("secrets.");
    const fence = workflow.indexOf("npm run --silent release:fence:control -- acquire");
    const targetRestore = workflow.indexOf("Restore raw database into the distinct recovery target");
    expect(create).toBeGreaterThan(install);
    expect(create).toBeLessThan(leaseUpload);
    expect(leaseUpload).toBeLessThan(firstSecret);
    expect(leaseUpload).toBeLessThan(fence);
    expect(leaseUpload).toBeLessThan(targetRestore);
    const leaseStep = workflow.slice(
      workflow.lastIndexOf("- name:", create),
      workflow.indexOf("- name:", leaseUpload + 1)
    );
    expect(leaseStep).toContain("SOURCE_HEAD_SHA: ${{ env.RELEASE_COMMIT }}");
    expect(leaseStep).toContain("SOURCE_RUN_ATTEMPT: ${{ github.run_attempt }}");
    expect(leaseStep).toContain("SOURCE_RUN_ID: ${{ github.run_id }}");
    const leaseArtifact = workflow.slice(leaseUpload, workflow.indexOf("- name:", leaseUpload));
    expect(leaseArtifact).toContain("production-recovery-cleanup-lease.json");
    expect(leaseArtifact).toContain("if-no-files-found: error");
    expect(leaseArtifact).toContain("retention-days: 90");
  });

  it("attests recovery evidence and publishes only the two bounded JSON artifacts", () => {
    expect(workflow).toContain(`uses: ${pinnedActionWithComment("attest")}`);
    expect(workflow).toContain(`uses: ${pinnedActionWithComment("checkout")}`);
    expect(workflow).toContain(`uses: ${pinnedActionWithComment("setupNode")}`);
    expect(workflow).toContain("name: production-recovery-evidence-${{ github.run_attempt }}");
    expect(workflow).toContain("name: production-recovery-cleanup-lease-${{ github.run_attempt }}");
    const uploadMarker = `uses: ${pinnedActionWithComment("uploadArtifact")}`;
    expect(workflow.split(uploadMarker)).toHaveLength(3);
    const upload = workflow.slice(workflow.lastIndexOf(uploadMarker));
    expect(upload).toContain("/recovery-evidence.json");
    expect(upload).not.toContain("database.dump");
    expect(upload).not.toContain("objects.tar");
    expect(workflow).not.toContain("continue-on-error");
  });
});
