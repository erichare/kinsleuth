import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  authorizeWorkflowRunSource,
  workflowRunSourceAuthorizationProfiles,
  type WorkflowRunSourceAuthorizationConfig
} from "@/lib/workflow-run-source-authorization";

const repository = "erichare/kinresolve";
const sha = "0123456789abcdef0123456789abcdef01234567";
const otherSha = "fedcba9876543210fedcba9876543210fedcba98";

const releaseContainmentConfig: WorkflowRunSourceAuthorizationConfig = {
  ...workflowRunSourceAuthorizationProfiles.releaseContainment,
  currentRepository: repository
};
const publicDemoSafetyConfig: WorkflowRunSourceAuthorizationConfig = {
  ...workflowRunSourceAuthorizationProfiles.publicDemoSafety,
  currentRepository: repository
};
const holdingSafetyConfig: WorkflowRunSourceAuthorizationConfig = {
  ...workflowRunSourceAuthorizationProfiles.holdingSafety,
  currentRepository: repository
};
const backupCleanupConfig: WorkflowRunSourceAuthorizationConfig = {
  ...workflowRunSourceAuthorizationProfiles.productionBackupCleanup,
  currentRepository: repository,
  expectedSourceWorkflowId: "190000001"
};
const recoveryCleanupConfig: WorkflowRunSourceAuthorizationConfig = {
  ...workflowRunSourceAuthorizationProfiles.recoveryCleanup,
  currentRepository: repository,
  expectedSourceWorkflowId: "190000002"
};

const baseOutputs = {
  run_id: "29470000001",
  run_attempt: "2",
  head_sha: sha
};

function baseRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 29470000001,
    run_attempt: 2,
    workflow_id: 190000001,
    event: "workflow_dispatch",
    conclusion: "failure",
    head_branch: "main",
    head_sha: sha,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    ...overrides
  };
}

function releaseRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return baseRun({
    name: "Release Kin Resolve beta candidate",
    display_title: "Kin Resolve beta release run 29470000001 attempt 2",
    path: ".github/workflows/vercel-release.yml",
    ...overrides
  });
}

function publicDemoRun(
  action = "release",
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return baseRun({
    name: "Release Kin Resolve public demo",
    display_title: `Public demo ${action} ${sha} run 29470000001 attempt 2`,
    path: ".github/workflows/public-demo-release.yml",
    ...overrides
  });
}

function holdingRun(
  target = "beta-staging",
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return baseRun({
    name: "Deploy Kin Resolve static holding page",
    display_title: `Kin Resolve static holding ${target} run 29470000001 attempt 2`,
    path: ".github/workflows/vercel-holding.yml",
    ...overrides
  });
}

function backupRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return baseRun({
    name: "Production encrypted backup",
    display_title: "Production encrypted backup",
    path: ".github/workflows/production-backup.yml",
    ...overrides
  });
}

function recoveryRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return baseRun({
    name: "Production recovery evidence",
    display_title: "Production recovery evidence",
    path: ".github/workflows/recovery-evidence.yml",
    workflow_id: 190000002,
    ...overrides
  });
}

function workflowRunEvent(
  run: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    action: "completed",
    repository: { full_name: repository },
    workflow_run: run,
    ...overrides
  };
}

