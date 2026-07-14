import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import { buildResearchGuide } from "@/lib/research-guide";
import {
  acceptGuideAssignment,
  addCaseHypothesis,
  addCaseTask,
  createCase,
  readResearchCase,
  readWorkspace,
  recordCaseTaskOutcome,
  updateCaseTask,
  updateCaseHypothesis,
  writeWorkspace
} from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

type StoreOptions = { databaseUrl: string; archiveId: string };
type TaskUpdateOptions = StoreOptions & { allowManualCompletionWithoutOutcome?: boolean };
type UnknownRecord = Record<string, unknown>;

const actor = { actorId: "user-guided-research", actorName: "Guided Researcher" };

let storeOptions: StoreOptions;

beforeAll(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id LIKE 'test-guided-%'", [], { databaseUrl });
});

beforeEach(() => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-guided-${randomUUID()}` };
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = $1", [storeOptions.archiveId], { databaseUrl });
});

afterAll(async () => {
  await closeDatabasePools();
});

const callBuildResearchGuide = buildResearchGuide as unknown as (researchCase: unknown) => unknown;
const callReadResearchCase = readResearchCase as unknown as (caseId: string, options: StoreOptions) => Promise<unknown>;
const callAddCaseHypothesis = addCaseHypothesis as unknown as (
  caseId: string,
  input: UnknownRecord,
  options: StoreOptions
) => Promise<unknown>;
const callAddCaseTask = addCaseTask as unknown as (caseId: string, input: UnknownRecord, options: StoreOptions) => Promise<unknown>;
const callAcceptGuideAssignment = acceptGuideAssignment as unknown as (
  caseId: string,
  guideKey: string,
  options: StoreOptions
) => Promise<unknown>;
const callRecordCaseTaskOutcome = recordCaseTaskOutcome as unknown as (
  caseId: string,
  taskId: string,
  input: UnknownRecord,
  options: StoreOptions
) => Promise<unknown>;
const callUpdateCaseHypothesis = updateCaseHypothesis as unknown as (
  caseId: string,
  hypothesisId: string,
  input: UnknownRecord,
  options: StoreOptions
) => Promise<unknown>;
const callUpdateCaseTask = updateCaseTask as unknown as (
  caseId: string,
  taskId: string,
  input: UnknownRecord,
  options: TaskUpdateOptions
) => Promise<unknown>;

function record(value: unknown, label: string): UnknownRecord {
  expect(value, label).toBeTruthy();
  expect(typeof value, label).toBe("object");
  expect(Array.isArray(value), label).toBe(false);
  return value as UnknownRecord;
}

function records(value: unknown, label: string): UnknownRecord[] {
  expect(Array.isArray(value), label).toBe(true);
  return (value as unknown[]).map((item, index) => record(item, `${label}[${index}]`));
}

function requiredString(value: unknown, label: string): string {
  expect(typeof value, label).toBe("string");
  expect((value as string).length, label).toBeGreaterThan(0);
  return value as string;
}

function resultEntity(result: unknown, key: "task" | "hypothesis"): UnknownRecord {
  const container = record(result, `${key} result`);
  return record(container[key] ?? container, key);
}

function tasks(researchCase: unknown): UnknownRecord[] {
  return records(record(researchCase, "research case").tasks, "tasks");
}

function hypotheses(researchCase: unknown): UnknownRecord[] {
  return records(record(researchCase, "research case").hypotheses, "hypotheses");
}

function findById(items: UnknownRecord[], id: string, label: string): UnknownRecord {
  const item = items.find((candidate) => candidate.id === id);
  expect(item, `${label} ${id}`).toBeDefined();
  return item!;
}

function guideAssignment(plan: unknown): UnknownRecord {
  const value = record(plan, "guide plan");
  const candidate = value.assignment ?? value.currentAssignment ?? value.proposedAssignment ?? value.step;
  return record(candidate, "guide assignment");
}

async function createCaseWithHypothesis(label: string): Promise<{ caseId: string; hypothesis: UnknownRecord }> {
  const researchCase = await createCase(
    {
      id: `case-${label}`,
      title: `${label} research case`,
      question: `What should the ${label} evidence establish?`,
      focus: `${label} branch`
    },
    storeOptions
  );
  const added = await callAddCaseHypothesis(
    researchCase.id,
    {
      statement: `The ${label} records describe the same family.`,
      confidence: 0.45
    },
    storeOptions
  );
  return { caseId: researchCase.id, hypothesis: resultEntity(added, "hypothesis") };
}

async function validGuidedSnapshot() {
  const snapshot = structuredClone(await readWorkspace(storeOptions));
  const researchCase = snapshot.cases[0];
  const taskId = "task-snapshot-integrity";
  const hypothesisId = "hyp-snapshot-integrity";
  const decidedAt = "2026-07-13T17:00:00.000Z";
  const completedAt = "2026-07-13T18:00:00.000Z";

  researchCase.hypotheses = [
    {
      id: hypothesisId,
      statement: "The two households are the same family.",
      confidence: 0.7,
      status: "supported",
      decisions: [
        {
          id: "decision-snapshot-one",
          requestId: "request-decision-snapshot-one",
          fromStatus: "open",
          toStatus: "supported",
          statement: "The two households are the same family.",
          reason: "The addresses and household members agree.",
          contextRefs: [{ type: "task", id: taskId }],
          actorId: actor.actorId,
          actorName: actor.actorName,
          createdAt: decidedAt
        }
      ],
      updatedAt: decidedAt
    }
  ];
  researchCase.tasks = [
    {
      id: taskId,
      title: "Compare the two household records",
      status: "done",
      origin: "manual",
      priority: "normal",
      workFingerprint: "compare the two household records",
      guidance: "Compare names, ages, and addresses.",
      contextRefs: [{ type: "hypothesis", id: hypothesisId }],
      outcomes: [
        {
          id: "outcome-snapshot-one",
          requestId: "request-outcome-snapshot-one",
          type: "found",
          note: "The household members and address match.",
          actorId: actor.actorId,
          actorName: actor.actorName,
          createdAt: completedAt
        }
      ],
      createdAt: "2026-07-13T16:00:00.000Z",
      completedAt,
      updatedAt: completedAt
    }
  ];

  return { snapshot, researchCase, task: researchCase.tasks[0], hypothesis: researchCase.hypotheses[0] };
}

describeIfDatabase("guided research store", () => {
  it("accepts a guide assignment idempotently and persists only server-owned metadata", async () => {
    const { caseId } = await createCaseWithHypothesis("guide-acceptance");
    const before = await callReadResearchCase(caseId, storeOptions);
    const proposed = guideAssignment(callBuildResearchGuide(before));
    const guideKey = requiredString(proposed.guideKey, "proposed guide key");

    // The caller supplies only the opaque key. Title, guidance, targets, origin,
    // and context references must be recomputed from current case state.
    const first = resultEntity(await callAcceptGuideAssignment(caseId, guideKey, storeOptions), "task");
    const retry = resultEntity(await callAcceptGuideAssignment(caseId, guideKey, storeOptions), "task");
    const storedCase = await callReadResearchCase(caseId, storeOptions);
    const storedWithKey = tasks(storedCase).filter((task) => task.guideKey === guideKey);

    expect(retry.id).toBe(first.id);
    expect(storedWithKey).toHaveLength(1);
    expect(storedWithKey[0]).toMatchObject({
      id: first.id,
      origin: "guide",
      guideKey,
      title: proposed.title,
      guidance: proposed.guidance,
      targetHypothesisId: proposed.targetHypothesisId,
      contextRefs: proposed.contextRefs
    });
    expect(requiredString(storedWithKey[0].workFingerprint, "work fingerprint")).toBe(
      requiredString(first.workFingerprint, "accepted work fingerprint")
    );
  });

  it("atomically appends an attributed outcome and optional hypothesis decision, then makes an identical retry a no-op", async () => {
    const { caseId, hypothesis } = await createCaseWithHypothesis("atomic-outcome");
    const addedTask = resultEntity(
      await callAddCaseTask(
        caseId,
        {
          title: "Search the county probate index",
          guidance: "Check the named county index before drawing a conclusion from its absence.",
          priority: "high"
        },
        storeOptions
      ),
      "task"
    );
    const requestId = `request-${randomUUID()}`;
    const input = {
      ...actor,
      requestId,
      expectedTaskUpdatedAt: requiredString(addedTask.updatedAt, "task updatedAt"),
      outcome: "not_found",
      note: "Searched the fictional Lantern Bay probate index volumes 12-18 under Hartwell and spelling variants; no matching entry found.",
      searchScope: {
        repository: "Synthetic Lantern Bay Archive",
        collection: "Probate index",
        dateRange: "1880-1900",
        query: "Hartwell, Hartwel, Heartwell"
      },
      hypothesisDecision: {
        hypothesisId: hypothesis.id,
        expectedUpdatedAt: requiredString(hypothesis.updatedAt, "hypothesis updatedAt"),
        status: "weakened",
        reason: "The scoped probate search did not produce the expected direct link."
      }
    };

    const first = await callRecordCaseTaskOutcome(caseId, requiredString(addedTask.id, "task id"), input, storeOptions);
    const retry = await callRecordCaseTaskOutcome(caseId, requiredString(addedTask.id, "task id"), input, storeOptions);
    const storedCase = await callReadResearchCase(caseId, storeOptions);
    const storedTask = findById(tasks(storedCase), requiredString(addedTask.id, "task id"), "task");
    const storedHypothesis = findById(hypotheses(storedCase), requiredString(hypothesis.id, "hypothesis id"), "hypothesis");
    const outcomes = records(storedTask.outcomes, "task outcomes");
    const decisions = records(storedHypothesis.decisions, "hypothesis decisions");

    expect(retry).toEqual(first);
    expect(storedTask.status).toBe("done");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      requestId,
      type: "not_found",
      note: input.note,
      searchScope: input.searchScope,
      actorId: actor.actorId,
      actorName: actor.actorName
    });
    expect(storedHypothesis.status).toBe("weakened");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      requestId,
      fromStatus: "open",
      toStatus: "weakened",
      statement: hypothesis.statement,
      reason: input.hypothesisDecision.reason,
      actorId: actor.actorId,
      actorName: actor.actorName
    });
    expect(requiredString(storedTask.completedAt, "completedAt")).toBeDefined();

    await expect(
      callRecordCaseTaskOutcome(
        caseId,
        requiredString(addedTask.id, "task id"),
        { ...input, note: "Different payload under the same request identifier." },
        storeOptions
      )
    ).rejects.toThrow(/request|idempot|conflict/i);
    expect(records(findById(tasks(await callReadResearchCase(caseId, storeOptions)), requiredString(addedTask.id, "task id"), "task").outcomes, "outcomes after conflict")).toHaveLength(1);
  });

  it("rejects stale expected versions without overwriting attributed histories", async () => {
    const { caseId, hypothesis } = await createCaseWithHypothesis("stale-writes");
    const originalUpdatedAt = requiredString(hypothesis.updatedAt, "original hypothesis updatedAt");

    await callUpdateCaseHypothesis(
      caseId,
      requiredString(hypothesis.id, "hypothesis id"),
      {
        ...actor,
        requestId: `request-${randomUUID()}`,
        expectedUpdatedAt: originalUpdatedAt,
        status: "supported",
        reason: "Two independent records now agree on the household."
      },
      storeOptions
    );

    await expect(
      callUpdateCaseHypothesis(
        caseId,
        requiredString(hypothesis.id, "hypothesis id"),
        {
          ...actor,
          requestId: `request-${randomUUID()}`,
          expectedUpdatedAt: originalUpdatedAt,
          status: "rejected",
          reason: "This stale tab should not overwrite the newer decision."
        },
        storeOptions
      )
    ).rejects.toThrow(/stale|conflict|updated/i);

    const stored = findById(
      hypotheses(await callReadResearchCase(caseId, storeOptions)),
      requiredString(hypothesis.id, "hypothesis id"),
      "hypothesis"
    );
    expect(stored.status).toBe("supported");
    expect(records(stored.decisions, "decisions after stale write")).toHaveLength(1);
  });

  it("binds a decision request id to the complete mutation and conflicts on changed edit fields", async () => {
    const { caseId, hypothesis } = await createCaseWithHypothesis("hypothesis-idempotency");
    const hypothesisId = requiredString(hypothesis.id, "hypothesis id");
    const input = {
      ...actor,
      requestId: `request-${randomUUID()}`,
      expectedUpdatedAt: requiredString(hypothesis.updatedAt, "hypothesis updatedAt"),
      status: "supported",
      reason: "Two independent records agree on the household."
    };

    const first = await callUpdateCaseHypothesis(caseId, hypothesisId, input, storeOptions);
    await expect(callUpdateCaseHypothesis(caseId, hypothesisId, input, storeOptions)).resolves.toEqual(first);

    await expect(
      callUpdateCaseHypothesis(
        caseId,
        hypothesisId,
        { ...input, statement: "A changed statement under the same request id." },
        storeOptions
      )
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      callUpdateCaseHypothesis(caseId, hypothesisId, { ...input, confidence: 0.9 }, storeOptions)
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const stored = findById(hypotheses(await callReadResearchCase(caseId, storeOptions)), hypothesisId, "hypothesis");
    expect(records(stored.decisions, "decisions after conflicting replays")).toHaveLength(1);
    expect(stored.statement).toBe(hypothesis.statement);
    expect(stored.confidence).toBe(hypothesis.confidence);
  });

  it("rejects a new mutation that combines a hypothesis edit with a status decision", async () => {
    const { caseId, hypothesis } = await createCaseWithHypothesis("hypothesis-mutation-contract");

    await expect(
      callUpdateCaseHypothesis(
        caseId,
        requiredString(hypothesis.id, "hypothesis id"),
        {
          ...actor,
          requestId: `request-${randomUUID()}`,
          expectedUpdatedAt: requiredString(hypothesis.updatedAt, "hypothesis updatedAt"),
          statement: "A mixed edit and decision.",
          confidence: 0.8,
          status: "supported",
          reason: "This payload should use one mutation mode."
        },
        storeOptions
      )
    ).rejects.toMatchObject({ code: "INVALID_DECISION" });
  });

  it("rolls back task completion when an optional decision targets a hypothesis from another case", async () => {
    const first = await createCaseWithHypothesis("atomic-first");
    const second = await createCaseWithHypothesis("atomic-second");
    const addedTask = resultEntity(
      await callAddCaseTask(first.caseId, { title: "Check the local register", guidance: "Record the exact search scope." }, storeOptions),
      "task"
    );

    await expect(
      callRecordCaseTaskOutcome(
        first.caseId,
        requiredString(addedTask.id, "task id"),
        {
          ...actor,
          requestId: `request-${randomUUID()}`,
          expectedTaskUpdatedAt: requiredString(addedTask.updatedAt, "task updatedAt"),
          outcome: "found",
          note: "A candidate record was located.",
          hypothesisDecision: {
            hypothesisId: second.hypothesis.id,
            expectedUpdatedAt: second.hypothesis.updatedAt,
            status: "supported",
            reason: "A decision for another case must not be accepted."
          }
        },
        storeOptions
      )
    ).rejects.toThrow(/hypothesis|case|target/i);

    const firstAfter = await callReadResearchCase(first.caseId, storeOptions);
    const secondAfter = await callReadResearchCase(second.caseId, storeOptions);
    const storedTask = findById(tasks(firstAfter), requiredString(addedTask.id, "task id"), "task");
    const foreignHypothesis = findById(
      hypotheses(secondAfter),
      requiredString(second.hypothesis.id, "hypothesis id"),
      "hypothesis"
    );

    expect(storedTask.status).toBe("todo");
    expect(records(storedTask.outcomes, "rolled-back outcomes")).toEqual([]);
    expect(foreignHypothesis.status).toBe("open");
    expect(records(foreignHypothesis.decisions, "foreign decisions")).toEqual([]);
  });

  it("preserves legacy completed and non-open rows as unknown without fabricating history", async () => {
    const researchCase = await createCase(
      {
        id: "case-legacy-unknown",
        title: "Legacy unknown history",
        question: "What was recorded before guided history existed?"
      },
      storeOptions
    );

    // These inserts deliberately use only the pre-005 column contract. Expanded
    // schema defaults must preserve the old facts without inventing outcomes,
    // decisions, actors, reasons, or timestamps.
    await query(
      "INSERT INTO hypotheses (id, archive_id, case_id, statement, confidence, status, sort_order) VALUES ($1, $2, $3, $4, 0.4, 'rejected', 0)",
      ["hyp-legacy-unknown", storeOptions.archiveId, researchCase.id, "A legacy hypothesis was ruled out."],
      storeOptions
    );
    await query(
      "INSERT INTO tasks (id, archive_id, case_id, title, status, sort_order) VALUES ($1, $2, $3, $4, 'done', 0)",
      ["task-legacy-unknown", storeOptions.archiveId, researchCase.id, "A legacy task was completed."],
      storeOptions
    );

    const stored = await callReadResearchCase(researchCase.id, storeOptions);
    const legacyHypothesis = findById(hypotheses(stored), "hyp-legacy-unknown", "legacy hypothesis");
    const legacyTask = findById(tasks(stored), "task-legacy-unknown", "legacy task");

    expect(legacyHypothesis.status).toBe("rejected");
    expect(records(legacyHypothesis.decisions, "legacy decisions")).toEqual([]);
    expect(legacyTask.status).toBe("done");
    expect(records(legacyTask.outcomes, "legacy outcomes")).toEqual([]);
    expect(legacyTask.completedAt).toBeUndefined();
    expect(legacyTask).toMatchObject({ origin: "manual", priority: "normal", guidance: "", contextRefs: [] });
    expect(requiredString(legacyTask.workFingerprint, "legacy work fingerprint")).toBeDefined();
  });

  it("rejects cross-case task targets and references during a full workspace snapshot write", async () => {
    const first = await createCaseWithHypothesis("snapshot-first");
    const second = await createCaseWithHypothesis("snapshot-second");
    const addedTask = resultEntity(
      await callAddCaseTask(first.caseId, { title: "A case-scoped manual assignment" }, storeOptions),
      "task"
    );
    const snapshot = structuredClone(await readWorkspace(storeOptions));
    const firstCase = snapshot.cases.find((researchCase) => researchCase.id === first.caseId)!;
    const task = firstCase.tasks.find((candidate) => candidate.id === addedTask.id)! as unknown as UnknownRecord;
    task.targetHypothesisId = second.hypothesis.id;
    task.contextRefs = [{ type: "hypothesis", id: second.hypothesis.id }];

    await expect(writeWorkspace(snapshot, storeOptions)).rejects.toThrow(/reference|target|hypothesis|case/i);

    const stored = findById(tasks(await callReadResearchCase(first.caseId, storeOptions)), requiredString(addedTask.id, "task id"), "task");
    expect(stored.targetHypothesisId).toBeUndefined();
    expect(stored.contextRefs).toEqual([]);
  });

  it("requires task versions, keeps guide metadata and completed tasks immutable, and allows only one active assignment", async () => {
    const { caseId } = await createCaseWithHypothesis("task-invariants");
    const beforeGuide = await callReadResearchCase(caseId, storeOptions);
    const proposed = guideAssignment(callBuildResearchGuide(beforeGuide));
    const guideTask = resultEntity(
      await callAcceptGuideAssignment(caseId, requiredString(proposed.guideKey, "guide key"), storeOptions),
      "task"
    );

    await expect(
      callUpdateCaseTask(caseId, requiredString(guideTask.id, "guide task id"), { status: "doing" }, storeOptions)
    ).rejects.toThrow(/expected|version|timestamp|stale/i);
    await expect(
      callUpdateCaseTask(
        caseId,
        requiredString(guideTask.id, "guide task id"),
        {
          title: "Client-authored replacement",
          guidance: "Client-authored guidance",
          expectedUpdatedAt: guideTask.updatedAt
        },
        storeOptions
      )
    ).rejects.toThrow(/guide|immutable|server/i);

    const startedGuide = resultEntity(
      await callUpdateCaseTask(
        caseId,
        requiredString(guideTask.id, "guide task id"),
        { status: "doing", expectedUpdatedAt: guideTask.updatedAt },
        storeOptions
      ),
      "task"
    );
    const secondTask = resultEntity(
      await callAddCaseTask(caseId, { title: "Check a second repository" }, storeOptions),
      "task"
    );

    await expect(
      callUpdateCaseTask(
        caseId,
        requiredString(secondTask.id, "second task id"),
        { status: "doing", expectedUpdatedAt: secondTask.updatedAt },
        storeOptions
      )
    ).rejects.toThrow(/another|active|progress|doing|conflict/i);

    const completed = resultEntity(
      await callRecordCaseTaskOutcome(
        caseId,
        requiredString(startedGuide.id, "started guide id"),
        {
          ...actor,
          requestId: `request-${randomUUID()}`,
          expectedTaskUpdatedAt: startedGuide.updatedAt,
          outcome: "found",
          note: "The requested record was located and cited."
        },
        storeOptions
      ),
      "task"
    );

    await expect(
      callUpdateCaseTask(
        caseId,
        requiredString(completed.id, "completed task id"),
        { title: "Rewritten completed history", expectedUpdatedAt: completed.updatedAt },
        storeOptions
      )
    ).rejects.toThrow(/completed|immutable|outcome/i);
  });

  it("allows outcome-free completion only for manual tasks under the explicit kill-switch policy", async () => {
    const { caseId } = await createCaseWithHypothesis("manual-kill-switch-completion");
    const manualTask = resultEntity(
      await callAddCaseTask(caseId, { title: "Review the handwritten index" }, storeOptions),
      "task"
    );

    await expect(
      callUpdateCaseTask(
        caseId,
        requiredString(manualTask.id, "manual task id"),
        { status: "done", expectedUpdatedAt: manualTask.updatedAt },
        storeOptions
      )
    ).rejects.toThrow(/outcome/i);

    const completedManualTask = resultEntity(
      await callUpdateCaseTask(
        caseId,
        requiredString(manualTask.id, "manual task id"),
        { status: "done", expectedUpdatedAt: manualTask.updatedAt },
        { ...storeOptions, allowManualCompletionWithoutOutcome: true }
      ),
      "task"
    );

    expect(completedManualTask).toMatchObject({
      status: "done",
      origin: "manual",
      outcomes: []
    });
    expect(requiredString(completedManualTask.completedAt, "manual completion timestamp")).toBe(
      completedManualTask.updatedAt
    );

    const guideCase = await createCaseWithHypothesis("guide-kill-switch-completion");
    const guidePlan = guideAssignment(callBuildResearchGuide(await callReadResearchCase(guideCase.caseId, storeOptions)));
    const guideTask = resultEntity(
      await callAcceptGuideAssignment(
        guideCase.caseId,
        requiredString(guidePlan.guideKey, "guide key"),
        storeOptions
      ),
      "task"
    );

    await expect(
      callUpdateCaseTask(
        guideCase.caseId,
        requiredString(guideTask.id, "guide task id"),
        { status: "done", expectedUpdatedAt: guideTask.updatedAt },
        { ...storeOptions, allowManualCompletionWithoutOutcome: true }
      )
    ).rejects.toThrow(/outcome/i);
  });

  it("accepts only append-only corrections that target an earlier outcome on the same task", async () => {
    const { caseId } = await createCaseWithHypothesis("outcome-corrections");
    const firstTask = resultEntity(
      await callAddCaseTask(caseId, { title: "Search the first register" }, storeOptions),
      "task"
    );
    const otherTask = resultEntity(
      await callAddCaseTask(caseId, { title: "Search the second register" }, storeOptions),
      "task"
    );
    const completedOther = resultEntity(
      await callRecordCaseTaskOutcome(
        caseId,
        requiredString(otherTask.id, "other task id"),
        {
          ...actor,
          requestId: `request-${randomUUID()}`,
          expectedTaskUpdatedAt: otherTask.updatedAt,
          outcome: "found",
          note: "The second register contains a separate result."
        },
        storeOptions
      ),
      "task"
    );
    const otherOutcome = records(completedOther.outcomes, "other task outcomes")[0];

    await expect(
      callRecordCaseTaskOutcome(
        caseId,
        requiredString(firstTask.id, "first task id"),
        {
          ...actor,
          requestId: `request-${randomUUID()}`,
          expectedTaskUpdatedAt: firstTask.updatedAt,
          outcome: "found",
          note: "A first result with a forged correction pointer.",
          correctsOutcomeId: otherOutcome.id
        },
        storeOptions
      )
    ).rejects.toThrow(/correction|outcome|task/i);

    const completedFirst = resultEntity(
      await callRecordCaseTaskOutcome(
        caseId,
        requiredString(firstTask.id, "first task id"),
        {
          ...actor,
          requestId: `request-${randomUUID()}`,
          expectedTaskUpdatedAt: firstTask.updatedAt,
          outcome: "found",
          note: "The index contains a plausible matching entry."
        },
        storeOptions
      ),
      "task"
    );
    const firstOutcome = records(completedFirst.outcomes, "first task outcomes")[0];

    const corrected = resultEntity(
      await callRecordCaseTaskOutcome(
        caseId,
        requiredString(firstTask.id, "first task id"),
        {
          ...actor,
          requestId: `request-${randomUUID()}`,
          expectedTaskUpdatedAt: completedFirst.updatedAt,
          outcome: "inconclusive",
          note: "Closer inspection shows that the entry belongs to another family.",
          correctsOutcomeId: firstOutcome.id
        },
        storeOptions
      ),
      "task"
    );

    expect(records(corrected.outcomes, "corrected outcomes")).toHaveLength(2);
    expect(records(corrected.outcomes, "corrected outcomes")[1].correctsOutcomeId).toBe(firstOutcome.id);
  });

  it("treats a changed or omitted hypothesis decision as an idempotency conflict", async () => {
    const { caseId, hypothesis } = await createCaseWithHypothesis("decision-idempotency");
    const task = resultEntity(
      await callAddCaseTask(caseId, { title: "Compare the candidate households" }, storeOptions),
      "task"
    );
    const input = {
      ...actor,
      requestId: `request-${randomUUID()}`,
      expectedTaskUpdatedAt: task.updatedAt,
      outcome: "found",
      note: "The households share the same address and family members.",
      hypothesisDecision: {
        hypothesisId: hypothesis.id,
        expectedUpdatedAt: hypothesis.updatedAt,
        status: "supported",
        reason: "Two independent details agree."
      }
    };
    await callRecordCaseTaskOutcome(caseId, requiredString(task.id, "task id"), input, storeOptions);

    await expect(
      callRecordCaseTaskOutcome(
        caseId,
        requiredString(task.id, "task id"),
        {
          ...input,
          hypothesisDecision: { ...input.hypothesisDecision, status: "rejected", reason: "Different decision." }
        },
        storeOptions
      )
    ).rejects.toThrow(/request|idempot|conflict/i);
    await expect(
      callRecordCaseTaskOutcome(
        caseId,
        requiredString(task.id, "task id"),
        { ...input, actorName: "Altered Attribution" },
        storeOptions
      )
    ).rejects.toThrow(/request|idempot|conflict/i);
    const { hypothesisDecision: _decision, ...withoutDecision } = input;
    void _decision;
    await expect(
      callRecordCaseTaskOutcome(caseId, requiredString(task.id, "task id"), withoutDecision, storeOptions)
    ).rejects.toThrow(/request|idempot|conflict/i);
  });

  it.each([
    ["invalid task status", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      (fixture.task as unknown as UnknownRecord).status = "unknown";
    }],
    ["invalid hypothesis status", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      (fixture.hypothesis as unknown as UnknownRecord).status = "unknown";
    }],
    ["invalid decision transition status", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      (fixture.hypothesis.decisions![0] as unknown as UnknownRecord).fromStatus = "unknown";
    }],
    ["invalid outcome type", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      (fixture.task.outcomes![0] as unknown as UnknownRecord).type = "unknown";
    }],
    ["multiple doing tasks", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      fixture.task.status = "doing";
      fixture.task.outcomes = [];
      fixture.task.completedAt = undefined;
      fixture.researchCase.tasks.push({
        ...fixture.task,
        id: "task-snapshot-second-doing",
        title: "A second active assignment",
        workFingerprint: "a second active assignment",
        contextRefs: [],
        outcomes: []
      });
    }],
    ["duplicate outcome request ids", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      fixture.task.outcomes!.push({
        ...fixture.task.outcomes![0],
        id: "outcome-snapshot-two",
        createdAt: "2026-07-13T19:00:00.000Z"
      });
    }],
    ["dangling correction", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      fixture.task.outcomes!.push({
        ...fixture.task.outcomes![0],
        id: "outcome-snapshot-two",
        requestId: "request-outcome-snapshot-two",
        correctsOutcomeId: "outcome-missing",
        createdAt: "2026-07-13T19:00:00.000Z"
      });
    }],
    ["forward correction", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      fixture.task.outcomes![0].correctsOutcomeId = "outcome-snapshot-two";
      fixture.task.outcomes!.push({
        ...fixture.task.outcomes![0],
        id: "outcome-snapshot-two",
        requestId: "request-outcome-snapshot-two",
        correctsOutcomeId: undefined,
        createdAt: "2026-07-13T19:00:00.000Z"
      });
    }],
    ["final decision mismatch", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      fixture.hypothesis.status = "open";
    }],
    ["duplicate decision request ids", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      fixture.hypothesis.decisions!.push({
        ...fixture.hypothesis.decisions![0],
        id: "decision-snapshot-two",
        fromStatus: "supported",
        toStatus: "rejected",
        createdAt: "2026-07-13T19:00:00.000Z"
      });
      fixture.hypothesis.status = "rejected";
    }],
    ["broken decision chronology", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      fixture.hypothesis.decisions!.push({
        ...fixture.hypothesis.decisions![0],
        id: "decision-snapshot-two",
        requestId: "request-decision-snapshot-two",
        fromStatus: "open",
        toStatus: "rejected",
        createdAt: "2026-07-13T19:00:00.000Z"
      });
      fixture.hypothesis.status = "rejected";
    }],
    ["out-of-order decision time", (fixture: Awaited<ReturnType<typeof validGuidedSnapshot>>) => {
      fixture.hypothesis.decisions!.push({
        ...fixture.hypothesis.decisions![0],
        id: "decision-snapshot-two",
        requestId: "request-decision-snapshot-two",
        fromStatus: "supported",
        toStatus: "rejected",
        createdAt: "2026-07-13T16:00:00.000Z"
      });
      fixture.hypothesis.status = "rejected";
    }]
  ])("rejects %s in a full workspace snapshot", async (_label, corrupt) => {
    const fixture = await validGuidedSnapshot();
    corrupt(fixture);

    await expect(writeWorkspace(fixture.snapshot, storeOptions)).rejects.toThrow(
      /invalid|duplicate|correction|decision|status|outcome|chronology|active|doing/i
    );
  });

  it("round-trips guide metadata and attributed histories through full workspace snapshot persistence", async () => {
    const { caseId, hypothesis } = await createCaseWithHypothesis("snapshot-round-trip");
    const addedTask = resultEntity(
      await callAddCaseTask(
        caseId,
        {
          title: "Inspect the parish register",
          guidance: "Record the parish, years, spelling variants, and result.",
          priority: "high"
        },
        storeOptions
      ),
      "task"
    );
    await callRecordCaseTaskOutcome(
      caseId,
      requiredString(addedTask.id, "task id"),
      {
        ...actor,
        requestId: `request-${randomUUID()}`,
        expectedTaskUpdatedAt: requiredString(addedTask.updatedAt, "task updatedAt"),
        outcome: "found",
        note: "Located the family in the 1891 register and recorded the citation.",
        hypothesisDecision: {
          hypothesisId: hypothesis.id,
          expectedUpdatedAt: hypothesis.updatedAt,
          status: "supported",
          reason: "The household members and address agree with the hypothesis."
        }
      },
      storeOptions
    );
    const before = await callReadResearchCase(caseId, storeOptions);

    // JSON serialization mirrors the persisted backup/portable snapshot boundary:
    // no in-memory object identity or Date instance may be required to retain data.
    const snapshot = JSON.parse(JSON.stringify(await readWorkspace(storeOptions))) as Awaited<ReturnType<typeof readWorkspace>>;
    await writeWorkspace(snapshot, storeOptions);
    const after = await callReadResearchCase(caseId, storeOptions);
    const beforeTask = findById(tasks(before), requiredString(addedTask.id, "task id"), "before task");
    const afterTask = findById(tasks(after), requiredString(addedTask.id, "task id"), "after task");
    const beforeHypothesis = findById(hypotheses(before), requiredString(hypothesis.id, "hypothesis id"), "before hypothesis");
    const afterHypothesis = findById(hypotheses(after), requiredString(hypothesis.id, "hypothesis id"), "after hypothesis");

    expect(afterTask).toMatchObject({
      origin: beforeTask.origin,
      priority: beforeTask.priority,
      workFingerprint: beforeTask.workFingerprint,
      guidance: beforeTask.guidance,
      contextRefs: beforeTask.contextRefs,
      outcomes: beforeTask.outcomes,
      completedAt: beforeTask.completedAt,
      updatedAt: beforeTask.updatedAt
    });
    expect(afterHypothesis).toMatchObject({
      status: beforeHypothesis.status,
      decisions: beforeHypothesis.decisions,
      updatedAt: beforeHypothesis.updatedAt
    });
  });
});
