import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import { betaOperationsRuntimeGrantContract } from "../lib/runtime-database-grants";

async function workflow(name: string): Promise<string> {
  return readFile(path.join(process.cwd(), ".github", "workflows", name), "utf8");
}

const databaseImage =
  "pgvector/pgvector:0.8.1-pg16@sha256:33198da2828a14c30348d2ccb4750833d5ed9a44c88d840a0e523d7417120337";
const exactAutoAssignmentAcknowledgement =
  "I acknowledge Vercel production deployment auto-assignment is disabled in the protected project dashboard.";
const exactAutoAssignmentComparison =
  `test "$AUTO_ASSIGNMENT_ACKNOWLEDGEMENT" = "${exactAutoAssignmentAcknowledgement}"`;
const exactDeploymentProtectionAcknowledgement =
  "I acknowledge Vercel Standard Protection covers every generated deployment URL and has no exceptions.";
const exactDeploymentProtectionComparison =
  `test "$DEPLOYMENT_PROTECTION_ACKNOWLEDGEMENT" = "${exactDeploymentProtectionAcknowledgement}"`;
const exactWriterPerimeterAcknowledgement =
  "I acknowledge the production writer perimeter contains only the canonical Vercel runtime and protected GitHub release/recovery workflows; no external workers, SQL/API writers, or shared database/Blob credentials remain.";
const exactWriterPerimeterComparison =
  `test "$WRITER_PERIMETER_ACKNOWLEDGEMENT" = "${exactWriterPerimeterAcknowledgement}"`;

