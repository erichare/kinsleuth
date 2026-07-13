import {
  type CaseListItem,
  type CaseSearchFilters,
  type CaseSearchResult,
  type CaseSearchStats,
  type CaseSortKey,
  type EvidenceQueueItem
} from "../case-search";
import { query } from "../db";
import type { ResearchCase } from "../models";
import { maximumPageSize, type PaginationInput } from "../pagination";
import { ensureWorkspaceSeeded, getArchiveId, type WorkspaceStoreOptions } from "../workspace-store";

// SQL-side case reads for the cases workspace and its API, following the
// people-queries/source-queries template: scoped queries instead of
// materializing the whole workspace, with the in-memory lib/case-search.ts
// contract reproduced exactly (verified by the parity oracle in
// tests/case-queries.test.ts).

// Everything buildCaseSearchText concatenates, in SQL form. The child-table
// text comes from the lateral aggregates below so searches match hypothesis
// statements, evidence details, and task titles like the in-memory haystack.
const searchHaystackSql = `extensions.unaccent(lower(concat_ws(' ',
  c.id, c.title, c.question, c.status, c.privacy, c.focus,
  coalesce(h.hypotheses_text, ''), coalesce(e.evidence_text, ''), coalesce(t.tasks_text, ''))))`;

// Boolean(linkedDnaMatchId) in the in-memory countDnaEvidence treats empty
// strings as unlinked, so NULLIF keeps parity if an empty id ever reaches the
// column.
function dnaLinkedSql(prefix: string): string {
  return `NULLIF(${prefix}linked_dna_match_id, '') IS NOT NULL`;
}

// Two variants per child table: the haystack text is only paid for when
// search terms actually reference it; plain browsing aggregates counts only.
const hypothesesCountSql = "count(*)::int AS hypothesis_count";
const hypothesesSearchLateralSql = `LEFT JOIN LATERAL (
  SELECT ${hypothesesCountSql},
    string_agg(concat_ws(' ', ch.statement, ch.status), ' ') AS hypotheses_text
  FROM hypotheses ch
  WHERE ch.archive_id = c.archive_id AND ch.case_id = c.id
) h ON true`;
const hypothesesCountLateralSql = `LEFT JOIN LATERAL (
  SELECT ${hypothesesCountSql}
  FROM hypotheses ch
  WHERE ch.archive_id = c.archive_id AND ch.case_id = c.id
) h ON true`;

const evidenceCountsSql = `count(*)::int AS evidence_count,
    count(*) FILTER (WHERE ${dnaLinkedSql("ce.")})::int AS dna_evidence_count,
    min(ce.confidence) AS weakest_confidence`;
const evidenceSearchLateralSql = `LEFT JOIN LATERAL (
  SELECT ${evidenceCountsSql},
    string_agg(concat_ws(' ', ce.title, ce.evidence_type, ce.summary, ce.linked_person_id, ce.linked_dna_match_id), ' ') AS evidence_text
  FROM evidence_items ce
  WHERE ce.archive_id = c.archive_id AND ce.case_id = c.id
) e ON true`;
const evidenceCountLateralSql = `LEFT JOIN LATERAL (
  SELECT ${evidenceCountsSql}
  FROM evidence_items ce
  WHERE ce.archive_id = c.archive_id AND ce.case_id = c.id
) e ON true`;

const tasksCountsSql = `count(*)::int AS task_count,
    count(*) FILTER (WHERE ct.status <> 'done')::int AS open_task_count`;
const tasksSearchLateralSql = `LEFT JOIN LATERAL (
  SELECT ${tasksCountsSql},
    string_agg(concat_ws(' ', ct.title, ct.status), ' ') AS tasks_text
  FROM tasks ct
  WHERE ct.archive_id = c.archive_id AND ct.case_id = c.id
) t ON true`;
const tasksCountLateralSql = `LEFT JOIN LATERAL (
  SELECT ${tasksCountsSql}
  FROM tasks ct
  WHERE ct.archive_id = c.archive_id AND ct.case_id = c.id
) t ON true`;

type CaseRow = {
  id: string;
  title: string;
  question: string;
  status: ResearchCase["status"];
  privacy: ResearchCase["privacy"];
  focus: string;
  hypothesis_count: number;
  evidence_count: number;
  dna_evidence_count: number;
  weakest_confidence: string | number | null;
  task_count: number;
  open_task_count: number;
};

