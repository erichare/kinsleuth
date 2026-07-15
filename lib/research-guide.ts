import type {
  ResearchCase,
  ResearchEvidence,
  ResearchHypothesis,
  ResearchHypothesisDecision,
  ResearchReference,
  ResearchTask,
  ResearchTaskOutcome
} from "./models";
import { projectResearchCaseForDnaCapability } from "./case-search";

export type ResearchGuidePhase = "resume" | "ready" | "needs_hypothesis" | "paused" | "resolved" | "exhausted";

export type ResearchGuideAssignment = {
  source: "existing" | "generated";
  taskId?: string;
  guideKey?: string;
  title: string;
  guidance: string;
  workFingerprint: string;
  targetHypothesisId?: string;
  contextRefs: ResearchReference[];
};

export type ResearchGuideCompletedResult = {
  taskId: string;
  title: string;
  outcomes: ResearchTaskOutcome[];
  legacyUnknown: boolean;
  completedAt?: string;
  targetHypothesisId?: string;
  contextRefs: ResearchReference[];
};

export type ResearchGuideRuledOut = {
  hypothesisId: string;
  statement: string;
  decision?: ResearchHypothesisDecision;
  legacyUnknown: boolean;
};

export type ResearchGuideMemory = {
  completedResults: ResearchGuideCompletedResult[];
  ruledOut: ResearchGuideRuledOut[];
};

export type ResearchGuideProgress = {
  evidenceCollected: number;
  completedAssignments: number;
  ruledOut: number;
};

export type ResearchGuidePlan = {
  phase: ResearchGuidePhase;
  assignment?: ResearchGuideAssignment;
  reason: string;
  progress: ResearchGuideProgress;
  memory: ResearchGuideMemory;
};

type GeneratedCandidate = ResearchGuideAssignment & {
  source: "generated";
};

type ReferenceIndex = {
  caseIds: Set<string>;
  hypothesisIds: Set<string>;
  evidenceIds: Set<string>;
  taskIds: Set<string>;
};

const guideRevision = "v1";
const priorityOrder: Record<NonNullable<ResearchTask["priority"]>, number> = {
  high: 0,
  normal: 1,
  low: 2
};

/**
 * Builds one case-scoped next step from persisted research state. The function
 * is intentionally pure: it performs no I/O and does not consult provider or
 * environment configuration.
 */
export function buildResearchGuide(
  inputCase: ResearchCase,
  options: { dnaEnabled?: boolean } = {}
): ResearchGuidePlan {
  const researchCase = projectResearchCaseForDnaCapability(
    inputCase,
    options.dnaEnabled ?? true
  );
  const referenceIndex = buildReferenceIndex(researchCase);
  const memory = buildMemory(researchCase, referenceIndex);
  const progress: ResearchGuideProgress = {
    evidenceCollected: researchCase.evidence.length,
    completedAssignments: researchCase.tasks.filter((task) => task.status === "done").length,
    ruledOut: memory.ruledOut.filter((item) => !item.legacyUnknown).length
  };
  const base = { progress, memory };

  if (researchCase.status === "paused") {
    return {
      ...base,
      phase: "paused",
      reason: "This case is paused. Resume the case before starting another assignment."
    };
  }

  if (researchCase.status === "resolved") {
    return {
      ...base,
      phase: "resolved",
      reason: "This case is resolved, so the guide is not proposing more work."
    };
  }

  const doingTask = researchCase.tasks.find((task) => task.status === "doing");
  if (doingTask) {
    return {
      ...base,
      phase: "resume",
      assignment: assignmentFromTask(researchCase, doingTask, referenceIndex),
      reason: "Resume the assignment already in progress before starting another one."
    };
  }

  const todoTask = selectTodoTask(researchCase.tasks);
  if (todoTask) {
    return {
      ...base,
      phase: "ready",
      assignment: assignmentFromTask(researchCase, todoTask, referenceIndex),
      reason: "Start the highest-priority assignment already recorded for this case."
    };
  }

  const unresolvedHypotheses = researchCase.hypotheses.filter((hypothesis) => hypothesis.status !== "rejected");
  if (researchCase.hypotheses.length === 0) {
    return {
      ...base,
      phase: "needs_hypothesis",
      reason: "Add one testable hypothesis before the guide proposes research work."
    };
  }
  if (unresolvedHypotheses.length === 0) {
    return {
      ...base,
      phase: "needs_hypothesis",
      reason: "Every current hypothesis is ruled out or marked rejected. Add a new testable hypothesis rather than inventing a conclusion."
    };
  }

  const suppressedGuideKeys = new Set(
    researchCase.tasks
      .filter((task) => task.status === "done")
      .map((task) => task.guideKey?.trim())
      .filter((key): key is string => Boolean(key))
  );
  const suppressedFingerprints = new Set(
    researchCase.tasks
      .filter((task) => task.status === "done")
      .map(taskWorkFingerprint)
      .filter(Boolean)
  );
  const candidate = buildGeneratedCandidates(researchCase, unresolvedHypotheses).find(
    (item) => !suppressedGuideKeys.has(item.guideKey ?? "") && !suppressedFingerprints.has(item.workFingerprint)
  );

  if (!candidate) {
    const negativeSearch = researchCase.tasks.find(
      (task) => task.status === "done" && taskOutcomes(task).some((outcome) => outcome.type === "not_found" || outcome.type === "already_tried")
    );
    return {
      ...base,
      phase: "exhausted",
      reason: negativeSearch
        ? "The matching scoped search is already recorded. Add a different specific search or a new testable hypothesis instead of repeating it."
        : "The deterministic guide has no distinct uncompleted assignment for the current case state."
    };
  }

  return {
    ...base,
    phase: "ready",
    assignment: candidate,
    reason: reasonForGeneratedCandidate(candidate)
  };
}

