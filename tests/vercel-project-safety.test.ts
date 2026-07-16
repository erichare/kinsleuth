import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateVercelProjectSafety } from "@/lib/vercel-project-safety";

const scratch: string[] = [];
const expectations = {
  expectedProjectId: "prj_project1234",
  expectedOrgId: "team_org1234",
  expectedPaused: false
};

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: expectations.expectedProjectId,
    accountId: expectations.expectedOrgId,
    autoAssignCustomDomains: false,
    paused: false,
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Vercel project release safety", () => {
  it("accepts the exact unpaused project only when custom-domain auto-assignment is disabled", () => {
    expect(validateVercelProjectSafety(project(), expectations)).toEqual({
      projectId: expectations.expectedProjectId,
      orgId: expectations.expectedOrgId,
      autoAssignCustomDomains: false,
      paused: false
    });
  });

  it.each([
    ["wrong project", { id: "prj_other1234" }],
    ["wrong organization", { accountId: "team_other1234" }],
    ["auto-assignment enabled", { autoAssignCustomDomains: true }],
    ["missing auto-assignment", { autoAssignCustomDomains: undefined }],
    ["malformed paused state", { paused: "false" }],
    ["paused project", { paused: true }],
    ["ambiguous organization", { teamId: "team_other1234" }]
  ])("rejects %s", (_label, override) => {
    expect(() => validateVercelProjectSafety(project(override), expectations)).toThrow();
  });

  it("can explicitly require a safely paused project", () => {
    expect(validateVercelProjectSafety(project({ paused: true }), {
      ...expectations,
      expectedPaused: true
    }).paused).toBe(true);
  });

  it("normalizes the documented omitted paused field as an active project", () => {
    expect(validateVercelProjectSafety(project({ paused: undefined }), expectations).paused).toBe(false);
  });

  it("validates a privacy-safe project document through the CLI", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-vercel-project-"));
    scratch.push(directory);
    const filePath = path.join(directory, "project.json");
    await writeFile(filePath, JSON.stringify(project()), "utf8");
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      "scripts/validate-vercel-project-safety.mjs",
      filePath
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_PROJECT_ID: expectations.expectedProjectId,
        VERCEL_ORG_ID: expectations.expectedOrgId,
        EXPECTED_VERCEL_PROJECT_PAUSED: "false"
      }
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("auto_assignment_disabled=true\nproject_paused=false\n");
  });

  it("reports a validated paused project for idempotent fail-closed handling", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-vercel-project-paused-"));
    scratch.push(directory);
    const filePath = path.join(directory, "project.json");
    await writeFile(filePath, JSON.stringify(project({ paused: true })), "utf8");
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      "scripts/validate-vercel-project-safety.mjs",
      filePath
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_PROJECT_ID: expectations.expectedProjectId,
        VERCEL_ORG_ID: expectations.expectedOrgId,
        EXPECTED_VERCEL_PROJECT_PAUSED: ""
      }
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("auto_assignment_disabled=true\nproject_paused=true\n");
  });
});
