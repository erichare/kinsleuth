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
      const dnaDelta = Number(Boolean(right.linkedDnaMatchId)) - Number(Boolean(left.linkedDnaMatchId));
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
  return researchCase.evidence.filter((evidence) => evidence.linkedDnaMatchId).length;
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
