import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pinnedActionWithComment } from "./helpers/action-pins";

async function workflow(): Promise<string> {
  return readFile(
    path.join(process.cwd(), ".github", "workflows", "public-demo-safety.yml"),
    "utf8"
  );
}

function job(contents: string, name: string, nextName?: string): string {
  const start = contents.indexOf(`\n  ${name}:`);
  const end = nextName ? contents.indexOf(`\n  ${nextName}:`, start + 1) : contents.length;
  expect(start, `missing ${name} job`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${nextName ?? "workflow end"}`).toBeGreaterThan(start);
  return contents.slice(start, end);
}

describe("failed public demo release safety workflow", () => {
  it("authorizes only exact failed public-demo workflow attempts before protected credentials", async () => {
    const contents = await workflow();
    const authorize = job(contents, "authorize", "contain");
    const trustedCheckout = authorize.indexOf("Check out the trusted authorization gate from main");
    const nodeSetup = authorize.indexOf(
      "Set up Node.js for the credential-free authorization gate"
    );
    const eventValidation = authorize.indexOf("Validate the exact failed public demo release event");
    const cli = authorize.indexOf("scripts/authorize-workflow-run-source.mjs");
    const revisionCheckout = authorize.indexOf(
      "Check out the exact failed public demo release revision"
    );
    const ancestry = authorize.indexOf("git merge-base --is-ancestor");

    expect(contents).toContain("name: Contain failed Kin Resolve public demo release");
    expect(contents).toContain(
      "run-name: Contain public demo run ${{ github.event.workflow_run.id }} attempt ${{ github.event.workflow_run.run_attempt }}"
    );
    expect(contents).toContain("workflow_run:");
    expect(contents).toContain("- Release Kin Resolve public demo");
    expect(contents).toContain("group: kinresolve-public-demo-release");
    expect(contents).toContain("queue: max");
    expect(contents).toContain("cancel-in-progress: false");
    expect(contents).toContain("actions: read");
    expect(authorize).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(authorize).toContain("github.event.workflow_run.conclusion == 'cancelled'");
    expect(authorize).toContain("github.event.workflow_run.conclusion == 'timed_out'");
    expect(trustedCheckout).toBeGreaterThan(0);
    expect(nodeSetup).toBeGreaterThan(trustedCheckout);
    expect(eventValidation).toBeGreaterThan(nodeSetup);
    expect(cli).toBeGreaterThan(eventValidation);
    expect(revisionCheckout).toBeGreaterThan(cli);
    expect(ancestry).toBeGreaterThan(revisionCheckout);
    const trustedGate = authorize.slice(trustedCheckout, eventValidation);
    expect(trustedGate).toContain(pinnedActionWithComment("checkout"));
    expect(trustedGate).toContain("ref: main");
    expect(trustedGate).toContain("fetch-depth: 1");
    expect(trustedGate).toContain("persist-credentials: false");
    expect(authorize).toContain(
      "run: node --experimental-strip-types scripts/authorize-workflow-run-source.mjs"
    );
    expect(authorize).toContain("ALLOWED_SOURCE_CONCLUSIONS: failure,cancelled,timed_out");
    expect(authorize).toContain("ALLOWED_SOURCE_EVENTS: workflow_dispatch");
    expect(authorize).toContain(
      "EXPECTED_SOURCE_WORKFLOW_NAME: Release Kin Resolve public demo"
    );
    expect(authorize).toContain(
      "EXPECTED_SOURCE_WORKFLOW_PATH: .github/workflows/public-demo-release.yml"
    );
    expect(authorize).toContain("REQUIRED_HEAD_BRANCH: main");
    expect(authorize).toContain(
      '[{"template":"Public demo {action} {head_sha} run {run_id} attempt {run_attempt}","captures":{"action":["release","rollback","contain"]}}]'
    );
    expect(authorize).toContain("action: ${{ steps.event.outputs.action }}");
    expect(authorize).toContain("authorized: ${{ steps.event.outputs.authorized }}");
    expect(authorize).not.toContain("secrets.");
    expect(authorize).not.toMatch(/^    environment:/m);
  });

  it("restores and proves the pinned public-demo holding deployment or pauses the exact project", async () => {
    const contents = await workflow();
    const contain = job(contents, "contain", "emergency-pause");
    const targetBinding = contain.indexOf("Validate and link the isolated public demo project");
    const holdingRecord = contain.indexOf("Fetch and validate the pinned demo holding record");
    const restore = contain.indexOf("Restore the pinned demo holding deployment");
    const projectSafety = contain.indexOf(
      "Repair and independently attest demo domain auto-assignment"
    );
    const domainOwnership = contain.indexOf("Restore and prove dedicated demo hostname ownership");
    const holdingProof = contain.indexOf("Prove the canonical demo holding restoration");
    const pause = contain.indexOf(
      "Fail closed by pausing the demo project when holding restoration cannot be proved"
    );
    const finalGate = contain.indexOf(
      "Require verified demo holding restoration or fail-closed pause"
    );

    expect(contain).toContain("needs: authorize");
    expect(contain).toContain("needs.authorize.outputs.authorized == 'true'");
    expect(contain).toContain("environment: demo-containment");
    expect(targetBinding).toBeGreaterThan(0);
    expect(holdingRecord).toBeGreaterThan(targetBinding);
    expect(restore).toBeGreaterThan(holdingRecord);
    expect(projectSafety).toBeGreaterThan(restore);
    expect(domainOwnership).toBeGreaterThan(projectSafety);
    expect(holdingProof).toBeGreaterThan(domainOwnership);
    expect(pause).toBeGreaterThan(holdingProof);
    expect(finalGate).toBeGreaterThan(pause);
    expect(contain).toContain('test "$APP_BASE_URL" = "https://demo.kinresolve.com"');
    expect(contain).toContain("EXPECTED_VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}");
    expect(contain).toContain("EXPECTED_VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}");
    expect(contain).toContain("PRODUCTION_VERCEL_PROJECT_ID: ${{ vars.PRODUCTION_VERCEL_PROJECT_ID }}");
    expect(contain).toContain("MARKETING_VERCEL_PROJECT_ID: ${{ vars.MARKETING_VERCEL_PROJECT_ID }}");
    expect(contain).toContain('test "$VERCEL_ORG_ID" = "$EXPECTED_VERCEL_ORG_ID"');
    expect(contain).toContain('test "$VERCEL_PROJECT_ID" = "$EXPECTED_VERCEL_PROJECT_ID"');
    expect(contain).toContain('test "$VERCEL_PROJECT_ID" != "$PRODUCTION_VERCEL_PROJECT_ID"');
    expect(contain).toContain('test "$VERCEL_PROJECT_ID" != "$MARKETING_VERCEL_PROJECT_ID"');
    expect(contain).toContain(
      "APPROVED_HOLDING_DEPLOYMENT_ID: ${{ secrets.DEMO_HOLDING_DEPLOYMENT_ID }}"
    );
    expect(contain).toContain("scripts/validate-vercel-deployment.mjs holding-record");
    const restoreBlock = contain.slice(restore, projectSafety);
    expect(restoreBlock).toContain(
      '"https://api.vercel.com/v13/deployments/$deployment_host$scope_query"'
    );
    expect(restoreBlock).toContain("scripts/validate-vercel-deployment.mjs holding");
    expect(restoreBlock).toContain('holding_is_current()');
    expect(restoreBlock).toContain("public-demo-safety-current-before.json");
    expect(restoreBlock).toContain("public-demo-safety-current-after.json");
    expect(restoreBlock).toContain("The exact pinned holding deployment is already current.");
    expect(restoreBlock).toContain(
      "The exact pinned holding deployment became current during restoration."
    );
    expect(restoreBlock.indexOf("scripts/validate-vercel-deployment.mjs holding")).toBeLessThan(
      restoreBlock.indexOf('vercel rollback "$HOLDING_DEPLOYMENT_URL"')
    );
    expect(restoreBlock.indexOf("public-demo-safety-current-after.json")).toBeGreaterThan(
      restoreBlock.indexOf('vercel rollback "$HOLDING_DEPLOYMENT_URL"')
    );
    expect(contain).toContain('vercel rollback "$HOLDING_DEPLOYMENT_URL" --yes --timeout=5m');
    expect(contain).not.toContain('vercel promote "$HOLDING_DEPLOYMENT_URL"');
    expect(contain).toContain(`--data '{"autoAssignCustomDomains":false}'`);
    expect(contain).toContain("scripts/validate-vercel-project-safety.mjs");
    expect(contain).toContain("EXPECTED_VERCEL_PROJECT_NAME: kinresolve-demo");
    expect(contain).toContain("scripts/validate-vercel-project-domain.mjs");
    expect(contain).toContain(
      "https://api.vercel.com/v1/projects/$MARKETING_VERCEL_PROJECT_ID/domains/$DEMO_DOMAIN/move"
    );
    expect(contain).toContain("scripts/validate-vercel-deployment.mjs holding");
    expect(contain).toContain(
      'cmp "$RUNNER_TEMP/public-demo-safety-canonical.html" holding/login.html'
    );
    expect(contain).toContain('test "$health_status" = "404"');
    expect(contain).toContain(
      '"https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/pause$scope_query"'
    );
    expect(contain).toContain('EXPECTED_VERCEL_PROJECT_PAUSED: "true"');

    const gate = contain.slice(finalGate);
    expect(gate).toContain('test "$PAUSE_OUTCOME" = "success"');
    expect(gate).toContain('"$HOLDING_RECORD_OUTCOME" = "success"');
    expect(gate).toContain('"$RESTORE_OUTCOME" = "success"');
    expect(gate).toContain('"$PROJECT_SAFETY_OUTCOME" = "success"');
    expect(gate).toContain('"$DOMAIN_OWNERSHIP_OUTCOME" = "success"');
    expect(gate).toContain('"$HOLDING_PROOF_OUTCOME" = "success"');
  });

  it("records a receipt only after containment reaches a proved safe state", async () => {
    const contents = await workflow();
    const contain = job(contents, "contain", "emergency-pause");
    const finalGate = contain.indexOf(
      "Require verified demo holding restoration or fail-closed pause"
    );
    const receipt = contain.indexOf("Record the exact public demo safety receipt");

    expect(finalGate).toBeGreaterThan(0);
    expect(receipt).toBeGreaterThan(finalGate);
    const receiptStep = contain.slice(receipt);
    expect(receiptStep).toContain("if: success()");
    expect(receiptStep).toContain(
      "SOURCE_RUN_ATTEMPT: ${{ github.event.workflow_run.run_attempt }}"
    );
    expect(receiptStep).toContain("SOURCE_RUN_ID: ${{ github.event.workflow_run.id }}");
    expect(receiptStep).toContain("Pinned holding restored or demo fail-closed paused: true");
  });

  it("runs an independent exact-project pause when the containment job fails or times out", async () => {
    const contents = await workflow();
    const pause = job(contents, "emergency-pause");

    expect(pause).toContain("needs: [authorize, contain]");
    expect(pause).toContain("if: >-");
    expect(pause).toContain("always() &&");
    expect(pause).toContain("needs.authorize.outputs.authorized == 'true'");
    expect(pause).toContain("needs.contain.result != 'success'");
    expect(pause).toContain("environment: demo-containment");
    expect(pause).toContain("timeout-minutes: 10");
    expect(pause).toContain("EXPECTED_VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}");
    expect(pause).toContain("EXPECTED_VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}");
    expect(pause).toContain("MARKETING_VERCEL_PROJECT_ID: ${{ vars.MARKETING_VERCEL_PROJECT_ID }}");
    expect(pause).toContain("PRODUCTION_VERCEL_PROJECT_ID: ${{ vars.PRODUCTION_VERCEL_PROJECT_ID }}");
    expect(pause).toContain('test "$VERCEL_PROJECT_ID" = "$EXPECTED_VERCEL_PROJECT_ID"');
    expect(pause).toContain('test "$VERCEL_PROJECT_ID" != "$MARKETING_VERCEL_PROJECT_ID"');
    expect(pause).toContain('test "$VERCEL_PROJECT_ID" != "$PRODUCTION_VERCEL_PROJECT_ID"');
    expect(pause).toContain(`--data '{"autoAssignCustomDomains":false}'`);
    expect(pause).toContain("https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/pause");
    expect(pause).toContain("|| true");
    expect(pause).toContain('project.name !== "kinresolve-demo"');
    expect(pause).toContain('project.paused !== true');
    expect(pause).toContain('project.autoAssignCustomDomains !== false');
  });
});
