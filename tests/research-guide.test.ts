import { describe, expect, it } from "vitest";
import { buildResearchGuide } from "@/lib/research-guide";
import type {
  ResearchCase,
  ResearchEvidence,
  ResearchHypothesis,
  ResearchHypothesisDecision,
  ResearchReference,
  ResearchTask,
  ResearchTaskOutcome
} from "@/lib/models";

const createdAt = "2026-07-13T16:00:00.000Z";
const updatedAt = "2026-07-13T16:30:00.000Z";

function makeHypothesis(overrides: Partial<ResearchHypothesis> = {}): ResearchHypothesis {
  return {
    id: "hyp-alpha",
    statement: "The March connection runs through the maternal Hartwell branch.",
    confidence: 0.5,
    status: "open",
    decisions: [],
    updatedAt,
    ...overrides
  };
}

function makeEvidence(overrides: Partial<ResearchEvidence> = {}): ResearchEvidence {
  return {
    id: "ev-alpha",
    title: "1911 Lantern Bay harbor signal log",
    type: "Harbor log",
    summary: "A March signal code appears beside the Hartwell dock assignment in Lantern Bay.",
    confidence: 0.45,
    ...overrides
  };
}

function makeOutcome(overrides: Partial<ResearchTaskOutcome> = {}): ResearchTaskOutcome {
  return {
    id: "outcome-alpha",
    requestId: "request-outcome-alpha",
    type: "found",
    note: "The register contained a matching household.",
    actorId: "user-owner",
    actorName: "Archive owner",
    createdAt: updatedAt,
    ...overrides
  };
}

function makeTask(overrides: Partial<ResearchTask> = {}): ResearchTask {
  return {
    id: "task-alpha",
    title: "Review the 1911 Lantern Bay harbor signal log",
    status: "todo",
    origin: "manual",
    priority: "normal",
    workFingerprint: "work:v1:review-1911-lantern-bay-harbor-signal-log",
    guidance: "Compare the signal-log entry with the case question.",
    contextRefs: [],
    outcomes: [],
    createdAt,
    updatedAt,
    ...overrides
  };
}

function makeCase(overrides: Partial<ResearchCase> = {}): ResearchCase {
  return {
    id: "case-alpha",
    title: "March connection",
    question: "How does the March household connect to the Hartwell family?",
    status: "active",
    focus: "Lantern Bay before 1912",
    privacy: "private",
    hypotheses: [makeHypothesis()],
    evidence: [],
    tasks: [],
    ...overrides
  };
}

function requireAssignment(researchCase: ResearchCase) {
  const plan = buildResearchGuide(researchCase);
  expect(plan.assignment).toBeDefined();
  return { plan, assignment: plan.assignment! };
}

