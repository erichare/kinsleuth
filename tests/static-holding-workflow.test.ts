import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import { pinnedActionWithComment } from "./helpers/action-pins";

const exactProductionPromotionAcknowledgement =
  "PROMOTE KIN RESOLVE STATIC HOLDING TO APP.KINRESOLVE.COM";
const exactStagingPromotionAcknowledgement =
  "PROMOTE KIN RESOLVE STATIC HOLDING TO BETA-STAGING";
const exactDemoPromotionAcknowledgement =
  "PROMOTE KIN RESOLVE STATIC HOLDING TO DEMO.KINRESOLVE.COM";
const exactAutoAssignmentAcknowledgement =
  "I acknowledge Vercel production deployment auto-assignment is disabled in the protected project dashboard.";
const exactAutoAssignmentComparison =
  `test "$AUTO_ASSIGNMENT_ACKNOWLEDGEMENT" = "${exactAutoAssignmentAcknowledgement}"`;
const exactDeploymentProtectionAcknowledgement =
  "I acknowledge Vercel Standard Protection covers every generated deployment URL and has no exceptions.";
const exactDeploymentProtectionComparison =
  `test "$DEPLOYMENT_PROTECTION_ACKNOWLEDGEMENT" = "${exactDeploymentProtectionAcknowledgement}"`;