function without(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function rejection(
  event: Record<string, unknown>,
  config: WorkflowRunSourceAuthorizationConfig,
  reasonFragment: string
): void {
  const result = authorizeWorkflowRunSource(event, config);
  expect(result.authorized).toBe(false);
  if (!result.authorized) expect(result.reason).toContain(reasonFragment);
}

describe("release containment source authorization", () => {
  it.each(["failure", "cancelled", "timed_out"])(
    "authorizes the exact failed protected release event that concluded %s",
    (conclusion) => {
      const result = authorizeWorkflowRunSource(
        workflowRunEvent(releaseRun({ conclusion })),
        releaseContainmentConfig
      );
      expect(result).toEqual({ authorized: true, outputs: baseOutputs });
    }
  );

  it("authorizes a renamed source run whose name equals its display title", () => {
    const result = authorizeWorkflowRunSource(
      workflowRunEvent(releaseRun({ name: "Kin Resolve beta release run 29470000001 attempt 2" })),
      releaseContainmentConfig
    );
    expect(result).toEqual({ authorized: true, outputs: baseOutputs });
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      "the event action is not completed",
      workflowRunEvent(releaseRun(), { action: "requested" }),
      "event action"
    ],
    [
      "the event repository is foreign",
      workflowRunEvent(releaseRun(), { repository: { full_name: "erichare/other" } }),
      "event repository"
    ],
    [
      "the source run repository is foreign",
      workflowRunEvent(releaseRun({ repository: { full_name: "erichare/other" } })),
      "source run repository"
    ],
    [
      "the source head repository is a fork",
      workflowRunEvent(releaseRun({ head_repository: { full_name: "attacker/kinresolve" } })),
      "source head repository"
    ],
    [
      "the source workflow path is another workflow",
      workflowRunEvent(releaseRun({ path: ".github/workflows/release-containment.yml" })),
      "workflow path"
    ],
    [
      "the source workflow name matches neither the release nor the title",
      workflowRunEvent(releaseRun({ name: "Some other workflow" })),
      "workflow name"
    ],
    [
      "the source event is not workflow_dispatch",
      workflowRunEvent(releaseRun({ event: "push" })),
      "trigger event"
    ],
    [
      "the source head branch is not main",
      workflowRunEvent(releaseRun({ head_branch: "develop" })),
      "head branch"
    ],
    [
      "the source conclusion is success",
      workflowRunEvent(releaseRun({ conclusion: "success" })),
      "conclusion"
    ],
    [
      "the display title embeds a mismatched run id",
      workflowRunEvent(releaseRun({ display_title: "Kin Resolve beta release run 999 attempt 2" })),
      "display title"
    ],
    [
      "the display title embeds a mismatched run attempt",
      workflowRunEvent(
        releaseRun({ display_title: "Kin Resolve beta release run 29470000001 attempt 3" })
      ),
      "display title"
    ],
    [
      "the display title is arbitrary text",
      workflowRunEvent(releaseRun({ display_title: "Nightly release" })),
      "display title"
    ],
    [
      "the display title is missing",
      workflowRunEvent(without(releaseRun(), "display_title")),
      "display title"
    ],
    [
      "the run id is zero",
      workflowRunEvent(releaseRun({ id: 0 })),
      "run ID"
    ],
    [
      "the run id is missing",
      workflowRunEvent(without(releaseRun(), "id")),
      "run ID"
    ],
    [
      "the run attempt is malformed",
      workflowRunEvent(releaseRun({ run_attempt: "0" })),
      "run attempt"
    ],
    [
      "the head sha is truncated",
      workflowRunEvent(releaseRun({ head_sha: sha.slice(1) })),
      "head SHA"
    ],
    [
      "the head sha is uppercase",
      workflowRunEvent(releaseRun({ head_sha: sha.toUpperCase() })),
      "head SHA"
    ]
  ])("rejects when %s", (_label, event, reasonFragment) => {
    rejection(event, releaseContainmentConfig, reasonFragment);
  });
});

