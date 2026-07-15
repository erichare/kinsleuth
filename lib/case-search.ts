import type { PrivacyLevel, ResearchCase } from "./models";
import { paginateItems, type PaginationInput, type PaginationResult } from "./pagination";

export type CaseStatusFilter = "all" | ResearchCase["status"];
export type CasePrivacyFilter = "all" | PrivacyLevel;
export type CaseEvidenceFilter = "all" | "dna" | "no_evidence" | "low_confidence";
export type CaseSortKey = "status" | "title" | "evidence";

export type CaseSearchFilters = {
  query?: string;
  status?: CaseStatusFilter;
  privacy?: CasePrivacyFilter;
  evidence?: CaseEvidenceFilter;
  sort?: CaseSortKey;
};

export type CaseListItem = {
  id: string;
  title: string;
  question: string;
  status: ResearchCase["status"];
  privacy: PrivacyLevel;
  focus: string;
  hypothesisCount: number;
  evidenceCount: number;
  dnaEvidenceCount: number;
  taskCount: number;
  openTaskCount: number;
  weakestEvidenceConfidence?: number;
};

export type CaseSearchStats = {
  total: number;
  active: number;
  planning: number;
  resolved: number;
  evidenceItems: number;
  dnaEvidence: number;
  lowConfidenceEvidence: number;
};

export type CaseSearchResult = PaginationResult<CaseListItem> & {
  stats: CaseSearchStats;
};

export type EvidenceQueueItem = {
  id: string;
  caseId: string;
  caseTitle: string;
  title: string;
  type: string;
  summary: string;
  confidence: number;
  linkedDnaMatchId?: string;
};

type DnaEvidenceCandidate = {
  type: string;
  linkedDnaMatchId?: string;
};

type DnaResearchCaseCandidate = {
  id?: unknown;
  title?: unknown;
  question?: unknown;
  focus?: unknown;
};

export function isDnaEvidence(evidence: DnaEvidenceCandidate): boolean {
  return Boolean(evidence.linkedDnaMatchId) || /^dna(?:\s|$)/i.test(evidence.type.trim());
}

export function isDnaResearchCase(researchCase: DnaResearchCaseCandidate): boolean {
  return hasDnaMarker(
    researchCase.id,
    researchCase.title,
    researchCase.question,
    researchCase.focus
  );
}

