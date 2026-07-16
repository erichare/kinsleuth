import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readRepositoryFile(relativePath: string): string {
  const filePath = path.join(root, relativePath);
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function triggerBlock(workflow: string): string {
  const start = workflow.indexOf("\non:");
  const end = workflow.indexOf("\npermissions:", start + 1);
  return start >= 0 && end > start ? workflow.slice(start, end) : workflow;
}

function stepBlock(workflow: string, stepName: string, nextStepName: string): string {
  const start = workflow.indexOf(`- name: ${stepName}`);
  const end = workflow.indexOf(`- name: ${nextStepName}`, start + 1);
  return start >= 0 && end > start ? workflow.slice(start, end) : "";
}

const productionBackup = readRepositoryFile(".github/workflows/production-backup.yml");
const productionBackupCleanup = readRepositoryFile(
  ".github/workflows/production-backup-cleanup.yml"
);
const recoveryCleanup = readRepositoryFile(".github/workflows/recovery-cleanup.yml");
const publicDemoRelease = readRepositoryFile(".github/workflows/public-demo-release.yml");
const publicDemoMonitoring = readRepositoryFile(
  ".github/workflows/public-demo-monitoring.yml"
);
const publicDemoMonitorScript = readRepositoryFile("scripts/public-demo-monitor.mjs");

describe("public demo operational boundary", () => {
  it("keeps the unprovisioned real-data backup manual-only", () => {
    const triggers = triggerBlock(productionBackup);
    expect(triggers).toContain("workflow_dispatch:");
    expect(triggers).not.toMatch(/^\s+schedule:/m);
    expect(triggers).not.toContain("cron:");

    const authorization = stepBlock(
      productionBackupCleanup,
      "Validate the exact failed production backup event without credentials",
      "Query the exact source run for its cleanup lease artifact"
    );
    expect(authorization).toContain('run?.event !== "workflow_dispatch"');
    expect(authorization).not.toContain('["schedule", "workflow_dispatch"]');
  });

  it.each([
    {
      label: "production backup",
      workflow: productionBackupCleanup,
      stepName: "Validate the exact failed production backup event without credentials",
      nextStepName: "Query the exact source run for its cleanup lease artifact",
      sourcePath: ".github/workflows/production-backup.yml",
      workflowIdVariable: "PRODUCTION_BACKUP_WORKFLOW_ID"
    },
    {
      label: "recovery evidence",
      workflow: recoveryCleanup,
      stepName: "Validate the exact failed protected recovery event without credentials",
      nextStepName: "Query the exact source run for its cleanup lease artifact",
      sourcePath: ".github/workflows/recovery-evidence.yml",
      workflowIdVariable: "RECOVERY_EVIDENCE_WORKFLOW_ID"
    }
  ])(
    "authorizes $label cleanup by immutable workflow path and numeric ID, not display name",
    ({ workflow, stepName, nextStepName, sourcePath, workflowIdVariable }) => {
      const authorization = stepBlock(workflow, stepName, nextStepName);
      expect(authorization).toContain(`run?.path !== "${sourcePath}"`);
      expect(workflow).toContain(
        `EXPECTED_SOURCE_WORKFLOW_ID: \${{ vars.${workflowIdVariable} }}`
      );
      expect(authorization).toContain("run?.workflow_id");
      expect(authorization).not.toContain("run?.name");
      expect(authorization).not.toContain("display_title");
    }
  );

  it("provides one protected manual workflow for exact-SHA public demo release and containment", () => {
    expect(publicDemoRelease).toContain("name: Release Kin Resolve public demo");
    expect(triggerBlock(publicDemoRelease)).toContain("workflow_dispatch:");
    expect(publicDemoRelease).toContain("release_commit:");
    expect(publicDemoRelease).toContain('[[ "$RELEASE_COMMIT" =~ ^[a-f0-9]{40}$ ]]');
    expect(publicDemoRelease).toContain(
      'test "$(git rev-parse --verify \'HEAD^{commit}\')" = "$RELEASE_COMMIT"'
    );
    expect(publicDemoRelease).toContain(
      'test "$(git rev-parse refs/remotes/origin/main)" = "$RELEASE_COMMIT"'
    );

    expect(publicDemoRelease).toContain("environment: demo-production");
    expect(publicDemoRelease).toContain("environment: demo-containment");
    expect(publicDemoRelease).toContain("scripts/probe-vercel-candidate-protection.mjs");
    expect(publicDemoRelease).toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(publicDemoRelease).toMatch(/browser-canary\.(?:ts|mjs)/);
    expect(publicDemoRelease).toContain('vercel promote "$CANDIDATE_DEPLOYMENT_URL"');
    expect(publicDemoRelease).toContain("PREVIOUS_DEPLOYMENT_ID");
    expect(publicDemoRelease).toContain("DEMO_HOLDING_DEPLOYMENT_ID");
    expect(publicDemoRelease).toContain('vercel promote "$HOLDING_DEPLOYMENT_URL"');

    const protection = publicDemoRelease.indexOf("scripts/probe-vercel-candidate-protection.mjs");
    const canary = publicDemoRelease.search(/browser-canary\.(?:ts|mjs)/);
    const promotion = publicDemoRelease.indexOf('vercel promote "$CANDIDATE_DEPLOYMENT_URL"');
    expect(protection).toBeGreaterThan(-1);
    expect(canary).toBeGreaterThan(protection);
    expect(promotion).toBeGreaterThan(canary);
  });

  it("binds the public demo release to its own hosted-demo cell identities", () => {
    expect(publicDemoRelease).toContain('test "$APP_BASE_URL" = "https://demo.kinresolve.com"');
    expect(publicDemoRelease).toContain("EXPECTED_DATASET_MODE: demo");
    expect(publicDemoRelease).toContain("EXPECTED_ARCHIVE_ID: kinresolve-demo-public");
    expect(publicDemoRelease).toContain("KINRESOLVE_DEPLOYMENT_MODE: hosted");
    expect(publicDemoRelease).toContain("KINRESOLVE_PUBLIC_DEMO_ENABLED: \"true\"");
    expect(publicDemoRelease).toContain("KINRESOLVE_RELEASE_ROLE: public-demo");

    expect(publicDemoRelease).toContain(
      "PRODUCTION_VERCEL_PROJECT_ID: ${{ vars.PRODUCTION_VERCEL_PROJECT_ID }}"
    );
    expect(publicDemoRelease).toContain(
      'test "$VERCEL_PROJECT_ID" != "$PRODUCTION_VERCEL_PROJECT_ID"'
    );
    expect(publicDemoRelease).toContain(
      "PRODUCTION_DATABASE_IDENTITY: ${{ vars.PRODUCTION_DATABASE_IDENTITY }}"
    );
    expect(publicDemoRelease).toContain(
      'test "$KINRESOLVE_DATABASE_IDENTITY" != "$PRODUCTION_DATABASE_IDENTITY"'
    );
    expect(publicDemoRelease).not.toMatch(/^\s+environment: (?:beta-staging|production)$/m);
  });

  it("validates Sensitive runtime credentials by metadata and readable demo values exactly", () => {
    const environmentValidation = publicDemoRelease.indexOf(
      "scripts/validate-vercel-environment.mjs"
    );
    const candidateDeployment = publicDemoRelease.indexOf(
      "Deploy the unaliased public demo candidate"
    );
    expect(environmentValidation).toBeGreaterThan(-1);
    expect(environmentValidation).toBeLessThan(candidateDeployment);
    expect(publicDemoRelease).toContain("EXPECTED_VERCEL_ENVIRONMENT_PROFILE=public-demo");
    expect(publicDemoRelease).toContain("/v9/projects/$VERCEL_PROJECT_ID/env?");
    expect(publicDemoRelease).toContain('AI_API_MODE: "responses"');
    expect(publicDemoRelease).toContain(
      'AI_BASE_URL: "https://ai-gateway.vercel.sh/v1"'
    );
    expect(publicDemoRelease).toContain('AI_CHAT_MODEL: "openai/gpt-5-mini"');
    expect(publicDemoRelease).not.toContain('if (!process.env[name]?.trim())');
  });

  it("fails closed unless the dedicated AI Gateway key retains the approved $50 hard budget", () => {
    const gatewayValidation = publicDemoRelease.indexOf(
      "scripts/validate-public-demo-ai-gateway-key.mjs"
    );
    const candidateDeployment = publicDemoRelease.indexOf(
      "Deploy the unaliased public demo candidate"
    );
    expect(gatewayValidation).toBeGreaterThan(-1);
    expect(gatewayValidation).toBeLessThan(candidateDeployment);
    expect(publicDemoRelease).toContain(
      "EXPECTED_AI_GATEWAY_API_KEY_ID: ${{ vars.AI_GATEWAY_API_KEY_ID }}"
    );
    expect(publicDemoRelease).toContain(
      "EXPECTED_AI_GATEWAY_MONTHLY_BUDGET_USD: ${{ vars.AI_GATEWAY_MONTHLY_BUDGET_USD }}"
    );
    expect(publicDemoRelease).toContain("https://api.vercel.com/v1/api-keys?");
  });

  it("grants and re-attests the demo runtime role after migration and before candidate deployment", () => {
    const migration = publicDemoRelease.indexOf(
      "Migrate and provision only the isolated demo database"
    );
    const grant = publicDemoRelease.indexOf(
      "npm run db:runtime-role:grant-beta-operations"
    );
    const deployment = publicDemoRelease.indexOf(
      "Deploy the unaliased public demo candidate"
    );

    expect(migration).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(migration);
    expect(deployment).toBeGreaterThan(grant);

    const grantStepStart = publicDemoRelease.lastIndexOf("- name:", grant);
    const grantStepEnd = publicDemoRelease.indexOf("\n      - name:", grant);
    const grantStep = publicDemoRelease.slice(grantStepStart, grantStepEnd);
    expect(grantStep).toContain(
      "EXPECTED_DATABASE_IDENTITY: ${{ vars.KINRESOLVE_DATABASE_IDENTITY }}"
    );
    expect(grantStep).toContain(
      "MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}"
    );
    expect(grantStep).toContain('grantContract == "beta-operations-v1"');
    expect(grantStep).toContain(".sameDatabaseSessionVerified == true");
    expect(grantStep).toContain(".safeRuntimeRoleReattested == true");
    expect(grantStep).toContain(".exactPrivilegesAttested == true");
    expect(grantStep).toContain(".persistentDataMutation == false");
    expect(grantStep).not.toMatch(/(?:source|\.)\s+\.vercel\/\.env\.production\.local/);
  });

  it("runs body-aware shallow monitoring every 15 minutes and a full demo canary every six hours", () => {
    expect(publicDemoMonitoring).toContain("name: Monitor Kin Resolve public demo");
    expect(triggerBlock(publicDemoMonitoring)).toContain('- cron: "*/15 * * * *"');
    expect(triggerBlock(publicDemoMonitoring)).toContain('- cron: "17 */6 * * *"');
    expect(triggerBlock(publicDemoMonitoring)).toContain("workflow_dispatch:");
    expect(publicDemoMonitoring).toContain("environment: demo-monitoring");
    expect(publicDemoMonitoring).toContain(
      "node --experimental-strip-types scripts/public-demo-monitor.mjs shallow"
    );
    expect(publicDemoMonitoring).toContain(
      "node --experimental-strip-types scripts/public-demo-monitor.mjs full"
    );
    expect(publicDemoMonitoring).toContain("KINRESOLVE_DEMO_CANARY_SECRET");
    expect(publicDemoMonitoring).toContain("github.event.schedule == '17 */6 * * *'");

    expect(publicDemoMonitorScript).toMatch(/path:\s*["']\/["']/);
    expect(publicDemoMonitorScript).toMatch(/path:\s*["']\/api\/health["']/);
    expect(publicDemoMonitorScript).toMatch(/path:\s*["']\/family["']/);
    expect(publicDemoMonitorScript).toContain("expectedContentType");
    expect(publicDemoMonitorScript).toContain("bodyContract");
    expect(publicDemoMonitorScript).toContain("/api/demo/sessions");
    expect(publicDemoMonitorScript).toContain("/api/demo/cases/");
    expect(publicDemoMonitorScript).toContain("/api/demo/session/end");
  });

  it("keeps demo lifecycle cleanup on the existing worker cron budget", () => {
    const vercel = JSON.parse(readRepositoryFile("vercel.json")) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    expect(vercel.crons).toEqual([
      { path: "/api/cron/integration-jobs", schedule: "*/5 * * * *" },
      { path: "/api/cron/import-uploads", schedule: "17 7 * * *" }
    ]);
    expect(vercel.crons?.some((cron) => /demo|session/i.test(cron.path ?? ""))).toBe(false);
  });
});
