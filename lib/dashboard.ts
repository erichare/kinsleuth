import type { DnaMatch } from "./models";
import type { WorkspaceData } from "./workspace-store";
import { searchCasesPage, type CaseListItem } from "./case-search";
import { buildPublicationReview, type PublicationBlocker } from "./publishing";
import { buildQualityReportPage, type QualityIssue } from "./quality";
import { scoreDnaMatch } from "./dna";

export type DashboardActionItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: "ok" | "warning" | "private" | "danger";
};

export type DashboardDnaLead = DnaMatch & {
  helpfulnessScore: number;
};

export type DashboardSummary = {
  metrics: {
    people: number;
    sourceDocuments: number;
    sourceReferences: number;
    dnaMatches: number;
    triagedDnaMatches: number;
    highPriorityDnaMatches: number;
    activeCases: number;
  };
  caseRows: CaseListItem[];
  dnaLeads: DashboardDnaLead[];
  actions: DashboardActionItem[];
};

export function buildDashboardSummary(workspace: WorkspaceData, options: { caseLimit?: number; dnaLimit?: number; actionLimit?: number } = {}): DashboardSummary {
  const caseLimit = options.caseLimit ?? 6;
  const dnaLimit = options.dnaLimit ?? 10;
  const actionLimit = options.actionLimit ?? 6;
  const dnaLeads = workspace.dnaMatches
    .map((match) => ({ ...match, helpfulnessScore: scoreDnaMatch(match) }))
    .sort((left, right) => right.helpfulnessScore - left.helpfulnessScore || right.totalCm - left.totalCm)
    .slice(0, dnaLimit);

  return {
    metrics: {
      people: workspace.people.length,
      sourceDocuments: workspace.sources.length,
      sourceReferences: countSourceReferences(workspace),
      dnaMatches: workspace.dnaMatches.length,
      triagedDnaMatches: workspace.dnaMatches.filter((match) => match.triageStatus === "triaged" || match.triageStatus === "high_priority").length,
      highPriorityDnaMatches: workspace.dnaMatches.filter((match) => match.triageStatus === "high_priority").length,
      activeCases: workspace.cases.filter((researchCase) => researchCase.status === "active" || researchCase.status === "planning").length
    },
    caseRows: searchCasesPage(workspace.cases, { sort: "status" }, { page: 1, pageSize: caseLimit }).items,
    dnaLeads,
    actions: buildDashboardActions(workspace).slice(0, actionLimit)
  };
}

function buildDashboardActions(workspace: WorkspaceData): DashboardActionItem[] {
  const qualityReport = buildQualityReportPage(workspace.people, workspace.dnaMatches, workspace.cases, { page: 1, pageSize: 4 });
  const publishingReview = buildPublicationReview(workspace.people, { profilePage: 1, blockerPage: 1, pageSize: 4 });
  const dnaActions = workspace.dnaMatches
    .filter((match) => match.triageStatus === "high_priority" || (match.totalCm >= 150 && match.side === "unknown"))
    .sort((left, right) => right.totalCm - left.totalCm)
    .map<DashboardActionItem>((match) => ({
      id: `dna-${match.id}`,
      title: `${match.displayName} needs DNA follow-up`,
      detail: `${match.totalCm} cM · ${match.treeStatus} tree · ${match.side} side`,
      href: "/app/dna",
      tone: match.triageStatus === "high_priority" ? "warning" : "private"
    }));

  return [
    ...qualityReport.issues.items.map(actionFromQualityIssue),
    ...publishingReview.blockers.items.map(actionFromPublicationBlocker),
    ...dnaActions
  ].sort((left, right) => toneRank(right.tone) - toneRank(left.tone));
}

function actionFromQualityIssue(issue: QualityIssue): DashboardActionItem {
  return {
    id: `quality-${issue.id}`,
    title: issue.title,
    detail: issue.action,
    href: issue.area === "dna" ? "/app/dna" : issue.area === "cases" ? "/app/cases" : "/app/reports",
    tone: issue.severity === "high" ? "danger" : issue.severity === "medium" ? "warning" : "private"
  };
}

function actionFromPublicationBlocker(blocker: PublicationBlocker): DashboardActionItem {
  return {
    id: `publishing-${blocker.id}`,
    title: `${blocker.personName}: ${blocker.title}`,
    detail: blocker.action,
    href: `/app/people/${encodeURIComponent(blocker.personId)}`,
    tone: "danger"
  };
}

export function countSourceReferences(workspace: WorkspaceData): number {
  const factSourceCount = workspace.people.reduce((count, person) => count + person.facts.filter((fact) => fact.source?.trim()).length, 0);
  return factSourceCount + workspace.sources.length;
}

function toneRank(tone: DashboardActionItem["tone"]): number {
  if (tone === "danger") return 4;
  if (tone === "warning") return 3;
  if (tone === "private") return 2;
  return 1;
}