describe("public demo safety source authorization", () => {
  it.each(["release", "rollback", "contain"])(
    "authorizes the exact failed public demo %s event and extracts the action",
    (action) => {
      const result = authorizeWorkflowRunSource(
        workflowRunEvent(publicDemoRun(action)),
        publicDemoSafetyConfig
      );
      expect(result).toEqual({ authorized: true, outputs: { ...baseOutputs, action } });
    }
  );

  it.each<[string, Record<string, unknown>, string]>([
    [
      "the display title names an unknown action",
      workflowRunEvent(publicDemoRun("destroy")),
      "display title"
    ],
    [
      "the display title embeds a different head sha",
      workflowRunEvent(publicDemoRun("release", {
        display_title: `Public demo release ${otherSha} run 29470000001 attempt 2`
      })),
      "display title"
    ],
    [
      "the display title embeds a mismatched run id",
      workflowRunEvent(publicDemoRun("release", {
        display_title: `Public demo release ${sha} run 29470000002 attempt 2`
      })),
      "display title"
    ],
    [
      "the display title is missing",
      workflowRunEvent(without(publicDemoRun(), "display_title")),
      "display title"
    ],
    [
      "the source workflow path is the beta release workflow",
      workflowRunEvent(publicDemoRun("release", { path: ".github/workflows/vercel-release.yml" })),
      "workflow path"
    ],
    [
      "the source workflow name is the beta release workflow",
      workflowRunEvent(publicDemoRun("release", { name: "Release Kin Resolve beta candidate" })),
      "workflow name"
    ],
    [
      "the source head branch is not main",
      workflowRunEvent(publicDemoRun("release", { head_branch: "release" })),
      "head branch"
    ],
    [
      "the source conclusion is success",
      workflowRunEvent(publicDemoRun("release", { conclusion: "success" })),
      "conclusion"
    ],
    [
      "the event action is not completed",
      workflowRunEvent(publicDemoRun(), { action: "in_progress" }),
      "event action"
    ]
  ])("rejects when %s", (_label, event, reasonFragment) => {
    rejection(event, publicDemoSafetyConfig, reasonFragment);
  });
});

describe("holding safety source authorization", () => {
  it.each<[string, string]>([
    ["beta-staging", "beta-staging-containment"],
    ["production", "production-containment"],
    ["public-demo", "demo-containment"]
  ])(
    "authorizes the exact failed %s holding event and derives its safety environment",
    (target, safetyEnvironment) => {
      const result = authorizeWorkflowRunSource(
        workflowRunEvent(holdingRun(target)),
        holdingSafetyConfig
      );
      expect(result).toEqual({
        authorized: true,
        outputs: { ...baseOutputs, target, safety_environment: safetyEnvironment }
      });
    }
  );

  it.each<[string, Record<string, unknown>, string]>([
    [
      "the display title names an unknown target",
      workflowRunEvent(holdingRun("staging")),
      "display title"
    ],
    [
      "the display title embeds a mismatched run attempt",
      workflowRunEvent(holdingRun("production", {
        display_title: "Kin Resolve static holding production run 29470000001 attempt 3"
      })),
      "display title"
    ],
    [
      "the source workflow path is the release workflow",
      workflowRunEvent(holdingRun("production", { path: ".github/workflows/vercel-release.yml" })),
      "workflow path"
    ],
    [
      "the source workflow name matches neither the holding page nor the title",
      workflowRunEvent(holdingRun("production", { name: "Deploy something else" })),
      "workflow name"
    ],
    [
      "the source event is pull_request",
      workflowRunEvent(holdingRun("production", { event: "pull_request" })),
      "trigger event"
    ],
    [
      "the source conclusion is action_required",
      workflowRunEvent(holdingRun("production", { conclusion: "action_required" })),
      "conclusion"
    ],
    [
      "the source head branch is not main",
      workflowRunEvent(holdingRun("production", { head_branch: "main2" })),
      "head branch"
    ],
    [
      "the head sha is not hexadecimal",
      workflowRunEvent(holdingRun("production", { head_sha: "not-a-sha" })),
      "head SHA"
    ]
  ])("rejects when %s", (_label, event, reasonFragment) => {
    rejection(event, holdingSafetyConfig, reasonFragment);
  });
});

