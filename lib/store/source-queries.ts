import { query } from "../db";
import { maximumPageSize, type PaginationInput } from "../pagination";
import type {
  CaseLinkOption,
  PersonLinkOption,
  SourceListItem,
  SourceSearchFilters,
  SourceSearchResult,
  SourceSearchStats
} from "../source-search";
import { ensureWorkspaceProvisioned, getArchiveId, type WorkspaceStoreOptions } from "../workspace-store";
import { dnaResearchCaseSql } from "./case-capability-sql";

// SQL-side source reads for the sources workspace and its API, following the
// people-queries template: scoped queries instead of materializing the whole
// workspace, with the in-memory lib/source-search.ts contract reproduced
// exactly (verified by the parity oracle in tests/source-queries.test.ts).

// Everything buildSourceSearchText concatenates, in SQL form. The linked
// person name and case title join in so searches match them, exactly like the
// in-memory lookups.
function searchHaystackSql(includeBinaryMetadata: boolean): string {
  return `extensions.unaccent(lower(concat_ws(' ',
  s.id, s.title, s.source_type, s.repository, ${includeBinaryMetadata ? "s.file_name," : ""} s.citation_date,
  s.url, s.ancestry_apid, s.linked_person_id, pp.display_name,
  s.linked_case_id, rc.title, s.transcript, s.notes, s.privacy)))`;
}

const linkJoinsSql = `LEFT JOIN people pp ON pp.archive_id = s.archive_id AND pp.id = s.linked_person_id
  LEFT JOIN research_cases rc ON rc.archive_id = s.archive_id AND rc.id = s.linked_case_id`;

// Boolean(linkedPersonId) in the in-memory filter treats empty strings as
// unlinked, so NULLIF keeps parity if an empty id ever reaches the column.
function linkedExprSql(prefix: string): string {
  return `(NULLIF(${prefix}linked_person_id, '') IS NOT NULL OR NULLIF(${prefix}linked_case_id, '') IS NOT NULL)`;
}
const linkedSql = linkedExprSql("s.");

type SourceRow = {
  id: string;
  title: string;
  source_type: string;
  repository: string | null;
  file_name: string | null;
  citation_date: string | null;
  linked_person_id: string | null;
  linked_person_name: string | null;
  linked_case_id: string | null;
  linked_case_title: string | null;
  transcript: string | null;
  notes: string | null;
  privacy: SourceListItem["privacy"];
  confidence: string | number;
  created_at: Date;
};

export type SourceQueryOptions = WorkspaceStoreOptions & {
  includeBinaryMetadata?: boolean;
  includeDnaCases?: boolean;
};