export function projectResearchCaseForDnaCapability(
  researchCase: ResearchCase,
  dnaEnabled: boolean
): ResearchCase {
  if (dnaEnabled) {
    return researchCase;
  }

  const hiddenEvidenceIds = new Set(
    researchCase.evidence.filter(isDnaEvidence).map((item) => item.id)
  );
  const hiddenHypothesisIds = new Set<string>();
  const hiddenTaskIds = new Set<string>();

  for (const hypothesis of researchCase.hypotheses) {
    if (hypothesisContainsDna(hypothesis, hiddenEvidenceIds)) {
      hiddenHypothesisIds.add(hypothesis.id);
    }
  }
  for (const task of researchCase.tasks) {
    if (taskContainsDna(task, hiddenEvidenceIds, hiddenHypothesisIds, hiddenTaskIds)) {
      hiddenTaskIds.add(task.id);
    }
  }

  // References can form a graph: a DNA task can target a hypothesis whose
  // statement is neutral, and another task can reference that hypothesis.
  // Close the graph before serializing any IDs or guide state.
  let changed = true;
  while (changed) {
    changed = false;

    for (const task of researchCase.tasks) {
      if (
        !hiddenTaskIds.has(task.id)
        && taskContainsDna(task, hiddenEvidenceIds, hiddenHypothesisIds, hiddenTaskIds)
      ) {
        hiddenTaskIds.add(task.id);
        changed = true;
      }
    }

    for (const hypothesis of researchCase.hypotheses) {
      if (hiddenHypothesisIds.has(hypothesis.id)) {
        continue;
      }
      const referencedByHiddenTask = researchCase.tasks.some((task) =>
        hiddenTaskIds.has(task.id)
        && (
          task.targetHypothesisId === hypothesis.id
          || task.contextRefs?.some((reference) => (
            reference.type === "hypothesis" && reference.id === hypothesis.id
          ))
        )
      );
      if (
        referencedByHiddenTask
        || hypothesisContainsDna(
          hypothesis,
          hiddenEvidenceIds,
          hiddenHypothesisIds,
          hiddenTaskIds
        )
      ) {
        hiddenHypothesisIds.add(hypothesis.id);
        changed = true;
      }
    }
  }

  const evidenceIds = new Set(
    researchCase.evidence
      .filter((item) => !hiddenEvidenceIds.has(item.id))
      .map((item) => item.id)
  );
  const hypothesisIds = new Set(
    researchCase.hypotheses
      .filter((item) => !hiddenHypothesisIds.has(item.id))
      .map((item) => item.id)
  );
  const taskIds = new Set(
    researchCase.tasks
      .filter((item) => !hiddenTaskIds.has(item.id))
      .map((item) => item.id)
  );
  const visibleReference = (reference: ResearchReferenceCandidate): boolean => {
    if (reference.type === "case") return reference.id === researchCase.id;
    if (reference.type === "evidence") return evidenceIds.has(reference.id);
    if (reference.type === "hypothesis") return hypothesisIds.has(reference.id);
    if (reference.type === "task") return taskIds.has(reference.id);
    return false;
  };

  return {
    ...researchCase,
    evidence: researchCase.evidence.filter((item) => evidenceIds.has(item.id)),
    hypotheses: researchCase.hypotheses
      .filter((item) => hypothesisIds.has(item.id))
      .map((hypothesis) => ({
        ...hypothesis,
        ...(hypothesis.decisions
          ? {
              decisions: hypothesis.decisions.map((decision) => ({
                ...decision,
                contextRefs: decision.contextRefs.filter(visibleReference)
              }))
            }
          : {})
      })),
    tasks: researchCase.tasks
      .filter((item) => taskIds.has(item.id))
      .map((task) => ({
        ...task,
        ...(task.contextRefs
          ? { contextRefs: task.contextRefs.filter(visibleReference) }
          : {}),
        targetHypothesisId: task.targetHypothesisId && hypothesisIds.has(task.targetHypothesisId)
          ? task.targetHypothesisId
          : undefined
      }))
  };
}

export function projectCaseResponseForDnaCapability(
  value: unknown,
  dnaEnabled: boolean
): unknown {
  if (dnaEnabled) {
    return value;
  }
  if (isResearchCase(value)) {
    if (isDnaResearchCase(value)) {
      return null;
    }
    return projectResearchCaseForDnaCapability(value, false);
  }
  if (!isRecord(value) || !isResearchCase(value.case)) {
    return value;
  }

  if (isDnaResearchCase(value.case)) {
    return null;
  }

  const projectedCase = projectResearchCaseForDnaCapability(value.case, false);
  const response: Record<string, unknown> = { ...value, case: projectedCase };
  projectResponseEntity(response, "evidence", projectedCase.evidence);
  projectResponseEntity(response, "hypothesis", projectedCase.hypotheses);
  projectResponseEntity(response, "task", projectedCase.tasks);
  return response;
}

type ResearchReferenceCandidate = {
  type: string;
  id: string;
};

function hypothesisContainsDna(
  hypothesis: ResearchCase["hypotheses"][number],
  hiddenEvidenceIds: Set<string>,
  hiddenHypothesisIds: Set<string> = new Set(),
  hiddenTaskIds: Set<string> = new Set()
): boolean {
  return hasDnaMarker(hypothesis.id, hypothesis.statement)
    || (hypothesis.decisions ?? []).some((decision) => (
      hasDnaMarker(decision.id, decision.statement, decision.reason)
      || decision.contextRefs.some((reference) => referenceTargetsHidden(
        reference,
        hiddenEvidenceIds,
        hiddenHypothesisIds,
        hiddenTaskIds
      ))
    ));
}