describe("production backup cleanup source authorization", () => {
  it("authorizes the exact failed backup event pinned to the numeric workflow id", () => {
    const result = authorizeWorkflowRunSource(
      workflowRunEvent(backupRun()),
      backupCleanupConfig
    );
    expect(result).toEqual({ authorized: true, outputs: baseOutputs });
  });

  it("authorizes a string workflow id that equals the expected numeric id", () => {
    const result = authorizeWorkflowRunSource(
      workflowRunEvent(backupRun({ workflow_id: "190000001" })),
      backupCleanupConfig
    );
    expect(result).toEqual({ authorized: true, outputs: baseOutputs });
  });

  it("authorizes a renamed backup run because this handler pins the path and id only", () => {
    const result = authorizeWorkflowRunSource(
      workflowRunEvent(backupRun({ name: "Renamed backup workflow" })),
      backupCleanupConfig
    );
    expect(result).toEqual({ authorized: true, outputs: baseOutputs });
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      "the workflow id is mismatched",
      workflowRunEvent(backupRun({ workflow_id: 190000009 })),
      "workflow ID"
    ],
    [
      "the workflow id is missing",
      workflowRunEvent(without(backupRun(), "workflow_id")),
      "workflow ID"
    ],
    [
      "the source workflow path is the recovery workflow",
      workflowRunEvent(backupRun({ path: ".github/workflows/recovery-evidence.yml" })),
      "workflow path"
    ],
    [
      "the source run repository is foreign",
      workflowRunEvent(backupRun({ repository: { full_name: "erichare/other" } })),
      "source run repository"
    ],
    [
      "the source head repository is a fork",
      workflowRunEvent(backupRun({ head_repository: { full_name: "attacker/kinresolve" } })),
      "source head repository"
    ],
    [
      "the event repository is foreign",
      workflowRunEvent(backupRun(), { repository: { full_name: "erichare/other" } }),
      "event repository"
    ],
    [
      "the source event is schedule",
      workflowRunEvent(backupRun({ event: "schedule" })),
      "trigger event"
    ],
    [
      "the source head branch is not main",
      workflowRunEvent(backupRun({ head_branch: "backup" })),
      "head branch"
    ],
    [
      "the source conclusion is success",
      workflowRunEvent(backupRun({ conclusion: "success" })),
      "conclusion"
    ],
    [
      "the run id is not numeric",
      workflowRunEvent(backupRun({ id: "abc" })),
      "run ID"
    ],
    [
      "the event action is not completed",
      workflowRunEvent(backupRun(), { action: "requested" }),
      "event action"
    ]
  ])("rejects when %s", (_label, event, reasonFragment) => {
    rejection(event, backupCleanupConfig, reasonFragment);
  });
});

describe("recovery cleanup source authorization", () => {
  it.each(["failure", "timed_out"])(
    "authorizes the exact failed recovery evidence event that concluded %s",
    (conclusion) => {
      const result = authorizeWorkflowRunSource(
        workflowRunEvent(recoveryRun({ conclusion })),
        recoveryCleanupConfig
      );
      expect(result).toEqual({ authorized: true, outputs: baseOutputs });
    }
  );

  it.each<[string, Record<string, unknown>, string]>([
    [
      "the workflow id belongs to the backup workflow",
      workflowRunEvent(recoveryRun({ workflow_id: 190000001 })),
      "workflow ID"
    ],
    [
      "the source workflow path is the backup workflow",
      workflowRunEvent(recoveryRun({ path: ".github/workflows/production-backup.yml" })),
      "workflow path"
    ],
    [
      "the source event is workflow_call",
      workflowRunEvent(recoveryRun({ event: "workflow_call" })),
      "trigger event"
    ],
    [
      "the source head branch is not main",
      workflowRunEvent(recoveryRun({ head_branch: "recovery" })),
      "head branch"
    ],
    [
      "the source conclusion is neutral",
      workflowRunEvent(recoveryRun({ conclusion: "neutral" })),
      "conclusion"
    ],
    [
      "the run attempt is zero",
      workflowRunEvent(recoveryRun({ run_attempt: 0 })),
      "run attempt"
    ],
    [
      "the head sha is missing",
      workflowRunEvent(without(recoveryRun(), "head_sha")),
      "head SHA"
    ]
  ])("rejects when %s", (_label, event, reasonFragment) => {
    rejection(event, recoveryCleanupConfig, reasonFragment);
  });
});