export async function searchSourcesPageFromDb(
  filters: SourceSearchFilters = {},
  pagination: PaginationInput = { page: 1, pageSize: 50 },
  options: SourceQueryOptions = {}
): Promise<SourceSearchResult> {
  await ensureWorkspaceProvisioned(options);
  const archiveId = getArchiveId(options);
  const includeBinaryMetadata = options.includeBinaryMetadata ?? true;

  const params: unknown[] = [archiveId];
  const conditions: string[] = ["s.archive_id = $1"];

  if ((filters.privacy ?? "all") !== "all") {
    params.push(filters.privacy);
    conditions.push(`s.privacy = $${params.length}`);
  }
  const sourceType = filters.sourceType?.trim() || "all";
  if (sourceType !== "all") {
    params.push(sourceType);
    conditions.push(`s.source_type = $${params.length}`);
  }
  const linkStatus = filters.linkStatus ?? "all";
  if (linkStatus === "linked") {
    conditions.push(linkedSql);
  } else if (linkStatus === "unlinked") {
    conditions.push(`NOT ${linkedSql}`);
  } else if (linkStatus === "person") {
    conditions.push("NULLIF(s.linked_person_id, '') IS NOT NULL");
  } else if (linkStatus === "case") {
    conditions.push("NULLIF(s.linked_case_id, '') IS NOT NULL");
  }

  const terms = normalizeSearchTerms(filters.query);
  for (const term of terms) {
    params.push(`%${escapeLikePattern(term)}%`);
    conditions.push(`${searchHaystackSql(includeBinaryMetadata)} ILIKE $${params.length} ESCAPE '\\'`);
  }

  const whereSql = conditions.join(" AND ");
  // The link joins only matter to the count when a term can match the joined
  // names; the page query always needs them for the output columns.
  const countJoinsSql = terms.length > 0 ? linkJoinsSql : "";

  const [stats, types, filteredTotal] = await Promise.all([
    loadSourceStats(archiveId, options),
    loadSourceTypes(archiveId, options),
    countFilteredSources(whereSql, countJoinsSql, params, options)
  ]);

  const pageSize = clampInteger(pagination.pageSize, 1, maximumPageSize);
  const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const page = clampInteger(pagination.page, 1, pageCount);
  const offset = (page - 1) * pageSize;

  const pageResult = await query<SourceRow>(
    `SELECT s.id, s.title, s.source_type, s.repository, s.file_name, s.citation_date,
       s.linked_person_id, pp.display_name AS linked_person_name,
       s.linked_case_id, rc.title AS linked_case_title,
       s.transcript, s.notes, s.privacy, s.confidence, s.created_at
     FROM sources s
     ${linkJoinsSql}
     WHERE ${whereSql}
     ORDER BY ${orderBySql(filters.sort ?? "created")}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset],
    options
  );

  const items = pageResult.rows.map((row) => toListItem(row, includeBinaryMetadata));

  return {
    items,
    page,
    pageSize,
    pageCount,
    total: filteredTotal,
    start: items.length === 0 ? 0 : offset + 1,
    end: offset + items.length,
    stats,
    types
  };
}

export async function listPersonLinkOptions(options: WorkspaceStoreOptions = {}, limit = 30): Promise<PersonLinkOption[]> {
  await ensureWorkspaceProvisioned(options);
  const archiveId = getArchiveId(options);

  const result = await query<{ id: string; display_name: string; slug: string; birth_date: string | null; birth_place: string | null }>(
    `SELECT p.id, p.display_name, p.slug, p.birth_date, p.birth_place
     FROM people p
     WHERE p.archive_id = $1
     ORDER BY
       EXISTS (
         SELECT 1 FROM sources s
         WHERE s.archive_id = p.archive_id AND s.linked_person_id = p.id
       ) DESC,
       p.published DESC,
       extensions.unaccent(lower(p.display_name)) ASC,
       p.sort_order ASC, p.display_name ASC, p.id ASC
     LIMIT $2`,
    [archiveId, limit],
    options
  );

  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    detail: [row.birth_date, row.birth_place].filter(Boolean).join(" · ") || row.slug
  }));
}

export async function listCaseLinkOptions(options: SourceQueryOptions = {}, limit = 100): Promise<CaseLinkOption[]> {
  await ensureWorkspaceProvisioned(options);
  const archiveId = getArchiveId(options);
  const caseCapabilityPredicate = (options.includeDnaCases ?? true)
    ? ""
    : ` AND NOT (${dnaResearchCaseSql("")})`;

  const result = await query<{ id: string; title: string }>(
    `SELECT id, title FROM research_cases
     WHERE archive_id = $1${caseCapabilityPredicate}
     ORDER BY extensions.unaccent(lower(title)) ASC, sort_order ASC, title ASC, id ASC
     LIMIT $2`,
    [archiveId, limit],
    options
  );

  return result.rows.map((row) => ({ id: row.id, title: row.title }));
}

async function loadSourceStats(archiveId: string, options: WorkspaceStoreOptions): Promise<SourceSearchStats> {
  const result = await query<{ total: number; linked: number; public_count: number; transcripts: number }>(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE ${linkedExprSql("")})::int AS linked,
       count(*) FILTER (WHERE privacy = 'public')::int AS public_count,
       count(*) FILTER (WHERE transcript ~ '\\S')::int AS transcripts
     FROM sources WHERE archive_id = $1`,
    [archiveId],
    options
  );
  const row = result.rows[0];
  return {
    total: row.total,
    linked: row.linked,
    unlinked: row.total - row.linked,
    publicCount: row.public_count,
    protectedCount: row.total - row.public_count,
    transcripts: row.transcripts
  };
}

async function loadSourceTypes(archiveId: string, options: WorkspaceStoreOptions): Promise<string[]> {
  const result = await query<{ source_type: string }>(
    `SELECT DISTINCT source_type FROM sources
     WHERE archive_id = $1 AND source_type IS NOT NULL AND source_type <> ''
     ORDER BY source_type`,
    [archiveId],
    options
  );
  return result.rows
    .map((row) => row.source_type)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

async function countFilteredSources(
  whereSql: string,
  joinsSql: string,
  params: unknown[],
  options: WorkspaceStoreOptions
): Promise<number> {
  const result = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM sources s ${joinsSql} WHERE ${whereSql}`,
    params,
    options
  );
  return result.rows[0].total;
}

function orderBySql(sort: NonNullable<SourceSearchFilters["sort"]>): string {
  // Tie-breaks mirror the stable in-memory sort's fallback to workspace load
  // order (sort_order ASC, created_at DESC, title ASC).
  const titleOrder = "extensions.unaccent(lower(s.title)) ASC";
  const stableOrder = "s.sort_order ASC, s.id ASC";
  // The in-memory title compare has no createdAt awareness; ties fall
  // straight through to the stable load-order fallback.
  if (sort === "title") {
    return `${titleOrder}, ${stableOrder}`;
  }
  if (sort === "confidence") {
    return `s.confidence DESC, s.created_at DESC, ${titleOrder}, ${stableOrder}`;
  }
  return `s.created_at DESC, ${titleOrder}, ${stableOrder}`;
}

// Mirrors the private helpers in lib/source-search.ts.
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

function excerpt(value: string | null, maxLength = 180): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}...` : normalized;
}

function toListItem(row: SourceRow, includeBinaryMetadata: boolean): SourceListItem {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    repository: row.repository ?? undefined,
    fileName: includeBinaryMetadata ? row.file_name ?? undefined : undefined,
    citationDate: row.citation_date ?? undefined,
    linkedPersonId: row.linked_person_id ?? undefined,
    linkedPersonName: row.linked_person_name ?? undefined,
    linkedCaseId: row.linked_case_id ?? undefined,
    linkedCaseTitle: row.linked_case_title ?? undefined,
    privacy: row.privacy,
    confidence: Number(row.confidence),
    createdAt: row.created_at.toISOString(),
    transcriptPreview: excerpt(row.transcript),
    notesPreview: excerpt(row.notes)
  };
}