function taskContainsDna(
  task: ResearchCase["tasks"][number],
  hiddenEvidenceIds: Set<string>,
  hiddenHypothesisIds: Set<string>,
  hiddenTaskIds: Set<string>
): boolean {
  const outcomeText = (task.outcomes ?? []).flatMap((outcome) => [
    outcome.id,
    outcome.note,
    outcome.searchScope?.repository,
    outcome.searchScope?.collection,
    outcome.searchScope?.place,
    outcome.searchScope?.dateRange,
    outcome.searchScope?.query
  ]);
  const hiddenIds = [
    ...hiddenEvidenceIds,
    ...hiddenHypothesisIds,
    ...hiddenTaskIds
  ];
  return hasDnaMarker(
    task.id,
    task.title,
    task.guidance,
    task.guideKey,
    task.workFingerprint,
    ...outcomeText
  )
    || Boolean(task.targetHypothesisId && hiddenHypothesisIds.has(task.targetHypothesisId))
    || (task.contextRefs ?? []).some((reference) => referenceTargetsHidden(
      reference,
      hiddenEvidenceIds,
      hiddenHypothesisIds,
      hiddenTaskIds
    ))
    || [task.guideKey, task.workFingerprint].some((value) => (
      typeof value === "string" && hiddenIds.some((id) => value.includes(id))
    ));
}

function referenceTargetsHidden(
  reference: ResearchReferenceCandidate,
  hiddenEvidenceIds: Set<string>,
  hiddenHypothesisIds: Set<string>,
  hiddenTaskIds: Set<string>
): boolean {
  return (reference.type === "evidence" && hiddenEvidenceIds.has(reference.id))
    || (reference.type === "hypothesis" && hiddenHypothesisIds.has(reference.id))
    || (reference.type === "task" && hiddenTaskIds.has(reference.id));
}

function hasDnaMarker(...values: unknown[]): boolean {
  return values.some((value) => (
    typeof value === "string" && /(?:^|[^a-z0-9])dna(?:[^a-z0-9]|$)/i.test(value)
  ));
}

