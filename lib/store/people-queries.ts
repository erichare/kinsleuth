import { query } from "../db";
import type { PersonFact, PersonSummary } from "../models";
import type { PeopleListItem, PeopleSearchFilters, PeopleSearchResult, PeopleSearchStats } from "../people-search";
import { maximumPageSize, type PaginationInput } from "../pagination";
import { canPublishPerson } from "../privacy";
import { ensureWorkspaceSeeded, getArchiveId, type WorkspaceStoreOptions } from "../workspace-store";

// SQL-side people reads for the hot paths (people search, public archive
// pages, shell branding). These run scoped queries instead of materializing
// the whole workspace; readWorkspace remains for surfaces that genuinely need
// everything. Row mapping is self-contained here on purpose.

// Everything the in-memory buildPersonSearchText concatenates, in SQL form.
// extensions.unaccent(lower(...)) approximates the JS NFKD + combining-mark
// strip; search terms are normalized the same way in normalizeSearchTerms.
const searchHaystackSql = `extensions.unaccent(lower(concat_ws(' ',
  p.id, p.slug, p.display_name, p.given_name, p.surname,
  p.birth_date, p.birth_place, p.death_date, p.death_place,
  p.sex, p.living_status, p.privacy, p.notes,
  array_to_string(p.relatives, ' '), coalesce(f.facts_text, ''))))`;

// Two lateral variants: the haystack (with facts_text) is only paid for when
// search terms actually reference it; plain browsing joins the count only.
const factsSearchLateralSql = `LEFT JOIN LATERAL (
  SELECT count(*)::int AS fact_count,
    string_agg(concat_ws(' ', pf.fact_type, pf.date_text, pf.place_text, pf.value_text, pf.source_text), ' ') AS facts_text
  FROM person_facts pf
  WHERE pf.archive_id = p.archive_id AND pf.person_id = p.id
) f ON true`;

const factsCountLateralSql = `LEFT JOIN LATERAL (
  SELECT count(*)::int AS fact_count
  FROM person_facts pf
  WHERE pf.archive_id = p.archive_id AND pf.person_id = p.id
) f ON true`;

type PersonRow = {
  id: string;
  slug: string;
  display_name: string;
  given_name: string | null;
  surname: string | null;
  sex: PersonSummary["sex"] | null;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  death_place: string | null;
  living_status: PersonSummary["livingStatus"];
  privacy: PersonSummary["privacy"];
  published: boolean;
  relatives: string[] | null;
  notes: string | null;
  fact_count?: number;
};

type FactRow = {
  id: string;
  person_id: string;
  fact_type: string;
  date_text: string | null;
  place_text: string | null;
  value_text: string | null;
  source_text: string | null;
  privacy: PersonFact["privacy"] | null;
  confidence: string | number;
};

