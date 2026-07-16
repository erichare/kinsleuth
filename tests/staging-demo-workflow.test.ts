import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function workflow() {
  return readFile(
    path.join(process.cwd(), ".github", "workflows", "staging-demo-session.yml"),
    "utf8"
  );
}

describe("staging demo session workflow", () => {
  it("exposes only exact manual open and close operations on the shared release queue", async () => {
    const contents = await workflow();
    const dispatch = contents.slice(contents.indexOf("  workflow_dispatch:"), contents.indexOf("\npermissions:"));
    expect(contents).toMatch(/^on:\s*\n\s*workflow_dispatch:/m);
    expect(contents).toMatch(/action:[\s\S]*?type: choice[\s\S]*?options:[\s\S]*?- open[\s\S]*?- close/);
    expect(contents).toContain("group: kinresolve-beta-release");
    expect(contents).toContain("queue: max");
    expect(contents).toContain("cancel-in-progress: false");
    expect(contents).toContain("OPEN KIN RESOLVE SYNTHETIC STAGING DEMO");
    expect(contents).toContain("CLOSE KIN RESOLVE SYNTHETIC STAGING DEMO TO HOLDING");
    expect(dispatch).not.toContain("candidate_deployment_id:");
    expect(dispatch).not.toContain("release_version:");
    expect(contents).not.toMatch(/\breset\b/i);
  });

  it("keeps source attestation credential-free and splits protected open from automatic close", async () => {
    const contents = await workflow();
    const authorize = contents.slice(contents.indexOf("  authorize:"), contents.indexOf("  session:"));
    const session = contents.slice(contents.indexOf("  session:"));
    expect(authorize).not.toMatch(/^    environment:/m);
    expect(authorize).toContain('session_environment="beta-staging"');
    expect(authorize).toContain('session_environment="beta-staging-containment"');
    expect(authorize).toContain('test "$GITHUB_REF_VALUE" = "refs/heads/main"');
    expect(authorize).toContain('test "$SESSION_COMMIT" = "$EXPECTED_GITHUB_SHA"');
    expect(authorize).toContain("actions/runs/$SOURCE_RELEASE_RUN_ID/attempts/$SOURCE_RELEASE_RUN_ATTEMPT");
    expect(authorize).toContain("validate-staging-demo-source.mjs");
    expect(authorize).toContain("staging-demo-candidate-evidence-$SOURCE_RELEASE_RUN_ATTEMPT");
    expect(authorize).toContain("candidate_deployment_id: ${{ steps.source-evidence.outputs.candidate_deployment_id }}");
    expect(authorize).toContain("release_version: ${{ steps.source-evidence.outputs.release_version }}");
    expect(authorize).toContain("RELEASE_SAFETY_CURRENT_WORKFLOW: demo");
    expect(authorize).toContain("validate-release-safety-queue.mjs");
    expect(session).toContain("needs: authorize");
    expect(session).toContain("environment: ${{ needs.authorize.outputs.session_environment }}");
    expect(session).toContain("RELEASE_SAFETY_CURRENT_WORKFLOW: demo");
  });

  it("proves current main, current legal bytes, holding state, and candidate metadata before open", async () => {
    const contents = await workflow();
    const source = contents.indexOf("Validate the successful staging-only source attempt");
    const legal = contents.indexOf("Revalidate approved staging legal document bytes");
    const holding = contents.indexOf("Validate the canonical staging holding before open");
    const candidate = contents.indexOf("Validate the exact staging demo candidate");
    const main = contents.indexOf("Reverify exact current main immediately before session mutation");
    const promote = contents.indexOf("Promote the exact staging demo candidate");
    const sourceRevalidation = contents.indexOf(
      "Revalidate the exact fresh staging-only evidence immediately before mutation"
    );
    expect(source).toBeGreaterThan(0);
    expect(legal).toBeGreaterThan(source);
    expect(holding).toBeGreaterThan(legal);
    expect(candidate).toBeGreaterThan(holding);
    expect(sourceRevalidation).toBeGreaterThan(candidate);
    expect(main).toBeGreaterThan(sourceRevalidation);
    expect(main).toBeGreaterThan(candidate);
    expect(promote).toBeGreaterThan(main);
    expect(contents).toContain("npm run beta:legal:validate -- .vercel/.env.production.local");
    expect(contents.match(/scripts\/probe-beta-legal-endpoints\.mjs/g)).toHaveLength(2);
    expect(contents).toContain('test "$(git rev-parse refs/remotes/origin/main)" = "$SESSION_COMMIT"');
    expect(contents).toContain("scripts/validate-vercel-deployment.mjs candidate");
    expect(contents).toContain('test "$APP_BASE_URL" = "https://demo.kinresolve.com"');
    expect(contents).toContain("SOURCE_RELEASE_RUN_ID: ${{ inputs.source_release_run_id }}");
    expect(contents).toContain("EXPECTED_GITHUB_RUN_ID: ${{ inputs.source_release_run_id }}");
    expect(contents).toContain(
      "CANDIDATE_DEPLOYMENT_ID: ${{ needs.authorize.outputs.candidate_deployment_id }}"
    );
    expect(contents.match(/scripts\/validate-staging-demo-source\.mjs/g)).toHaveLength(2);
    expect(contents.match(/gh run download "\$SOURCE_RELEASE_RUN_ID"/g)).toHaveLength(2);
    expect(contents).toContain("Prove the generated staging demo candidate still rejects unauthenticated access");
    expect(contents).toContain("scripts/probe-vercel-candidate-protection.mjs");
  });

  it("closes idempotently to the pinned holding and fail-closes Vercel project safety", async () => {
    const contents = await workflow();
    expect(contents).toContain("scripts/validate-vercel-deployment.mjs holding-record");
    const closeAttempt = contents.indexOf("Attempt to promote the pinned staging holding deployment for close");
    const holdingBeforeResume = contents.indexOf("Prove the canonical staging holding before resume");
    const projectSafety = contents.indexOf("Resume and independently attest staging domain safety");
    const holdingAfterResume = contents.indexOf("Validate the canonical staging holding after close");
    expect(closeAttempt).toBeGreaterThan(0);
    expect(holdingBeforeResume).toBeGreaterThan(closeAttempt);
    expect(projectSafety).toBeGreaterThan(holdingBeforeResume);
    expect(holdingAfterResume).toBeGreaterThan(projectSafety);
    expect(contents.slice(closeAttempt, holdingBeforeResume)).toContain("continue-on-error: true");
    expect(contents.slice(closeAttempt, holdingBeforeResume)).toContain(
      'vercel promote "$HOLDING_DEPLOYMENT_URL" --yes --timeout=5m'
    );
    expect(contents.slice(holdingBeforeResume, projectSafety)).toContain(
      "scripts/validate-vercel-deployment.mjs holding"
    );
    expect(contents.slice(holdingBeforeResume, projectSafety)).toContain("id: close-holding-proof");
    expect(contents.slice(projectSafety, holdingAfterResume)).toContain(
      "steps.close-holding-proof.outcome == 'success'"
    );
    expect(contents.slice(projectSafety, holdingAfterResume)).toContain(
      "https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/unpause"
    );
    expect(contents.slice(projectSafety, holdingAfterResume)).toContain(
      'grep -qx "project_paused=true"'
    );
    expect(contents).toContain("Validate the canonical staging holding after close");
    expect(contents).toContain("scripts/validate-vercel-deployment.mjs holding");
    expect(contents).toContain("scripts/validate-vercel-project-safety.mjs");
    expect(contents).toContain("Fail closed by pausing staging when session safety cannot be proved");
    expect(contents).toContain("https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/pause");
    expect(contents).toContain("Validate the exact opened candidate at the canonical hostname");
    expect(contents).toContain("scripts/validate-vercel-deployment.mjs promoted");
    const canonicalLegal = contents.indexOf(
      "Prove the canonical demo serves the exact current approved legal bytes"
    );
    const finalMain = contents.indexOf(
      "Require the opened demo to remain the exact current main revision"
    );
    const receipt = contents.indexOf("Record the completed staging demo session action");
    expect(finalMain).toBeGreaterThan(canonicalLegal);
    expect(receipt).toBeGreaterThan(finalMain);
  });
});
