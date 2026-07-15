import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json";

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
    expect(contents.match(new RegExp(databaseImage, "g"))).toHaveLength(5);
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
      "release-contract"
    ]) {
      expect(contents, job).toMatch(new RegExp(`^  ${job}:`, "m"));
    }
    expect(contents).toMatch(/^  gate:/m);
    expect(contents).toMatch(/if:\s*always\(\)/);
    expect(contents).toMatch(
      /STATIC_RESULT.*DATABASE_RESULT.*UPGRADE_RESULT.*COMPATIBILITY_RESULT.*LARGE_IMPORT_RESULT.*LARGE_INTEGRATION_IMPORT_RESULT.*RELEASE_CONTRACT_RESULT/s
    );
    expect(contents).toMatch(/test\s+"\$STATIC_RESULT"\s+=\s+"success"/);
    for (const result of [
      "DATABASE_RESULT",
      "UPGRADE_RESULT",
      "COMPATIBILITY_RESULT",
      "LARGE_IMPORT_RESULT",
      "LARGE_INTEGRATION_IMPORT_RESULT",
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
    ).toHaveLength(5);
    expect(
      contents.match(/actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4/g)
    ).toHaveLength(5);
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

  it("proves exact main provenance and release absence before repository code or deploy credentials", async () => {
    const contents = await workflow("vercel-release.yml");
    const verify = job(contents, "verify", "staging");
    const dispatchGate = verify.indexOf("Validate dispatch request before checkout");
    const provenance = verify.indexOf("Verify exact candidate provenance");
    const releaseAbsence = verify.indexOf("Verify candidate tag and release do not exist");

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
    expect(releaseAbsence).toBeGreaterThan(provenance);
    expect(verify).toContain("/releases/tags/$RELEASE_TAG");
    expect(releaseAbsence).toBeLessThan(verify.indexOf("npm ci"));
    expect(releaseAbsence).toBeLessThan(verify.indexOf("npm run lint"));
    expect(releaseAbsence).toBeLessThan(contents.indexOf("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}"));
    expect(verify).not.toContain("environment:");
  });

  it("validates the Vercel deployment bypass guard before release database tests or credentials", async () => {
    const contents = await workflow("vercel-release.yml");
    const verify = job(contents, "verify", "staging");
    const guard = verify.indexOf("npm run vercel:config:validate");
    const globalGuard = contents.indexOf("npm run vercel:config:validate");

    expect(guard).toBeGreaterThan(verify.indexOf("Verify candidate tag and release do not exist"));
    expect(guard).toBeLessThan(verify.indexOf("npm ci"));
    expect(guard).toBeLessThan(verify.indexOf("npm run test:db"));
    expect(globalGuard).toBeLessThan(contents.indexOf("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}"));
  });

  it("requires the automation bypass secret before either protected deployment starts", async () => {
    const contents = await workflow("vercel-release.yml");
    const staging = job(contents, "staging", "production");
    const production = job(contents, "production", "publish-release");
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

    for (const name of ["verify", "staging", "production", "publish-release"]) {
      expect(contents, name).toMatch(new RegExp(`^  ${name}:`, "m"));
    }
    expect(job(contents, "staging", "production")).toMatch(/needs:\s*verify/);
    expect(job(contents, "staging", "production")).toMatch(/environment:\s*beta-staging/);
    expect(job(contents, "production", "publish-release")).toMatch(/needs:\s*\[verify, staging\]/);
    expect(job(contents, "production", "publish-release")).toMatch(/environment:\s*production/);
    expect(job(contents, "publish-release")).toMatch(/needs:\s*production/);
  });

  it("rehearses the same revision and release procedure in an attested isolated staging cell", async () => {
    const contents = await workflow("vercel-release.yml");
    const staging = job(contents, "staging", "production");
    const environmentGate = staging.indexOf("scripts/validate-vercel-environment.mjs");
    const releaseContract = staging.indexOf("Validate staging release contract");
    const identityExclusions = staging.indexOf(
      "Prove staging cannot target protected production identities"
    );
    const initialHoldingGate = staging.indexOf("scripts/validate-vercel-deployment.mjs holding");
    const finalHoldingGate = staging.lastIndexOf("scripts/validate-vercel-deployment.mjs holding");
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
    expect(staging.split("scripts/validate-vercel-deployment.mjs holding")).toHaveLength(3);
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
    expect(protectionProbeStep).toContain(
      "CANDIDATE_ORIGIN: ${{ steps.staging-candidate.outputs.deployment_url }}"
    );
    expect(protectionProbeStep).toContain("401|403) ;;");
    expect(protectionProbeStep).toContain(
      'has("database") or has("capabilities") or has("scheduledWrites")'
    );
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
    expect(runtimeGrantStep).toContain('grantContract == "beta-operations-v1"');
    expect(staging).not.toContain("vercel promote");
    expect(staging).not.toContain("rollback");
    expect(staging).not.toContain("gh release create");
  });

  it("gates production mutation on environment, policy, attested recovery, holding, and candidate identity", async () => {
    const contents = await workflow("vercel-release.yml");
    const production = job(contents, "production", "publish-release");
    const environmentGate = production.indexOf("scripts/validate-vercel-environment.mjs");
    const releaseGate = production.indexOf("scripts/validate-release-contract.mjs");
    const policyGate = production.indexOf("scripts/validate-release-policy.mjs");
    const readinessGate = production.indexOf("scripts/validate-release-readiness.mjs");
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
    expect(production).toContain('SMOKE_PHASE: "pre-migration"');
    expect(production).toContain('KINRESOLVE_SCHEDULED_WRITES_ENABLED: "true"');
    expect(production).toContain("gh attestation verify");
    expect(production).toContain("--signer-workflow \"$GITHUB_REPOSITORY/.github/workflows/recovery-evidence.yml\"");
    expect(production).toContain("--source-digest \"$RELEASE_COMMIT\"");
    expect(production).toContain("--deny-self-hosted-runners");
    expect(production).toContain(
      'run.display_title !== "Kin Resolve recovery run " + run.id + " attempt " + run.run_attempt'
    );
    expect(production).toContain(
      '--name "production-recovery-evidence-$recovery_run_attempt"'
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
    const production = job(await workflow("vercel-release.yml"), "production", "publish-release");
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
    expect(runtimeGrantStep).toContain('grantContract == "beta-operations-v1"');
  });

  it("proves the generated production candidate is private before bypass-authenticated identity smoke", async () => {
    const production = job(await workflow("vercel-release.yml"), "production", "publish-release");
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
    expect(probeStep).toContain(
      "CANDIDATE_ORIGIN: ${{ steps.production-candidate.outputs.deployment_url }}"
    );
    expect(probeStep).toContain("401|403) ;;");
    expect(probeStep).toContain('has("database") or has("capabilities") or has("scheduledWrites")');
    expect(probeStep).toContain("production-candidate-unauthenticated");
    expect(probeStep).not.toContain("x-vercel-protection-bypass");
    expect(probeStep).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(authenticatedStep).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"
    );
    expect(authenticatedStep).toContain("scripts/smoke-release.mjs");
    expect(production).not.toContain('if [[ -n "$VERCEL_AUTOMATION_BYPASS_SECRET" ]]');
  });

  it("validates and smokes an immutable candidate before exact promotion and fence release", async () => {
    const production = job(await workflow("vercel-release.yml"), "production", "publish-release");
    const deploy = production.indexOf("deploy --prebuilt --prod --skip-domain --yes");
    const validateCandidate = production.indexOf("scripts/validate-vercel-deployment.mjs candidate");
    const candidateSmoke = production.indexOf("Smoke the production candidate");
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

  it("rolls back only to the captured approved holding deployment and verifies the canonical result", async () => {
    const production = job(await workflow("vercel-release.yml"), "production", "publish-release");
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
    const production = job(await workflow("vercel-release.yml"), "production", "publish-release");
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
      "Gates: staging isolation, holding, candidate identity, migration ledger, and smoke passed"
    );
    expect(summaryStep).toContain(
      "Gates: production recovery, holding, candidate identity, fence, migration ledger, promotion, and canonical smoke passed"
    );
    expect(summaryStep).not.toContain("${{ secrets.");
    expect(summaryStep).not.toMatch(/DATABASE_URL|MIGRATION_DATABASE_URL|VERCEL_TOKEN/);
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
    expect(publish).toContain('--target "$RELEASE_COMMIT"');
    expect(publish).toContain("--verify-tag");
    expect(publish).toContain('gh api --method POST "repos/$GH_REPO/git/refs"');
    expect(publish).toContain("VERCEL_TOKEN");
    expect(contents.indexOf("Smoke the fully enabled canonical production application")).toBeLessThan(
      contents.indexOf("gh release create")
    );
  });

  it("keeps deployment credentials step-scoped and removes pulled environment material", async () => {
    const contents = await workflow("vercel-release.yml");
    const verify = job(contents, "verify", "staging");
    const staging = job(contents, "staging", "production");
    const production = job(contents, "production", "publish-release");

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

function job(contents: string, name: string, nextName?: string): string {
  const start = contents.indexOf(`\n  ${name}:`);
  const end = nextName ? contents.indexOf(`\n  ${nextName}:`, start + 1) : contents.length;
  expect(start, `missing ${name} job`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${nextName ?? "workflow end"}`).toBeGreaterThan(start);
  return contents.slice(start, end);
}
