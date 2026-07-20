import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pinnedAction, pinnedActionWithComment } from "./helpers/action-pins";

async function workflow(name = "release-containment.yml"): Promise<string> {
  return readFile(path.join(process.cwd(), ".github", "workflows", name), "utf8");
}

function job(contents: string, name: string, nextName?: string): string {
  const start = contents.indexOf(`\n  ${name}:`);
  const end = nextName ? contents.indexOf(`\n  ${nextName}:`, start + 1) : contents.length;
  expect(start, `missing ${name} job`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${nextName ?? "workflow end"}`).toBeGreaterThan(start);
  return contents.slice(start, end);
}

describe("failed release containment workflow", () => {
  it("runs only after a failed, cancelled, or timed-out protected release and serializes every mutation", async () => {
    const contents = await workflow();
    expect(contents).toMatch(/workflow_run:/);
    expect(contents).toContain("Release Kin Resolve beta candidate");
    expect(contents).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(contents).toContain("github.event.workflow_run.conclusion == 'cancelled'");
    expect(contents).toContain("github.event.workflow_run.conclusion == 'timed_out'");
    expect(contents).toContain("actions: read");
    expect(contents).toContain("group: kinresolve-beta-release-containment");
    expect(contents).toContain("queue: max");
    expect(contents).toContain("cancel-in-progress: false");
    expect(contents).toContain("environment: production-containment");
  });

  it("classifies exact protected provenance before checkout and fails closed without production credentials", async () => {
    const contents = await workflow();
    const classify = job(contents, "classify", "staging-authorize");
    const validation = classify.indexOf(
      "Validate the failed protected release event before classifier checkout"
    );
    const checkout = classify.indexOf(pinnedAction("checkout"));
    const defaultContain = classify.indexOf("should_contain=true");
    const inspection = classify.indexOf("filter=all&per_page=100");

    expect(validation).toBeGreaterThan(0);
    expect(checkout).toBeGreaterThan(validation);
    expect(defaultContain).toBeGreaterThan(checkout);
    expect(inspection).toBeGreaterThan(defaultContain);
    expect(classify).toContain('test "$SOURCE_EVENT" = "workflow_dispatch"');
    expect(classify).toContain('test "$SOURCE_HEAD_BRANCH" = "main"');
    expect(classify).toContain('test "$EVENT_ACTION" = "completed"');
    expect(classify).toContain('test "$EVENT_REPOSITORY" = "$CURRENT_REPOSITORY"');
    expect(classify).toContain('test "$SOURCE_HEAD_REPOSITORY" = "$CURRENT_REPOSITORY"');
    expect(classify).toContain('test "$SOURCE_RUN_REPOSITORY" = "$CURRENT_REPOSITORY"');
    expect(classify).toContain("SOURCE_DISPLAY_TITLE: ${{ github.event.workflow_run.display_title }}");
    expect(classify).toContain('test "$SOURCE_WORKFLOW_NAME" = "$SOURCE_DISPLAY_TITLE"');
    expect(classify).toContain(
      'test "$SOURCE_DISPLAY_TITLE" = "Kin Resolve beta release run $SOURCE_RUN_ID attempt $SOURCE_RUN_ATTEMPT"'
    );
    expect(classify).toContain('test "$SOURCE_WORKFLOW_PATH" = ".github/workflows/vercel-release.yml"');
    expect(classify).toContain("/attempts/$SOURCE_RUN_ATTEMPT/jobs?per_page=100");
    expect(classify).toContain("scripts/classify-release-containment.mjs");
    expect(classify).toContain("authorized=true");
    expect(classify).not.toContain("secrets.");
    expect(classify).not.toContain("environment: production-containment");

    const contain = job(contents, "contain");
    expect(contain).toContain("always()");
    expect(contain).toContain("needs.classify.result != 'skipped'");
    expect(contain).toContain("needs.classify.result != 'success'");
    expect(contain).toContain("needs.classify.outputs.authorized == 'true'");
    expect(contain).toContain("needs.classify.outputs.should_contain == 'true'");
  });

  it("independently authorizes exact failed release provenance for staging without protected credentials", async () => {
    const contents = await workflow();
    const authorize = job(contents, "staging-authorize", "staging-contain");
    const trustedMainCheckout = authorize.indexOf(
      "Check out the trusted authorization gate from main"
    );
    const authorization = authorize.indexOf(
      "Authorize the exact failed release event for staging containment"
    );
    const authorizationScript = authorize.indexOf("scripts/authorize-workflow-run-source.mjs");
    const headShaCheckout = authorize.indexOf(
      "Check out the exact failed release revision for staging authorization"
    );
    const ancestry = authorize.indexOf("git merge-base --is-ancestor");

    expect(trustedMainCheckout).toBeGreaterThan(0);
    expect(authorization).toBeGreaterThan(trustedMainCheckout);
    expect(authorizationScript).toBeGreaterThan(authorization);
    expect(headShaCheckout).toBeGreaterThan(authorizationScript);
    expect(ancestry).toBeGreaterThan(headShaCheckout);
    expect(authorize).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(authorize).toContain("github.event.workflow_run.conclusion == 'cancelled'");
    expect(authorize).toContain("github.event.workflow_run.conclusion == 'timed_out'");
    expect(authorize).toContain("ref: main");
    expect(authorize).toContain("fetch-depth: 1");
    expect(authorize).toContain("persist-credentials: false");
    expect(authorize).toContain("id: event");
    expect(authorize).toContain("ALLOWED_SOURCE_CONCLUSIONS: failure,cancelled,timed_out");
    expect(authorize).toContain("ALLOWED_SOURCE_EVENTS: workflow_dispatch");
    expect(authorize).toContain(
      "DISPLAY_TITLE_TEMPLATES: '[{\"template\":\"Kin Resolve beta release run {run_id} attempt {run_attempt}\"}]'"
    );
    expect(authorize).toContain(
      "EXPECTED_SOURCE_WORKFLOW_NAME: Release Kin Resolve beta candidate"
    );
    expect(authorize).toContain(
      "EXPECTED_SOURCE_WORKFLOW_PATH: .github/workflows/vercel-release.yml"
    );
    expect(authorize).toContain("REQUIRED_HEAD_BRANCH: main");
    expect(authorize).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    expect(authorize).toContain(
      'test "$(git rev-parse --verify \'HEAD^{commit}\')" = "$SOURCE_HEAD_SHA"'
    );
    expect(authorize).toContain("authorized: ${{ steps.event.outputs.authorized }}");
    expect(authorize).not.toContain("secrets.");
    expect(authorize).not.toContain("environment: beta-staging-containment");
  });

  it("restores the exact isolated staging holding or proves an exact-project fail-closed pause", async () => {
    const contents = await workflow();
    const staging = job(contents, "staging-contain", "contain");
    const eventValidation = staging.indexOf(
      "Revalidate the exact failed release event before staging credentials"
    );
    const checkout = staging.indexOf(pinnedAction("checkout"));
    const ancestry = staging.indexOf("git merge-base --is-ancestor");
    const firstSecret = staging.indexOf("secrets.");
    const targetBinding = staging.indexOf("Validate and link the exact isolated staging project");
    const holdingRecord = staging.indexOf("Fetch and validate the pinned staging holding record");
    const restore = staging.indexOf("Idempotently restore the pinned staging holding deployment");
    const projectSafety = staging.indexOf(
      "Set and independently re-read disabled staging domain auto-assignment"
    );
    const holdingProof = staging.indexOf("Prove the canonical staging alias resolves to exact holding");
    const pause = staging.indexOf("Fail closed by pausing the exact staging project");
    const finalGate = staging.indexOf("Require exact staging holding or a proved fail-closed pause");

    expect(staging).toContain("needs: staging-authorize");
    expect(staging).toContain("needs.staging-authorize.result == 'success'");
    expect(staging).toContain("needs.staging-authorize.outputs.authorized == 'true'");
    expect(staging).toContain("environment: beta-staging-containment");
    expect(eventValidation).toBeGreaterThan(0);
    expect(checkout).toBeGreaterThan(eventValidation);
    expect(ancestry).toBeGreaterThan(checkout);
    expect(firstSecret).toBeGreaterThan(ancestry);
    expect(targetBinding).toBeGreaterThan(ancestry);
    expect(holdingRecord).toBeGreaterThan(targetBinding);
    expect(restore).toBeGreaterThan(holdingRecord);
    expect(projectSafety).toBeGreaterThan(restore);
    expect(holdingProof).toBeGreaterThan(projectSafety);
    expect(pause).toBeGreaterThan(holdingProof);
    expect(finalGate).toBeGreaterThan(pause);

    expect(staging).toContain('test "$SOURCE_EVENT" = "workflow_dispatch"');
    expect(staging).toContain(
      'test "$SOURCE_WORKFLOW_PATH" = ".github/workflows/vercel-release.yml"'
    );
    expect(staging).toContain("EXPECTED_VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}");
    expect(staging).toContain("EXPECTED_VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}");
    expect(staging).toContain('test "$VERCEL_ORG_ID" = "$EXPECTED_VERCEL_ORG_ID"');
    expect(staging).toContain('test "$VERCEL_PROJECT_ID" = "$EXPECTED_VERCEL_PROJECT_ID"');
    expect(staging).toContain(
      'test "$VERCEL_PROJECT_ID" != "prj_ZK8tbbhxoDuuGFy1k67kW7XgjXzs"'
    );
    expect(staging).toContain('test "$APP_BASE_URL" = "https://demo.kinresolve.com"');
    expect(staging).toContain(
      "APPROVED_HOLDING_DEPLOYMENT_ID: ${{ secrets.STAGING_HOLDING_DEPLOYMENT_ID }}"
    );
    expect(staging).toContain(
      '"https://api.vercel.com/v13/deployments/$APPROVED_HOLDING_DEPLOYMENT_ID$scope_query"'
    );
    expect(staging).toContain("scripts/validate-vercel-deployment.mjs holding-record");
    expect(staging).toContain('vercel promote "$HOLDING_DEPLOYMENT_URL" --yes --timeout=5m');
    expect(staging).toContain('--data \'{"autoAssignCustomDomains":false}\'');
    expect(staging).toContain("scripts/validate-vercel-project-safety.mjs");
    expect(staging).toContain(
      '"https://api.vercel.com/v13/deployments/$canonical_host$scope_query"'
    );
    expect(staging).toContain("scripts/validate-vercel-deployment.mjs holding");
    expect(staging).toContain(
      '"https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/pause$scope_query"'
    );
    expect(staging).toContain('EXPECTED_VERCEL_PROJECT_PAUSED: "true"');

    const recoverableSteps = staging.match(/continue-on-error: true/g) ?? [];
    expect(recoverableSteps).toHaveLength(4);
    const gate = staging.slice(finalGate);
    expect(gate).toContain('test "$PAUSE_OUTCOME" = "success"');
    expect(gate).toContain('"$HOLDING_RECORD_OUTCOME" = "success"');
    expect(gate).toContain('"$RESTORE_OUTCOME" = "success"');
    expect(gate).toContain('"$PROJECT_SAFETY_OUTCOME" = "success"');
    expect(gate).toContain('"$HOLDING_PROOF_OUTCOME" = "success"');
    expect(gate).toContain("if: success()");

    const production = job(contents, "contain");
    expect(production).toContain("needs: classify");
    expect(production).not.toContain("needs: staging-contain");
  });

  it("revalidates provenance before the privileged containment checkout or protected credentials", async () => {
    const contain = job(await workflow(), "contain");
    const validation = contain.indexOf("Validate the failed protected release event before checkout");
    const checkout = contain.indexOf(pinnedAction("checkout"));
    const databaseSecret = contain.indexOf("secrets.MIGRATION_DATABASE_URL");
    expect(validation).toBeGreaterThan(0);
    expect(checkout).toBeGreaterThan(validation);
    expect(databaseSecret).toBeGreaterThan(checkout);
    expect(contain).toContain("git merge-base --is-ancestor");
    expect(contain).toContain("SOURCE_DISPLAY_TITLE: ${{ github.event.workflow_run.display_title }}");
    expect(contain).toContain('test "$SOURCE_WORKFLOW_NAME" = "$SOURCE_DISPLAY_TITLE"');
    expect(contain).toContain(
      'test "$SOURCE_DISPLAY_TITLE" = "Kin Resolve beta release run $SOURCE_RUN_ID attempt $SOURCE_RUN_ATTEMPT"'
    );
  });

  it("binds every Vercel control operation to independent protected org and project identities", async () => {
    const contain = job(await workflow(), "contain");
    const event = contain.indexOf("Validate the failed protected release event before checkout");
    const binding = contain.indexOf(
      "Bind Vercel control credentials to the exact protected production project"
    );
    const firstVercelApi = contain.indexOf("https://api.vercel.com/", binding);
    const targetBinding = contain.slice(binding, firstVercelApi);
    expect(binding).toBeGreaterThan(event);
    expect(firstVercelApi).toBeGreaterThan(binding);
    expect(targetBinding).toContain("EXPECTED_VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}");
    expect(targetBinding).toContain("EXPECTED_VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}");
    expect(targetBinding).toContain('test "$VERCEL_ORG_ID" = "$EXPECTED_VERCEL_ORG_ID"');
    expect(targetBinding).toContain(
      'test "$VERCEL_PROJECT_ID" = "$EXPECTED_VERCEL_PROJECT_ID"'
    );
    expect(targetBinding).toContain(
      'test "$EXPECTED_VERCEL_PROJECT_ID" = "prj_ZK8tbbhxoDuuGFy1k67kW7XgjXzs"'
    );
    expect(contain).toContain("steps.vercel-target.outputs.authorized == 'true'");
  });

  it("matches stable release job and step names used by the failure classifier", async () => {
    const release = await workflow("vercel-release.yml");
    expect(release).toContain("name: Deploy and promote production candidate");
    expect(release).toContain("name: Publish stable GitHub release");
    expect(release).toContain("name: Revalidate the live canonical candidate before publication");
  });

  it("contains through the exact database before rolling back to the prior holding deployment", async () => {
    const contents = await workflow();
    const directContainment = contents.indexOf("npm run --silent release:fence:control -- contain");
    const autoAssignmentSafety = contents.indexOf(
      "Enforce disabled production domain auto-assignment before ownership checks"
    );
    const canonicalOwnership = contents.indexOf(
      "Refuse stale containment against a different live release"
    );
    const drain = contents.indexOf("sleep 1860");
    const holdingValidation = contents.indexOf("scripts/validate-static-holding-deployment.mjs");
    const ownershipChecks = contents.match(/scripts\/validate-vercel-deployment\.mjs containment/g) ?? [];
    const rollback = contents.indexOf('vercel rollback "$APPROVED_HOLDING_DEPLOYMENT_ID"');
    const finalValidation = contents.lastIndexOf("scripts/validate-vercel-deployment.mjs holding");
    expect(directContainment).toBeGreaterThan(0);
    expect(autoAssignmentSafety).toBeGreaterThan(directContainment);
    expect(canonicalOwnership).toBeGreaterThan(autoAssignmentSafety);
    expect(drain).toBeGreaterThan(directContainment);
    expect(holdingValidation).toBeGreaterThan(drain);
    expect(ownershipChecks).toHaveLength(3);
    expect(rollback).toBeGreaterThan(holdingValidation);
    expect(finalValidation).toBeGreaterThan(rollback);
    expect(job(contents, "contain")).not.toContain('vercel promote "$HOLDING_DEPLOYMENT_URL"');
    expect(contents).toContain("RECOVERY_REQUIRE_STRAGGLER_PROOF: \"true\"");
    expect(contents).toContain("FIRST_CUTOVER_HOLDING_DEPLOYMENT_ID");
    expect(contents).toContain("verify or disable both schedules in the Vercel dashboard");
    const repairBlock = contents.slice(autoAssignmentSafety, canonicalOwnership);
    expect(repairBlock).toContain("always() &&");
    expect(repairBlock).toContain("steps.vercel-target.outputs.authorized == 'true'");
    expect(repairBlock).toContain("needs.classify.result != 'success'");
    expect(repairBlock).toContain(
      "steps.containment-domain-auto-assignment.outcome != 'success'"
    );
    expect(repairBlock).not.toContain("steps.canonical-ownership.outcome");
    expect(contents).toContain("scripts/validate-vercel-project-safety.mjs");
    expect(contents).toContain('canonical_state" == "other-release"');
    expect(contents).toContain("candidate_run_attempt: ${{ steps.classification.outputs.candidate_run_attempt }}");
    expect(contents).toContain("EXPECTED_GITHUB_RUN_ATTEMPT: ${{ steps.privileged-classification.outputs.candidate_run_attempt }}");
    expect(contents).toContain("Independently resolve the candidate-owning production attempt");
    expect(contents).toContain("ORIGINAL_CLASSIFY_RESULT: ${{ needs.classify.result }}");
    expect(contents).toContain("Prove current canonical ownership before a manual containment rerun");
    expect(contents).toContain("github.run_attempt > 1");
    expect(contents).toContain("github.run_attempt == 1");
    const staleRelease = contents.indexOf(
      "Idempotently release only the stale source fence after proving another release is canonical"
    );
    expect(staleRelease).toBeGreaterThan(canonicalOwnership);
    const staleReleaseBlock = contents.slice(staleRelease, drain);
    expect(staleReleaseBlock).toContain(
      "if: steps.canonical-ownership.outputs.canonical_state == 'other-release'"
    );
    expect(staleReleaseBlock).not.toContain("steps.contain-fence.outputs.transition");
    expect(staleReleaseBlock).toContain(
      '(.transition == "released" or .transition == "already-released")'
    );
    expect(staleReleaseBlock).toContain("npm run --silent release:fence:control -- release");
  });

  it("pins privileged checkout and setup actions to full commits", async () => {
    const contents = await workflow();
    expect(contents).toContain(pinnedActionWithComment("checkout"));
    expect(contents).toContain(pinnedActionWithComment("setupNode"));
    expect(contents).not.toMatch(/uses:\s+actions\/(?:checkout|setup-node)@v\d/);
  });
});
