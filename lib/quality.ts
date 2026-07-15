import type { DnaMatch, PersonSummary, ResearchCase } from "./models";
import { findStructuredAnomalies } from "./ai";
import { paginateItems, type PaginationInput, type PaginationResult } from "./pagination";

export type QualityIssue = {
  id: string;
  area: "privacy" | "sources" | "dna" | "cases" | "dates";
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  action: string;
  entityId?: string;
};

export type QualityReport = {
  score: number;
  issues: QualityIssue[];
  summary: {
    high: number;
    medium: number;
    low: number;
    privacyRisks: number;
    sourceGaps: number;
    dnaGaps: number;
    caseGaps: number;
  };
};

export type QualityReportPage = Omit<QualityReport, "issues"> & {
  issues: PaginationResult<QualityIssue>;
};

export type QualityCapabilities = {
  dnaEnabled?: boolean;
};

export function buildQualityReport(
  people: PersonSummary[],
  dnaMatches: DnaMatch[],
  cases: ResearchCase[],
  capabilities: QualityCapabilities = {}
): QualityReport {
  const issues: QualityIssue[] = [];
  const dnaEnabled = capabilities.dnaEnabled ?? true;

  for (const [index, anomaly] of findStructuredAnomalies(people).entries()) {
    issues.push({
      id: `anomaly-${slugify(anomaly.title)}-${index}`,
      area: anomaly.type === "privacy_risk" ? "privacy" : anomaly.type === "date_conflict" ? "dates" : "sources",
      severity: anomaly.severity,
      title: anomaly.title,
      detail: anomaly.evidence.join(" · "),
      action: anomaly.type === "privacy_risk" ? "Unpublish or mark the person private before sharing." : "Review the conflicting or missing evidence."
    });
  }

  for (const match of dnaEnabled ? dnaMatches : []) {
    if (match.totalCm >= 90 && (match.treeStatus === "none" || match.treeStatus === "unknown")) {
      issues.push({
        id: `dna-tree-${match.id}`,
        area: "dna",
        severity: match.totalCm >= 200 ? "high" : "medium",
        title: `${match.displayName} is a meaningful DNA match with no usable tree`,
        detail: `${match.totalCm} cM · ${match.predictedRelationship ?? "relationship unknown"} · ${match.side} side`,
        action: "Request a tree, add notes from shared matches, or mark as temporarily low-value.",
        entityId: match.id
      });
    }

    if (match.side === "unknown" && match.totalCm >= 150) {
      issues.push({
        id: `dna-side-${match.id}`,
        area: "dna",
        severity: "medium",
        title: `${match.displayName} needs maternal/paternal side classification`,
        detail: `${match.totalCm} cM without side hint limits branch prediction.`,
        action: "Use shared matches or known relatives to classify the match.",
        entityId: match.id
      });
    }
  }

  for (const researchCase of cases) {
    if (researchCase.status !== "resolved" && researchCase.evidence.length === 0) {
      issues.push({
        id: `case-evidence-${researchCase.id}`,
        area: "cases",
        severity: "low",
        title: `${researchCase.title} has no linked evidence`,
        detail: researchCase.question,
        action: dnaEnabled
          ? "Add at least one source, DNA match, or research note before relying on the case."
          : "Add at least one source or research note before relying on the case.",
        entityId: researchCase.id
      });
    }

    if (researchCase.hypotheses.length === 0) {
      issues.push({
        id: `case-hypothesis-${researchCase.id}`,
        area: "cases",
        severity: "low",
        title: `${researchCase.title} has no explicit hypothesis`,
        detail: "Cases are easier to resolve when each one has a testable claim.",
        action: "Add a hypothesis that can be supported or weakened by evidence.",
        entityId: researchCase.id
      });
    }
  }

  const high = issues.filter((issue) => issue.severity === "high").length;
  const medium = issues.filter((issue) => issue.severity === "medium").length;
  const low = issues.filter((issue) => issue.severity === "low").length;
  const penalty = high * 12 + medium * 6 + low * 2;

  return {
    score: Math.max(0, Math.min(100, 100 - penalty)),
    issues: issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    summary: {
      high,
      medium,
      low,
      privacyRisks: issues.filter((issue) => issue.area === "privacy").length,
      sourceGaps: issues.filter((issue) => issue.area === "sources").length,
      dnaGaps: issues.filter((issue) => issue.area === "dna").length,
      caseGaps: issues.filter((issue) => issue.area === "cases").length
    }
  };
}

export function paginateQualityReport(report: QualityReport, pagination: PaginationInput): QualityReportPage {
  return {
    ...report,
    issues: paginateItems(report.issues, pagination)
  };
}

export function buildQualityReportPage(
  people: PersonSummary[],
  dnaMatches: DnaMatch[],
  cases: ResearchCase[],
  pagination: PaginationInput,
  capabilities: QualityCapabilities = {}
): QualityReportPage {
  return paginateQualityReport(buildQualityReport(people, dnaMatches, cases, capabilities), pagination);
}

function severityRank(severity: QualityIssue["severity"]): number {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