function selectTodoTask(tasks: ResearchTask[]): ResearchTask | undefined {
  return tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.status === "todo")
    .sort((left, right) => {
      const priorityDelta = priorityOrder[normalizedPriority(left.task)] - priorityOrder[normalizedPriority(right.task)];
      return priorityDelta || left.index - right.index;
    })[0]?.task;
}

function assignmentFromTask(researchCase: ResearchCase, task: ResearchTask, referenceIndex: ReferenceIndex): ResearchGuideAssignment {
  const guidance = task.guidance?.trim() || task.title.trim();
  return {
    source: "existing",
    taskId: task.id,
    guideKey: task.guideKey?.trim() || undefined,
    title: task.title,
    guidance,
    workFingerprint: taskWorkFingerprint(task),
    targetHypothesisId: validTargetHypothesisId(researchCase, task.targetHypothesisId),
    contextRefs: sanitizeReferences(task.contextRefs, referenceIndex)
  };
}

function buildGeneratedCandidates(researchCase: ResearchCase, unresolvedHypotheses: ResearchHypothesis[]): GeneratedCandidate[] {
  const candidates: GeneratedCandidate[] = [];
  const weakestEvidence = selectWeakestEvidence(researchCase.evidence);

  if (weakestEvidence) {
    candidates.push(
      generatedCandidate({
        researchCase,
        ruleId: "review-case-evidence",
        targetId: weakestEvidence.id,
        variant: "reliability",
        title: `Review case evidence: ${weakestEvidence.title}`,
        guidance: `Assess the case evidence “${weakestEvidence.title}” for reliability and relevance. Determine what it can and cannot show without assuming that it supports any particular hypothesis.`,
        contextRefs: [
          { type: "case", id: researchCase.id },
          { type: "evidence", id: weakestEvidence.id }
        ]
      })
    );
  }

  const orderedHypotheses = orderHypotheses(unresolvedHypotheses);
  if (researchCase.evidence.length === 0) {
    for (const hypothesis of orderedHypotheses) {
      candidates.push(
        generatedCandidate({
          researchCase,
          ruleId: "first-record-search",
          targetId: hypothesis.id,
          variant: "initial-scoped-search",
          title: `Find one independent record for: ${hypothesis.statement}`,
          guidance:
            "Choose one named repository or collection and a bounded place and date range. Record exactly what you searched and what you found; a missing result is not proof that the hypothesis is false.",
          targetHypothesisId: hypothesis.id,
          contextRefs: [
            { type: "case", id: researchCase.id },
            { type: "hypothesis", id: hypothesis.id }
          ]
        })
      );
    }
    return candidates;
  }

  const strongestEvidence = selectStrongestEvidence(researchCase.evidence);
  if (strongestEvidence) {
    for (const hypothesis of orderedHypotheses.filter((item) => item.status === "open" || item.status === "weakened")) {
      candidates.push(
        generatedCandidate({
          researchCase,
          ruleId: "compare-case-evidence",
          targetId: hypothesis.id,
          variant: strongestEvidence.id,
          title: `Compare ${strongestEvidence.title} with: ${hypothesis.statement}`,
          guidance: `Review “${strongestEvidence.title}” and determine whether it strengthens, weakens, or leaves this hypothesis unchanged. The guide does not assume a relationship between them.`,
          targetHypothesisId: hypothesis.id,
          contextRefs: [
            { type: "case", id: researchCase.id },
            { type: "hypothesis", id: hypothesis.id },
            { type: "evidence", id: strongestEvidence.id }
          ]
        })
      );
    }
  }

  for (const hypothesis of orderedHypotheses.filter((item) => item.status === "supported")) {
    candidates.push(
      generatedCandidate({
        researchCase,
        ruleId: "independent-corroboration",
        targetId: hypothesis.id,
        variant: "next-independent-source",
        title: `Seek independent corroboration for: ${hypothesis.statement}`,
        guidance: "Look for an independent record or source that tests the supported hypothesis without merely repeating the evidence already in this case.",
        targetHypothesisId: hypothesis.id,
        contextRefs: [
          { type: "case", id: researchCase.id },
          { type: "hypothesis", id: hypothesis.id }
        ]
      })
    );
  }

  return candidates;
}