export async function searchPeoplePageFromDb(
  filters: PeopleSearchFilters = {},
  pagination: PaginationInput = { page: 1, pageSize: 50 },
  options: WorkspaceStoreOptions = {}
): Promise<PeopleSearchResult> {
  await ensureWorkspaceSeeded(options);
  const archiveId = getArchiveId(options);

  const params: unknown[] = [archiveId];
  const conditions: string[] = ["p.archive_id = $1"];

  const publication = filters.publication ?? "all";
  if (publication === "published") {
    conditions.push("p.published");
  } else if (publication === "unpublished") {
    conditions.push("NOT p.published");
  }
  if ((filters.privacy ?? "all") !== "all") {
    params.push(filters.privacy);
    conditions.push(`p.privacy = $${params.length}`);
  }
  if ((filters.livingStatus ?? "all") !== "all") {
    params.push(filters.livingStatus);
    conditions.push(`p.living_status = $${params.length}`);
  }
  const terms = normalizeSearchTerms(filters.query);
  for (const term of terms) {
    params.push(`%${escapeLikePattern(term)}%`);
    conditions.push(`${searchHaystackSql} ILIKE $${params.length} ESCAPE '\\'`);
  }

  const whereSql = conditions.join(" AND ");
  // The count query only needs the facts join when a term can match facts_text.
  const countLateralSql = terms.length > 0 ? factsSearchLateralSql : "";
  const pageLateralSql = terms.length > 0 ? factsSearchLateralSql : factsCountLateralSql;

  const [stats, filteredTotal] = await Promise.all([
    loadPeopleStats(archiveId, options),
    countFilteredPeople(whereSql, countLateralSql, params, options)
  ]);

  // Same clamping as paginateItems so API consumers see identical paging.
  const pageSize = clampInteger(pagination.pageSize, 1, maximumPageSize);
  const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const page = clampInteger(pagination.page, 1, pageCount);
  const offset = (page - 1) * pageSize;

  const pageResult = await query<PersonRow>(
    `SELECT p.id, p.slug, p.display_name, p.surname, p.birth_date, p.birth_place,
       p.death_date, p.death_place, p.living_status, p.privacy, p.published, f.fact_count
     FROM people p
     ${pageLateralSql}
     WHERE ${whereSql}
     ORDER BY ${orderBySql(filters.sort ?? "name")}
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

export async function listPublicPeople(options: WorkspaceStoreOptions = {}): Promise<PersonSummary[]> {
  await ensureWorkspaceSeeded(options);
  const archiveId = getArchiveId(options);

  const peopleResult = await query<PersonRow>(
    "SELECT * FROM people WHERE archive_id = $1 AND published ORDER BY sort_order ASC, display_name ASC",
    [archiveId],
    options
  );
  const publishable = peopleResult.rows.map((row) => mapPerson(row, [])).filter(canPublishPerson);
  if (publishable.length === 0) {
    return [];
  }

  const factsResult = await query<FactRow>(
    "SELECT * FROM person_facts WHERE archive_id = $1 AND person_id = ANY($2) ORDER BY sort_order ASC, id ASC",
    [archiveId, publishable.map((person) => person.id)],
    options
  );
  const factsByPerson = new Map<string, PersonFact[]>();
  for (const row of factsResult.rows) {
    const facts = factsByPerson.get(row.person_id) ?? [];
    factsByPerson.set(row.person_id, [...facts, mapFact(row)]);
  }

  return publishable.map((person) => ({ ...person, facts: factsByPerson.get(person.id) ?? [] }));
}

export async function getPublicPersonBySlug(
  slug: string,
  options: WorkspaceStoreOptions = {}
): Promise<{ person: PersonSummary; publishedRelatives: PersonSummary[] } | undefined> {
  await ensureWorkspaceSeeded(options);
  const archiveId = getArchiveId(options);

  const personResult = await query<PersonRow>(
    "SELECT * FROM people WHERE archive_id = $1 AND slug = $2 AND published LIMIT 1",
    [archiveId, slug],
    options
  );
  const row = personResult.rows[0];
  if (!row) {
    return undefined;
  }

  const withoutFacts = mapPerson(row, []);
  if (!canPublishPerson(withoutFacts)) {
    return undefined;
  }

  const factsResult = await query<FactRow>(
    "SELECT * FROM person_facts WHERE archive_id = $1 AND person_id = $2 ORDER BY sort_order ASC, id ASC",
    [archiveId, withoutFacts.id],
    options
  );
  const person = { ...withoutFacts, facts: factsResult.rows.map(mapFact) };

  // Relative cards only render name and slug, so their facts stay unloaded.
  // Order follows the person's relatives array (import order), matching the
  // previous in-memory rendering.
  let publishedRelatives: PersonSummary[] = [];
  if (person.relatives.length > 0) {
    const relativeRows = await query<PersonRow>(
      "SELECT * FROM people WHERE archive_id = $1 AND id = ANY($2) AND published",
      [archiveId, person.relatives],
      options
    );
    const relativesById = new Map(relativeRows.rows.map((row) => [row.id, mapPerson(row, [])]));
    publishedRelatives = person.relatives
      .map((relativeId) => relativesById.get(relativeId))
      .filter((relative): relative is PersonSummary => Boolean(relative) && canPublishPerson(relative as PersonSummary));
  }

  return { person, publishedRelatives };
}

export async function readArchiveBranding(options: WorkspaceStoreOptions = {}): Promise<{ name: string; tagline: string }> {
  await ensureWorkspaceSeeded(options);
  const archiveId = getArchiveId(options);

  const result = await query<{ name: string; tagline: string }>(
    "SELECT name, tagline FROM archives WHERE id = $1",
    [archiveId],
    options
  );
  return { name: result.rows[0].name, tagline: result.rows[0].tagline };
}

async function loadPeopleStats(archiveId: string, options: WorkspaceStoreOptions): Promise<PeopleSearchStats> {
  const result = await query<{ total: number; published: number; protected: number; living: number }>(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE published)::int AS published,
       count(*) FILTER (WHERE privacy <> 'public')::int AS protected,
       count(*) FILTER (WHERE living_status = 'living')::int AS living
     FROM people WHERE archive_id = $1`,
    [archiveId],
    options
  );
  const row = result.rows[0];
  return { total: row.total, published: row.published, protectedCount: row.protected, living: row.living };
}

