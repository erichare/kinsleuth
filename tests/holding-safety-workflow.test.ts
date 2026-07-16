import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "holding-safety.yml"),
  "utf8"
);
const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");

function job(name: string, nextName?: string): string {
  const start = workflow.indexOf(`\n  ${name}:`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:`, start + 1) : workflow.length;
  expect(start, `missing ${name} job`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${nextName ?? "workflow end"}`).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe("failed holding auto-assignment safety workflow", () => {
  it("emits an exact source-attempt receipt and accepts only failed marked holding events", () => {
    const authorize = job("authorize", "repair");
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
    expect(authorize).toContain('test "$EVENT_ACTION" = "completed"');
    expect(authorize).toContain('test "$EVENT_REPOSITORY" = "$CURRENT_REPOSITORY"');
    expect(authorize).toContain(
      'test "$SOURCE_WORKFLOW_NAME" = "Deploy Kin Resolve static holding page"'
    );
    expect(authorize).toContain(
      'test "$SOURCE_WORKFLOW_NAME" = "$SOURCE_DISPLAY_TITLE"'
    );
    expect(authorize).toContain(
      'test "$SOURCE_WORKFLOW_PATH" = ".github/workflows/vercel-holding.yml"'
    );
    expect(authorize).toContain('test "$SOURCE_EVENT" = "workflow_dispatch"');
    expect(authorize).toContain('test "$SOURCE_HEAD_BRANCH" = "main"');
    expect(authorize).toContain('test "$SOURCE_HEAD_REPOSITORY" = "$CURRENT_REPOSITORY"');
    expect(authorize).toContain('test "$SOURCE_RUN_REPOSITORY" = "$CURRENT_REPOSITORY"');
    expect(authorize).toContain(
      '"Kin Resolve static holding beta-staging run $SOURCE_RUN_ID attempt $SOURCE_RUN_ATTEMPT"'
    );
    expect(authorize).toContain(
      '"Kin Resolve static holding production run $SOURCE_RUN_ID attempt $SOURCE_RUN_ATTEMPT"'
    );
    expect(authorize).toContain('safety_environment="beta-staging-containment"');
    expect(authorize).toContain('safety_environment="production-containment"');
    expect(authorize).toContain("authorized=true");
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
    const repair = job("repair");
    expect(workflow.split(
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4"
    )).toHaveLength(3);
    expect(workflow.split(
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4"
    )).toHaveLength(3);
    expect(workflow).not.toMatch(/uses:\s+actions\/(?:checkout|setup-node)@v\d/);
    expect(workflow.split("git merge-base --is-ancestor")).toHaveLength(3);
    expect(workflow.split("git fetch origin main:refs/remotes/origin/main --force --no-tags"))
      .toHaveLength(3);
    expect(repair).toContain(
      "if: needs.authorize.result == 'success' && needs.authorize.outputs.authorized == 'true'"
    );
    expect(repair).toContain("environment: ${{ needs.authorize.outputs.safety_environment }}");
    expect(repair).toContain(
      "group: kinresolve-beta-holding-safety-${{ needs.authorize.outputs.target }}"
    );
    expect(repair).toContain("queue: max");
    expect(repair).toContain("cancel-in-progress: false");
  });

  it("PATCHes v9, independently GET-validates, and pauses closed when repair cannot be proved", () => {
    const repair = job("repair");
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

  it("documents non-interactive Vercel-only target safety environments", () => {
    expect(readme).toContain(
      "`beta-staging-containment` is an automatic safety environment with no required reviewers"
    );
    expect(readme).toContain(
      "Secrets: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`."
    );
    expect(readme).toContain("Variables: `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.");
    expect(readme).toContain(
      "`production-containment` is an automatic safety environment with no required reviewers"
    );
  });
});