describe("protected static holding deployment workflow", () => {
  it("is manual, target-protected, serialized with releases, and exact-revision only", async () => {
    const contents = await holdingWorkflow();
    const dispatchValidation = contents.indexOf("Validate the manual request before checkout");
    const autoAssignmentGate = contents.indexOf(exactAutoAssignmentComparison);
    const deploymentProtectionGate = contents.indexOf(exactDeploymentProtectionComparison);
    const checkout = contents.indexOf("Check out the exact holding revision");
    const firstDeploymentCredential = contents.indexOf(
      "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}"
    );

    expect(contents).toMatch(/^on:\s*\n\s*workflow_dispatch:/m);
    expect(contents).toContain(
      "run-name: Kin Resolve static holding ${{ inputs.target }} run ${{ github.run_id }} attempt ${{ github.run_attempt }}"
    );
    expect(contents).toMatch(/^      target:\s*$/m);
    expect(contents).toMatch(
      /target:[\s\S]*?type: choice[\s\S]*?options:[\s\S]*?- beta-staging[\s\S]*?- public-demo[\s\S]*?- production/
    );
    expect(contents).toMatch(/^      holding_commit:/m);
    expect(contents).toMatch(/^      promotion_acknowledgement:/m);
    expect(contents).toMatch(/^      auto_assignment_acknowledgement:/m);
    expect(contents).toMatch(/^      deployment_protection_acknowledgement:/m);
    expect(contents).toContain(`default: ""`);
    expect(contents).toContain(
      "environment: ${{ inputs.target == 'public-demo' && 'demo-production' || inputs.target }}"
    );
    expect(contents).toContain(
      "group: ${{ inputs.target == 'public-demo' && 'kinresolve-public-demo-release' || 'kinresolve-beta-release' }}"
    );
    expect(contents).toContain("queue: max");
    expect(contents).toContain("cancel-in-progress: false");
    expect(contents).toContain("timeout-minutes:");
    expect(contents).toContain("GITHUB_REF_VALUE: ${{ github.ref }}");
    expect(contents).toContain("EXPECTED_GITHUB_SHA: ${{ github.sha }}");
    expect(contents).toContain("HOLDING_COMMIT: ${{ inputs.holding_commit }}");
    expect(contents).toContain(
      "AUTO_ASSIGNMENT_ACKNOWLEDGEMENT: ${{ inputs.auto_assignment_acknowledgement }}"
    );
    expect(contents).toContain(
      "DEPLOYMENT_PROTECTION_ACKNOWLEDGEMENT: ${{ inputs.deployment_protection_acknowledgement }}"
    );
    expect(contents).toContain('test "$HOLDING_COMMIT" = "$EXPECTED_GITHUB_SHA"');
    expect(contents).toContain(`PROMOTION_ACKNOWLEDGEMENT: \${{ inputs.promotion_acknowledgement }}`);
    expect(contents).toContain("TARGET_APP_BASE_URL: ${{ vars.APP_BASE_URL }}");
    expect(contents).toContain("TARGET_VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}");
    expect(contents).toContain(exactProductionPromotionAcknowledgement);
    expect(contents).toContain(exactStagingPromotionAcknowledgement);
    expect(contents).toContain(exactDemoPromotionAcknowledgement);
    expect(contents).toContain(exactAutoAssignmentComparison);
    expect(contents).toContain(exactDeploymentProtectionComparison);
    expect(dispatchValidation).toBeGreaterThan(0);
    for (const acknowledgementGate of [autoAssignmentGate, deploymentProtectionGate]) {
      expect(acknowledgementGate).toBeGreaterThan(dispatchValidation);
      expect(acknowledgementGate).toBeLessThan(checkout);
      expect(acknowledgementGate).toBeLessThan(firstDeploymentCredential);
    }
    expect(contents).toContain('test "$TARGET_APP_BASE_URL" = "$production_app_base_url"');
    expect(contents).toContain('test "$TARGET_APP_BASE_URL" != "$production_app_base_url"');
    expect(contents).toContain('test "$TARGET_VERCEL_PROJECT_ID" = "$production_vercel_project_id"');
    expect(contents).toContain('test "$TARGET_VERCEL_PROJECT_ID" != "$production_vercel_project_id"');
    expect(contents).toContain('test "$TARGET_VERCEL_PROJECT_ID" != "$MARKETING_VERCEL_PROJECT_ID"');
    expect(contents).toContain("scripts/validate-legacy-demo-retirement.mjs");
    expect(contents).toMatch(/ref:\s*\$\{\{ inputs\.holding_commit \}\}/);
    expect(contents).toContain("persist-credentials: false");
    expect(contents).toContain("git merge-base --is-ancestor");
    expect(contents).toContain("RELEASE_SAFETY_CURRENT_WORKFLOW: holding");
    expect(contents).toContain("scripts/validate-release-safety-queue.mjs");
    expect(contents).toMatch(/^  holding:\n    needs: safety/m);
  });

  it("pins privileged setup actions to immutable revisions", async () => {
    const contents = await holdingWorkflow();

    expect(contents).not.toContain("actions/checkout@v4");
    expect(contents).not.toContain("actions/setup-node@v4");
    expect(contents).toContain(pinnedActionWithComment("checkout"));
    expect(contents).toContain(pinnedActionWithComment("setupNode"));
  });

  it("builds and verifies only the checked-in static artifact before credentials are introduced", async () => {
    const contents = await holdingWorkflow();
    const build = contents.indexOf("npm run holding:build");
    const verify = contents.indexOf("npm run holding:verify");
    const installCli = contents.indexOf("npm install --global --ignore-scripts vercel@56.1.0");
    const token = contents.indexOf("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");

    expect(build).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(build);
    expect(installCli).toBeGreaterThan(verify);
    expect(token).toBeGreaterThan(installCli);
    expect(packageJson.scripts["holding:build"]).toBe("node scripts/build-static-holding.mjs");
    expect(packageJson.scripts["holding:verify"]).toBe("node scripts/verify-static-holding.mjs");
    expect(contents).not.toContain("npx --yes vercel");
    expect(contents).not.toMatch(/vercel(?:@56\.1\.0)? build/);
    expect(contents).not.toMatch(/vercel(?:@56\.1\.0)? pull/);
    for (const forbidden of [
      "DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "AUTH_SECRET",
      "BLOB_READ_WRITE_TOKEN",
      "CRON_SECRET"
    ]) {
      expect(contents, forbidden).not.toContain(forbidden);
    }
  });

  it("deploys unaliased with exact static metadata and validates the REST record", async () => {
    const contents = await holdingWorkflow();

    expect(contents).toContain("vercel deploy --prebuilt --prod --skip-domain --yes");
    expect(contents).toContain('--meta "releaseRole=kinresolve-static-holding-v1"');
    expect(contents).toContain('--meta "databaseAccess=none"');
    expect(contents).toContain('--meta "rollbackPolicy=forward-only"');
    expect(contents).toContain('--meta "packageVersion=holding-v1"');
    expect(contents).toContain("scripts/validate-static-holding-deployment.mjs");
    expect(contents).toContain("https://api.vercel.com/v13/deployments/");
    expect(contents).toContain("--connect-timeout 5");
    expect(contents).toContain("--max-time 20");
  });

  it("proves the generated holding URL is private before an exact bypass-authenticated smoke", async () => {
    const contents = await holdingWorkflow();
    const candidateValidation = contents.indexOf("Validate the exact unaliased holding candidate");
    const unauthenticatedProbe = contents.indexOf(
      "Prove the generated holding candidate rejects unauthenticated access"
    );
    const authenticatedSmoke = contents.indexOf(
      "Smoke the protected holding candidate with automation bypass"
    );
    const promote = contents.indexOf("Promote the explicitly acknowledged static holding deployment");
    const probeStep = contents.slice(unauthenticatedProbe, authenticatedSmoke);
    const authenticatedStep = contents.slice(authenticatedSmoke, promote);
    const identifierGate = contents.slice(
      contents.indexOf("Validate and link the product Vercel project"),
      contents.indexOf("Deploy the unaliased production-target holding candidate")
    );

    expect(candidateValidation).toBeGreaterThan(0);
    expect(unauthenticatedProbe).toBeGreaterThan(candidateValidation);
    expect(authenticatedSmoke).toBeGreaterThan(unauthenticatedProbe);
    expect(promote).toBeGreaterThan(authenticatedSmoke);
    expect(probeStep).toContain(
      "HOLDING_DEPLOYMENT_URL: ${{ steps.holding-candidate.outputs.deployment_url }}"
    );
    expect(probeStep).toContain(
      '--dump-header "$RUNNER_TEMP/static-holding-unauthenticated.headers"'
    );
    expect(probeStep).toContain("scripts/validate-vercel-protection-response.mjs");
    expect(probeStep).toContain('"$HOLDING_DEPLOYMENT_URL/"');
    expect(probeStep).toContain('grep -Fq "Kin Resolve"');
    expect(probeStep).toContain("static-holding-unauthenticated.html");
    expect(probeStep).not.toContain("x-vercel-protection-bypass");
    expect(probeStep).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(authenticatedStep).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"
    );
    expect(authenticatedStep).toContain(
      '--header "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"'
    );
    expect(authenticatedStep).toContain(
      'cmp "$RUNNER_TEMP/static-holding-protected.html" holding/login.html'
    );
    expect(identifierGate).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"
    );
    expect(identifierGate).toContain('test -n "$VERCEL_AUTOMATION_BYPASS_SECRET"');
  });

  it("promotes only on the validated exact acknowledgement and proves the canonical holding alias", async () => {
    const contents = await holdingWorkflow();
    const promote = contents.indexOf("vercel promote");
    const validateHolding = contents.lastIndexOf("scripts/validate-vercel-deployment.mjs holding");

    expect(contents).toContain("if: steps.dispatch.outputs.promote == 'true'");
    expect(promote).toBeGreaterThan(0);
    expect(contents).toContain('vercel promote "$HOLDING_DEPLOYMENT_URL" --yes');
    expect(validateHolding).toBeGreaterThan(promote);
    expect(contents).toContain("APP_BASE_URL: ${{ steps.dispatch.outputs.app_base_url }}");
    expect(contents).toContain("APPROVED_HOLDING_DEPLOYMENT_ID: ${{ steps.holding-candidate.outputs.deployment_id }}");
    expect(contents).toContain("id: holding-promoted");
    expect(contents).toContain("promoted: ${{ steps.holding-promoted.outcome == 'success' }}");
  });

  it("repairs auto-assignment immediately after promotion and pauses closed if repair fails", async () => {
    const contents = await holdingWorkflow();
    const promote = contents.indexOf("Promote the explicitly acknowledged static holding deployment");
    const autoAssignment = contents.indexOf(
      "Disable and independently attest target domain auto-assignment"
    );
    const pauseFallback = contents.indexOf(
      "Emergency-pause the target if domain auto-assignment cannot be disabled"
    );
    const canonicalWait = contents.indexOf(
      "Wait for the canonical alias to resolve to the holding deployment"
    );
    const repairStep = contents.slice(autoAssignment, pauseFallback);
    const fallbackStep = contents.slice(pauseFallback, canonicalWait);

    expect(promote).toBeGreaterThan(0);
    expect(autoAssignment).toBeGreaterThan(promote);
    expect(pauseFallback).toBeGreaterThan(autoAssignment);
    expect(canonicalWait).toBeGreaterThan(pauseFallback);
    expect(repairStep).toContain("id: holding-domain-auto-assignment");
    expect(repairStep).toContain("if: steps.dispatch.outputs.promote == 'true'");
    expect(repairStep).toContain("https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID");
    expect(repairStep).toContain("--request PATCH");
    expect(repairStep).toContain(`--data '{"autoAssignCustomDomains":false}'`);
    expect(repairStep).toContain('"$project_api" --output "$RUNNER_TEMP/static-holding-project.json"');
    expect(repairStep).toContain("scripts/validate-vercel-project-safety.mjs");
    expect(repairStep).toContain('"$RUNNER_TEMP/static-holding-project.json"');
    expect(repairStep).toContain('EXPECTED_VERCEL_PROJECT_PAUSED: "false"');
    expect(fallbackStep).toContain("steps.promote-holding.outcome == 'success'");
    expect(fallbackStep).toContain("steps.holding-domain-auto-assignment.outcome == 'failure'");
    expect(fallbackStep).toContain("https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/pause");
    expect(fallbackStep).toContain('EXPECTED_VERCEL_PROJECT_PAUSED: "true"');
    expect(fallbackStep).toContain("static-holding-project-after-emergency-pause.json");
  });

  it("records the exact deployment ID for the release environment secret", async () => {
    const contents = await holdingWorkflow();

    expect(contents).toContain("deployment_id: ${{ steps.holding-candidate.outputs.deployment_id }}");
    expect(contents).toContain("FIRST_CUTOVER_HOLDING_DEPLOYMENT_ID");
    expect(contents).toContain("STAGING_HOLDING_DEPLOYMENT_ID");
    expect(contents).toContain("SUMMARY_SECRET_NAME: ${{ steps.dispatch.outputs.summary_secret_name }}");
    expect(contents).toContain("printf -- '- %s=%s\\n' \"$SUMMARY_SECRET_NAME\" \"$DEPLOYMENT_ID\"");
    expect(contents).toContain("$GITHUB_STEP_SUMMARY");
    expect(contents).toContain("if: always() && steps.holding-candidate.outcome == 'success'");
    expect(contents).toContain("PROMOTED: ${{ steps.holding-promoted.outcome == 'success' }}");
    expect(contents).not.toMatch(/run:[^\n]*\$\{\{ inputs\./);
  });
});

async function holdingWorkflow(): Promise<string> {
  return readFile(path.join(process.cwd(), ".github", "workflows", "vercel-holding.yml"), "utf8");
}