describe("authorization config fail-closed validation", () => {
  it("rejects an empty allowed conclusion list", () => {
    rejection(
      workflowRunEvent(releaseRun()),
      { ...releaseContainmentConfig, allowedSourceConclusions: [] },
      "allowed source conclusions"
    );
  });

  it("rejects a template capture without allowed values", () => {
    rejection(
      workflowRunEvent(publicDemoRun()),
      {
        ...publicDemoSafetyConfig,
        displayTitleTemplates: [{ template: "Public demo {action} run {run_id}" }]
      },
      "capture"
    );
  });

  it("rejects a template output that shadows a reserved output name", () => {
    rejection(
      workflowRunEvent(releaseRun()),
      {
        ...releaseContainmentConfig,
        displayTitleTemplates: [{
          template: "Kin Resolve beta release run {run_id} attempt {run_attempt}",
          outputs: { run_id: "1" }
        }]
      },
      "output"
    );
  });

  it("rejects a non-numeric expected workflow id", () => {
    rejection(
      workflowRunEvent(backupRun()),
      { ...backupCleanupConfig, expectedSourceWorkflowId: "0" },
      "workflow ID"
    );
  });

  it("rejects a config with unexpected fields", () => {
    rejection(
      workflowRunEvent(releaseRun()),
      {
        ...releaseContainmentConfig,
        allowUnsafe: true
      } as unknown as WorkflowRunSourceAuthorizationConfig,
      "unexpected or missing fields"
    );
  });

  it.each([
    ["productionBackupCleanup", backupRun()],
    ["recoveryCleanup", recoveryRun()]
  ] as const)(
    "rejects the %s profile when the mandatory expected workflow id is omitted",
    (profile, run) => {
      rejection(
        workflowRunEvent(run),
        {
          ...workflowRunSourceAuthorizationProfiles[profile],
          currentRepository: repository
        },
        "requires an expected source workflow ID"
      );
    }
  );

  it("rejects a non-boolean requiresExpectedSourceWorkflowId flag", () => {
    rejection(
      workflowRunEvent(backupRun()),
      {
        ...backupCleanupConfig,
        requiresExpectedSourceWorkflowId: "true"
      } as unknown as WorkflowRunSourceAuthorizationConfig,
      "requiresExpectedSourceWorkflowId"
    );
  });

  it("rejects a template output that shadows the authorized verdict output", () => {
    rejection(
      workflowRunEvent(releaseRun()),
      {
        ...releaseContainmentConfig,
        displayTitleTemplates: [{
          template: "Kin Resolve beta release run {run_id} attempt {run_attempt}",
          outputs: { authorized: "true" }
        }]
      },
      "output"
    );
  });

  it("rejects a template capture that shadows the authorized verdict output", () => {
    rejection(
      workflowRunEvent(releaseRun()),
      {
        ...releaseContainmentConfig,
        displayTitleTemplates: [{
          template: "Kin Resolve beta release {authorized} run {run_id} attempt {run_attempt}",
          captures: { authorized: ["true"] }
        }]
      },
      "reserved output name"
    );
  });
});

