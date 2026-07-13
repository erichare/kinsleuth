import { query } from "../db";
import { createDnaConnectionHypothesis } from "../dna";
import {
  maximumDnaPageSize,
  type DnaCaseOption,
  type DnaMatchFilters,
  type DnaSearchResult,
  type DnaSearchStats,
  type ScoredDnaMatch
} from "../dna-search";
import type { DnaConnectionHypothesis, DnaMatch } from "../models";
import type { PaginationInput } from "../pagination";
import { ensureWorkspaceSeeded, getArchiveId, type WorkspaceStoreOptions } from "../workspace-store";
import { mapDnaMatch, mapPersonRow } from "./mappers";

// SQL-side DNA match reads for the triage workspace and its API, following the
// people-queries/source-queries template: scoped queries instead of
// materializing the whole workspace, with the in-memory lib/dna-search.ts
// contract reproduced exactly (verified by the parity oracle in
// tests/dna-queries.test.ts).

// The notes bonus fires exactly when JS notes.trim().length > 0. Postgres's
// \s only covers ASCII whitespace, so the Unicode characters String.trim()
// strips (NBSP, ogham/typographic spaces, line separators, BOM) are listed
// explicitly: this matches any character trim() would keep.
const notesNonWhitespaceSql = `'[^\\t\\n\\v\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]'`;

// lib/dna.ts scoreDnaMatch in SQL form. array_length returns NULL for empty
// arrays, so every list term is coalesced to 0. All addends except the cM term
// are integers and the cM term divides a two-decimal numeric by 5, so the sum
// never lands on a float-representation edge: round() (half away from zero)
// agrees with Math.round (half up) for these non-negative scores.
const scoreSql = `round(LEAST(
  LEAST(d.total_cm / 5, 35)
  + CASE d.tree_status WHEN 'public' THEN 25 WHEN 'partial' THEN 18 WHEN 'private' THEN 5 ELSE 0 END
  + LEAST(coalesce(array_length(d.surnames, 1), 0) * 4, 16)
  + LEAST(coalesce(array_length(d.places, 1), 0) * 3, 12)
  + LEAST(coalesce(array_length(d.shared_matches, 1), 0) * 2, 10)
  + CASE WHEN d.side <> 'unknown' THEN 8 ELSE 0 END
  + CASE WHEN d.notes ~ ${notesNonWhitespaceSql} THEN 4 ELSE 0 END,
  100))::int`;

// Everything buildDnaSearchText concatenates, in SQL form. trim_scale drops
// the numeric columns' stored trailing zeros ("238.00" -> "238") so the text
// matches the JS number rendering in the in-memory haystack; NULL numerics
// drop out of concat_ws just like the filtered undefined values in JS.
const searchHaystackSql = `extensions.unaccent(lower(concat_ws(' ',
  d.id, d.display_name,
  trim_scale(d.total_cm)::text,
  trim_scale(d.longest_segment_cm)::text,
  trim_scale(d.shared_dna_percent)::text,
  d.predicted_relationship, d.side, d.tree_status, d.triage_status,
  array_to_string(d.surnames, ' '), array_to_string(d.places, ' '),
  array_to_string(d.shared_matches, ' '), d.notes, d.ancestry_url)))`;