function generatedCandidate(input: {
  researchCase: ResearchCase;
  ruleId: string;
  targetId: string;
  variant: string;
  title: string;
  guidance: string;
  targetHypothesisId?: string;
  contextRefs: ResearchReference[];
}): GeneratedCandidate {
  return {
    source: "generated",
    guideKey: [
      "guide",
      guideRevision,
      guideKeySegment(input.researchCase.id),
      guideKeySegment(input.ruleId),
      guideKeySegment(input.targetId),
      guideKeySegment(input.variant)
    ].join(":"),
    title: input.title,
    guidance: input.guidance,
    workFingerprint: normalizeResearchWorkFingerprint(input.title),
    targetHypothesisId: input.targetHypothesisId,
    contextRefs: input.contextRefs
  };
}

/** Mirrors the migration/store normalization used for manual and legacy work. */
export function normalizeResearchWorkFingerprint(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function taskWorkFingerprint(task: ResearchTask): string {
  const stored = task.workFingerprint?.trim();
  return stored ? normalizeResearchWorkFingerprint(stored) : normalizeResearchWorkFingerprint(task.title);
}

function normalizedPriority(task: ResearchTask): NonNullable<ResearchTask["priority"]> {
  return task.priority === "high" || task.priority === "low" ? task.priority : "normal";
}

function buildMemory(researchCase: ResearchCase, referenceIndex: ReferenceIndex): ResearchGuideMemory {
  const completedResults = researchCase.tasks
    .filter((task) => task.status === "done")
    .map((task): ResearchGuideCompletedResult => {
      const outcomes = taskOutcomes(task);
      return {
        taskId: task.id,
        title: task.title,
        outcomes,
        legacyUnknown: outcomes.length === 0,
        completedAt: task.completedAt,
        targetHypothesisId: validTargetHypothesisId(researchCase, task.targetHypothesisId),
        contextRefs: sanitizeReferences(task.contextRefs, referenceIndex)
      };
    });

  const ruledOut = researchCase.hypotheses
    .filter((hypothesis) => hypothesis.status === "rejected")
    .map((hypothesis): ResearchGuideRuledOut => {
      const decision = latestAttributedRejection(hypothesis, referenceIndex);
      return {
        hypothesisId: hypothesis.id,
        statement: decision?.statement || hypothesis.statement,
        decision,
        legacyUnknown: !decision
      };
    });

  return { completedResults, ruledOut };
}

function latestAttributedRejection(
  hypothesis: ResearchHypothesis,
  referenceIndex: ReferenceIndex
): ResearchHypothesisDecision | undefined {
  const decisions = Array.isArray(hypothesis.decisions) ? hypothesis.decisions : [];
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const decision = decisions[index];
    if (
      decision?.toStatus === "rejected" &&
      decision.reason?.trim() &&
      decision.statement?.trim() &&
      decision.actorId?.trim() &&
      decision.actorName?.trim() &&
      decision.createdAt?.trim()
    ) {
      return {
        ...decision,
        contextRefs: sanitizeReferences(decision.contextRefs, referenceIndex)
      };
    }
  }
  return undefined;
}

