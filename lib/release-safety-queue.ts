type JsonObject = Record<string, unknown>;

export type ReleaseSafetySource = "release" | "recovery" | "holding" | "demo" | "public-demo";

export type WorkflowRunList = {
  total_count: number;
  workflow_runs: unknown[];
};

export type ReleaseSafetyQueueInput = {
  releaseRuns: WorkflowRunList;
  recoveryRuns: WorkflowRunList;
  holdingRuns: WorkflowRunList;
  demoRuns: WorkflowRunList;
  containmentRuns: WorkflowRunList;
  cleanupRuns: WorkflowRunList;
  holdingSafetyRuns: WorkflowRunList;
  demoSafetyRuns: WorkflowRunList;
  currentSourceRun?: {
    source: ReleaseSafetySource;
    expectedRepository: string;
    expectedRunId: string;
    expectedRunAttempt: string;
    run: unknown;
  };
  priorCurrentRunAttempts?: readonly {
    source: ReleaseSafetySource;
    run: unknown;
  }[];
};

export type ReleaseSafetyIssue = {
  kind: "pending-safety-run" | "failed-safety-run" | "unresolved-source-run";
  source: ReleaseSafetySource | "safety";
  runId: string;
  runAttempt: string;
};

export type ReleaseSafetyQueueAssessment = {
  safe: boolean;
  issues: readonly ReleaseSafetyIssue[];
};

type NormalizedRun = {
  id: string;
  attempt: string;
  status: string;
  conclusion: string | null;
  event: string;
  headBranch: string | null;
  displayTitle: string;
};

type BoundSourceRun = NormalizedRun & {
  workflowName: string;
  workflowPath: string;
  headSha: string;
  repository: string;
  headRepository: string;
};

const sourceWorkflowContract: Record<ReleaseSafetySource, { name: string; path: string }> = {
  release: {
    name: "Release Kin Resolve beta candidate",
    path: ".github/workflows/vercel-release.yml"
  },
  recovery: {
    name: "Production recovery evidence",
    path: ".github/workflows/recovery-evidence.yml"
  },
  holding: {
    name: "Deploy Kin Resolve static holding page",
    path: ".github/workflows/vercel-holding.yml"
  },
  demo: {
    name: "Operate Kin Resolve synthetic staging demo session",
    path: ".github/workflows/staging-demo-session.yml"
  },
  "public-demo": {
    name: "Release Kin Resolve public demo",
    path: ".github/workflows/public-demo-release.yml"
  }
};

const unsafeSourceConclusions = new Set(["failure", "cancelled", "timed_out"]);
const failedSafetyConclusions = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale"
]);