describe("private deterministic research guide", () => {
  it.each([
    ["paused", "paused"],
    ["resolved", "resolved"]
  ] as const)("short-circuits a %s case before resuming its tasks", (status, phase) => {
    const plan = buildResearchGuide(
      makeCase({
        status,
        tasks: [makeTask({ id: "task-doing", status: "doing", priority: "high" })]
      })
    );

    expect(plan.phase).toBe(phase);
    expect(plan.assignment).toBeUndefined();
  });

  it("returns one deterministic generated assignment with a stable server key", () => {
    const researchCase = makeCase();
    const first = buildResearchGuide(researchCase);
    const second = buildResearchGuide(structuredClone(researchCase));

    expect(first).toEqual(second);
    expect(first.assignment).toEqual(
      expect.objectContaining({
        source: "generated",
        targetHypothesisId: "hyp-alpha",
        workFingerprint: expect.any(String),
        guideKey: expect.stringMatching(/^guide:v1:case-alpha:/)
      })
    );
    expect(Array.isArray(first.assignment)).toBe(false);
  });

  it("resumes doing work before any queued or generated assignment", () => {
    const plan = buildResearchGuide(
      makeCase({
        tasks: [
          makeTask({ id: "task-high-todo", title: "High queued work", status: "todo", priority: "high" }),
          makeTask({ id: "task-doing", title: "Work already underway", status: "doing", priority: "low" })
        ]
      })
    );

    expect(plan.phase).toBe("resume");
    expect(plan.assignment).toMatchObject({ source: "existing", taskId: "task-doing", title: "Work already underway" });
  });

  it("selects existing todos by priority and then persisted order", () => {
    const plan = buildResearchGuide(
      makeCase({
        tasks: [
          makeTask({ id: "task-normal", title: "Normal work", priority: "normal" }),
          makeTask({ id: "task-high-first", title: "First high-priority work", priority: "high" }),
          makeTask({ id: "task-high-second", title: "Second high-priority work", priority: "high" })
        ]
      })
    );

    expect(plan.phase).toBe("ready");
    expect(plan.assignment).toMatchObject({ source: "existing", taskId: "task-high-first" });
  });

  it("asks for a testable hypothesis instead of inventing one", () => {
    const plan = buildResearchGuide(makeCase({ hypotheses: [] }));

    expect(plan.phase).toBe("needs_hypothesis");
    expect(plan.assignment).toBeUndefined();
    expect(plan.reason).toMatch(/testable hypothesis/i);
  });

  it("describes weak evidence as case evidence without claiming it supports a hypothesis", () => {
    const weakEvidence = makeEvidence({ id: "ev-weak", title: "Unverified harbor-log transcription", confidence: 0.2 });
    const strongEvidence = makeEvidence({ id: "ev-strong", title: "Certified birth register", confidence: 0.9 });
    const weakEvidenceRef: ResearchReference = { type: "evidence", id: "ev-weak" };
    const { assignment } = requireAssignment(makeCase({ evidence: [strongEvidence, weakEvidence] }));

    expect(assignment).toMatchObject({
      source: "generated",
      targetHypothesisId: undefined,
      contextRefs: expect.arrayContaining([weakEvidenceRef])
    });
    expect(`${assignment.title} ${assignment.guidance}`).toMatch(/review|assess|determine/i);
    expect(`${assignment.title} ${assignment.guidance}`).toContain("Unverified harbor-log transcription");
    expect(`${assignment.title} ${assignment.guidance}`).not.toContain("supports the March connection runs through the maternal Hartwell branch");
  });

  it("suppresses a completed generated guide key", () => {
    const researchCase = makeCase();
    const { assignment } = requireAssignment(researchCase);
    const completed = makeTask({
      id: "task-completed-guide",
      title: assignment.title,
      status: "done",
      origin: "guide",
      priority: "normal",
      guideKey: assignment.guideKey,
      workFingerprint: assignment.workFingerprint,
      guidance: assignment.guidance,
      targetHypothesisId: assignment.targetHypothesisId,
      contextRefs: assignment.contextRefs,
      outcomes: [makeOutcome()],
      completedAt: updatedAt
    });

    const next = buildResearchGuide(makeCase({ tasks: [completed] }));

    expect(next.assignment?.guideKey).not.toBe(assignment.guideKey);
    expect(next.assignment?.workFingerprint).not.toBe(assignment.workFingerprint);
  });

  it("suppresses equivalent completed manual work by fingerprint", () => {
    const { assignment } = requireAssignment(makeCase());
    const completedManual = makeTask({
      id: "task-completed-manual",
      title: "A manually entered equivalent search",
      status: "done",
      origin: "manual",
      guideKey: undefined,
      workFingerprint: assignment.workFingerprint,
      outcomes: [makeOutcome()],
      completedAt: updatedAt
    });

    const next = buildResearchGuide(makeCase({ tasks: [completedManual] }));

    expect(next.assignment?.workFingerprint).not.toBe(assignment.workFingerprint);
  });

  it("remembers a legacy completed task without fabricating an outcome", () => {
    const { assignment } = requireAssignment(makeCase());
    const legacyTask = makeTask({
      id: "task-legacy-done",
      title: "Legacy register search",
      status: "done",
      origin: "manual",
      guideKey: undefined,
      workFingerprint: assignment.workFingerprint,
      outcomes: [],
      completedAt: undefined
    });

    const plan = buildResearchGuide(makeCase({ tasks: [legacyTask] }));

    expect(plan.assignment?.workFingerprint).not.toBe(assignment.workFingerprint);
    expect(plan.memory.completedResults).toContainEqual(
      expect.objectContaining({
        taskId: "task-legacy-done",
        outcomes: [],
        legacyUnknown: true
      })
    );
  });

  it("records not_found as search memory without automatically ruling out its hypothesis", () => {
    const researchCase = makeCase();
    const { assignment } = requireAssignment(researchCase);
    const notFound = makeOutcome({
      id: "outcome-not-found",
      type: "not_found",
      note: "No matching baptism was found in the indexed register pages.",
      searchScope: {
        repository: "Lantern Bay archive",
        collection: "Harbor baptisms",
        place: "Lantern Bay",
        dateRange: "1906-1912",
        query: "March"
      }
    });
    const completed = makeTask({
      id: "task-not-found",
      title: assignment.title,
      status: "done",
      origin: "guide",
      guideKey: assignment.guideKey,
      workFingerprint: assignment.workFingerprint,
      guidance: assignment.guidance,
      targetHypothesisId: assignment.targetHypothesisId,
      contextRefs: assignment.contextRefs,
      outcomes: [notFound],
      completedAt: updatedAt
    });

    const plan = buildResearchGuide(makeCase({ tasks: [completed] }));

    expect(plan.memory.completedResults).toContainEqual(
      expect.objectContaining({ taskId: "task-not-found", outcomes: [notFound], legacyUnknown: false })
    );
    expect(plan.memory.ruledOut).toEqual([]);
    expect(plan.progress.ruledOut).toBe(0);
    expect(plan.assignment?.workFingerprint).not.toBe(assignment.workFingerprint);
  });

  it("counts only attributed rejection decisions while retaining legacy unknown rule-outs", () => {
    const evidence = makeEvidence();
    const decision: ResearchHypothesisDecision = {
      id: "decision-rejected",
      requestId: "request-decision-rejected",
      fromStatus: "open",
      toStatus: "rejected",
      statement: "The March connection runs through the maternal Hartwell branch.",
      reason: "The named parents in the certified register identify a different family.",
      contextRefs: [{ type: "evidence", id: evidence.id }],
      actorId: "user-owner",
      actorName: "Archive owner",
      createdAt: updatedAt
    };
    const attributed = makeHypothesis({ id: "hyp-attributed", status: "rejected", decisions: [decision] });
    const legacyUnknown = makeHypothesis({
      id: "hyp-legacy-rejected",
      statement: "A legacy path marked rejected before decision history existed.",
      status: "rejected",
      decisions: []
    });

    const plan = buildResearchGuide(makeCase({ hypotheses: [attributed, legacyUnknown], evidence: [evidence] }));

    expect(plan.phase).toBe("needs_hypothesis");
    expect(plan.memory.ruledOut).toContainEqual(
      expect.objectContaining({
        hypothesisId: "hyp-attributed",
        legacyUnknown: false,
        decision: expect.objectContaining({
          reason: decision.reason,
          actorId: "user-owner",
          actorName: "Archive owner"
        })
      })
    );
    expect(plan.memory.ruledOut).toContainEqual(
      expect.objectContaining({
        hypothesisId: "hyp-legacy-rejected",
        legacyUnknown: true,
        decision: undefined
      })
    );
    expect(plan.progress.ruledOut).toBe(1);
  });
});