type EvidenceQueueRow = {
  id: string;
  case_id: string;
  case_title: string;
  title: string;
  evidence_type: string;
  summary: string;
  confidence: string | number;
  linked_dna_match_id: string | null;
};

export async function searchCasesPageFromDb(
  filters: CaseSearchFilters = {},
  pagination: PaginationInput = { page: 1, pageSize: 25 },
  options: WorkspaceStoreOptions = {}
): Promise<CaseSearchResult> {
  await ensureWorkspaceSeeded(options);
  const archiveId = getArchiveId(options);

  const params: unknown[] = [archiveId];
  const conditions: string[] = ["c.archive_id = $1"];

  if ((filters.status ?? "all") !== "all") {
    params.push(filters.status);
    conditions.push(`c.status = $${params.length}`);
  }
  if ((filters.privacy ?? "all") !== "all") {
    params.push(filters.privacy);
    conditions.push(`c.privacy = $${params.length}`);
  }
  const evidence = filters.evidence ?? "all";
  if (evidence === "dna") {
    conditions.push("e.dna_evidence_count > 0");
  } else if (evidence === "no_evidence") {
    conditions.push("e.evidence_count = 0");
  } else if (evidence === "low_confidence") {
    conditions.push("e.weakest_confidence < 0.5");
  }

  const terms = normalizeSearchTerms(filters.query);
  for (const term of terms) {
    params.push(`%${escapeLikePattern(term)}%`);
    conditions.push(`${searchHaystackSql} ILIKE $${params.length} ESCAPE '\\'`);
  }

  const whereSql = conditions.join(" AND ");
  // The count query only needs the laterals its WHERE clause references: all
  // three when a term can match child text, the evidence one for evidence
  // filters, none for plain browsing. The page query always needs all three
  // for the output counts.
  const countLateralsSql =
    terms.length > 0
      ? `${hypothesesSearchLateralSql}\n${evidenceSearchLateralSql}\n${tasksSearchLateralSql}`
      : evidence !== "all"
        ? evidenceCountLateralSql
        : "";
  const pageLateralsSql =
    terms.length > 0
      ? `${hypothesesSearchLateralSql}\n${evidenceSearchLateralSql}\n${tasksSearchLateralSql}`
      : `${hypothesesCountLateralSql}\n${evidenceCountLateralSql}\n${tasksCountLateralSql}`;

  const [stats, filteredTotal] = await Promise.all([
    loadCaseStats(archiveId, options),
    countFilteredCases(whereSql, countLateralsSql, params, options)
  ]);

  // Same clamping as paginateItems so API consumers see identical paging.
  const pageSize = clampInteger(pagination.pageSize, 1, maximumPageSize);
  const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const page = clampInteger(pagination.page, 1, pageCount);
  const offset = (page - 1) * pageSize;

  const pageResult = await query<CaseRow>(
    `SELECT c.id, c.title, c.question, c.status, c.privacy, c.focus,
       h.hypothesis_count, e.evidence_count, e.dna_evidence_count, e.weakest_confidence,
       t.task_count, t.open_task_count
     FROM research_cases c
     ${pageLateralsSql}
     WHERE ${whereSql}
     ORDER BY ${orderBySql(filters.sort ?? "status")}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset],
    options
  );

  const items = pageResult.rows.map(toListItem);

  return {
    items,
    page,
    pageSize,
    pageCount,
    total: filteredTotal,
    start: items.length === 0 ? 0 : offset + 1,
    end: offset + items.length,
    stats
  };
}

// Cross-case evidence flatten for the review queue: DNA-linked first, then
// weakest confidence, then case title, capped like the in-memory default.
export async function caseEvidenceQueueFromDb(options: WorkspaceStoreOptions = {}, limit = 50): Promise<EvidenceQueueItem[]> {
  await ensureWorkspaceSeeded(options);
  const archiveId = getArchiveId(options);

  // Tie-breaks past the case title mirror the in-memory flatten order: cases
  // in workspace load order (sort_order, title), then each case's evidence in
  // its own load order (sort_order, id).
  const result = await query<EvidenceQueueRow>(
    `SELECT ce.id, ce.case_id, rc.title AS case_title, ce.title, ce.evidence_type,
       ce.summary, ce.confidence, ce.linked_dna_match_id
     FROM evidence_items ce
     JOIN research_cases rc ON rc.archive_id = ce.archive_id AND rc.id = ce.case_id
     WHERE ce.archive_id = $1
     ORDER BY (${dnaLinkedSql("ce.")}) DESC,
       ce.confidence ASC,
       extensions.unaccent(lower(rc.title)) ASC,
       rc.sort_order ASC, rc.title ASC, ce.sort_order ASC, ce.id ASC
     LIMIT $2`,
    [archiveId, clampInteger(limit, 0, maximumPageSize)],
    options
  );

  return result.rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    caseTitle: row.case_title,
    title: row.title,
    type: row.evidence_type,
    summary: row.summary,
    confidence: Number(row.confidence),
    linkedDnaMatchId: row.linked_dna_match_id ?? undefined
  }));
}

async function loadCaseStats(archiveId: string, options: WorkspaceStoreOptions): Promise<CaseSearchStats> {
  // Every evidence_items row belongs to a research_cases row (composite FK),
  // so the archive-wide evidence counts equal summarizeCases' per-case sums.
  const [caseResult, evidenceResult] = await Promise.all([
    query<{ total: number; active: number; planning: number; resolved: number }>(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE status = 'active')::int AS active,
         count(*) FILTER (WHERE status = 'planning')::int AS planning,
         count(*) FILTER (WHERE status = 'resolved')::int AS resolved
       FROM research_cases WHERE archive_id = $1`,
      [archiveId],
      options
    ),
    query<{ evidence_items: number; dna_evidence: number; low_confidence_evidence: number }>(
      `SELECT count(*)::int AS evidence_items,
         count(*) FILTER (WHERE ${dnaLinkedSql("")})::int AS dna_evidence,
         count(*) FILTER (WHERE confidence < 0.5)::int AS low_confidence_evidence
       FROM evidence_items WHERE archive_id = $1`,
      [archiveId],
      options
    )
  ]);

  const cases = caseResult.rows[0];
  const evidence = evidenceResult.rows[0];
  return {
    total: cases.total,
    active: cases.active,
    planning: cases.planning,
    resolved: cases.resolved,
    evidenceItems: evidence.evidence_items,
    dnaEvidence: evidence.dna_evidence,
    lowConfidenceEvidence: evidence.low_confidence_evidence
  };
}

