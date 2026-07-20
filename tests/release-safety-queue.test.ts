import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assessReleaseSafetyQueue, type WorkflowRunList } from "../lib/release-safety-queue";

function run(overrides: Record<string, unknown> = {}) {
  const value = {
    id: 100,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
    head_branch: "main",
    display_title: "source",
    ...overrides
  };
  if (!("display_title" in overrides)) {
    value.display_title = value.event === "workflow_dispatch"
      ? `Kin Resolve beta release run ${value.id} attempt ${value.run_attempt}`
      : "source";
  }
  return value;
}

function list(...runs: unknown[]): WorkflowRunList {
  return { total_count: runs.length, workflow_runs: runs };
}

function boundSourceRun(
  source: "release" | "recovery" | "holding" | "public-demo",
  id: number,
  attempt: number,
  overrides: Record<string, unknown> = {}
) {
  const contract = {
    release: {
      name: "Release Kin Resolve beta candidate",
      path: ".github/workflows/vercel-release.yml",
      title: `Kin Resolve beta release run ${id} attempt ${attempt}`
    },
    recovery: {
      name: "Production recovery evidence",
      path: ".github/workflows/recovery-evidence.yml",
      title: `Kin Resolve recovery run ${id} attempt ${attempt}`
    },
    holding: {
      name: "Deploy Kin Resolve static holding page",
      path: ".github/workflows/vercel-holding.yml",
      title: `Kin Resolve static holding production run ${id} attempt ${attempt}`
    },
    "public-demo": {
      name: "Release Kin Resolve public demo",
      path: ".github/workflows/public-demo-release.yml",
      title: `Public demo release ${"a".repeat(40)} run ${id} attempt ${attempt}`
    }
  }[source];
  return run({
    id,
    run_attempt: attempt,
    name: contract.name,
    path: contract.path,
    head_sha: "a".repeat(40),
    repository: { full_name: "kinresolve/kinresolve" },
    head_repository: { full_name: "kinresolve/kinresolve" },
    display_title: contract.title,
    ...overrides
  });
}

function currentSourceBinding(
  source: "release" | "recovery" | "holding",
  id: number,
  attempt: number
) {
  return {
    source,
    expectedRepository: "kinresolve/kinresolve",
    expectedRunId: String(id),
    expectedRunAttempt: String(attempt),
    run: boundSourceRun(source, id, attempt, {
      status: "in_progress",
      conclusion: null
    })
  } as const;
}

type FuturePublicDemoSafetyInput = Parameters<typeof assessReleaseSafetyQueue>[0] & {
  publicDemoRuns: WorkflowRunList;
  publicDemoSafetyRuns: WorkflowRunList;
};

function input(overrides: Partial<FuturePublicDemoSafetyInput> = {}): FuturePublicDemoSafetyInput {
  return {
    releaseRuns: list(),
    recoveryRuns: list(),
    holdingRuns: list(),
    publicDemoRuns: list(),
    containmentRuns: list(),
    cleanupRuns: list(),
    holdingSafetyRuns: list(),
    publicDemoSafetyRuns: list(),
    ...overrides
  };
}