describe("authorize-workflow-run-source CLI", () => {
  const scratch: string[] = [];

  afterEach(async () => {
    await Promise.all(scratch.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true
    })));
  });

  async function scratchDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-workflow-run-auth-"));
    scratch.push(directory);
    return directory;
  }

  function runCli(
    eventPath: string,
    outputPath: string,
    environment: Record<string, string>
  ): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/authorize-workflow-run-source.mjs"
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        // Optional checks are absent by default: only a variable that is
        // entirely missing from the environment means "check not configured".
        // An empty string (how GitHub Actions renders a missing repository
        // variable) must hard-fail, which dedicated tests below assert.
        EXPECTED_SOURCE_WORKFLOW_NAME: undefined,
        EXPECTED_SOURCE_WORKFLOW_ID: undefined,
        DISPLAY_TITLE_TEMPLATES: undefined,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REPOSITORY: repository,
        ALLOWED_SOURCE_EVENTS: "workflow_dispatch",
        ALLOWED_SOURCE_CONCLUSIONS: "failure,cancelled,timed_out",
        REQUIRED_HEAD_BRANCH: "main",
        ...environment
      }
    });
  }

  it("emits sorted key=value pairs to GITHUB_OUTPUT for an authorized public demo event", async () => {
    const directory = await scratchDirectory();
    const eventPath = path.join(directory, "event.json");
    const outputPath = path.join(directory, "output");
    await Promise.all([
      writeFile(eventPath, JSON.stringify(workflowRunEvent(publicDemoRun("contain"))), "utf8"),
      writeFile(outputPath, "", "utf8")
    ]);

    const result = runCli(eventPath, outputPath, {
      EXPECTED_SOURCE_WORKFLOW_NAME: "Release Kin Resolve public demo",
      EXPECTED_SOURCE_WORKFLOW_PATH: ".github/workflows/public-demo-release.yml",
      DISPLAY_TITLE_TEMPLATES: JSON.stringify(
        workflowRunSourceAuthorizationProfiles.publicDemoSafety.displayTitleTemplates
      )
    });

    const expected = [
      "authorized=true",
      "action=contain",
      `head_sha=${sha}`,
      "run_attempt=2",
      "run_id=29470000001",
      ""
    ].join("\n");
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(expected);
    expect(await readFile(outputPath, "utf8")).toBe(expected);
  });

  it("authorizes a cleanup-family event from the numeric workflow id without templates", async () => {
    const directory = await scratchDirectory();
    const eventPath = path.join(directory, "event.json");
    const outputPath = path.join(directory, "output");
    await Promise.all([
      writeFile(eventPath, JSON.stringify(workflowRunEvent(recoveryRun())), "utf8"),
      writeFile(outputPath, "", "utf8")
    ]);

    const result = runCli(eventPath, outputPath, {
      EXPECTED_SOURCE_WORKFLOW_PATH: ".github/workflows/recovery-evidence.yml",
      EXPECTED_SOURCE_WORKFLOW_ID: "190000002"
    });

    const expected = [
      "authorized=true",
      `head_sha=${sha}`,
      "run_attempt=2",
      "run_id=29470000001",
      ""
    ].join("\n");
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(await readFile(outputPath, "utf8")).toBe(expected);
  });

  it("exits nonzero and writes nothing to GITHUB_OUTPUT for an unauthorized event", async () => {
    const directory = await scratchDirectory();
    const eventPath = path.join(directory, "event.json");
    const outputPath = path.join(directory, "output");
    await Promise.all([
      writeFile(
        eventPath,
        JSON.stringify(workflowRunEvent(recoveryRun({ conclusion: "success" }))),
        "utf8"
      ),
      writeFile(outputPath, "", "utf8")
    ]);

    const result = runCli(eventPath, outputPath, {
      EXPECTED_SOURCE_WORKFLOW_PATH: ".github/workflows/recovery-evidence.yml",
      EXPECTED_SOURCE_WORKFLOW_ID: "190000002"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Workflow run source authorization failed");
    expect(result.stderr).toContain("conclusion");
    expect(result.stdout).toBe("");
    expect(await readFile(outputPath, "utf8")).toBe("");
  });

  it.each([
    "EXPECTED_SOURCE_WORKFLOW_NAME",
    "EXPECTED_SOURCE_WORKFLOW_ID",
    "DISPLAY_TITLE_TEMPLATES"
  ])(
    "exits nonzero when %s is present but empty instead of skipping the check",
    async (name) => {
      const directory = await scratchDirectory();
      const eventPath = path.join(directory, "event.json");
      const outputPath = path.join(directory, "output");
      await Promise.all([
        writeFile(eventPath, JSON.stringify(workflowRunEvent(recoveryRun())), "utf8"),
        writeFile(outputPath, "", "utf8")
      ]);

      const result = runCli(eventPath, outputPath, {
        EXPECTED_SOURCE_WORKFLOW_PATH: ".github/workflows/recovery-evidence.yml",
        EXPECTED_SOURCE_WORKFLOW_ID: "190000002",
        [name]: ""
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Workflow run source authorization failed");
      expect(result.stderr).toContain(`${name} is set but empty`);
      expect(result.stdout).toBe("");
      expect(await readFile(outputPath, "utf8")).toBe("");
    }
  );

  it("exits nonzero when an optional variable is present but whitespace-only", async () => {
    const directory = await scratchDirectory();
    const eventPath = path.join(directory, "event.json");
    const outputPath = path.join(directory, "output");
    await Promise.all([
      writeFile(eventPath, JSON.stringify(workflowRunEvent(recoveryRun())), "utf8"),
      writeFile(outputPath, "", "utf8")
    ]);

    const result = runCli(eventPath, outputPath, {
      EXPECTED_SOURCE_WORKFLOW_PATH: ".github/workflows/recovery-evidence.yml",
      EXPECTED_SOURCE_WORKFLOW_ID: "  "
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EXPECTED_SOURCE_WORKFLOW_ID is set but empty");
    expect(result.stdout).toBe("");
    expect(await readFile(outputPath, "utf8")).toBe("");
  });

  it("exits nonzero when REQUIRE_EXPECTED_SOURCE_WORKFLOW_ID is true without a workflow id pin", async () => {
    const directory = await scratchDirectory();
    const eventPath = path.join(directory, "event.json");
    const outputPath = path.join(directory, "output");
    await Promise.all([
      writeFile(eventPath, JSON.stringify(workflowRunEvent(recoveryRun())), "utf8"),
      writeFile(outputPath, "", "utf8")
    ]);

    const result = runCli(eventPath, outputPath, {
      EXPECTED_SOURCE_WORKFLOW_PATH: ".github/workflows/recovery-evidence.yml",
      REQUIRE_EXPECTED_SOURCE_WORKFLOW_ID: "true"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "requires an expected source workflow ID but none was provided"
    );
    expect(result.stdout).toBe("");
    expect(await readFile(outputPath, "utf8")).toBe("");
  });

  it("exits nonzero when REQUIRE_EXPECTED_SOURCE_WORKFLOW_ID is not exactly true or false", async () => {
    const directory = await scratchDirectory();
    const eventPath = path.join(directory, "event.json");
    const outputPath = path.join(directory, "output");
    await Promise.all([
      writeFile(eventPath, JSON.stringify(workflowRunEvent(recoveryRun())), "utf8"),
      writeFile(outputPath, "", "utf8")
    ]);

    const result = runCli(eventPath, outputPath, {
      EXPECTED_SOURCE_WORKFLOW_PATH: ".github/workflows/recovery-evidence.yml",
      EXPECTED_SOURCE_WORKFLOW_ID: "190000002",
      REQUIRE_EXPECTED_SOURCE_WORKFLOW_ID: "yes"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "REQUIRE_EXPECTED_SOURCE_WORKFLOW_ID must be exactly true or false when set."
    );
    expect(result.stdout).toBe("");
    expect(await readFile(outputPath, "utf8")).toBe("");
  });

  it("authorizes with the workflow id pin when REQUIRE_EXPECTED_SOURCE_WORKFLOW_ID is true", async () => {
    const directory = await scratchDirectory();
    const eventPath = path.join(directory, "event.json");
    const outputPath = path.join(directory, "output");
    await Promise.all([
      writeFile(eventPath, JSON.stringify(workflowRunEvent(recoveryRun())), "utf8"),
      writeFile(outputPath, "", "utf8")
    ]);

    const result = runCli(eventPath, outputPath, {
      EXPECTED_SOURCE_WORKFLOW_PATH: ".github/workflows/recovery-evidence.yml",
      EXPECTED_SOURCE_WORKFLOW_ID: "190000002",
      REQUIRE_EXPECTED_SOURCE_WORKFLOW_ID: "true"
    });

    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toContain("authorized=true");
  });

  it("exits nonzero on the missing-repository-variable probe with a forged workflow id", async () => {
    const directory = await scratchDirectory();
    const eventPath = path.join(directory, "event.json");
    const outputPath = path.join(directory, "output");
    await Promise.all([
      writeFile(
        eventPath,
        JSON.stringify(workflowRunEvent(recoveryRun({ workflow_id: 999999999 }))),
        "utf8"
      ),
      writeFile(outputPath, "", "utf8")
    ]);

    const result = runCli(eventPath, outputPath, {
      EXPECTED_SOURCE_WORKFLOW_PATH: ".github/workflows/recovery-evidence.yml",
      EXPECTED_SOURCE_WORKFLOW_ID: ""
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EXPECTED_SOURCE_WORKFLOW_ID is set but empty");
    expect(result.stdout).toBe("");
    expect(await readFile(outputPath, "utf8")).toBe("");
  });
});