async function countFilteredCases(
  whereSql: string,
  lateralsSql: string,
  params: unknown[],
  options: WorkspaceStoreOptions
): Promise<number> {
  const result = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM research_cases c ${lateralsSql} WHERE ${whereSql}`,
    params,
    options
  );
  return result.rows[0].total;
}

function orderBySql(sort: CaseSortKey): string {
  // Tie-breaks mirror the stable in-memory sort's fallback to workspace load
  // order (sort_order ASC, title ASC); id closes the last theoretical tie.
  const statusRank = "CASE c.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END ASC";
  const titleOrder = "extensions.unaccent(lower(c.title)) ASC";
  const stableOrder = "c.sort_order ASC, c.title ASC, c.id ASC";
  if (sort === "title") {
    return `${titleOrder}, ${stableOrder}`;
  }
  if (sort === "evidence") {
    return `e.evidence_count DESC, ${statusRank}, ${titleOrder}, ${stableOrder}`;
  }
  return `${statusRank}, ${titleOrder}, ${stableOrder}`;
}

// Mirrors the private helpers in lib/case-search.ts.
function normalizeSearchTerms(value?: string): string[] {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function toListItem(row: CaseRow): CaseListItem {
  return {
    id: row.id,
    title: row.title,
    question: row.question,
    status: row.status,
    privacy: row.privacy,
    focus: row.focus,
    hypothesisCount: row.hypothesis_count,
    evidenceCount: row.evidence_count,
    dnaEvidenceCount: row.dna_evidence_count,
    taskCount: row.task_count,
    openTaskCount: row.open_task_count,
    weakestEvidenceConfidence: row.weakest_confidence === null ? undefined : Number(row.weakest_confidence)
  };
}