describe("release safety queue", () => {
  it("accepts an empty or fully successful history", () => {
    expect(assessReleaseSafetyQueue(input()).safe).toBe(true);
    expect(assessReleaseSafetyQueue(input({ releaseRuns: list(run()) })).safe).toBe(true);
  });

  it("ignores legacy runs that predate the marked beta workflow contract", () => {
    const legacy = run({
      id: 90,
      conclusion: "failure",
      event: "release",
      head_branch: "v0.17.2",
      display_title: "KinSleuth v0.17.2"
    });
    expect(assessReleaseSafetyQueue(input({ releaseRuns: list(legacy) }))).toEqual({
      safe: true,
      issues: []
    });
  });

  it("requires an exact successful containment receipt for every failed release attempt", () => {
    const failed = run({ id: 501, run_attempt: 2, conclusion: "failure" });
    const unresolved = assessReleaseSafetyQueue(input({ releaseRuns: list(failed) }));
    expect(unresolved.safe).toBe(false);
    expect(unresolved.issues).toContainEqual({
      kind: "unresolved-source-run",
      source: "release",
      runId: "501",
      runAttempt: "2"
    });

    const resolved = assessReleaseSafetyQueue(input({
      releaseRuns: list(failed),
      containmentRuns: list(run({
        id: 700,
        event: "workflow_run",
        display_title: "Contain release run 501 attempt 2"
      }))
    }));
    expect(resolved).toEqual({ safe: true, issues: [] });
  });

  it("does not let a later gate-only failure hide an older unresolved failure", () => {
    const releaseRuns = list(
      run({ id: 502, conclusion: "failure" }),
      run({ id: 501, conclusion: "failure" })
    );
    const containmentRuns = list(run({
      id: 702,
      event: "workflow_run",
      display_title: "Contain release run 502 attempt 1"
    }));
    const assessment = assessReleaseSafetyQueue(input({ releaseRuns, containmentRuns }));
    expect(assessment.safe).toBe(false);
    expect(assessment.issues).toContainEqual(expect.objectContaining({ runId: "501" }));
  });

  it("requires the exact cleanup receipt for failed recovery and checks rerun attempts", () => {
    const prior = boundSourceRun("recovery", 801, 1, {
      conclusion: "cancelled",
      display_title: "Kin Resolve recovery run 801 attempt 2"
    });
    const wrongAttempt = run({
      id: 900,
      event: "workflow_run",
      display_title: "Clean recovery run 801 attempt 2"
    });
    expect(assessReleaseSafetyQueue(input({
      cleanupRuns: list(wrongAttempt),
      currentSourceRun: currentSourceBinding("recovery", 801, 2),
      priorCurrentRunAttempts: [{ source: "recovery", run: prior }]
    })).safe).toBe(false);

    const exact = { ...wrongAttempt, display_title: "Clean recovery run 801 attempt 1" };
    expect(assessReleaseSafetyQueue(input({
      cleanupRuns: list(exact),
      currentSourceRun: currentSourceBinding("recovery", 801, 2),
      priorCurrentRunAttempts: [{ source: "recovery", run: prior }]
    })).safe).toBe(true);
  });

  it("requires an exact successful repair receipt for every marked failed holding attempt", () => {
    const failedStaging = run({
      id: 811,
      conclusion: "failure",
      display_title: "Kin Resolve static holding beta-staging run 811 attempt 1"
    });
    const failedProduction = run({
      id: 812,
      run_attempt: 2,
      conclusion: "timed_out",
      display_title: "Kin Resolve static holding production run 812 attempt 2"
    });
    const stagingReceipt = run({
      id: 910,
      event: "workflow_run",
      display_title: "Repair holding run 811 attempt 1"
    });
    const oneUnresolved = assessReleaseSafetyQueue(input({
      holdingRuns: list(failedStaging, failedProduction),
      holdingSafetyRuns: list(stagingReceipt)
    }));
    expect(oneUnresolved.safe).toBe(false);
    expect(oneUnresolved.issues).toContainEqual({
      kind: "unresolved-source-run",
      source: "holding",
      runId: "812",
      runAttempt: "2"
    });

    const productionReceipt = run({
      id: 911,
      event: "workflow_run",
      display_title: "Repair holding run 812 attempt 2"
    });
    expect(assessReleaseSafetyQueue(input({
      holdingRuns: list(failedStaging, failedProduction),
      holdingSafetyRuns: list(stagingReceipt, productionReceipt)
    }))).toEqual({ safe: true, issues: [] });
  });

  it("requires the exact holding-safety receipt for a failed public-demo holding attempt", () => {
    const failed = run({
      id: 813,
      conclusion: "failure",
      display_title: "Kin Resolve static holding public-demo run 813 attempt 1"
    });
    expect(assessReleaseSafetyQueue(input({ holdingRuns: list(failed) }))).toMatchObject({
      safe: false,
      issues: [expect.objectContaining({ source: "holding", runId: "813", runAttempt: "1" })]
    });
    const receipt = run({
      id: 913,
      event: "workflow_run",
      display_title: "Repair holding run 813 attempt 1"
    });
    expect(assessReleaseSafetyQueue(input({
      holdingRuns: list(failed),
      holdingSafetyRuns: list(receipt)
    }))).toEqual({ safe: true, issues: [] });
  });

  it("includes earlier attempts when the current workflow is a holding deployment", () => {
    const priorHoldingAttempt = boundSourceRun("holding", 820, 1, {
      conclusion: "cancelled",
      display_title: "Kin Resolve static holding production run 820 attempt 2"
    });
    const exactReceipt = run({
      id: 920,
      event: "workflow_run",
      display_title: "Repair holding run 820 attempt 1"
    });
    expect(assessReleaseSafetyQueue(input({
      holdingSafetyRuns: list(exactReceipt),
      currentSourceRun: currentSourceBinding("holding", 820, 2),
      priorCurrentRunAttempts: [{ source: "holding", run: priorHoldingAttempt }]
    }))).toEqual({ safe: true, issues: [] });
  });

  it("binds historical attempts to current provenance instead of their drifted display title", () => {
    const historical = boundSourceRun("release", 830, 1, {
      conclusion: "failure",
      display_title: "Kin Resolve beta release run 830 attempt 2"
    });
    const receipt = run({
      id: 930,
      event: "workflow_run",
      display_title: "Contain release run 830 attempt 1"
    });
    expect(assessReleaseSafetyQueue(input({
      containmentRuns: list(receipt),
      currentSourceRun: currentSourceBinding("release", 830, 2),
      priorCurrentRunAttempts: [{ source: "release", run: historical }]
    }))).toEqual({ safe: true, issues: [] });

    const mismatched = {
      ...historical,
      head_sha: "b".repeat(40)
    };
    expect(() => assessReleaseSafetyQueue(input({
      containmentRuns: list(receipt),
      currentSourceRun: currentSourceBinding("release", 830, 2),
      priorCurrentRunAttempts: [{ source: "release", run: mismatched }]
    }))).toThrow(/not bound/i);
  });

  it("accepts GitHub's custom run-name as the current workflow name", () => {
    const current = currentSourceBinding("holding", 840, 1);
    const currentApiRun = {
      ...current.run,
      name: current.run.display_title
    };

    expect(assessReleaseSafetyQueue(input({
      currentSourceRun: {
        ...current,
        run: currentApiRun
      }
    }))).toEqual({ safe: true, issues: [] });
  });

  it("authenticates the public demo release as its own exact workflow source", () => {
    const id = 850;
    const attempt = 1;
    const binding = {
      source: "public-demo",
      expectedRepository: "kinresolve/kinresolve",
      expectedRunId: String(id),
      expectedRunAttempt: String(attempt),
      run: run({
        id,
        run_attempt: attempt,
        status: "in_progress",
        conclusion: null,
        name: "Release Kin Resolve public demo",
        path: ".github/workflows/public-demo-release.yml",
        head_sha: "a".repeat(40),
        repository: { full_name: "kinresolve/kinresolve" },
        head_repository: { full_name: "kinresolve/kinresolve" },
        display_title: `Public demo release ${"a".repeat(40)} run ${id} attempt ${attempt}`
      })
    };

    expect(assessReleaseSafetyQueue(input({
      currentSourceRun: binding as unknown as NonNullable<
        Parameters<typeof assessReleaseSafetyQueue>[0]["currentSourceRun"]
      >
    }))).toEqual({ safe: true, issues: [] });
  });

  it.each(["failure", "cancelled", "timed_out"] as const)(
    "requires an exact successful public-demo containment receipt after a %s",
    (conclusion) => {
      const runId = conclusion === "failure" ? 851 : conclusion === "cancelled" ? 852 : 853;
      const failed = boundSourceRun("public-demo", runId, 2, { conclusion });

      expect(assessReleaseSafetyQueue(input({
        publicDemoRuns: list(failed)
      }))).toMatchObject({
        safe: false,
        issues: [{
          kind: "unresolved-source-run",
          source: "public-demo",
          runId: String(runId),
          runAttempt: "2"
        }]
      });

      const wrongAttempt = run({
        id: 950 + runId,
        event: "workflow_run",
        display_title: `Contain public demo run ${runId} attempt 1`
      });
      expect(assessReleaseSafetyQueue(input({
        publicDemoRuns: list(failed),
        publicDemoSafetyRuns: list(wrongAttempt)
      })).safe).toBe(false);

      const exactReceipt = run({
        id: 960 + runId,
        event: "workflow_run",
        display_title: `Contain public demo run ${runId} attempt 2`
      });
      expect(assessReleaseSafetyQueue(input({
        publicDemoRuns: list(failed),
        publicDemoSafetyRuns: list(exactReceipt)
      }))).toEqual({ safe: true, issues: [] });
    }
  );

  it("blocks pending and failed public-demo safety automation", () => {
    const pending = run({
      id: 854,
      status: "in_progress",
      conclusion: null,
      event: "workflow_run",
      display_title: "Contain public demo run 851 attempt 1"
    });
    expect(assessReleaseSafetyQueue(input({
      publicDemoSafetyRuns: list(pending)
    }))).toMatchObject({
      safe: false,
      issues: [{ kind: "pending-safety-run", source: "safety", runId: "854" }]
    });

    const failed = run({
      id: 855,
      conclusion: "failure",
      event: "workflow_run",
      display_title: "Contain public demo run 852 attempt 1"
    });
    expect(assessReleaseSafetyQueue(input({
      publicDemoSafetyRuns: list(failed)
    }))).toMatchObject({
      safe: false,
      issues: [{ kind: "failed-safety-run", source: "safety", runId: "855" }]
    });
  });

  it("declares a distinct public-demo source in the release workflow and safety CLI", async () => {
    const [workflow, script] = await Promise.all([
      readFile(path.join(process.cwd(), ".github", "workflows", "public-demo-release.yml"), "utf8"),
      readFile(path.join(process.cwd(), "scripts", "validate-release-safety-queue.mjs"), "utf8")
    ]);

    expect(workflow).toContain("RELEASE_SAFETY_CURRENT_WORKFLOW: public-demo");
    expect(script).toContain('publicDemo: "public-demo-release.yml"');
    expect(script).toContain('publicDemoSafety: "public-demo-safety.yml"');
    expect(script).toContain('workflowFiles.publicDemo, "workflow_dispatch"');
    expect(script).toContain('workflowFiles.publicDemoSafety, "workflow_run"');
    expect(script).toContain('"public-demo"');
  });

  it("blocks pending and hard-failed safety automation", () => {
    const pending = run({ id: 901, status: "in_progress", conclusion: null, event: "workflow_run" });
    expect(assessReleaseSafetyQueue(input({ containmentRuns: list(pending) })).safe).toBe(false);
    const failed = run({ id: 902, conclusion: "failure", event: "workflow_run" });
    expect(assessReleaseSafetyQueue(input({ cleanupRuns: list(failed) })).safe).toBe(false);
    const holdingPending = run({
      id: 904,
      status: "queued",
      conclusion: null,
      event: "workflow_run"
    });
    expect(assessReleaseSafetyQueue(input({
      holdingSafetyRuns: list(holdingPending)
    })).safe).toBe(false);
    const holdingFailed = run({ id: 905, conclusion: "timed_out", event: "workflow_run" });
    expect(assessReleaseSafetyQueue(input({
      holdingSafetyRuns: list(holdingFailed)
    })).safe).toBe(false);
    const skipped = run({ id: 903, conclusion: "skipped", event: "workflow_run" });
    expect(assessReleaseSafetyQueue(input({ cleanupRuns: list(skipped) })).safe).toBe(true);
  });

  it("fails closed for truncated or malformed API state", () => {
    expect(() => assessReleaseSafetyQueue(input({
      releaseRuns: { total_count: 2, workflow_runs: [run()] }
    }))).toThrow(/incomplete or malformed/i);
    expect(() => assessReleaseSafetyQueue(input({
      releaseRuns: list(run({ id: "not-a-run" }))
    }))).toThrow(/ID is malformed/i);
  });

  it("queries each source and safety workflow by event within the B2 contract epoch", async () => {
    const script = await readFile(
      path.join(process.cwd(), "scripts", "validate-release-safety-queue.mjs"),
      "utf8"
    );
    expect(script).toContain('holding: "vercel-holding.yml"');
    expect(script).toContain('holdingSafety: "holding-safety.yml"');
    expect(script).toContain('workflowFiles.holding, "workflow_dispatch"');
    expect(script).toContain('workflowFiles.holdingSafety, "workflow_run"');
    expect(script).toContain('workflowFiles.publicDemo, "workflow_dispatch"');
    expect(script).toContain('workflowFiles.publicDemoSafety, "workflow_run"');
    expect(script).toContain('const safetyContractEpoch = "2026-07-14T00:00:00Z"');
    expect(script).toContain('created: `>=${safetyContractEpoch}`');
    expect(script).toContain("if (currentRunAttempt > 1)");
    expect(script).toContain("source: currentSource");
    expect(script).toContain("current source workflow run");
    expect(script).toContain("currentSourceRunDocument");
  });
});
