import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pinnedActionWithComment } from "./helpers/action-pins";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "api-edge-evidence.yml"),
  "utf8"
);

describe("protected API edge evidence workflow", () => {
  it("binds a protected manual run to the exact current main SHA", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("environment: api-edge-evidence");
    expect(workflow).toContain("group: kinresolve-beta-release");
    expect(workflow).toContain('test "${GITHUB_REF}" = "refs/heads/main"');
    expect(workflow).toContain('test "${GITHUB_SHA}" = "${RELEASE_COMMIT}"');
    expect(workflow).toContain('test "$(git rev-parse origin/main)" = "${RELEASE_COMMIT}"');
    expect(workflow).toContain("ref: ${{ inputs.release_commit }}");
    expect(workflow).toContain("persist-credentials: false");
  });

  it("reads only the current official Vercel firewall and system-bypass APIs", () => {
    const read = workflow.slice(
      workflow.indexOf("Read the current active Vercel firewall and system bypasses"),
      workflow.indexOf("Validate the exact active rule before sending a bounded probe")
    );
    expect(read).toContain("https://api.vercel.com/v1/security/firewall/config/active");
    expect(read).toContain("https://api.vercel.com/v1/security/firewall/bypass");
    expect(read).toContain('--data-urlencode "limit=100"');
    expect(read).not.toMatch(/\b(?:PATCH|POST|PUT|DELETE)\b/);
    expect(read).toContain('rm -f "${auth_config}"');
    expect(workflow.match(/secrets\./g)).toHaveLength(1);
    const jobEnvironment = workflow.slice(workflow.indexOf("    env:"), workflow.indexOf("    steps:"));
    expect(jobEnvironment).not.toContain("secrets.");
  });

  it("validates the exact rule and no-bypass contract before a bounded unauthenticated burst", () => {
    const validate = workflow.indexOf("Validate the exact active rule before sending a bounded probe");
    const probe = workflow.indexOf("Prove bounded unauthenticated enforcement and direct-origin denial");
    const capture = workflow.indexOf("Assemble and self-validate the sole sanitized evidence file");
    expect(validate).toBeGreaterThan(-1);
    expect(validate).toBeLessThan(probe);
    expect(probe).toBeLessThan(capture);
    expect(workflow).toContain("inspectVercelApiEdgeConfiguration");
    expect(workflow).toContain("index<=API_EDGE_EXPECTED_LIMIT+1");
    expect(workflow).toContain("requests_sent=$((API_EDGE_EXPECTED_LIMIT + 2))");
    expect(workflow).toContain('test "${ordinary_status}" = "401" -o "${ordinary_status}" = "404"');
    expect(workflow).toMatch(/429\)\s+rate_limited_responses=/);
    expect(workflow).toContain('test "${API_EDGE_EXPECTED_ACTION}" = "rate_limit"');
    expect(workflow).not.toContain('test "${API_EDGE_EXPECTED_ACTION}" = "deny"');
    expect(workflow).toContain('test "${direct_origin_status}" = "401" -o "${direct_origin_status}" = "403"');
    const probeStep = workflow.slice(probe, capture);
    expect(probeStep).not.toContain("Authorization:");
    expect(probeStep).not.toContain("secrets.");
    expect(probeStep).toContain('--dump-header "${EDGE_WORK}/direct-origin.headers"');
    expect(probeStep).toContain("validate-api-edge-response-headers.mjs");
    expect(probeStep).toContain('direct-protection "${EDGE_WORK}/direct-origin.headers"');
    expect(probeStep).toContain("Vercel Authentication|Authentication Required|Deployment Protection");
    expect(probeStep).toContain("directOriginProtectionVerified: true");
    expect(probeStep).toContain('ordinary "${EDGE_WORK}/canonical-0.headers"');
    expect(probeStep).toContain('marker="kr-edge-evidence-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"');
    expect(probeStep).toContain('--dump-header "${headers}"');
    expect(probeStep).toContain("canonical-0.headers");
    expect(probeStep).toContain("first_rate_limited_index");
    expect(probeStep).toContain('rate-limited "${limited_headers}"');
    expect(probeStep).toContain('canonical "${headers}"');
    expect(probeStep).toContain('grep -Fq "${marker}" "${EDGE_WORK}/direct-origin.headers"');
    expect(probeStep).not.toContain("no-store|private|no-cache|max-age=0");
    expect(probeStep).toContain("response_leakage_observed=false");
    expect(probeStep).toContain('responseLeakageObserved: $responseLeakageObserved');
  });

  it("requires explicit log review and scans response bodies without publishing them", () => {
    const gate = workflow.indexOf("I inspected Vercel Firewall logs and confirmed only x-request-id is logged; credentials, cookies, bypass headers, signatures, and query values are not logged or sampled.");
    const providerCredential = workflow.indexOf("secrets.VERCEL_TOKEN");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(providerCredential);
    expect(workflow).toContain('responseLeakageObserved: $responseLeakageObserved');
    expect(workflow).toContain("providerLogsReviewed: true");
    expect(workflow).toContain("Bearer[[:space:]]+");
    const upload = workflow.slice(workflow.indexOf("Upload only the release-bound sanitized API edge evidence"));
    expect(upload).toContain("/api-edge-evidence.json");
    expect(upload).not.toContain("active-firewall.json");
    expect(upload).not.toContain("system-bypasses.json");
    expect(upload).not.toContain(".body");
  });

  it("attests and uploads exactly one JSON artifact using pinned actions", () => {
    expect(workflow).toContain(`uses: ${pinnedActionWithComment("checkout")}`);
    expect(workflow).toContain(`uses: ${pinnedActionWithComment("setupNode")}`);
    expect(workflow).toContain(`uses: ${pinnedActionWithComment("attest")}`);
    const uploadAction = `uses: ${pinnedActionWithComment("uploadArtifact")}`;
    expect(workflow.split(uploadAction)).toHaveLength(2);
    expect(workflow).toContain("name: production-api-edge-evidence-${{ github.run_attempt }}");
    expect(workflow.indexOf("scripts/validate-api-edge-evidence.mjs"))
      .toBeLessThan(workflow.indexOf("actions/attest@"));
    expect(workflow.indexOf("actions/attest@"))
      .toBeLessThan(workflow.indexOf("actions/upload-artifact@"));
    expect(workflow).not.toContain("continue-on-error");
  });

  it("removes raw provider responses and probe bodies on every outcome", () => {
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain('rm -rf "${EDGE_WORK:-${RUNNER_TEMP}/kinresolve-api-edge-evidence}"');
  });
});