export function assessReleaseSafetyQueue(input: ReleaseSafetyQueueInput): ReleaseSafetyQueueAssessment {
  const releaseRuns = normalizeList(input.releaseRuns, "release");
  const recoveryRuns = normalizeList(input.recoveryRuns, "recovery");
  const holdingRuns = normalizeList(input.holdingRuns, "holding");
  const demoRuns = normalizeList(input.demoRuns, "demo session");
  const containmentRuns = normalizeList(input.containmentRuns, "containment");
  const cleanupRuns = normalizeList(input.cleanupRuns, "cleanup");
  const holdingSafetyRuns = normalizeList(input.holdingSafetyRuns, "holding safety");
  const demoSafetyRuns = normalizeList(input.demoSafetyRuns, "demo safety");
  const priorAttempts = (input.priorCurrentRunAttempts ?? []).map(({ source, run }) => ({
    source,
    run: normalizeBoundRun(run, `${source} prior attempt`)
  }));
  authenticatePriorAttempts(input.currentSourceRun, priorAttempts);

  const issues: ReleaseSafetyIssue[] = [];
  for (const safetyRun of [
    ...containmentRuns,
    ...cleanupRuns,
    ...holdingSafetyRuns,
    ...demoSafetyRuns
  ]) {
    if (safetyRun.status !== "completed") {
      issues.push({
        kind: "pending-safety-run",
        source: "safety",
        runId: safetyRun.id,
        runAttempt: safetyRun.attempt
      });
    } else if (safetyRun.conclusion && failedSafetyConclusions.has(safetyRun.conclusion)) {
      issues.push({
        kind: "failed-safety-run",
        source: "safety",
        runId: safetyRun.id,
        runAttempt: safetyRun.attempt
      });
    }
  }

  const sources: {
    source: ReleaseSafetySource;
    run: NormalizedRun;
    markerAuthenticated: boolean;
  }[] = [
    ...releaseRuns.map((run) => ({ source: "release" as const, run, markerAuthenticated: false })),
    ...recoveryRuns.map((run) => ({ source: "recovery" as const, run, markerAuthenticated: false })),
    ...holdingRuns.map((run) => ({ source: "holding" as const, run, markerAuthenticated: false })),
    ...demoRuns.map((run) => ({ source: "demo" as const, run, markerAuthenticated: false })),
    ...priorAttempts.map(({ source, run }) => ({ source, run, markerAuthenticated: true }))
  ];
  const seen = new Set<string>();
  for (const { source, run, markerAuthenticated } of sources) {
    const key = `${source}:${run.id}:${run.attempt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!markerAuthenticated && !isMarkedSourceRun(source, run)) continue;
    if (run.status !== "completed" || !run.conclusion || !unsafeSourceConclusions.has(run.conclusion)) {
      continue;
    }
    if (run.event !== "workflow_dispatch" || run.headBranch !== "main") {
      throw new Error(`A failed ${source} run has unexpected provenance.`);
    }
    const expectedTitle = safetyReceiptTitle(source, run);
    const safetyRuns = safetyRunsForSource(source, {
      containmentRuns,
      cleanupRuns,
      holdingSafetyRuns,
      demoSafetyRuns
    });
    const resolved = safetyRuns.some((candidate) =>
      candidate.status === "completed"
      && candidate.conclusion === "success"
      && candidate.event === "workflow_run"
      && candidate.headBranch === "main"
      && candidate.displayTitle === expectedTitle
    );
    if (!resolved) {
      issues.push({
        kind: "unresolved-source-run",
        source,
        runId: run.id,
        runAttempt: run.attempt
      });
    }
  }

  const uniqueIssues = [...new Map(issues.map((issue) => [
    `${issue.kind}:${issue.source}:${issue.runId}:${issue.runAttempt}`,
    issue
  ])).values()];
  return { safe: uniqueIssues.length === 0, issues: uniqueIssues };
}

function authenticatePriorAttempts(
  binding: ReleaseSafetyQueueInput["currentSourceRun"],
  priorAttempts: readonly { source: ReleaseSafetySource; run: BoundSourceRun }[]
): void {
  if (!binding) {
    if (priorAttempts.length > 0) {
      throw new Error("Prior workflow attempts require an authenticated current source run.");
    }
    return;
  }
  const current = normalizeBoundRun(binding.run, `${binding.source} current source`);
  const expectedRepository = repositoryName(binding.expectedRepository);
  const expectedRunId = integerString(binding.expectedRunId, "The expected current run ID", 20);
  const expectedRunAttempt = integerString(
    binding.expectedRunAttempt,
    "The expected current run attempt",
    10
  );
  const workflow = sourceWorkflowContract[binding.source];
  const workflowNameMatches = current.workflowName === workflow.name
    || current.workflowName === current.displayTitle;
  if (current.id !== expectedRunId || current.attempt !== expectedRunAttempt) {
    throw new Error("The current source run does not match the executing workflow attempt.");
  }
  if (!workflowNameMatches || current.workflowPath !== workflow.path
      || current.event !== "workflow_dispatch" || current.headBranch !== "main"
      || current.repository !== expectedRepository || current.headRepository !== expectedRepository
      || !isMarkedSourceRun(binding.source, current)) {
    throw new Error("The current source run does not match the release safety contract.");
  }

  const currentAttempt = Number(current.attempt);
  if (priorAttempts.length !== currentAttempt - 1) {
    throw new Error("The prior workflow attempt history is incomplete.");
  }
  const seenAttempts = new Set<string>();
  for (const prior of priorAttempts) {
    if (prior.source !== binding.source
        || prior.run.id !== current.id
        || prior.run.workflowName !== current.workflowName
        || prior.run.workflowPath !== current.workflowPath
        || prior.run.event !== current.event
        || prior.run.headBranch !== current.headBranch
        || prior.run.headSha !== current.headSha
        || prior.run.repository !== current.repository
        || prior.run.headRepository !== current.headRepository) {
      throw new Error("A prior workflow attempt is not bound to the authenticated current source run.");
    }
    const attempt = Number(prior.run.attempt);
    if (attempt >= currentAttempt || seenAttempts.has(prior.run.attempt)) {
      throw new Error("The prior workflow attempt history is malformed.");
    }
    seenAttempts.add(prior.run.attempt);
  }
  for (let attempt = 1; attempt < currentAttempt; attempt += 1) {
    if (!seenAttempts.has(String(attempt))) {
      throw new Error("The prior workflow attempt history is incomplete.");
    }
  }
}

function safetyRunsForSource(
  source: ReleaseSafetySource,
  runs: {
    containmentRuns: NormalizedRun[];
    cleanupRuns: NormalizedRun[];
    holdingSafetyRuns: NormalizedRun[];
    demoSafetyRuns: NormalizedRun[];
  }
): NormalizedRun[] {
  if (source === "release") return runs.containmentRuns;
  if (source === "recovery") return runs.cleanupRuns;
  if (source === "holding") return runs.holdingSafetyRuns;
  if (source === "demo") return runs.demoSafetyRuns;
  return [];
}

function isMarkedSourceRun(source: ReleaseSafetySource, run: NormalizedRun): boolean {
  if (source === "release") {
    return run.displayTitle === `Kin Resolve beta release run ${run.id} attempt ${run.attempt}`;
  }
  if (source === "recovery") {
    return run.displayTitle === `Kin Resolve recovery run ${run.id} attempt ${run.attempt}`;
  }
  if (source === "holding") {
    return run.displayTitle === `Kin Resolve static holding beta-staging run ${run.id} attempt ${run.attempt}`
      || run.displayTitle === `Kin Resolve static holding production run ${run.id} attempt ${run.attempt}`;
  }
  if (source === "demo") {
    return run.displayTitle === `Kin Resolve staging demo open run ${run.id} attempt ${run.attempt}`
      || run.displayTitle === `Kin Resolve staging demo close run ${run.id} attempt ${run.attempt}`;
  }
  if (!("headSha" in run) || typeof run.headSha !== "string") return false;
  return ["release", "rollback", "contain"].some((action) =>
    run.displayTitle
      === `Public demo ${action} ${run.headSha} run ${run.id} attempt ${run.attempt}`
  );
}

function safetyReceiptTitle(source: ReleaseSafetySource, run: NormalizedRun): string {
  if (source === "release") return `Contain release run ${run.id} attempt ${run.attempt}`;
  if (source === "recovery") return `Clean recovery run ${run.id} attempt ${run.attempt}`;
  if (source === "holding") return `Repair holding run ${run.id} attempt ${run.attempt}`;
  if (source === "demo") return `Close demo session run ${run.id} attempt ${run.attempt}`;
  return `Contain public demo run ${run.id} attempt ${run.attempt}`;
}

function normalizeList(value: WorkflowRunList, label: string): NormalizedRun[] {
  if (!isObject(value)
      || !Number.isSafeInteger(value.total_count)
      || value.total_count < 0
      || !Array.isArray(value.workflow_runs)
      || value.workflow_runs.length !== value.total_count) {
    throw new Error(`The ${label} workflow run list is incomplete or malformed.`);
  }
  return value.workflow_runs.map((run) => normalizeRun(run, label));
}

function normalizeRun(value: unknown, label: string): NormalizedRun {
  if (!isObject(value)) throw new Error(`A ${label} workflow run is malformed.`);
  const id = integerString(value.id, `A ${label} workflow run ID`, 20);
  const attempt = integerString(value.run_attempt, `A ${label} workflow run attempt`, 10);
  const status = requiredString(value.status, `A ${label} workflow run status`);
  const conclusion = value.conclusion === null
    ? null
    : requiredString(value.conclusion, `A ${label} workflow run conclusion`);
  const event = requiredString(value.event, `A ${label} workflow run event`);
  const headBranch = value.head_branch === null
    ? null
    : requiredString(value.head_branch, `A ${label} workflow run head branch`);
  const displayTitle = requiredString(value.display_title, `A ${label} workflow run display title`);
  return { id, attempt, status, conclusion, event, headBranch, displayTitle };
}

function normalizeBoundRun(value: unknown, label: string): BoundSourceRun {
  if (!isObject(value)) throw new Error(`A ${label} workflow run is malformed.`);
  return {
    ...normalizeRun(value, label),
    workflowName: requiredString(value.name, `A ${label} workflow name`),
    workflowPath: requiredString(value.path, `A ${label} workflow path`),
    headSha: sha(value.head_sha, `A ${label} workflow head SHA`),
    repository: nestedRepository(value.repository, `A ${label} workflow repository`),
    headRepository: nestedRepository(value.head_repository, `A ${label} workflow head repository`)
  };
}

function nestedRepository(value: unknown, label: string): string {
  if (!isObject(value)) throw new Error(`${label} is malformed.`);
  return repositoryName(requiredString(value.full_name, `${label} name`));
}

function repositoryName(value: string): string {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value)) {
    throw new Error("A workflow repository name is malformed.");
  }
  return value;
}

function sha(value: unknown, label: string): string {
  const normalized = requiredString(value, label);
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error(`${label} is malformed.`);
  return normalized;
}

function integerString(value: unknown, label: string, maxDigits: number): string {
  const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== "string" || !new RegExp(`^[1-9][0-9]{0,${maxDigits - 1}}$`).test(normalized)) {
    throw new Error(`${label} is malformed.`);
  }
  return normalized;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is malformed.`);
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