export async function searchDnaMatchesPageFromDb(
  filters: DnaMatchFilters = {},
  pagination: PaginationInput = { page: 1, pageSize: 25 },
  options: WorkspaceStoreOptions = {}
): Promise<DnaSearchResult> {
  await ensureWorkspaceSeeded(options);
  const archiveId = getArchiveId(options);

  const params: unknown[] = [archiveId];
  const conditions: string[] = ["d.archive_id = $1"];

  if ((filters.status ?? "all") !== "all") {
    params.push(filters.status);
    conditions.push(`d.triage_status = $${params.length}`);
  }
  if ((filters.side ?? "all") !== "all") {
    params.push(filters.side);
    conditions.push(`d.side = $${params.length}`);
  }
  if ((filters.treeStatus ?? "all") !== "all") {
    params.push(filters.treeStatus);
    conditions.push(`d.tree_status = $${params.length}`);
  }
  const helpfulness = filters.helpfulness ?? "all";
  if (helpfulness === "high") {
    conditions.push(`${scoreSql} >= 75`);
  } else if (helpfulness === "medium") {
    conditions.push(`${scoreSql} >= 45 AND ${scoreSql} < 75`);
  } else if (helpfulness === "low") {
    conditions.push(`${scoreSql} < 45`);
  }
  const terms = normalizeSearchTerms(filters.query);
  for (const term of terms) {
    params.push(`%${escapeLikePattern(term)}%`);
    conditions.push(`${searchHaystackSql} ILIKE $${params.length} ESCAPE '\\'`);
  }

  const whereSql = conditions.join(" AND ");

  const [stats, filteredTotal] = await Promise.all([
    loadDnaStats(archiveId, options),
    countFilteredMatches(whereSql, params, options)
  ]);

  // Same clamping as paginateDnaMatches so API consumers see identical paging.
  const pageSize = clampInteger(pagination.pageSize, 1, maximumDnaPageSize);
  const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const page = clampInteger(pagination.page, 1, pageCount);
  const offset = (page - 1) * pageSize;

  const pageResult = await query<Record<string, unknown>>(
    `SELECT d.id, d.display_name, d.total_cm, d.longest_segment_cm, d.shared_dna_percent,
       d.predicted_relationship, d.side, d.tree_status, d.surnames, d.places,
       d.shared_matches, d.notes, d.ancestry_url, d.triage_status,
       ${scoreSql} AS helpfulness_score
     FROM dna_matches d
     WHERE ${whereSql}
     ORDER BY ${orderBySql(filters.sort ?? "helpfulness")}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset],
    options
  );

  const items: ScoredDnaMatch[] = pageResult.rows.map((row) => ({
    ...mapDnaMatch(row),
    helpfulnessScore: Number(row.helpfulness_score)
  }));

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

// Hypotheses compare a match against every person's surname/place columns, so
// this loads the scoped people list once (facts stay unloaded, mirroring the
// loadPeopleForHypotheses precedent in workspace-store) and reuses it for the
// whole page of matches.
export async function createDnaHypothesesForMatches(
  matches: DnaMatch[],
  options: WorkspaceStoreOptions = {}
): Promise<DnaConnectionHypothesis[]> {
  if (matches.length === 0) {
    return [];
  }

  await ensureWorkspaceSeeded(options);
  const archiveId = getArchiveId(options);

  const result = await query<Record<string, unknown>>(
    "SELECT * FROM people WHERE archive_id = $1 ORDER BY sort_order ASC, display_name ASC",
    [archiveId],
    options
  );
  const people = result.rows.map((row) => mapPersonRow(row, []));

  return matches.map((match) => createDnaConnectionHypothesis(match, people));
}

export async function listCaseOptions(options: WorkspaceStoreOptions = {}): Promise<DnaCaseOption[]> {
  await ensureWorkspaceSeeded(options);
  const archiveId = getArchiveId(options);

  // Same ordering as the workspace loader's cases read, so the picker lists
  // cases exactly like the readWorkspace-backed page did.
  const result = await query<{ id: string; title: string }>(
    "SELECT id, title FROM research_cases WHERE archive_id = $1 ORDER BY sort_order ASC, title ASC",
    [archiveId],
    options
  );
  return result.rows.map((row) => ({ id: row.id, title: row.title }));
}

async function loadDnaStats(archiveId: string, options: WorkspaceStoreOptions): Promise<DnaSearchStats> {
  const result = await query<{ total: number; high_priority: number; needs_review: number }>(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE triage_status = 'high_priority')::int AS high_priority,
       count(*) FILTER (WHERE triage_status = 'needs_review')::int AS needs_review
     FROM dna_matches WHERE archive_id = $1`,
    [archiveId],
    options
  );
  const row = result.rows[0];
  return { total: row.total, highPriority: row.high_priority, needsReview: row.needs_review };
}

async function countFilteredMatches(whereSql: string, params: unknown[], options: WorkspaceStoreOptions): Promise<number> {
  const result = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM dna_matches d WHERE ${whereSql}`,
    params,
    options
  );
  return result.rows[0].total;
}

function orderBySql(sort: NonNullable<DnaMatchFilters["sort"]>): string {
  // Tie-breaks mirror the stable in-memory sort's fallback to workspace load
  // order (sort_order ASC, then display_name ASC).
  const nameOrder = "extensions.unaccent(lower(d.display_name)) ASC, d.sort_order ASC, d.display_name ASC, d.id ASC";
  if (sort === "cm") {
    return `d.total_cm DESC, ${nameOrder}`;
  }
  if (sort === "name") {
    return nameOrder;
  }
  return `${scoreSql} DESC, d.total_cm DESC, ${nameOrder}`;
}

// Mirrors the private normalizeSearchValue in lib/dna-search.ts.
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