async function countFilteredPeople(
  whereSql: string,
  lateralSql: string,
  params: unknown[],
  options: WorkspaceStoreOptions
): Promise<number> {
  const result = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM people p ${lateralSql} WHERE ${whereSql}`,
    params,
    options
  );
  return result.rows[0].total;
}

function orderBySql(sort: NonNullable<PeopleSearchFilters["sort"]>): string {
  // Tie-break mirrors the in-memory implementation, where the stable JS sort
  // falls back to workspace load order (sort_order, then display_name).
  const nameOrder = "extensions.unaccent(lower(p.display_name)) ASC, p.sort_order ASC, p.display_name ASC, p.id ASC";
  if (sort === "facts") {
    return `f.fact_count DESC, ${nameOrder}`;
  }
  // The in-memory sort compared date strings left to right, which ordered by
  // day-of-month before year; sorting on the extracted year is the intended
  // behavior, with undated people last.
  if (sort === "birth") {
    return `(substring(p.birth_date FROM '[0-9]{4}'))::int ASC NULLS LAST, ${nameOrder}`;
  }
  if (sort === "death") {
    return `(substring(p.death_date FROM '[0-9]{4}'))::int ASC NULLS LAST, ${nameOrder}`;
  }
  return nameOrder;
}

// Mirrors the private normalizeSearchValue in lib/people-search.ts.
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

function toListItem(row: PersonRow): PeopleListItem {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    surname: row.surname ?? undefined,
    birthDate: row.birth_date ?? undefined,
    birthPlace: row.birth_place ?? undefined,
    deathDate: row.death_date ?? undefined,
    deathPlace: row.death_place ?? undefined,
    livingStatus: row.living_status,
    privacy: row.privacy,
    published: row.published,
    factCount: row.fact_count ?? 0
  };
}

function mapPerson(row: PersonRow, facts: PersonFact[]): PersonSummary {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    givenName: row.given_name ?? undefined,
    surname: row.surname ?? undefined,
    birthDate: row.birth_date ?? undefined,
    birthPlace: row.birth_place ?? undefined,
    deathDate: row.death_date ?? undefined,
    deathPlace: row.death_place ?? undefined,
    sex: row.sex ?? undefined,
    livingStatus: row.living_status,
    privacy: row.privacy,
    published: row.published,
    facts,
    relatives: row.relatives ?? [],
    notes: row.notes ?? undefined
  };
}

function mapFact(row: FactRow): PersonFact {
  return {
    id: row.id,
    type: row.fact_type,
    date: row.date_text ?? undefined,
    place: row.place_text ?? undefined,
    value: row.value_text ?? undefined,
    source: row.source_text ?? undefined,
    confidence: Number(row.confidence),
    privacy: row.privacy ?? undefined
  };
}