describe("product CI workflow contract", () => {
  it("runs for every product pull request and main push with an immutable database service", async () => {
    const contents = await workflow("ci.yml");

    expect(contents).toMatch(/pull_request:/);
    expect(contents).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(contents).not.toMatch(/^\s*paths:/m);
    expect(contents).not.toMatch(/^\s*paths-ignore:/m);
    expect(contents).not.toMatch(/continue-on-error/);
    expect(contents.match(new RegExp(databaseImage, "g"))).toHaveLength(7);
  });

  it("exposes every release signal and one fail-closed aggregate gate", async () => {
    const contents = await workflow("ci.yml");

    for (const job of [
      "static",
      "database",
      "release-upgrade",
      "release-compatibility",
      "large-import",
      "large-integration-import",
      "browser-canary",
      "identity-canary",
      "release-contract"
    ]) {
      expect(contents, job).toMatch(new RegExp(`^  ${job}:`, "m"));
    }
    expect(contents).toMatch(/^  gate:/m);
    expect(contents).toMatch(/if:\s*always\(\)/);
    expect(contents).toMatch(
      /STATIC_RESULT.*DATABASE_RESULT.*UPGRADE_RESULT.*COMPATIBILITY_RESULT.*LARGE_IMPORT_RESULT.*LARGE_INTEGRATION_IMPORT_RESULT.*BROWSER_CANARY_RESULT.*IDENTITY_CANARY_RESULT.*RELEASE_CONTRACT_RESULT/s
    );
    expect(contents).toMatch(/test\s+"\$STATIC_RESULT"\s+=\s+"success"/);
    for (const result of [
      "DATABASE_RESULT",
      "UPGRADE_RESULT",
      "COMPATIBILITY_RESULT",
      "LARGE_IMPORT_RESULT",
      "LARGE_INTEGRATION_IMPORT_RESULT",
      "BROWSER_CANARY_RESULT",
      "IDENTITY_CANARY_RESULT",
      "RELEASE_CONTRACT_RESULT"
    ]) {
      expect(contents, result).toMatch(new RegExp(`test\\s+"\\$${result}"\\s+=\\s+"success"`));
    }
  });

  it("keeps package database commands exhaustive and explicit", () => {
    expect(packageJson.scripts["test:db"]).not.toMatch(/tests\//);
    expect(packageJson.scripts["test:db"]).toContain("vitest run");
    expect(packageJson.scripts["test:db"]).toContain("--no-file-parallelism");
    expect(packageJson.scripts["test:release-upgrade"]).toContain("require-release-upgrade-database.mjs");
    expect(packageJson.scripts["test:release-compatibility"]).toContain("require-release-upgrade-database.mjs");
    expect(packageJson.scripts["test:release-compatibility"]).toContain("--no-file-parallelism");
    expect(packageJson.scripts["test:release-compatibility"]).toContain("tests/release-compatibility.test.ts");
    expect(packageJson.scripts["test:db:large"]).toContain("require-test-database.mjs");
    expect(packageJson.scripts["test:db:large"]).toContain("RUN_LARGE_GEDCOM_TEST=true");
    expect(packageJson.scripts["test:db:integration-large"]).toContain("require-test-database.mjs");
    expect(packageJson.scripts["test:db:integration-large"]).toContain("RUN_LARGE_INTEGRATION_TEST=true");
    expect(packageJson.scripts["vercel:config:validate"]).toBe(
      "node --experimental-strip-types scripts/validate-vercel-deployment-config.mjs"
    );
  });

  it("lints every workflow definition with a checksummed pinned actionlint before unit tests", async () => {
    const contents = await workflow("ci.yml");
    const staticJob = job(contents, "static", "database");
    const workflowLint = staticJob.indexOf("Lint workflow definitions");
    const dependencyInstall = staticJob.indexOf("npm ci");

    expect(workflowLint).toBeGreaterThan(0);
    expect(dependencyInstall).toBeGreaterThan(0);
    expect(workflowLint).toBeGreaterThan(dependencyInstall);
    expect(workflowLint).toBeLessThan(staticJob.indexOf("Unit tests"));
    expect(staticJob).toContain(
      "https://github.com/rhysd/actionlint/releases/download/",
    );
    expect(staticJob).toMatch(/actionlint_version="\d+\.\d+\.\d+"/);
    expect(staticJob).toMatch(/expected_sha256="[0-9a-f]{64}"/);
    expect(staticJob).toContain('test "$actual_sha256" = "$expected_sha256"');
    expect(staticJob).toContain("-config-file .github/actionlint.yaml");
  });

  it("validates the Vercel deployment bypass guard in the release-contract job before installation", async () => {
    const contents = await workflow("ci.yml");
    const releaseContract = job(contents, "release-contract", "gate");
    const guard = releaseContract.indexOf("npm run vercel:config:validate");

    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(releaseContract.indexOf("npm ci"));
    expect(guard).toBeLessThan(releaseContract.indexOf("Verify release and workflow contracts"));
  });

  it("runs the forward-only legacy proof in its own local database job with full tag history", async () => {
    const contents = await workflow("ci.yml");
    const compatibility = job(contents, "release-compatibility", "large-import");

    expect(compatibility).toContain("POSTGRES_DB: kinresolve_release_compatibility");
    expect(compatibility).toContain("fetch-depth: 0");
    expect(compatibility).toContain("npm run test:release-compatibility");
    expect(compatibility).toContain("TEST_RELEASE_UPGRADE_DATABASE_URL:");
    expect(compatibility).not.toContain("npm run test:release-upgrade");
  });

  it("isolates both mandatory large import gates", async () => {
    const contents = await workflow("ci.yml");
    const largeGedcom = job(contents, "large-import", "large-integration-import");
    const largeIntegration = job(contents, "large-integration-import", "release-contract");

    expect(largeGedcom).toContain("POSTGRES_DB: kinresolve_large_import");
    expect(largeGedcom).toContain("npm run test:db:large");
    expect(largeGedcom).not.toContain("test:db:integration-large");
    expect(largeIntegration).toContain("POSTGRES_DB: kinresolve_large_integration");
    expect(largeIntegration).toContain("npm run test:db:integration-large");
    expect(largeIntegration).not.toContain("npm run test:db:large");
  });

  it("fails closed when retired real-family demo identifiers return", async () => {
    const contents = await workflow("ci.yml");

    expect(packageJson.scripts["demo:verify"]).toBe("node scripts/verify-fictional-demo.mjs");
    expect(contents).toContain("npm run demo:verify");
    expect(contents.indexOf("npm run demo:verify")).toBeLessThan(contents.indexOf("npm test"));
  });
});

describe("stable release workflow contract", () => {
  it("is manual, serialized, and forward-only with every reviewed cutover input", async () => {
    const contents = await workflow("vercel-release.yml");
    const verify = job(contents, "verify", "staging");
    const dispatchValidation = verify.indexOf("Validate dispatch request before checkout");
    const autoAssignmentGate = verify.indexOf(exactAutoAssignmentComparison);
    const deploymentProtectionGate = verify.indexOf(exactDeploymentProtectionComparison);
    const writerPerimeterGate = verify.indexOf(exactWriterPerimeterComparison);
    const checkout = verify.indexOf("Check out the exact candidate revision");
    const firstDeploymentCredential = contents.indexOf(
      "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}"
    );

    expect(contents).toMatch(/^\s*workflow_dispatch:/m);
    expect(contents).not.toMatch(/^\s*release:/m);
    for (const input of [
      "release_commit",
      "release_version",
      "release_policy_acknowledged_at",
      "first_cutover_acknowledgement",
      "recovery_run_id",
      "recovery_evidence_sha256",
      "release_mode",
      "beta_intake_enabled",
      "beta_intake_acknowledgement",
      "api_edge_run_id",
      "api_edge_evidence_sha256",
      "auto_assignment_acknowledgement",
      "deployment_protection_acknowledgement",
      "writer_perimeter_acknowledgement"
    ]) {
      expect(contents, input).toMatch(new RegExp(`^      ${input}:`, "m"));
    }
    expect(contents).toMatch(/group:\s*kinresolve-beta-release/);
    expect(contents).toMatch(/queue:\s*max/);
    expect(contents).toMatch(/cancel-in-progress:\s*false/);
    expect(contents).not.toContain("continue-on-error");
    expect(contents).not.toMatch(/down[-_ ]?migrat|migrat(?:e|ion).*rollback/i);
    expect(verify).toContain(
      "AUTO_ASSIGNMENT_ACKNOWLEDGEMENT: ${{ inputs.auto_assignment_acknowledgement }}"
    );
    expect(verify).toContain(
      "DEPLOYMENT_PROTECTION_ACKNOWLEDGEMENT: ${{ inputs.deployment_protection_acknowledgement }}"
    );
    expect(verify).toContain(
      "WRITER_PERIMETER_ACKNOWLEDGEMENT: ${{ inputs.writer_perimeter_acknowledgement }}"
    );
    expect(verify).toContain(exactAutoAssignmentComparison);
    expect(verify).toContain(exactDeploymentProtectionComparison);
    expect(verify).toContain(exactWriterPerimeterComparison);
    expect(verify).toContain('case "$RELEASE_MODE" in');
    expect(verify).toContain("api-launch)");
    expect(verify).toContain('test -z "$API_EDGE_RUN_ID"');
    expect(verify).toContain('[[ "$API_EDGE_EVIDENCE_SHA256" =~ ^[0-9a-f]{64}$ ]]');
    expect(contents).toMatch(/beta_intake_enabled:[\s\S]*?type: boolean[\s\S]*?default: false/);
    expect(verify).toContain("BETA_INTAKE_ENABLED: ${{ inputs.beta_intake_enabled }}");
    expect(verify).toContain("BETA_INTAKE_ACKNOWLEDGEMENT: ${{ inputs.beta_intake_acknowledgement }}");
    expect(verify).toContain(
      "I acknowledge the beta intake canary submits only fixed synthetic fields to the owner-approved controlled delivery sink and deletes its exact database row."
    );
    expect(verify).toContain('test -z "$BETA_INTAKE_ACKNOWLEDGEMENT"');
    expect(dispatchValidation).toBeGreaterThan(0);
    for (const acknowledgementGate of [autoAssignmentGate, deploymentProtectionGate, writerPerimeterGate]) {
      expect(acknowledgementGate).toBeGreaterThan(dispatchValidation);
      expect(acknowledgementGate).toBeLessThan(checkout);
      expect(acknowledgementGate).toBeLessThan(firstDeploymentCredential);
    }
  });

  it("pins every privileged repository and runtime setup action to an immutable revision", async () => {
    const contents = await workflow("vercel-release.yml");

    expect(contents).not.toContain("actions/checkout@v4");
    expect(contents).not.toContain("actions/setup-node@v4");
    expect(
      contents.match(/actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4/g)
    ).toHaveLength(7);
    expect(
      contents.match(/actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4/g)
    ).toHaveLength(7);
  });

  it("runs a credential-free safety queue gate before release verification or protected environments", async () => {
    const contents = await workflow("vercel-release.yml");
    const safety = job(contents, "safety", "verify");
    const verify = job(contents, "verify", "staging");
    expect(safety).toContain("actions: read");
    expect(safety).toContain("RELEASE_SAFETY_CURRENT_WORKFLOW: release");
    expect(safety).toContain("scripts/validate-release-safety-queue.mjs");
    expect(safety).not.toContain("secrets.");
    expect(verify).toContain("needs: safety");
  });

  it("repeats both mandatory large import gates sequentially before release deployment", async () => {
    const verify = job(await workflow("vercel-release.yml"), "verify", "staging");
    const compatibility = verify.indexOf("npm run test:release-compatibility");
    const largeGedcom = verify.indexOf("npm run test:db:large");
    const largeIntegration = verify.indexOf("npm run test:db:integration-large");
    const build = verify.indexOf("npm run build");

    expect(compatibility).toBeGreaterThan(verify.indexOf("npm run test:release-upgrade"));
    expect(largeGedcom).toBeGreaterThan(compatibility);
    expect(largeGedcom).toBeGreaterThan(0);
    expect(largeIntegration).toBeGreaterThan(largeGedcom);
    expect(build).toBeGreaterThan(largeIntegration);
    expect(verify.match(/TEST_DATABASE_URL:/g)).toHaveLength(3);
  });

  it("proves exact main provenance and a vacant or same-run draft before code or deploy credentials", async () => {
    const contents = await workflow("vercel-release.yml");
    const verify = job(contents, "verify", "staging");
    const dispatchGate = verify.indexOf("Validate dispatch request before checkout");
    const provenance = verify.indexOf("Verify exact candidate provenance");
    const releaseNamespace = verify.indexOf(
      "Verify the candidate release namespace is vacant or exactly repairable"
    );

    expect(dispatchGate).toBeGreaterThan(0);
    expect(verify).toContain("GITHUB_REF_VALUE: ${{ github.ref }}");
    expect(verify).toContain("EXPECTED_GITHUB_SHA: ${{ github.sha }}");
    expect(verify).toContain('test "$GITHUB_REF_VALUE" = "refs/heads/main"');
    expect(verify).toMatch(/ref:\s*\$\{\{ inputs\.release_commit \}\}/);
    expect(verify).toMatch(/fetch-depth:\s*0/);
    expect(verify).toMatch(/persist-credentials:\s*false/);
    expect(provenance).toBeGreaterThan(dispatchGate);
    expect(verify).toContain("HEAD^{commit}");
    expect(verify).toContain("origin/main");
    expect(verify).toContain("git merge-base --is-ancestor");
    expect(verify).toContain("package.json");
    expect(verify).toContain("git ls-remote --tags origin");
    expect(releaseNamespace).toBeGreaterThan(provenance);
    expect(verify).toContain("gh api --paginate --slurp");
    expect(verify).toContain("scripts/github-release-namespace.mjs repairable");
    expect(verify).toContain("RELEASE_WORKFLOW_RUN_ID: ${{ github.run_id }}");
    expect(releaseNamespace).toBeLessThan(verify.indexOf("npm ci"));
    expect(releaseNamespace).toBeLessThan(verify.indexOf("npm run lint"));
    expect(releaseNamespace).toBeLessThan(
      contents.indexOf("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}")
    );
    expect(verify).not.toContain("environment:");
  });

  it("validates the Vercel deployment bypass guard before release database tests or credentials", async () => {
    const contents = await workflow("vercel-release.yml");
    const verify = job(contents, "verify", "staging");
    const guard = verify.indexOf("npm run vercel:config:validate");
    const globalGuard = contents.indexOf("npm run vercel:config:validate");

    expect(guard).toBeGreaterThan(
      verify.indexOf("Verify the candidate release namespace is vacant or exactly repairable")
    );
    expect(guard).toBeLessThan(verify.indexOf("npm ci"));
    expect(guard).toBeLessThan(verify.indexOf("npm run test:db"));
    expect(globalGuard).toBeLessThan(contents.indexOf("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}"));
  });

  it("requires the automation bypass secret before either protected deployment starts", async () => {
    const contents = await workflow("vercel-release.yml");
    const staging = job(contents, "staging", "staging-finalize");
    const production = job(contents, "production", "marketing");
    const stagingValidation = staging.slice(
      staging.indexOf("Validate staging Vercel identifiers"),
      staging.indexOf("Pull isolated staging production settings")
    );
    const productionValidation = production.slice(
      production.indexOf("Validate production Vercel identifiers"),
      production.indexOf("Pull production settings")
    );

    for (const validation of [stagingValidation, productionValidation]) {
      expect(validation).toContain(
        "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"
      );
      expect(validation).toContain('test -n "$VERCEL_AUTOMATION_BYPASS_SECRET"');
    }
  });

  it("requires verified staging before the protected production cutover", async () => {
    const contents = await workflow("vercel-release.yml");

    for (const name of ["verify", "staging", "staging-finalize", "production", "marketing", "publish-release"]) {
      expect(contents, name).toMatch(new RegExp(`^  ${name}:`, "m"));
    }
    expect(job(contents, "staging", "staging-finalize")).toMatch(/needs:\s*verify/);
    expect(job(contents, "staging", "staging-finalize")).toMatch(/environment:\s*beta-staging/);
    expect(job(contents, "staging-finalize", "production")).toMatch(/needs:\s*\[verify, staging\]/);
    expect(job(contents, "staging-finalize", "production")).toContain("needs.staging.result != 'skipped'");
    expect(job(contents, "production", "marketing")).toMatch(/needs:\s*\[verify, staging, staging-finalize\]/);
    expect(job(contents, "production", "marketing")).toMatch(/environment:\s*production/);
    expect(job(contents, "marketing", "publish-release")).toMatch(/needs:\s*production/);
    expect(job(contents, "publish-release")).toMatch(/needs:\s*\[production, marketing\]/);
  });

  it("binds the hosted browser journey to the promoted candidate and restores staging on a fresh runner", async () => {
    const contents = await workflow("vercel-release.yml");
    const staging = job(contents, "staging", "staging-finalize");
    const finalizer = job(contents, "staging-finalize", "production");
    const baseline = staging.indexOf("Capture the exact staging baseline before temporary promotion");
    const upload = staging.indexOf("Upload the pre-promotion staging baseline");
    const promotion = staging.indexOf("Temporarily promote the exact staging candidate");
    const customOrigin = staging.indexOf("Validate the exact staging candidate at the custom origin");
    const journey = staging.indexOf("Run the authenticated synthetic journey at the custom origin");
    const restore = staging.indexOf("Restore the captured staging holding deployment");
    const cleanup = staging.indexOf("Restore the exact staging archive, identity, and object baseline");

    expect(baseline).toBeGreaterThan(staging.indexOf("Smoke the staging candidate"));
    expect(upload).toBeGreaterThan(baseline);
    expect(promotion).toBeGreaterThan(upload);
    expect(customOrigin).toBeGreaterThan(promotion);
    expect(journey).toBeGreaterThan(customOrigin);
    expect(restore).toBeGreaterThan(journey);
    expect(cleanup).toBeGreaterThan(restore);
    expect(staging.slice(baseline, promotion)).not.toContain("STAGING_BROWSER_CANARY_EMAIL");
    expect(staging.slice(baseline, promotion)).not.toContain("STAGING_BROWSER_CANARY_PASSWORD");
    const journeyStep = staging.slice(journey, restore);
    expect(journeyStep).toContain("STAGING_BROWSER_CANARY_EMAIL");
    expect(journeyStep).toContain("STAGING_BROWSER_CANARY_PASSWORD");
    expect(journeyStep).toContain('VERCEL_AUTOMATION_BYPASS_SECRET: ""');
    expect(journeyStep).toContain("npm run test:staging-smoke");
    expect(staging).toContain("staging-browser-canary-baseline-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(staging).toContain("KINRESOLVE_CANARY_USER_ID: ${{ secrets.STAGING_BROWSER_CANARY_USER_ID }}");
    expect(staging).toContain("steps.staging-browser-promotion-marker.outputs.attempted == 'true'");

    expect(finalizer).toContain("timeout-minutes: 20");
    expect(finalizer).toContain("if: ${{ always() && needs.staging.result != 'skipped' }}");
    expect(finalizer).toContain("actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093");
    expect(finalizer).toContain("needs.staging.outputs.browser_baseline_prepared == 'true'");
    expect(finalizer).not.toContain("STAGING_BROWSER_CANARY_EMAIL");
    expect(finalizer).not.toContain("STAGING_BROWSER_CANARY_PASSWORD");
    expect(finalizer.indexOf("Restore the captured staging holding deployment idempotently"))
      .toBeLessThan(finalizer.indexOf("Reapply the exact staging archive, identity, and object baseline"));
    expect(finalizer).toContain('vercel promote "$HOLDING_DEPLOYMENT_URL"');
    expect(finalizer).toContain("scripts/browser-canary-state.ts cleanup staging");
  });

  it("rehearses the same revision and release procedure in an attested isolated staging cell", async () => {
    const contents = await workflow("vercel-release.yml");
    const staging = job(contents, "staging", "staging-finalize");
    const environmentGate = staging.indexOf("scripts/validate-vercel-environment.mjs");
    const releaseContract = staging.indexOf("Validate staging release contract");
    const identityExclusions = staging.indexOf(
      "Prove staging cannot target protected production identities"
    );
    const initialHoldingGate = staging.indexOf("scripts/validate-vercel-deployment.mjs holding");
    const finalHoldingGate = staging.indexOf(
      "scripts/validate-vercel-deployment.mjs holding",
      initialHoldingGate + 1
    );
    const holdingSmoke = staging.indexOf("Smoke the staging holding application immediately before migration");
    const build = staging.indexOf("vercel build --prod");
    const deploy = staging.indexOf("deploy --prebuilt --prod --skip-domain --yes");
    const candidateGate = staging.indexOf("scripts/validate-vercel-deployment.mjs candidate");
    const protectionProbe = staging.indexOf(
      "Prove the generated staging candidate rejects unauthenticated access"
    );
    const identityProbe = staging.indexOf("Attest the staging candidate database before migration");
    const disabledSchedulers = staging.indexOf(
      "Prove both signed staging schedulers are disabled before migration"
    );
    const migrate = staging.indexOf("npm run db:migrate:production");
    const ledger = staging.indexOf("npm run db:migrations:verify-production");
    const runtimeGrant = staging.indexOf("npm run db:runtime-role:grant-beta-operations");
    const fullSmoke = staging.indexOf('SMOKE_PHASE: "full"');

    for (const script of [
      "scripts/validate-vercel-environment.mjs",
      "scripts/validate-release-contract.mjs",
      "scripts/validate-release-policy.mjs",
      "scripts/validate-vercel-deployment.mjs holding",
      "scripts/validate-vercel-deployment.mjs candidate",
      "scripts/smoke-release.mjs"
    ]) {
      expect(staging, script).toContain(script);
    }
    expect(staging).toContain("MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}");
    expect(staging).toContain("EXPECTED_DATASET_MODE: demo");
    expect(staging).toContain('EXPECTED_SCHEDULED_WRITES_ENABLED: "false"');
    expect(staging).toContain("EXPECTED_API_V1_ENABLED: ${{ inputs.release_mode == 'api-launch' }}");
    expect(staging.match(/EXPECTED_BETA_APPLICATIONS_ENABLED: \$\{\{ inputs\.beta_intake_enabled \}\}/g))
      .toHaveLength(2);
    expect(staging).toContain(
      "KINRESOLVE_API_V1_ENABLED: ${{ steps.staging-release-contract.outputs.api_v1_enabled }}"
    );
    expect(staging).toContain("EXPECTED_ARCHIVE_ID: kinresolve-staging-demo");
    expect(staging).toContain("FORBIDDEN_VERCEL_PROJECT_ID: prj_ZK8tbbhxoDuuGFy1k67kW7XgjXzs");
    expect(staging).toContain("APPROVED_HOLDING_DEPLOYMENT_ID: ${{ secrets.STAGING_HOLDING_DEPLOYMENT_ID }}");
    expect(staging).toContain("database_identity: ${{ steps.staging-release-contract.outputs.database_identity }}");
    expect(staging).toContain("object_storage_identity: ${{ steps.staging-release-contract.outputs.object_storage_identity }}");
    expect(staging).toContain(
      "object_storage_provider_id: ${{ steps.staging-identity-exclusions.outputs.object_storage_provider_id }}"
    );
    expect(staging).toContain(
      "FORBIDDEN_PRODUCTION_DATABASE_IDENTITY: ${{ vars.FORBIDDEN_PRODUCTION_DATABASE_IDENTITY }}"
    );
    expect(staging).toContain(
      "FORBIDDEN_PRODUCTION_OBJECT_STORAGE_IDENTITY: ${{ vars.FORBIDDEN_PRODUCTION_OBJECT_STORAGE_IDENTITY }}"
    );
    expect(staging).toContain(
      "FORBIDDEN_PRODUCTION_OBJECT_STORAGE_PROVIDER_ID: ${{ vars.FORBIDDEN_PRODUCTION_OBJECT_STORAGE_PROVIDER_ID }}"
    );
    expect(staging).toContain(
      'test "$STAGING_DATABASE_IDENTITY" != "$FORBIDDEN_PRODUCTION_DATABASE_IDENTITY"'
    );
    expect(staging).toContain(
      'test "$STAGING_OBJECT_STORAGE_IDENTITY" != "$FORBIDDEN_PRODUCTION_OBJECT_STORAGE_IDENTITY"'
    );
    expect(staging).toContain(
      'test "$STAGING_OBJECT_STORAGE_PROVIDER_ID" != "$FORBIDDEN_PRODUCTION_OBJECT_STORAGE_PROVIDER_ID"'
    );
    expect(staging).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"
    );
    expect(staging).toContain('test -n "$VERCEL_AUTOMATION_BYPASS_SECRET"');
    expect(staging).toContain("npm run db:migrate:production");
    expect(staging).toContain("npm run db:migrations:verify-production");
    expect(staging).toContain("vercel build --prod");
    expect(staging).toContain("deploy --prebuilt --prod --skip-domain --yes");
    expect(staging).toContain('--meta "githubCommitSha=$RELEASE_COMMIT"');
    expect(staging).toContain('--meta "releaseTag=$RELEASE_TAG"');
    expect(staging).toContain('--meta "packageVersion=$RELEASE_VERSION"');
    expect(staging).toContain("PREVIOUS_DEPLOYMENT_ID: ${{ steps.staging-holding.outputs.deployment_id }}");
    expect(staging).toContain('SMOKE_PHASE: "full"');
    expect(staging).toContain('KINRESOLVE_SCHEDULED_WRITES_ENABLED: "false"');
    expect(staging).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(staging).toContain('test "$status" = "503"');
    expect(staging).toContain("Scheduled work is unavailable.");
    expect(staging).toContain('SMOKE_PHASE: "identity"');
    expect(staging).toContain('SMOKE_PHASE: "pre-migration"');
    const holdingSmokeStep = staging.slice(holdingSmoke, migrate);
    expect(holdingSmokeStep).toContain(
      "SMOKE_ORIGIN: ${{ steps.staging-release-contract.outputs.app_base_url }}"
    );
    expect(holdingSmokeStep).toContain(
      "KINRESOLVE_DATABASE_IDENTITY: ${{ steps.staging-release-contract.outputs.database_identity }}"
    );
    expect(holdingSmokeStep).toContain(
      "KINRESOLVE_DATASET_MODE: ${{ steps.staging-release-contract.outputs.dataset_mode }}"
    );
    expect(holdingSmokeStep).toContain("RELEASE_VERSION: ${{ inputs.release_version }}");
    expect(staging.split("scripts/validate-vercel-deployment.mjs holding")).toHaveLength(5);
    for (const position of [
      initialHoldingGate,
      finalHoldingGate,
      holdingSmoke,
      environmentGate,
      releaseContract,
      identityExclusions,
      build,
      deploy,
      candidateGate,
      protectionProbe,
      identityProbe,
      disabledSchedulers,
      migrate,
      ledger,
      runtimeGrant,
      fullSmoke
    ]) {
      expect(position).toBeGreaterThan(0);
    }
    expect(staging.slice(environmentGate, releaseContract)).toContain(".vercel/.env.production.local");
    expect(environmentGate).toBeLessThan(build);
    expect(environmentGate).toBeLessThan(deploy);
    expect(environmentGate).toBeLessThan(migrate);
    expect(releaseContract).toBeLessThan(identityExclusions);
    expect(identityExclusions).toBeLessThan(initialHoldingGate);
    expect(identityExclusions).toBeLessThan(build);
    expect(identityExclusions).toBeLessThan(deploy);
    expect(identityExclusions).toBeLessThan(migrate);
    expect(initialHoldingGate).toBeLessThan(build);
    expect(build).toBeLessThan(deploy);
    expect(deploy).toBeLessThan(candidateGate);
    expect(candidateGate).toBeLessThan(protectionProbe);
    expect(protectionProbe).toBeLessThan(identityProbe);
    const protectionProbeStep = staging.slice(protectionProbe, identityProbe);
    expect(protectionProbeStep).toContain("scripts/probe-vercel-candidate-protection.mjs");
    expect(protectionProbeStep).toContain('"$RUNNER_TEMP/staging-candidate.json"');
    expect(protectionProbeStep).toContain("VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}");
    expect(protectionProbeStep).toContain("VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}");
    expect(protectionProbeStep).not.toContain("x-vercel-protection-bypass");
    expect(protectionProbeStep).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(identityProbe).toBeLessThan(disabledSchedulers);
    expect(disabledSchedulers).toBeLessThan(finalHoldingGate);
    expect(finalHoldingGate).toBeLessThan(holdingSmoke);
    expect(holdingSmoke).toBeLessThan(migrate);
    expect(deploy).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(ledger);
    expect(ledger).toBeLessThan(runtimeGrant);
    expect(runtimeGrant).toBeLessThan(fullSmoke);
    const runtimeGrantStep = staging.slice(
      staging.lastIndexOf("- name:", runtimeGrant),
      staging.indexOf("\n      - name:", runtimeGrant)
    );
    expect(runtimeGrantStep).toContain(
      "MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}"
    );
    expect(runtimeGrantStep).toContain(
      "EXPECTED_DATABASE_IDENTITY: ${{ steps.staging-release-contract.outputs.database_identity }}"
    );
    expect(runtimeGrantStep).not.toMatch(/^\s*DATABASE_URL:/m);
    expect(runtimeGrantStep).not.toContain("PUBLIC_DEMO_RUNTIME_DATABASE_URL");
    expect(runtimeGrantStep).not.toContain("--public-demo");
    expect(runtimeGrantStep).toContain('grantContract == "beta-operations-v1"');
    expect(staging).toContain('vercel promote "$CANDIDATE_DEPLOYMENT_URL"');
    expect(staging).toContain('vercel promote "$HOLDING_DEPLOYMENT_URL"');
    expect(staging).not.toContain("rollback");
    expect(staging).not.toContain("gh release create");
  });

  it("gates production mutation on environment, policy, attested recovery, holding, and candidate identity", async () => {
    const contents = await workflow("vercel-release.yml");
    const production = job(contents, "production", "marketing");
    const environmentGate = production.indexOf("scripts/validate-vercel-environment.mjs");
    const releaseGate = production.indexOf("scripts/validate-release-contract.mjs");
    const policyGate = production.indexOf("scripts/validate-release-policy.mjs");
    const readinessGate = production.indexOf("scripts/validate-release-readiness.mjs");
    const apiEdgeGate = production.indexOf("scripts/validate-api-edge-evidence.mjs");
    const initialHoldingGate = production.indexOf("scripts/validate-vercel-deployment.mjs holding");
    const preDeployFence = production.indexOf(
      "Assert the evidenced production fence before production-target deployment"
    );
    const build = production.indexOf("vercel build --prod");
    const identityProbe = production.indexOf("Attest the production candidate database before migration");
    const finalHoldingGate = production.indexOf(
      "Revalidate the production holding deployment immediately before migration"
    );
    const finalHoldingSmoke = production.indexOf(
      "Smoke the production holding application immediately before migration"
    );
    const liveFence = production.indexOf("Assert the live production write fence immediately before database mutation");
    const migrate = production.indexOf("npm run db:migrate:production");

    for (const position of [
      environmentGate,
      releaseGate,
      policyGate,
      readinessGate,
      apiEdgeGate,
      initialHoldingGate,
      preDeployFence,
      build,
      identityProbe,
      finalHoldingGate,
      finalHoldingSmoke,
      liveFence,
      migrate
    ]) {
      expect(position).toBeGreaterThan(0);
    }
    expect(environmentGate).toBeLessThan(migrate);
    expect(production.slice(environmentGate, releaseGate)).toContain(".vercel/.env.production.local");
    expect(environmentGate).toBeLessThan(build);
    expect(releaseGate).toBeLessThan(migrate);
    expect(policyGate).toBeLessThan(migrate);
    expect(readinessGate).toBeLessThan(migrate);
    expect(apiEdgeGate).toBeLessThan(migrate);
    expect(initialHoldingGate).toBeLessThan(migrate);
    expect(initialHoldingGate).toBeLessThan(preDeployFence);
    expect(preDeployFence).toBeLessThan(build);
    expect(build).toBeLessThan(migrate);
    expect(identityProbe).toBeLessThan(migrate);
    expect(readinessGate).toBeLessThan(liveFence);
    expect(identityProbe).toBeLessThan(liveFence);
    expect(identityProbe).toBeLessThan(finalHoldingGate);
    expect(finalHoldingGate).toBeLessThan(finalHoldingSmoke);
    expect(finalHoldingSmoke).toBeLessThan(liveFence);
    expect(liveFence).toBeLessThan(migrate);
    expect(production).toContain("APPROVED_HOLDING_DEPLOYMENT_ID: ${{ secrets.FIRST_CUTOVER_HOLDING_DEPLOYMENT_ID }}");
    expect(production).toContain("EXPECTED_APP_BASE_URL: https://app.kinresolve.com");
    expect(production).toContain("EXPECTED_DATASET_MODE: pilot");
    expect(production).toContain('EXPECTED_SCHEDULED_WRITES_ENABLED: "true"');
    expect(production).toContain("EXPECTED_API_V1_ENABLED: ${{ inputs.release_mode == 'api-launch' }}");
    expect(production.match(/EXPECTED_BETA_APPLICATIONS_ENABLED: \$\{\{ inputs\.beta_intake_enabled \}\}/g))
      .toHaveLength(2);
    expect(production).toContain(
      "KINRESOLVE_API_V1_ENABLED: ${{ steps.production-release-contract.outputs.api_v1_enabled }}"
    );
    expect(production).toContain('SMOKE_PHASE: "pre-migration"');
    expect(production).toContain('KINRESOLVE_SCHEDULED_WRITES_ENABLED: "true"');
    expect(production).toContain("gh attestation verify");
    expect(production).toContain("--signer-workflow \"$GITHUB_REPOSITORY/.github/workflows/recovery-evidence.yml\"");
    expect(production).toContain("--signer-workflow \"$GITHUB_REPOSITORY/.github/workflows/api-edge-evidence.yml\"");
    expect(production).toContain("--source-digest \"$RELEASE_COMMIT\"");
    expect(production).toContain("--deny-self-hosted-runners");
    expect(production).toContain(
      'run.display_title !== "Kin Resolve recovery run " + run.id + " attempt " + run.run_attempt'
    );
    expect(production).toContain(
      '--name "production-recovery-evidence-$recovery_run_attempt"'
    );
    expect(production).toContain(
      '--name "production-api-edge-evidence-$api_edge_run_attempt"'
    );
    expect(production).toContain("fence_activated_at");
    expect(production).toContain("/api/release/fence/assert");
    expect(production.split('[[ "$RELEASE_FENCE_SECRET" =~ ^[A-Za-z0-9_-]{43,128}$ ]]')).toHaveLength(3);
    expect(production).toContain("KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID: ${{ vars.KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID }}");
    expect(production).toContain("RECOVERY_TARGET_DATABASE_IDENTITY: ${{ vars.RECOVERY_TARGET_DATABASE_IDENTITY }}");
    expect(production).toContain("RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY: ${{ vars.RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY }}");
    expect(production).toContain("RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID: ${{ vars.RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID }}");
    expect(production).toContain('test "$PRODUCTION_DATABASE_IDENTITY" != "$STAGING_DATABASE_IDENTITY"');
    expect(production).toContain('test "$PRODUCTION_OBJECT_STORAGE_IDENTITY" != "$STAGING_OBJECT_STORAGE_IDENTITY"');
    expect(production).toContain(
      "STAGING_OBJECT_STORAGE_PROVIDER_ID: ${{ needs.staging.outputs.object_storage_provider_id }}"
    );
    expect(production).toContain(
      'test "$PRODUCTION_OBJECT_STORAGE_PROVIDER_ID" != "$STAGING_OBJECT_STORAGE_PROVIDER_ID"'
    );
    const finalHoldingValidation = production.slice(finalHoldingGate, finalHoldingSmoke);
    expect(finalHoldingValidation).toContain(
      "APPROVED_HOLDING_DEPLOYMENT_ID: ${{ steps.production-holding.outputs.deployment_id }}"
    );
    expect(finalHoldingValidation).toContain(
      '"$RUNNER_TEMP/production-holding-pre-migration.json"'
    );
    const finalHoldingSmokeStep = production.slice(finalHoldingSmoke, liveFence);
    expect(finalHoldingSmokeStep).toContain(
      "SMOKE_ORIGIN: ${{ steps.production-release-contract.outputs.app_base_url }}"
    );
    expect(finalHoldingSmokeStep).toContain('SMOKE_PHASE: "pre-migration"');
  });

  it("deploys and attests the unaliased candidate before dedicated migration and exact ledger proof", async () => {
    const production = job(await workflow("vercel-release.yml"), "production", "marketing");
    const migrate = production.indexOf("npm run db:migrate:production");
    const ledger = production.indexOf("npm run db:migrations:verify-production");
    const runtimeGrant = production.indexOf("npm run db:runtime-role:grant-beta-operations");
    const reassertFence = production.indexOf("Reassert the production write fence after migration");
    const candidateSmoke = production.indexOf("Smoke the production candidate");
    const deploy = production.indexOf("deploy --prebuilt --prod --skip-domain --yes");

    expect(migrate).toBeGreaterThan(0);
    expect(ledger).toBeGreaterThan(migrate);
    expect(runtimeGrant).toBeGreaterThan(ledger);
    expect(reassertFence).toBeGreaterThan(runtimeGrant);
    expect(candidateSmoke).toBeGreaterThan(reassertFence);
    expect(deploy).toBeLessThan(migrate);
    const migrationStep = production.slice(production.lastIndexOf("- name:", migrate), ledger);
    expect(migrationStep).toContain("MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}");
    expect(migrationStep).toContain("KINRESOLVE_DATABASE_IDENTITY:");
    expect(migrationStep).toContain("EXPECTED_ARCHIVE_ID:");
    expect(migrationStep).toContain(
      "EXPECTED_MIGRATION_PREFIX_COUNT: ${{ steps.recovery-readiness.outputs.source_migration_count }}"
    );
    expect(migrationStep).toContain(
      "EXPECTED_MIGRATION_PREFIX_LEDGER_SHA256: ${{ steps.recovery-readiness.outputs.source_migration_ledger_sha256 }}"
    );
    expect(migrationStep).not.toMatch(/^\s*DATABASE_URL:/m);
    const runtimeGrantStep = production.slice(
      production.lastIndexOf("- name:", runtimeGrant),
      production.indexOf("\n      - name:", runtimeGrant)
    );
    expect(runtimeGrantStep).toContain(
      "MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}"
    );
    expect(runtimeGrantStep).toContain(
      "EXPECTED_DATABASE_IDENTITY: ${{ steps.production-release-contract.outputs.database_identity }}"
    );
    expect(runtimeGrantStep).not.toMatch(/^\s*DATABASE_URL:/m);
    expect(runtimeGrantStep).not.toContain("PUBLIC_DEMO_RUNTIME_DATABASE_URL");
    expect(runtimeGrantStep).not.toContain("--public-demo");
    expect(runtimeGrantStep).toContain('grantContract == "beta-operations-v1"');
  });

  it("proves the generated production candidate is private before bypass-authenticated identity smoke", async () => {
    const production = job(await workflow("vercel-release.yml"), "production", "marketing");
    const candidateValidation = production.indexOf("Validate the production candidate deployment");
    const unauthenticatedProbe = production.indexOf(
      "Prove the generated production candidate rejects unauthenticated access"
    );
    const authenticatedSmoke = production.indexOf(
      "Attest the production candidate database before migration"
    );
    const migrate = production.indexOf("npm run db:migrate:production");
    const probeStep = production.slice(unauthenticatedProbe, authenticatedSmoke);
    const authenticatedStep = production.slice(authenticatedSmoke, production.indexOf("\n      - name:", authenticatedSmoke));

    expect(candidateValidation).toBeGreaterThan(0);
    expect(unauthenticatedProbe).toBeGreaterThan(candidateValidation);
    expect(authenticatedSmoke).toBeGreaterThan(unauthenticatedProbe);
    expect(authenticatedSmoke).toBeLessThan(migrate);
    expect(probeStep).toContain("scripts/probe-vercel-candidate-protection.mjs");
    expect(probeStep).toContain('"$RUNNER_TEMP/production-candidate.json"');
    expect(probeStep).toContain("VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}");
    expect(probeStep).toContain("VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}");
    expect(probeStep).not.toContain("x-vercel-protection-bypass");
    expect(probeStep).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(authenticatedStep).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"
    );
    expect(authenticatedStep).toContain("scripts/smoke-release.mjs");
    expect(production).not.toContain('if [[ -n "$VERCEL_AUTOMATION_BYPASS_SECRET" ]]');
  });

  it("validates and smokes an immutable candidate before exact promotion and fence release", async () => {
    const production = job(await workflow("vercel-release.yml"), "production", "marketing");
    const deploy = production.indexOf("deploy --prebuilt --prod --skip-domain --yes");
    const validateCandidate = production.indexOf("scripts/validate-vercel-deployment.mjs candidate");
    const candidateSmoke = production.indexOf("Smoke the production candidate");
    const edgeRecheck = production.indexOf("scripts/verify-live-api-edge-config.mjs");
    const promote = production.indexOf("vercel promote");
    const disableAutoAssignment = production.indexOf(
      "Disable and independently attest production domain auto-assignment"
    );
    const validatePromoted = production.indexOf("scripts/validate-vercel-deployment.mjs promoted");
    const canonicalSmoke = production.indexOf("Smoke the canonical production application");
    const releaseFence = production.indexOf("Release the attested production write fence");
    const finalCanonical = production.indexOf("Revalidate the canonical candidate after releasing the fence");
    const schedulerReconcile = production.indexOf(
      "Reconcile both signed production schedulers after fence release"
    );
    const postReconcileCanonical = production.indexOf(
      "Revalidate the canonical candidate after scheduler reconciliation"
    );
    const finalSmoke = production.indexOf("Smoke the fully enabled canonical production application");

    expect(deploy).toBeGreaterThan(0);
    expect(production).toContain('--meta "githubCommitSha=$RELEASE_COMMIT"');
    expect(production).toContain('--meta "releaseTag=$RELEASE_TAG"');
    expect(production).toContain('--meta "packageVersion=$RELEASE_VERSION"');
    expect(validateCandidate).toBeGreaterThan(deploy);
    expect(candidateSmoke).toBeGreaterThan(validateCandidate);
    expect(edgeRecheck).toBeGreaterThan(candidateSmoke);
    expect(edgeRecheck).toBeLessThan(promote);
    expect(production).toContain("https://api.vercel.com/v1/security/firewall/config/active?$scope_query");
    expect(production).toContain("https://api.vercel.com/v1/security/firewall/bypass?$scope_query&limit=100");
    expect(promote).toBeGreaterThan(candidateSmoke);
    expect(production).toContain('vercel promote "$CANDIDATE_DEPLOYMENT_URL" --yes');
    expect(disableAutoAssignment).toBeGreaterThan(promote);
    expect(disableAutoAssignment).toBeLessThan(validatePromoted);
    const autoAssignmentSafety = production.slice(disableAutoAssignment, validatePromoted);
    expect(autoAssignmentSafety).toContain(
      "scripts/validate-vercel-project-safety.mjs"
    );
    expect(autoAssignmentSafety).toContain("always() &&");
    expect(autoAssignmentSafety).toContain(
      "steps.promotion-marker.outputs.attempted == 'true'"
    );
    expect(autoAssignmentSafety).toContain(
      "steps.domain-auto-assignment.outcome != 'success'"
    );
    expect(autoAssignmentSafety).not.toContain("steps.promote.outcome == 'success'");
    expect(validatePromoted).toBeGreaterThan(promote);
    expect(canonicalSmoke).toBeGreaterThan(validatePromoted);
    expect(releaseFence).toBeGreaterThan(canonicalSmoke);
    expect(finalCanonical).toBeGreaterThan(releaseFence);
    expect(schedulerReconcile).toBeGreaterThan(finalCanonical);
    expect(postReconcileCanonical).toBeGreaterThan(schedulerReconcile);
    expect(production).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(production).toContain('test "$status" = "200"');
    expect(finalSmoke).toBeGreaterThan(finalCanonical);
    expect(production).toContain("${{ steps.recovery-readiness.outputs.fence_id }}");
    const releaseFenceStep = production.slice(releaseFence, finalCanonical);
    expect(releaseFenceStep).toContain(
      "RELEASE_FENCE_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}"
    );
    expect(releaseFenceStep).toContain(
      "EXPECTED_DATABASE_IDENTITY: ${{ steps.production-release-contract.outputs.database_identity }}"
    );
    expect(releaseFenceStep).toContain(
      "EXPECTED_FENCE_ACTIVATION_GENERATION: ${{ steps.assert-write-fence-before-deploy.outputs.activation_generation }}"
    );
    expect(releaseFenceStep).toContain("npm run --silent release:fence:control -- release");
    expect(releaseFenceStep).toContain('.transition == "released"');
    expect(releaseFenceStep).not.toContain("already-released");
    expect(releaseFenceStep).toContain(".fence.activationGeneration == $expected_generation");
    expect(releaseFenceStep).not.toMatch(/FENCE_ORIGIN|RELEASE_FENCE_SECRET|api\/release\/fence\/release/);
    expect(production.indexOf("Recheck the release namespace after cutover")).toBeGreaterThan(finalCanonical);
    expect(production).not.toContain("Reconcile scheduled production work");
  });

  it("proves both production UI origins anonymously without admitting browser credentials or writes", async () => {
    const production = job(await workflow("vercel-release.yml"), "production", "marketing");
    const install = production.indexOf("Install the pinned Chromium browser for production UI proof");
    const candidateServerSmoke = production.indexOf("Smoke the production candidate");
    const candidateBrowser = production.indexOf("Prove the exact production candidate UI anonymously");
    const promote = production.indexOf("Promote the exact production candidate");
    const canonicalServerSmoke = production.indexOf("Smoke the canonical production application");
    const canonicalBrowser = production.indexOf(
      "Prove the canonical production UI anonymously without a bypass"
    );
    const releaseFence = production.indexOf("Release the attested production write fence");
    const candidateStep = production.slice(
      candidateBrowser,
      production.indexOf("\n      - name:", candidateBrowser)
    );
    const canonicalStep = production.slice(
      canonicalBrowser,
      production.indexOf("\n      - name:", canonicalBrowser)
    );

    expect(install).toBeGreaterThan(0);
    expect(production.match(/playwright install --with-deps chromium/g)).toHaveLength(1);
    expect(candidateBrowser).toBeGreaterThan(candidateServerSmoke);
    expect(candidateBrowser).toBeLessThan(promote);
    expect(canonicalBrowser).toBeGreaterThan(canonicalServerSmoke);
    expect(canonicalBrowser).toBeLessThan(releaseFence);
    expect(candidateStep).toContain("steps.production-candidate.outputs.deployment_url");
    expect(candidateStep).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"
    );
    expect(canonicalStep).toContain(
      "KINRESOLVE_CANARY_ORIGIN: ${{ steps.production-release-contract.outputs.app_base_url }}"
    );
    expect(canonicalStep).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    for (const smoke of [candidateStep, canonicalStep]) {
      expect(smoke).toContain("npm run test:production-smoke");
      expect(smoke).toContain('KINRESOLVE_CANARY_HEADLESS: "true"');
      expect(smoke).not.toContain("KINRESOLVE_CANARY_EMAIL");
      expect(smoke).not.toContain("KINRESOLVE_CANARY_PASSWORD");
      expect(smoke).not.toContain("KINRESOLVE_CANARY_ALLOW_MUTATION");
      expect(smoke).not.toContain("KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT");
      expect(smoke).not.toContain("KINRESOLVE_CANARY_ARCHIVE_ID");
      expect(smoke).not.toContain("KINRESOLVE_CANARY_BOOTSTRAP_OWNER");
    }
  });

  it("rolls back only to the captured approved holding deployment and verifies the canonical result", async () => {
    const production = job(await workflow("vercel-release.yml"), "production", "marketing");
    const rollback = production.indexOf("Roll back the production alias to the approved holding deployment");
    const verifyRollback = production.indexOf("Verify the holding deployment after rollback");
    const containWrites = production.indexOf("Contain production writes before rollback");
    const drainWrites = production.indexOf("Drain admitted production work before rollback");

    expect(rollback).toBeGreaterThan(0);
    expect(containWrites).toBeGreaterThan(0);
    expect(drainWrites).toBeGreaterThan(containWrites);
    expect(drainWrites).toBeLessThan(rollback);
    expect(containWrites).toBeLessThan(rollback);
    expect(production).toContain("if: (failure() || cancelled()) &&");
    const containWritesStep = production.slice(containWrites, drainWrites);
    expect(containWritesStep).toContain(
      "RELEASE_FENCE_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}"
    );
    expect(containWritesStep).toContain(
      "EXPECTED_DATABASE_IDENTITY: ${{ steps.production-release-contract.outputs.database_identity }}"
    );
    expect(containWritesStep).toContain(
      "EXPECTED_FENCE_ACTIVATION_GENERATION: ${{ steps.assert-write-fence-before-deploy.outputs.activation_generation }}"
    );
    expect(containWritesStep).toContain("npm run --silent release:fence:control -- contain");
    expect(containWritesStep).toContain(".fence.activationGeneration == ($expected_generation + 1)");
    expect(containWritesStep).not.toMatch(/FENCE_ORIGIN|RELEASE_FENCE_SECRET|api\/release\/fence\/reacquire/);
    expect(production).toContain("steps.drain-production-writes.outcome == 'success'");
    expect(production).toContain("sleep 1860");
    expect(production).toContain("scripts/capture-recovery-database.mjs");
    expect(production).toContain('APPROVED_HOLDING_DEPLOYMENT_ID: ${{ steps.production-holding.outputs.deployment_id }}');
    expect(production).toContain('vercel rollback "$APPROVED_HOLDING_DEPLOYMENT_ID" --yes');
    expect(production).not.toMatch(/vercel rollback\s+--yes/);
    expect(verifyRollback).toBeGreaterThan(rollback);
    expect(production.slice(verifyRollback)).toContain("scripts/validate-vercel-deployment.mjs holding");
    expect(production.slice(verifyRollback)).toContain(
      "Prove rollback left production domain auto-assignment disabled"
    );
    expect(production.slice(verifyRollback)).toContain("scripts/validate-vercel-project-safety.mjs");
    expect(production.slice(verifyRollback)).toContain(
      "verify or disable both schedules in the Vercel Cron Jobs dashboard"
    );
    expect(production).toContain("if: (failure() || cancelled()) && steps.promotion-marker.outputs.attempted == 'true'");
  });

  it("records only exact privacy-safe release evidence after every live gate passes", async () => {
    const production = job(await workflow("vercel-release.yml"), "production", "marketing");
    const finalNamespace = production.indexOf("Recheck the release namespace after cutover");
    const summary = production.indexOf("Record the privacy-safe release gate summary");
    const containment = production.indexOf("Contain production writes before rollback");
    const summaryStep = production.slice(summary, containment);

    expect(summary).toBeGreaterThan(finalNamespace);
    expect(containment).toBeGreaterThan(summary);
    for (const evidence of [
      "FENCE_ID: ${{ steps.recovery-readiness.outputs.fence_id }}",
      "PRODUCTION_CANDIDATE_DEPLOYMENT_ID: ${{ steps.production-candidate.outputs.deployment_id }}",
      "PRODUCTION_HOLDING_DEPLOYMENT_ID: ${{ steps.production-holding.outputs.deployment_id }}",
      "RELEASE_COMMIT: ${{ inputs.release_commit }}",
      "RELEASE_VERSION: ${{ inputs.release_version }}",
      "STAGING_CANDIDATE_DEPLOYMENT_ID: ${{ needs.staging.outputs.candidate_deployment_id }}",
      "STAGING_HOLDING_DEPLOYMENT_ID: ${{ needs.staging.outputs.holding_deployment_id }}"
    ]) {
      expect(summaryStep, evidence).toContain(evidence);
    }
    expect(summaryStep).toContain("$GITHUB_STEP_SUMMARY");
    expect(summaryStep).toContain(
      "Gates: staging isolation, holding, candidate identity, migration ledger, authenticated browser canary, and exact restoration passed"
    );
    expect(summaryStep).toContain(
      "Gates: production recovery, holding, candidate identity, fence, migration ledger, promotion, and anonymous candidate/canonical UI smokes passed"
    );
    expect(summaryStep).not.toContain("${{ secrets.");
    expect(summaryStep).not.toMatch(/DATABASE_URL|MIGRATION_DATABASE_URL|VERCEL_TOKEN/);
  });

  it("gates API launch on an ephemeral exact-archive canary and guaranteed revocation", async () => {
    const production = job(await workflow("vercel-release.yml"), "production", "marketing");
    const step = (name: string): string => {
      const start = production.indexOf(`- name: ${name}`);
      const end = production.indexOf("\n      - name:", start + 1);
      expect(start, name).toBeGreaterThanOrEqual(0);
      return production.slice(start, end < 0 ? production.length : end);
    };
    const prepare = step("Prepare the ephemeral production API canary");
    const candidate = step(
      "Prove the production candidate API with an ephemeral owner-bound token"
    );
    const canonical = step("Prove the canonical production API without a protection bypass");
    const revoke = step("Revoke the ephemeral production API canary");
    const rejected = step(
      "Prove the revoked canary is rejected immediately at the canonical edge"
    );
    const finalize = step("Finalize privacy-safe production API canary evidence");
    const postPromotionEdge = step(
      "Re-read and verify the live API edge configuration after promotion"
    );
    const cleanup = step("Always revoke and remove the ephemeral production API canary");
    const removeEnvironment = step("Remove pulled production environment material");
    const summary = step("Record the privacy-safe release gate summary");

    expect(production.indexOf("Prepare the ephemeral production API canary"))
      .toBeGreaterThan(production.indexOf("Reassert the production write fence after migration"));
    expect(production.indexOf("probe-candidate"))
      .toBeGreaterThan(production.indexOf("Smoke the production candidate"));
    expect(production.indexOf("probe-canonical"))
      .toBeGreaterThan(production.indexOf("Smoke the canonical production application"));
    expect(production.indexOf(" scripts/production-api-canary.mjs revoke"))
      .toBeGreaterThan(production.indexOf("probe-canonical"));
    expect(production.indexOf("prove-revoked"))
      .toBeGreaterThan(production.indexOf(" scripts/production-api-canary.mjs revoke"));
    expect(production.indexOf(" scripts/production-api-canary.mjs finalize"))
      .toBeGreaterThan(production.indexOf("prove-revoked"));
    expect(production.indexOf("Always revoke and remove the ephemeral production API canary"))
      .toBeGreaterThan(production.indexOf(" scripts/production-api-canary.mjs finalize"));
    expect(production.indexOf("live API edge configuration after promotion"))
      .toBeGreaterThan(production.indexOf("Always revoke and remove the ephemeral production API canary"));
    expect(production.indexOf("Release the attested production write fence"))
      .toBeGreaterThan(production.indexOf("live API edge configuration after promotion"));

    for (const gated of [prepare, candidate, canonical, revoke, rejected, finalize, postPromotionEdge]) {
      expect(gated).toContain("if: inputs.release_mode == 'api-launch'");
    }
    expect(prepare).toContain(
      "KINRESOLVE_API_CANARY_OWNER_USER_ID: ${{ secrets.KINRESOLVE_API_CANARY_OWNER_USER_ID }}"
    );
    expect(prepare).toContain("MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}");
    expect(candidate).toContain(
      "CANARY_ORIGIN: ${{ steps.production-candidate.outputs.deployment_url }}"
    );
    expect(candidate).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"
    );
    for (const publicEdgeStep of [canonical, rejected]) {
      expect(publicEdgeStep).toContain("CANARY_ORIGIN: https://app.kinresolve.com");
      expect(publicEdgeStep).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
      expect(publicEdgeStep).not.toContain("MIGRATION_DATABASE_URL");
    }
    for (const databaseStep of [prepare, revoke, finalize, cleanup]) {
      expect(databaseStep).toContain("MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}");
      expect(databaseStep).toContain("KINRESOLVE_API_CANARY_OWNER_USER_ID");
    }
    expect(cleanup).toContain("always() &&");
    expect(cleanup).toContain("steps.production-release-contract.outcome == 'success'");
    expect(cleanup).not.toContain("steps.prepare-api-canary.outcome");
    expect(cleanup).not.toContain("continue-on-error");
    expect(production.indexOf("Always revoke and remove the ephemeral production API canary"))
      .toBeLessThan(production.indexOf("Remove pulled production environment material"));
    expect(removeEnvironment).toContain(
      'test ! -e "$RUNNER_TEMP/production-api-canary.token"'
    );
    expect(removeEnvironment).not.toMatch(/rm -f .*production-api-canary/);

    expect(production.match(/scripts\/verify-live-api-edge-config\.mjs/g)).toHaveLength(2);
    expect(postPromotionEdge).toContain("api-edge-active-after-promotion.json");
    expect(postPromotionEdge).toContain("api-edge-bypasses-after-promotion.json");
    expect(postPromotionEdge).toContain(
      '"$RUNNER_TEMP/api-edge-evidence/api-edge-evidence.json"'
    );
    expect(summary).toContain(
      "API_CANARY_EVIDENCE_SHA256: ${{ steps.api-canary-evidence.outputs.evidence_sha256 }}"
    );
    expect(summary).toContain("Ephemeral API canary evidence SHA-256");
    expect(summary).toContain("Combined API launch receipt SHA-256");
    expect(summary).not.toMatch(/API_CANARY_OWNER|production-api-canary\.(?:token|json)/);
    const receiptUpload = step("Upload only the sanitized API launch release receipt");
    expect(receiptUpload).not.toMatch(/production-api-canary-(?:metadata|token)/);
  });

  it("publishes one strict idempotent API launch receipt without credential material", async () => {
    const contents = await workflow("vercel-release.yml");
    const production = job(contents, "production", "marketing");
    const publication = job(contents, "publish-release");
    const postPromotionEdge = production.indexOf(
      "Re-read and verify the live API edge configuration after promotion"
    );
    const assemble = production.indexOf("Assemble the sanitized API launch release receipt");
    const upload = production.indexOf("Upload only the sanitized API launch release receipt");
    const releaseFence = production.indexOf("Release the attested production write fence");

    expect(assemble).toBeGreaterThan(postPromotionEdge);
    expect(upload).toBeGreaterThan(assemble);
    expect(releaseFence).toBeGreaterThan(upload);
    const receiptSteps = production.slice(assemble, releaseFence);
    expect(receiptSteps).toContain("scripts/api-launch-release-receipt.mjs assemble");
    expect(receiptSteps).toContain(
      '"$RUNNER_TEMP/api-edge-evidence/api-edge-evidence.json"'
    );
    expect(receiptSteps).toContain(
      '"$RUNNER_TEMP/production-api-canary-evidence.json"'
    );
    expect(receiptSteps).toContain(
      "name: production-api-launch-release-receipt-${{ github.run_attempt }}"
    );
    expect(receiptSteps).toContain(
      "path: ${{ runner.temp }}/api-launch-release-receipt/kinresolve-api-launch-receipt.json"
    );
    expect(receiptSteps).not.toMatch(/production-api-canary\.(?:token|json)/);
    expect(receiptSteps).not.toContain("production-api-canary-metadata.json");
    expect(production).toContain(
      "api_launch_receipt_sha256: ${{ steps.api-launch-receipt.outputs.receipt_sha256 }}"
    );
    expect(production).toContain(
      "api_edge_run_attempt: ${{ steps.api-edge-evidence-source.outputs.run_attempt }}"
    );
    expect(production).toContain(
      "release_workflow_run_attempt: ${{ steps.release-attempt.outputs.run_attempt }}"
    );

    const download = publication.indexOf("Download the sanitized API launch release receipt");
    const validate = publication.indexOf(
      "Validate the exact API launch release receipt before publication"
    );
    const draft = publication.indexOf("Prepare or verify the exact run-owned draft release");
    const attach = publication.indexOf(
      "Attach or verify the API launch receipt and exact release-notes marker"
    );
    const release = publication.indexOf(
      "Publish the evidence-complete draft as the stable GitHub release"
    );
    expect(download).toBeGreaterThanOrEqual(0);
    expect(validate).toBeGreaterThan(download);
    expect(draft).toBeGreaterThan(validate);
    expect(attach).toBeGreaterThan(draft);
    expect(release).toBeGreaterThan(attach);
    expect(publication).toContain(
      "production-api-launch-release-receipt-${{ needs.production.outputs.release_workflow_run_attempt }}"
    );
    expect(publication).toContain(
      "RELEASE_WORKFLOW_RUN_ATTEMPT: ${{ needs.production.outputs.release_workflow_run_attempt }}"
    );
    const attachStep = publication.slice(attach, release);
    expect(attachStep).toContain("scripts/api-launch-release-receipt.mjs marker");
    expect(attachStep).toContain("scripts/api-launch-release-receipt.mjs validate");
    expect(attachStep).toContain(
      "kinresolve-api-launch-receipt-run-[1-9][0-9]*-attempt-[1-9][0-9]*"
    );
    expect(attachStep).toContain("scripts/api-launch-release-receipt.mjs asset-name");
    expect(attachStep).toContain("scripts/api-launch-release-receipt.mjs notes-state");
    expect(attachStep).toContain("scripts/api-launch-release-receipt.mjs notes-verify");
    expect(attachStep).toContain('select(.name == $asset_name)');
    expect(attachStep).toContain('case "$asset_count" in');
    expect(attachStep).toContain('test "$verified_sha256" = "$API_LAUNCH_RECEIPT_SHA256"');
    expect(attachStep).toContain('repos/$GH_REPO/releases/$RELEASE_DATABASE_ID');
    expect(attachStep).toContain('test "$(jq -er \'.releaseDatabaseId\' <<< "$namespace")"');
    expect(attachStep).not.toContain("--clobber");
    expect(attachStep).not.toMatch(/API_CANARY_OWNER|MIGRATION_DATABASE_URL|production-api-canary\.token/);
    expect(publication.match(/if: inputs\.release_mode == 'api-launch'/g)?.length)
      .toBeGreaterThanOrEqual(3);
  });

  it("publishes the stable GitHub release only after the live cutover succeeds", async () => {
    const contents = await workflow("vercel-release.yml");
    const publish = job(contents, "publish-release");

    expect(publish).toContain("permissions:");
    expect(publish).toContain("contents: write");
    expect(publish).toContain("environment: production");
    expect(publish).toContain("GH_REPO: ${{ github.repository }}");
    expect(publish).toContain("Revalidate the live canonical candidate before publication");
    expect(publish).toContain("gh release create");
    expect(publish).toContain("--draft");
    expect(publish).toContain('--target "$RELEASE_COMMIT"');
    expect(publish).toContain("scripts/github-release-namespace.mjs owner-marker");
    expect(publish).not.toContain("--verify-tag");
    expect(publish).not.toContain('git/refs');
    expect(publish).toContain('{draft: false, prerelease: false, make_latest: "true"}');
    expect(publish).toMatch(/scripts\/github-release-namespace\.mjs \\\n+\s+published/);
    expect(publish).toContain("VERCEL_TOKEN");
    expect(publish).toContain('gh api "repos/$GH_REPO/releases/latest"');
    expect(contents.indexOf("Smoke the fully enabled canonical production application")).toBeLessThan(
      contents.indexOf("gh release create")
    );
  });

  it("keeps same-run draft repair open while rejecting stable releases before publication", async () => {
    const contents = await workflow("vercel-release.yml");
    const verify = job(contents, "verify", "staging");
    const production = job(contents, "production", "marketing");
    const publication = job(contents, "publish-release");

    expect(verify.match(/github-release-namespace\.mjs repairable/g)).toHaveLength(1);
    expect(production.match(/github-release-namespace\.mjs repairable/g)).toHaveLength(2);
    expect(publication).toMatch(/github-release-namespace\.mjs \\\n+\s+publication/);
    expect(publication).toContain("release_state == 'draft'");
    expect(publication).toContain('release_state" = "published"');
    expect(publication).toContain("RELEASE_DATABASE_ID");
    const prepare = publication.indexOf("Prepare or verify the exact run-owned draft release");
    const attach = publication.indexOf(
      "Attach or verify the API launch receipt and exact release-notes marker"
    );
    const stable = publication.indexOf(
      "Publish the evidence-complete draft as the stable GitHub release"
    );
    expect(prepare).toBeGreaterThan(publication.indexOf("Revalidate the live canonical candidate"));
    expect(attach).toBeGreaterThan(prepare);
    expect(stable).toBeGreaterThan(attach);
  });

  it("keeps beta intake default-off and activates marketing only after exact row, mail, and deletion proof", async () => {
    const contents = await workflow("vercel-release.yml");
    const staging = job(contents, "staging", "staging-finalize");
    const production = job(contents, "production", "marketing");
    const marketing = job(contents, "marketing", "publish-release");
    const canary = await readFile(
      path.join(process.cwd(), "scripts", "beta-application-release-canary.mjs"),
      "utf8"
    );
    const canaryIdentity = await readFile(
      path.join(process.cwd(), "scripts", "beta-application-canary-identity.ts"),
      "utf8"
    );
    const fenceRelease = production.indexOf("Release the attested production write fence");
    const enabledSmoke = production.indexOf("Smoke the fully enabled canonical production application");
    const intakeStart = production.indexOf(
      "Prove the enabled production beta intake and remove its exact synthetic row"
    );
    const schedulers = production.indexOf("Reconcile both signed production schedulers after fence release");
    const intake = production.slice(intakeStart, schedulers);

    expect(fenceRelease).toBeGreaterThan(0);
    expect(enabledSmoke).toBeGreaterThan(fenceRelease);
    expect(intakeStart).toBeGreaterThan(enabledSmoke);
    expect(schedulers).toBeGreaterThan(intakeStart);
    expect(intake).toContain("if: inputs.beta_intake_enabled");
    expect(intake).toContain(
      "BETA_APPLICATION_CANARY_EMAIL_PATTERN: ${{ secrets.BETA_APPLICATION_CANARY_EMAIL_PATTERN }}"
    );
    expect(intake).toContain("BETA_APPLICATION_CANARY_PHASE: production");
    expect(intake).toContain("BETA_APPLICATION_CANARY_RUN_ATTEMPT: ${{ github.run_attempt }}");
    expect(intake).toContain("BETA_APPLICATION_CANARY_RUN_ID: ${{ github.run_id }}");
    expect(intake).toContain('--header "Origin: https://kinresolve.com"');
    expect(intake).toContain('--header "Content-Type: application/x-www-form-urlencoded"');
    for (const field of [
      "name", "email", "researcher_type", "current_tool", "archive_size_band",
      "workflow", "consent_version", "consent", "website"
    ]) expect(intake, field).toContain(`--data-urlencode "${field}=`);
    expect(intake).toContain('test "$status" = "303"');
    expect(intake).toContain("https:\\/\\/kinresolve\\.com\\/beta\\/thanks\\/");
    expect(intake).toContain("synthetic-canary.invalid");
    expect(intake).toContain("scripts/beta-application-release-canary.mjs preflight");
    expect(intake).toContain("scripts/beta-application-release-canary.mjs verify-delete");
    expect(intake).toContain("scripts/beta-application-release-canary.mjs cleanup");
    expect(intake).toContain("production-beta-intake-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.email");
    expect(intake).toContain('IFS= read -r CANARY_EMAIL < "$CANARY_EMAIL_FILE"');
    expect(intake).toContain('rm -f "$CANARY_EMAIL_FILE"');
    expect(intake).toContain("--retry 2 --retry-all-errors");
    expect(intake).not.toContain("BETA_APPLICATION_CANARY_EMAIL:");
    expect(intake).toContain("printf 'proven=true\\n' >> \"$GITHUB_OUTPUT\"");
    expect(intake).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(intake).not.toMatch(/upload-artifact|console\.log|cat .*\.body/);

    const stagingIntakeStart = staging.indexOf(
      "Prove the enabled staging beta intake and remove its exact synthetic row"
    );
    const stagingPromotion = staging.indexOf("Temporarily promote the exact staging candidate");
    const stagingIntake = staging.slice(stagingIntakeStart, staging.indexOf("Install the pinned Chromium"));
    expect(stagingIntakeStart).toBeGreaterThan(staging.indexOf("Smoke the staging candidate"));
    expect(stagingPromotion).toBeGreaterThan(stagingIntakeStart);
    expect(stagingIntake).toContain("if: inputs.beta_intake_enabled");
    expect(stagingIntake).toContain(
      "BETA_APPLICATION_CANARY_EMAIL_PATTERN: ${{ secrets.BETA_APPLICATION_CANARY_EMAIL_PATTERN }}"
    );
    expect(stagingIntake).toContain("BETA_APPLICATION_CANARY_PHASE: staging");
    expect(stagingIntake).toContain("BETA_APPLICATION_CANARY_RUN_ATTEMPT: ${{ github.run_attempt }}");
    expect(stagingIntake).toContain("BETA_APPLICATION_CANARY_RUN_ID: ${{ github.run_id }}");
    expect(stagingIntake).toContain('--header "Origin: https://kinresolve.com"');
    expect(stagingIntake).toContain("x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(stagingIntake).toContain("scripts/beta-application-release-canary.mjs preflight");
    expect(stagingIntake).toContain("scripts/beta-application-release-canary.mjs verify-delete");
    expect(stagingIntake).toContain("scripts/beta-application-release-canary.mjs cleanup");
    expect(stagingIntake).toContain("staging-beta-intake-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.email");
    expect(stagingIntake).toContain('IFS= read -r CANARY_EMAIL < "$CANARY_EMAIL_FILE"');
    expect(stagingIntake).toContain('rm -f "$CANARY_EMAIL_FILE"');
    expect(stagingIntake).toContain("--retry 2 --retry-all-errors");
    expect(stagingIntake).not.toContain("BETA_APPLICATION_CANARY_EMAIL:");
    expect(production).toContain("STAGING_BETA_INTAKE_PROVEN: ${{ needs.staging.outputs.beta_intake_proven }}");

    const exactColumns = [
      "id", "submission_day", "submission_digest", "email_digest", "name", "email",
      "researcher_type", "workflow", "archive_size_band", "current_tool", "consent_version",
      "consented_at", "state", "applicant_delivery_state", "applicant_delivery_provider",
      "applicant_delivery_message_digest", "applicant_delivered_at", "founder_delivery_state",
      "founder_delivery_provider", "founder_delivery_message_digest", "founder_delivered_at",
      "delivery_attempt_count", "last_delivery_attempt_at", "created_at", "updated_at",
      "retention_expires_at"
    ];
    const columnBlock = canary.slice(
      canary.indexOf("const exactColumns = ["),
      canary.indexOf("];", canary.indexOf("const exactColumns = ["))
    );
    expect([...columnBlock.matchAll(/"([a-z_]+)"/g)].map((match) => match[1])).toEqual(exactColumns);
    expect(canary).toContain("resolveBetaApplicationCanaryEmail");
    expect(canary).toContain('flag: "wx"');
    expect(canary).toContain("mode: 0o600");
    expect(canaryIdentity).toContain('const canaryEmailTokenPlaceholder = "{token}"');
    expect(canaryIdentity).toContain("`${phase}-run-${runId}-attempt-${runAttempt}`");
    expect(canary).toContain("row.retention_seconds !== 7_776_000");
    expect(canary).toContain('row.applicant_delivery_state !== "sent"');
    expect(canary).toContain('row.founder_delivery_state !== "sent"');
    expect(canary).toContain("DELETE FROM public.beta_applications WHERE id = $1::uuid");
    expect(canary).toContain("absent.rows[0]?.count !== 0");

    const proofGate = marketing.indexOf("Require product and mail proof before application-mode marketing");
    const deploy = marketing.indexOf("Publish the selected marketing mode");
    expect(marketing).toContain("needs: production");
    expect(marketing).toContain(
      "KINRESOLVE_MARKETING_SOURCE_COMMIT_SHA: ${{ inputs.release_commit }}"
    );
    expect(marketing).toContain(
      "KINRESOLVE_MARKETING_RELEASE_MODE: ${{ inputs.release_mode }}"
    );
    expect(marketing).toContain("BETA_INTAKE_PROVEN: ${{ needs.production.outputs.beta_intake_proven }}");
    expect(marketing).toContain(
      "STAGING_BETA_INTAKE_PROVEN: ${{ needs.production.outputs.staging_beta_intake_proven }}"
    );
    expect(marketing).toContain('test "$BETA_INTAKE_PROVEN" = "true"');
    expect(marketing).toContain("KINRESOLVE_MARKETING_BETA_APPLICATION_MODE=mailto npm run verify");
    expect(marketing).toContain("KINRESOLVE_MARKETING_BETA_APPLICATION_MODE=application npm run verify");
    expect(marketing).toContain("${{ inputs.beta_intake_enabled && 'application' || 'mailto' }}");
    expect(proofGate).toBeGreaterThan(0);
    expect(deploy).toBeGreaterThan(proofGate);
    expect(marketing.indexOf("Prove the canonical marketing release and form modes")).toBeGreaterThan(deploy);
    expect(marketing).toContain("EXPECTED_MARKETING_RELEASE_MODE: ${{ inputs.release_mode }}");
    expect(marketing).toContain('data-marketing-release-mode="${expectedReleaseMode}"');
    expect(job(contents, "publish-release")).toContain("needs: [production, marketing]");
  });

  it("attests the exact runtime grant contract derived from lib/runtime-database-grants.ts in release and recovery workflows", async () => {
    const expectedEntries = betaOperationsRuntimeGrantContract.map(({ table, privileges }) => {
      const has = (privilege: string) => (privileges as readonly string[]).includes(privilege);
      return `{"table":"${table}","select":${has("SELECT")},"insert":${has("INSERT")},"update":${has("UPDATE")},"delete":${has("DELETE")}}`;
    });
    const attestedLists = (contents: string): string[][] => {
      const blocks = [...contents.matchAll(
        /\(\.managedTablePrivileges \| map\(\{table, select, insert, update, delete\}\)\) == \[\n([\s\S]*?)\n\s*\] and/g
      )];
      return blocks.map(([, body]) =>
        body.split("\n").map((line) => line.trim().replace(/,$/, ""))
      );
    };
    for (const [file, expectedBlocks] of [
      ["vercel-release.yml", 2],
      ["recovery-evidence.yml", 1]
    ] as const) {
      const lists = attestedLists(await workflow(file));
      expect(
        lists,
        `${file} must attest the managed-table grant list once per grant step`
      ).toHaveLength(expectedBlocks);
      for (const list of lists) {
        expect(
          list,
          `${file} pins a managed-table privilege list that drifted from `
            + "betaOperationsRuntimeGrantContract in lib/runtime-database-grants.ts; "
            + "update every workflow jq attestation to the full contract in contract order"
        ).toEqual(expectedEntries);
      }
    }
  });

  it("keeps deployment credentials step-scoped and removes pulled environment material", async () => {
    const contents = await workflow("vercel-release.yml");
    const verify = job(contents, "verify", "staging");
    const staging = job(contents, "staging", "staging-finalize");
    const production = job(contents, "production", "marketing");

    expect(contents).not.toContain("--token");
    expect(verify).not.toContain("VERCEL_TOKEN");
    expect(staging.slice(0, staging.indexOf("    steps:"))).not.toContain("VERCEL_TOKEN");
    expect(production.slice(0, production.indexOf("    steps:"))).not.toContain("VERCEL_TOKEN");
    expect(contents).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    for (const target of [staging, production]) {
      const buildStep = target.slice(
        target.lastIndexOf("- name:", target.indexOf("vercel build --prod")),
        target.indexOf("\n      - name:", target.indexOf("vercel build --prod"))
      );
      expect(buildStep).not.toContain("VERCEL_TOKEN");
    }
    expect(staging).toContain("if: always()");
    expect(production).toContain("if: always()");
    expect(contents).toContain('rm -f .vercel/.env.production.local');
    expect(staging).toContain('rm -f "$RUNNER_TEMP/staging-environment.json"');
    expect(production).toContain('rm -f "$RUNNER_TEMP/production-environment.json"');
    expect(staging.split("umask 077").length).toBeGreaterThanOrEqual(3);
    expect(production.split("umask 077").length).toBeGreaterThanOrEqual(3);
    expect(contents).not.toMatch(/run:[^\n]*\$\{\{ inputs\./);
  });
});

describe("marketing workflow release and intake modes", () => {
  it("proves every static release/intake combination and keeps standalone production prelaunch-only", async () => {
    const ci = await workflow("site-ci.yml");
    const deploy = await workflow("site-deploy.yml");
    const release = await workflow("vercel-release.yml");
    const marketing = job(release, "marketing", "publish-release");
    const deployJob = job(deploy, "deploy");
    const deployStep = (name: string): string => {
      const start = deployJob.indexOf(`      - name: ${name}`);
      const end = deployJob.indexOf("\n      - name:", start + 1);
      expect(start, `missing marketing deploy step ${name}`).toBeGreaterThanOrEqual(0);
      return deployJob.slice(start, end === -1 ? deployJob.length : end);
    };
    const marketingStep = (name: string): string => {
      const start = marketing.indexOf(`      - name: ${name}`);
      const end = marketing.indexOf("\n      - name:", start + 1);
      expect(start, `missing release marketing step ${name}`).toBeGreaterThanOrEqual(0);
      return marketing.slice(start, end === -1 ? marketing.length : end);
    };
    expect(ci).toContain("release-mode: [prelaunch, application, api-launch]");
    expect(ci).toContain("application-mode: [mailto, application]");
    expect(ci).toContain("demo-mode: [pending, live]");
    expect(ci).toContain("KINRESOLVE_MARKETING_RELEASE_MODE: ${{ matrix.release-mode }}");
    expect(ci).toContain("KINRESOLVE_MARKETING_BETA_APPLICATION_MODE: ${{ matrix.application-mode }}");
    expect(ci).toContain("KINRESOLVE_MARKETING_DEMO_MODE: ${{ matrix.demo-mode }}");
    expect(ci).toContain('scripts/launch-media-text.mjs');
    expect(deploy).toMatch(/beta_application_mode:[\s\S]*?default: mailto[\s\S]*?- mailto[\s\S]*?- application/);
    expect(deploy).toMatch(/demo_mode:[\s\S]*?default: pending[\s\S]*?- pending[\s\S]*?- live/);
    expect(deploy).toContain(
      "KINRESOLVE_MARKETING_BETA_APPLICATION_MODE: ${{ inputs.beta_application_mode }}"
    );
    expect(deploy).toContain("KINRESOLVE_MARKETING_DEMO_MODE: ${{ inputs.demo_mode }}");
    expect(deploy).toContain("KINRESOLVE_MARKETING_RELEASE_MODE: prelaunch");
    expect(deploy).toContain("if: inputs.production && inputs.beta_application_mode == 'application'");
    expect(deploy).toContain("Production application-mode activation requires the product release workflow evidence gate.");
    expect(packageJson.scripts["launch:media:validate"]).toBe(
      "node scripts/validate-launch-media.mjs"
    );
    expect(packageJson.scripts["site:verify"]).toContain("npm run launch:media:validate");
    for (const target of [ci, deploy, marketing]) {
      expect(target).toContain("fetch-depth: 0");
      expect(target).toContain("persist-credentials: false");
      expect(target).toContain("Install launch-media validator dependencies");
      expect(target).toContain("Validate the committed synthetic launch media");
      expect(target).toContain("npm run launch:media:validate");
      expect(target).not.toMatch(
        /name: Validate the committed synthetic launch media[\s\S]{0,120}\n\s+if:/
      );
    }
    expect(marketing.indexOf("npm run launch:media:validate")).toBeLessThan(
      marketing.indexOf("Prove both static intake exports before loading deploy credentials")
    );

    expect(deployJob.slice(0, deployJob.indexOf("    steps:"))).not.toMatch(
      /VERCEL_(?:ORG_ID|PROJECT_ID|TOKEN)/
    );
    for (const name of [
      "Install launch-media validator dependencies",
      "Install marketing dependencies",
      "Validate the committed synthetic launch media",
      "Refuse out-of-band production application activation",
      "Verify the explicitly selected static site mode",
      "Verify static site",
      "Install the pinned Vercel CLI before loading deploy credentials"
    ]) {
      expect(deployStep(name)).not.toMatch(/VERCEL_(?:ORG_ID|PROJECT_ID|TOKEN)/);
    }
    for (const name of [
      "Pull Vercel project settings",
      "Build preview",
      "Build production release",
      "Deploy preview",
      "Deploy production release"
    ]) {
      const step = deployStep(name);
      expect(step).toContain("VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}");
      expect(step).toContain("VERCEL_PROJECT_ID: ${{ vars.MARKETING_VERCEL_PROJECT_ID }}");
      expect(step).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    }
    expect(deployStep("Install the pinned Vercel CLI before loading deploy credentials"))
      .toContain("npm install --global --ignore-scripts vercel@56.1.0");
    expect(deploy).not.toContain("npx vercel");
    expect(deploy.match(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/g)).toHaveLength(5);

    for (const name of [
      "Install launch-media validator dependencies",
      "Install marketing dependencies",
      "Validate the committed synthetic launch media",
      "Prove both static intake exports before loading deploy credentials",
      "Install the pinned marketing Vercel CLI before loading deploy credentials"
    ]) {
      expect(marketingStep(name)).not.toMatch(/VERCEL_(?:ORG_ID|PROJECT_ID|TOKEN)/);
    }
    for (const name of [
      "Validate the protected marketing deployment identity",
      "Pull the protected marketing production settings",
      "Build the selected evidence-bound marketing mode",
      "Publish the selected marketing mode"
    ]) {
      const step = marketingStep(name);
      expect(step).toContain("VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}");
      expect(step).toContain("VERCEL_PROJECT_ID: ${{ vars.MARKETING_VERCEL_PROJECT_ID }}");
      expect(step).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    }
    expect(marketingStep("Install the pinned marketing Vercel CLI before loading deploy credentials"))
      .toContain("npm install --global --ignore-scripts vercel@56.1.0");
    expect(marketing).not.toContain("npx vercel");
    expect(marketing.match(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/g)).toHaveLength(4);
  });
});

function job(contents: string, name: string, nextName?: string): string {
  const start = contents.indexOf(`\n  ${name}:`);
  const end = nextName ? contents.indexOf(`\n  ${nextName}:`, start + 1) : contents.length;
  expect(start, `missing ${name} job`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${nextName ?? "workflow end"}`).toBeGreaterThan(start);
  return contents.slice(start, end);
}
