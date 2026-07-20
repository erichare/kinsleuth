import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pinnedActionWithComment } from "./helpers/action-pins";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "holding-safety.yml"),
  "utf8"
);
const releasesDoc = readFileSync(path.join(process.cwd(), "docs", "releases.md"), "utf8");

function job(name: string, nextName?: string): string {
  const start = workflow.indexOf(`\n  ${name}:`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:`, start + 1) : workflow.length;
  expect(start, `missing ${name} job`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${nextName ?? "workflow end"}`).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe("failed holding auto-assignment safety workflow", () => {
  it("authorizes only exact failed marked holding events through the trusted shared gate", () => {
    const authorize = job("authorize", "repair");
    const trustedCheckout = authorize.indexOf("Check out the trusted authorization gate from main");
    const nodeSetup = authorize.indexOf(
      "Set up Node.js for the credential-free authorization gate"
    );
    const cli = authorize.indexOf("scripts/authorize-workflow-run-source.mjs");
    const revisionCheckout = authorize.indexOf("Check out the exact failed holding revision");
    const ancestry = authorize.indexOf("git merge-base --is-ancestor");

    expect(workflow).toContain("name: Repair failed Kin Resolve holding safety");
    expect(workflow).toContain(
      "run-name: Repair holding run ${{ github.event.workflow_run.id }} attempt ${{ github.event.workflow_run.run_attempt }}"
    );
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("- Deploy Kin Resolve static holding page");
    expect(workflow).toContain("actions: read");
    expect(authorize).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(authorize).toContain("github.event.workflow_run.conclusion == 'cancelled'");
    expect(authorize).toContain("github.event.workflow_run.conclusion == 'timed_out'");
    expect(trustedCheckout).toBeGreaterThan(0);
    expect(nodeSetup).toBeGreaterThan(trustedCheckout);
    expect(cli).toBeGreaterThan(nodeSetup);
    expect(revisionCheckout).toBeGreaterThan(cli);
    expect(ancestry).toBeGreaterThan(revisionCheckout);
    const trustedGate = authorize.slice(trustedCheckout, cli);
    expect(trustedGate).toContain("ref: main");
    expect(trustedGate).toContain("fetch-depth: 1");
    expect(trustedGate).toContain("persist-credentials: false");
    expect(authorize).toContain(
      "run: node --experimental-strip-types scripts/authorize-workflow-run-source.mjs"
    );
    expect(authorize).toContain("ALLOWED_SOURCE_CONCLUSIONS: failure,cancelled,timed_out");
    expect(authorize).toContain("ALLOWED_SOURCE_EVENTS: workflow_dispatch");
    expect(authorize).toContain(
      "EXPECTED_SOURCE_WORKFLOW_NAME: Deploy Kin Resolve static holding page"
    );
    expect(authorize).toContain(
      "EXPECTED_SOURCE_WORKFLOW_PATH: .github/workflows/vercel-holding.yml"
    );
    expect(authorize).toContain("REQUIRED_HEAD_BRANCH: main");
    expect(authorize).toContain(
      '[{"template":"Kin Resolve static holding beta-staging run {run_id} attempt {run_attempt}","outputs":{"target":"beta-staging","safety_environment":"beta-staging-containment"}},'
    );
    expect(authorize).toContain(
      '{"template":"Kin Resolve static holding production run {run_id} attempt {run_attempt}","outputs":{"target":"production","safety_environment":"production-containment"}},'
    );
    expect(authorize).toContain(
      '{"template":"Kin Resolve static holding public-demo run {run_id} attempt {run_attempt}","outputs":{"target":"public-demo","safety_environment":"demo-containment"}}]'
    );
    expect(authorize).toContain("authorized: ${{ steps.event.outputs.authorized }}");
    expect(authorize).toContain(
      "safety_environment: ${{ steps.event.outputs.safety_environment }}"
    );
    expect(authorize).toContain("target: ${{ steps.event.outputs.target }}");
    expect(authorize).not.toContain("secrets.");
    expect(authorize).not.toMatch(/^    environment:/m);
    expect(authorize).toContain("Classify whether promotion could have changed the target");
    expect(authorize).toContain(
      "actions/runs/$SOURCE_RUN_ID/attempts/$SOURCE_RUN_ATTEMPT/jobs?per_page=100"
    );
    expect(authorize).toContain(
      'step?.name === "Promote the explicitly acknowledged static holding deployment"'
    );
    expect(authorize).toContain('step.conclusion === "skipped" ? "false" : "true"');
    expect(authorize).toContain("promotion_exposure=%s");
  });

  it("pins trusted actions, proves exact main provenance twice, and queues by target resource", () => {
    const repair = job("repair", "emergency-pause");
    expect(workflow.split(pinnedActionWithComment("checkout"))).toHaveLength(4);
    expect(workflow.split(pinnedActionWithComment("setupNode"))).toHaveLength(4);
    expect(workflow).not.toMatch(/uses:\s+actions\/(?:checkout|setup-node)@v\d/);
    expect(workflow.split("git merge-base --is-ancestor")).toHaveLength(3);
    expect(workflow.split("git fetch origin main:refs/remotes/origin/main --force --no-tags"))
      .toHaveLength(3);
    expect(repair).toContain(
      "if: needs.authorize.result == 'success' && needs.authorize.outputs.authorized == 'true'"
    );
    expect(repair).toContain("environment: ${{ needs.authorize.outputs.safety_environment }}");
    expect(repair).toContain(
      "group: ${{ needs.authorize.outputs.target == 'public-demo' && 'kinresolve-public-demo-release' || format('kinresolve-beta-holding-safety-{0}', needs.authorize.outputs.target) }}"
    );
    expect(repair).toContain("queue: max");
    expect(repair).toContain("cancel-in-progress: false");
  });

  it("PATCHes v9, independently GET-validates, and pauses closed when repair cannot be proved", () => {
    const repair = job("repair", "emergency-pause");
    const normalStart = repair.indexOf(
      "Repair and independently attest target domain auto-assignment"
    );
    const fallbackStart = repair.indexOf(
      "Fail closed by pausing the target when repair cannot be proved"
    );
    const requireStart = repair.indexOf(
      "Require a verified automatic repair or fail-closed pause"
    );
    const normal = repair.slice(normalStart, fallbackStart);
    const fallback = repair.slice(fallbackStart, requireStart);

    expect(normalStart).toBeGreaterThan(0);
    expect(fallbackStart).toBeGreaterThan(normalStart);
    expect(requireStart).toBeGreaterThan(fallbackStart);
    expect(normal).toContain("continue-on-error: true");
    expect(normal).toContain("https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID");
    expect(normal).toContain("--request PATCH");
    expect(normal).toContain(`--data '{"autoAssignCustomDomains":false}'`);
    expect(normal).toContain('"$project_api" --output "$RUNNER_TEMP/holding-safety-project.json"');
    expect(normal).toContain("scripts/validate-vercel-project-safety.mjs");
    expect(normal).toContain('"$RUNNER_TEMP/holding-safety-project.json"');
    expect(normal).not.toContain("EXPECTED_VERCEL_PROJECT_PAUSED");
    expect(normal).toContain("EXPECTED_VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}");
    expect(normal).toContain("EXPECTED_VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}");
    expect(normal).toContain('test "$VERCEL_ORG_ID" = "$EXPECTED_VERCEL_ORG_ID"');
    expect(normal).toContain('test "$VERCEL_PROJECT_ID" = "$EXPECTED_VERCEL_PROJECT_ID"');
    expect(normal).toContain("TARGET: ${{ needs.authorize.outputs.target }}");
    expect(normal).toContain("production)");
    expect(normal).toContain(
      'test "$EXPECTED_VERCEL_PROJECT_ID" = "prj_ZK8tbbhxoDuuGFy1k67kW7XgjXzs"'
    );
    expect(normal).toContain("beta-staging)");
    expect(normal).toContain(
      'test "$EXPECTED_VERCEL_PROJECT_ID" != "prj_ZK8tbbhxoDuuGFy1k67kW7XgjXzs"'
    );
    expect(normal).toContain("public-demo)");
    expect(normal).toContain("MARKETING_VERCEL_PROJECT_ID: ${{ vars.MARKETING_VERCEL_PROJECT_ID }}");
    expect(normal).toContain('test "$EXPECTED_VERCEL_PROJECT_ID" != "$MARKETING_VERCEL_PROJECT_ID"');
    expect(normal).toContain("EXPECTED_VERCEL_PROJECT_NAME");
    expect(normal).toContain("kinresolve-demo");

    expect(fallback).toContain("steps.repair-auto-assignment.outcome == 'failure'");
    expect(fallback).toContain("needs.authorize.outputs.promotion_exposure == 'true'");
    expect(fallback).toContain("https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/pause");
    expect(fallback).toContain('EXPECTED_VERCEL_PROJECT_PAUSED: "true"');
    expect(fallback).toContain("holding-safety-project-after-pause.json");
    expect(fallback).toContain("TARGET: ${{ needs.authorize.outputs.target }}");
    expect(fallback).toContain(
      'test "$EXPECTED_VERCEL_PROJECT_ID" = "prj_ZK8tbbhxoDuuGFy1k67kW7XgjXzs"'
    );
    expect(repair.slice(requireStart)).toContain('if [[ "$REPAIR_OUTCOME" == "success" ]]');
    expect(repair.slice(requireStart)).toContain('test "$PROMOTION_EXPOSURE" = "true"');
    expect(repair.slice(requireStart)).toContain('test "$PAUSE_OUTCOME" = "success"');
  });

  it("repairs and proves the dedicated demo hostname or pauses closed", () => {
    const repair = job("repair", "emergency-pause");
    const proofStart = repair.indexOf("Prove public demo hostname and exact holding bytes");
    const pauseStart = repair.indexOf(
      "Fail closed by pausing the target when repair cannot be proved"
    );
    const proof = repair.slice(proofStart, pauseStart);

    expect(proofStart).toBeGreaterThan(0);
    expect(proof).toContain("needs.authorize.outputs.target == 'public-demo'");
    expect(proof).toContain("needs.authorize.outputs.promotion_exposure == 'true'");
    expect(proof).toContain(
      "https://api.vercel.com/v1/projects/$MARKETING_VERCEL_PROJECT_ID/domains/$DEMO_DOMAIN/move"
    );
    expect(proof).toContain('"projectId": process.env.VERCEL_PROJECT_ID');
    expect(proof).toContain("scripts/validate-vercel-project-domain.mjs");
    expect(proof).toContain(
      'cmp "$RUNNER_TEMP/holding-safety-demo-canonical.html" holding/login.html'
    );
    expect(proof).toContain('test "$health_status" = "404"');
    expect(repair.slice(pauseStart)).toContain("steps.demo-holding-proof.outcome != 'success'");
  });

  it("documents non-interactive Vercel-only target safety environments", () => {
    expect(releasesDoc).toContain(
      "`beta-staging-containment` is an automatic safety environment with no required reviewers"
    );
    expect(releasesDoc).toContain(
      "Secrets: `STAGING_HOLDING_DEPLOYMENT_ID`, `VERCEL_ORG_ID`,"
    );
    expect(releasesDoc).toContain(
      "`VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`. Variables: `APP_BASE_URL`, `VERCEL_ORG_ID`, and"
    );
    expect(releasesDoc).toContain(
      "`production-containment` is an automatic safety environment with no required reviewers"
    );
  });

  it("runs an independent idempotent pause when the repair job fails or times out", () => {
    const pause = job("emergency-pause");

    expect(pause).toContain("needs: [authorize, repair]");
    expect(pause).toContain("if: >-");
    expect(pause).toContain("always() &&");
    expect(pause).toContain("needs.authorize.outputs.authorized == 'true'");
    expect(pause).toContain("needs.authorize.outputs.promotion_exposure == 'true'");
    expect(pause).toContain("needs.repair.result != 'success'");
    expect(pause).toContain("environment: ${{ needs.authorize.outputs.safety_environment }}");
    expect(pause).toContain("timeout-minutes: 10");
    expect(pause).toContain(
      "group: ${{ needs.authorize.outputs.target == 'public-demo' && 'kinresolve-public-demo-release' || format('kinresolve-beta-holding-safety-{0}', needs.authorize.outputs.target) }}"
    );
    expect(pause).toContain("EXPECTED_VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}");
    expect(pause).toContain("EXPECTED_VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}");
    expect(pause).toContain("TARGET: ${{ needs.authorize.outputs.target }}");
    expect(pause).toContain('test "$VERCEL_PROJECT_ID" = "$EXPECTED_VERCEL_PROJECT_ID"');
    expect(pause).toContain(`--data '{"autoAssignCustomDomains":false}'`);
    expect(pause).toContain("https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/pause");
    expect(pause).toContain("|| true");
    expect(pause).toContain('project.paused !== true');
    expect(pause).toContain('project.autoAssignCustomDomains !== false');
  });
});