function taskOutcomes(task: ResearchTask): ResearchTaskOutcome[] {
  return Array.isArray(task.outcomes) ? [...task.outcomes] : [];
}

function orderHypotheses(hypotheses: ResearchHypothesis[]): ResearchHypothesis[] {
  const statusOrder: Record<Exclude<ResearchHypothesis["status"], "rejected">, number> = {
    open: 0,
    weakened: 1,
    supported: 2
  };
  return hypotheses
    .map((hypothesis, index) => ({ hypothesis, index }))
    .sort((left, right) => {
      const leftRank = left.hypothesis.status === "rejected" ? Number.MAX_SAFE_INTEGER : statusOrder[left.hypothesis.status];
      const rightRank = right.hypothesis.status === "rejected" ? Number.MAX_SAFE_INTEGER : statusOrder[right.hypothesis.status];
      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ hypothesis }) => hypothesis);
}

function selectWeakestEvidence(evidence: ResearchEvidence[]): ResearchEvidence | undefined {
  return evidence
    .map((item, index) => ({ item, index }))
    .sort((left, right) => normalizedConfidence(left.item.confidence) - normalizedConfidence(right.item.confidence) || left.index - right.index)[0]?.item;
}

function selectStrongestEvidence(evidence: ResearchEvidence[]): ResearchEvidence | undefined {
  return evidence
    .map((item, index) => ({ item, index }))
    .sort((left, right) => normalizedConfidence(right.item.confidence) - normalizedConfidence(left.item.confidence) || left.index - right.index)[0]?.item;
}

function normalizedConfidence(value: number): number {
  return Number.isFinite(value) ? value : 0.5;
}

function buildReferenceIndex(researchCase: ResearchCase): ReferenceIndex {
  return {
    caseIds: new Set([researchCase.id]),
    hypothesisIds: new Set(researchCase.hypotheses.map((item) => item.id)),
    evidenceIds: new Set(researchCase.evidence.map((item) => item.id)),
    taskIds: new Set(researchCase.tasks.map((item) => item.id))
  };
}

function sanitizeReferences(references: ResearchReference[] | undefined, index: ReferenceIndex): ResearchReference[] {
  if (!Array.isArray(references)) {
    return [];
  }

  const seen = new Set<string>();
  return references.filter((reference): reference is ResearchReference => {
    if (!reference || !reference.id || !isReferenceType(reference.type)) {
      return false;
    }
    const valid =
      (reference.type === "case" && index.caseIds.has(reference.id)) ||
      (reference.type === "hypothesis" && index.hypothesisIds.has(reference.id)) ||
      (reference.type === "evidence" && index.evidenceIds.has(reference.id)) ||
      (reference.type === "task" && index.taskIds.has(reference.id));
    const key = `${reference.type}:${reference.id}`;
    if (!valid || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isReferenceType(value: unknown): value is ResearchReference["type"] {
  return value === "case" || value === "hypothesis" || value === "evidence" || value === "task";
}

function validTargetHypothesisId(researchCase: ResearchCase, hypothesisId?: string): string | undefined {
  return hypothesisId && researchCase.hypotheses.some((hypothesis) => hypothesis.id === hypothesisId) ? hypothesisId : undefined;
}

function reasonForGeneratedCandidate(candidate: GeneratedCandidate): string {
  if (candidate.guideKey?.includes(":review-case-evidence:")) {
    return "Review the least-certain case evidence before relying on it in a conclusion."
  }
  if (candidate.guideKey?.includes(":first-record-search:")) {
    return "The case has a testable hypothesis but no evidence yet, so begin with one bounded record search."
  }
  if (candidate.guideKey?.includes(":compare-case-evidence:")) {
    return "Determine how a named evidence item relates to an unresolved hypothesis without assuming the answer."
  }
  return "Seek independent corroboration before treating the supported hypothesis as resolved."
}

function guideKeySegment(value: string): string {
  return encodeURIComponent(value.trim() || "none");
}