function isResearchCase(value: unknown): value is ResearchCase {
  return isRecord(value)
    && typeof value.id === "string"
    && Array.isArray(value.hypotheses)
    && Array.isArray(value.evidence)
    && Array.isArray(value.tasks);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectResponseEntity(
  response: Record<string, unknown>,
  key: "evidence" | "hypothesis" | "task",
  visible: Array<{ id: string }>
): void {
  if (!(key in response)) {
    return;
  }
  const entity = response[key];
  const id = isRecord(entity) && typeof entity.id === "string" ? entity.id : undefined;
  const projected = id ? visible.find((item) => item.id === id) : undefined;
  if (projected) {
    response[key] = projected;
  } else {
    delete response[key];
  }
}

export function projectCaseSearchResultForDnaCapability(
  result: CaseSearchResult,
  dnaEnabled: boolean
): CaseSearchResult {
  if (dnaEnabled) {
    return result;
  }

  const hiddenCases = result.items.filter(isDnaResearchCase);
  const visibleItems = result.items.filter((item) => !isDnaResearchCase(item));
  const hiddenCaseCount = hiddenCases.length;
  const hiddenCaseEvidenceCount = hiddenCases.reduce(
    (count, item) => count + item.evidenceCount,
    0
  );
  const hiddenCaseDnaEvidenceCount = hiddenCases.reduce(
    (count, item) => count + item.dnaEvidenceCount,
    0
  );
  const visibleDnaEvidenceCount = Math.max(
    0,
    result.stats.dnaEvidence - hiddenCaseDnaEvidenceCount
  );
  const total = Math.max(0, result.total - hiddenCaseCount);
  const pageCount = Math.max(1, Math.ceil(total / result.pageSize));
  const start = visibleItems.length === 0 ? 0 : Math.min(result.start, total);

  return {
    ...result,
    items: visibleItems.map((item) => {
      const hiddenEvidenceCount = Math.min(item.evidenceCount, item.dnaEvidenceCount);
      return {
        ...item,
        // A list aggregate cannot prove which task or hypothesis depends on
        // disabled evidence. Full-case projections keep exact visible child
        // records; list responses fail closed instead of leaking their count.
        hypothesisCount: 0,
        taskCount: 0,
        openTaskCount: 0,
        evidenceCount: item.evidenceCount - hiddenEvidenceCount,
        dnaEvidenceCount: 0,
        // The aggregate does not identify which evidence supplied the minimum.
        // Fail closed until the capability-aware SQL query supplies a safe value.
        weakestEvidenceConfidence: hiddenEvidenceCount > 0
          ? undefined
          : item.weakestEvidenceConfidence
      };
    }),
    total,
    pageCount,
    start,
    end: visibleItems.length === 0 ? 0 : start + visibleItems.length - 1,
    stats: {
      ...result.stats,
      total: Math.max(0, result.stats.total - hiddenCaseCount),
      active: Math.max(
        0,
        result.stats.active - hiddenCases.filter((item) => item.status === "active").length
      ),
      planning: Math.max(
        0,
        result.stats.planning - hiddenCases.filter((item) => item.status === "planning").length
      ),
      resolved: Math.max(
        0,
        result.stats.resolved - hiddenCases.filter((item) => item.status === "resolved").length
      ),
      evidenceItems: Math.max(
        0,
        result.stats.evidenceItems
          - visibleDnaEvidenceCount
          - hiddenCaseEvidenceCount
      ),
      dnaEvidence: 0,
      // The aggregate may include disabled evidence. Capability-aware database
      // reads retain the exact documentary count; this fallback avoids leakage.
      lowConfidenceEvidence: result.stats.dnaEvidence > 0 || hiddenCaseCount > 0
        ? 0
        : result.stats.lowConfidenceEvidence
    }
  };
}

export function projectEvidenceQueueForDnaCapability(
  queue: EvidenceQueueItem[],
  dnaEnabled: boolean
): EvidenceQueueItem[] {
  return dnaEnabled
    ? queue
    : queue.filter((item) => !isDnaEvidence(item) && !isDnaResearchCase({
        id: item.caseId,
        title: item.caseTitle
      }));
}

export function searchCasesPage(cases: ResearchCase[], filters: CaseSearchFilters = {}, pagination: PaginationInput = { page: 1, pageSize: 25 }): CaseSearchResult {
  const filteredCases = filterCases(cases, filters);
  const page = paginateItems(filteredCases, pagination);

  return {
    ...page,
    items: page.items.map(toCaseListItem),
    stats: summarizeCases(cases)
  };
}

export function filterCases(cases: ResearchCase[], filters: CaseSearchFilters = {}): ResearchCase[] {
  const terms = normalizeSearchTerms(filters.query);
  const status = filters.status ?? "all";
  const privacy = filters.privacy ?? "all";
  const evidence = filters.evidence ?? "all";
  const sort = filters.sort ?? "status";

  return cases
    .filter((researchCase) => {
      if (status !== "all" && researchCase.status !== status) return false;
      if (privacy !== "all" && researchCase.privacy !== privacy) return false;
      if (evidence === "dna" && countDnaEvidence(researchCase) === 0) return false;
      if (evidence === "no_evidence" && researchCase.evidence.length > 0) return false;
      if (evidence === "low_confidence" && !researchCase.evidence.some((item) => item.confidence < 0.5)) return false;

      if (terms.length === 0) {
        return true;
      }

      const searchText = buildCaseSearchText(researchCase);
      return terms.every((term) => searchText.includes(term));
    })
    .sort((left, right) => compareCases(left, right, sort));
}

export function summarizeCases(cases: ResearchCase[]): CaseSearchStats {
  return cases.reduce<CaseSearchStats>(
    (stats, researchCase) => {
      const dnaEvidence = countDnaEvidence(researchCase);
      const lowConfidenceEvidence = researchCase.evidence.filter((evidence) => evidence.confidence < 0.5).length;

      stats.total += 1;
      stats.active += researchCase.status === "active" ? 1 : 0;
      stats.planning += researchCase.status === "planning" ? 1 : 0;
      stats.resolved += researchCase.status === "resolved" ? 1 : 0;
      stats.evidenceItems += researchCase.evidence.length;
      stats.dnaEvidence += dnaEvidence;
      stats.lowConfidenceEvidence += lowConfidenceEvidence;
      return stats;
    },
    {
      total: 0,
      active: 0,
      planning: 0,
      resolved: 0,
      evidenceItems: 0,
      dnaEvidence: 0,
      lowConfidenceEvidence: 0
    }
  );
}

export function caseEvidenceQueue(cases: ResearchCase[], limit = 50): EvidenceQueueItem[] {
  return cases
    .flatMap((researchCase) =>
      researchCase.evidence.map((evidence) => ({
        ...evidence,
        caseId: researchCase.id,
        caseTitle: researchCase.title
      }))
    )
    .sort((left, right) => {
      const dnaDelta = Number(isDnaEvidence(right)) - Number(isDnaEvidence(left));
      const confidenceDelta = left.confidence - right.confidence;
      return dnaDelta || confidenceDelta || left.caseTitle.localeCompare(right.caseTitle, undefined, { sensitivity: "base" });
    })
    .slice(0, limit);
}

export function toCaseListItem(researchCase: ResearchCase): CaseListItem {
  return {
    id: researchCase.id,
    title: researchCase.title,
    question: researchCase.question,
    status: researchCase.status,
    privacy: researchCase.privacy,
    focus: researchCase.focus,
    hypothesisCount: researchCase.hypotheses.length,
    evidenceCount: researchCase.evidence.length,
    dnaEvidenceCount: countDnaEvidence(researchCase),
    taskCount: researchCase.tasks.length,
    openTaskCount: researchCase.tasks.filter((task) => task.status !== "done").length,
    weakestEvidenceConfidence: weakestEvidenceConfidence(researchCase)
  };
}

function buildCaseSearchText(researchCase: ResearchCase): string {
  return normalizeSearchValue(
    [
      researchCase.id,
      researchCase.title,
      researchCase.question,
      researchCase.status,
      researchCase.privacy,
      researchCase.focus,
      researchCase.hypotheses.map(buildHypothesisSearchText).join(" "),
      researchCase.evidence.map((evidence) => [evidence.title, evidence.type, evidence.summary, evidence.linkedPersonId, evidence.linkedDnaMatchId].filter(Boolean).join(" ")).join(" "),
      researchCase.tasks.map(buildTaskSearchText).join(" ")
    ].join(" ")
  );
}

function buildHypothesisSearchText(hypothesis: ResearchCase["hypotheses"][number]): string {
  const decisionsText = (hypothesis.decisions ?? [])
    .map((decision) => [decision.reason, decision.statement].join(" "))
    .join(" ");

  return [hypothesis.statement, hypothesis.status, decisionsText].join(" ");
}

function buildTaskSearchText(task: ResearchCase["tasks"][number]): string {
  const outcomesText = (task.outcomes ?? [])
    .map((outcome) => [outcome.note, outcome.searchScope ? JSON.stringify(outcome.searchScope) : ""].join(" "))
    .join(" ");

  return [task.title, task.status, task.guidance, task.workFingerprint, outcomesText].filter(Boolean).join(" ");
}

function compareCases(left: ResearchCase, right: ResearchCase, sort: CaseSortKey): number {
  if (sort === "title") {
    return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
  }

  if (sort === "evidence") {
    return right.evidence.length - left.evidence.length || compareCaseStatus(left, right);
  }

  return compareCaseStatus(left, right);
}

function compareCaseStatus(left: ResearchCase, right: ResearchCase): number {
  return statusRank(left.status) - statusRank(right.status) || left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
}

function statusRank(status: ResearchCase["status"]): number {
  if (status === "active") return 0;
  if (status === "planning") return 1;
  if (status === "paused") return 2;
  return 3;
}

function countDnaEvidence(researchCase: ResearchCase): number {
  return researchCase.evidence.filter(isDnaEvidence).length;
}

function weakestEvidenceConfidence(researchCase: ResearchCase): number | undefined {
  if (researchCase.evidence.length === 0) {
    return undefined;
  }

  return Math.min(...researchCase.evidence.map((evidence) => evidence.confidence));
}

function normalizeSearchTerms(query?: string): string[] {
  return normalizeSearchValue(query ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}
