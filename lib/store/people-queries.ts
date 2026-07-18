import type { PoolClient } from "pg";
import type { PersonFact, PersonSummary } from "../models";
import type { PeopleListItem, PeopleSearchFilters, PeopleSearchResult, PeopleSearchStats } from "../people-search";
import { maximumPageSize, type PaginationInput } from "../pagination";
import { withWorkspaceReadTransaction, type WorkspaceStoreOptions } from "../workspace-store";

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

// The page variants project aliases from the same per-person fact scan that
// supplies fact counts. The filtered-count variant omits both projections so
// an alias list is not built just to count matching people.
const factsSearchLateralSql = `LEFT JOIN LATERAL (
  SELECT count(*)::int AS fact_count,
    string_agg(concat_ws(' ', pf.fact_type, pf.date_text, pf.place_text, pf.value_text, pf.source_text), ' ') AS facts_text,
    array_agg(btrim(pf.value_text) ORDER BY pf.sort_order) FILTER (
      WHERE upper(btrim(pf.fact_type)) = 'NAME' AND nullif(btrim(pf.value_text), '') IS NOT NULL
    ) AS aliases
  FROM person_facts pf
  WHERE pf.archive_id = p.archive_id AND pf.person_id = p.id
) f ON true`;

const factsSearchCountLateralSql = `LEFT JOIN LATERAL (
  SELECT string_agg(concat_ws(' ', pf.fact_type, pf.date_text, pf.place_text, pf.value_text, pf.source_text), ' ') AS facts_text
  FROM person_facts pf
  WHERE pf.archive_id = p.archive_id AND pf.person_id = p.id
) f ON true`;

const factsCountLateralSql = `LEFT JOIN LATERAL (
  SELECT count(*)::int AS fact_count,
    array_agg(btrim(pf.value_text) ORDER BY pf.sort_order) FILTER (
      WHERE upper(btrim(pf.fact_type)) = 'NAME' AND nullif(btrim(pf.value_text), '') IS NOT NULL
    ) AS aliases
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
  fact_count?: number;
  aliases?: string[] | null;
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

export type PublicPlaceProjection = {
  name: string;
  referenceCount: number;
  personNames: string[];
};

type PublicPlaceRow = {
  name: string;
  reference_count: number;
  person_names: string[];
};

export async function searchPeoplePageFromDb(
  filters: PeopleSearchFilters = {},
  pagination: PaginationInput = { page: 1, pageSize: 50 },
  options: WorkspaceStoreOptions = {}
): Promise<PeopleSearchResult> {
  return withWorkspaceReadTransaction(options, async (client, archiveId) => {
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
    const countLateralSql = terms.length > 0 ? factsSearchCountLateralSql : "";
    const pageLateralSql = terms.length > 0 ? factsSearchLateralSql : factsCountLateralSql;

    const [stats, filteredTotal] = await Promise.all([
      loadPeopleStats(client, archiveId),
      countFilteredPeople(client, whereSql, countLateralSql, params)
    ]);

    // Same clamping as paginateItems so API consumers see identical paging.
    const pageSize = clampInteger(pagination.pageSize, 1, maximumPageSize);
    const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize));
    const page = clampInteger(pagination.page, 1, pageCount);
    const offset = (page - 1) * pageSize;

    const pageResult = await client.query<PersonRow>(
      `SELECT p.id, p.slug, p.display_name, p.surname, p.birth_date, p.birth_place,
         p.death_date, p.death_place, p.living_status, p.privacy, p.published, f.fact_count, f.aliases
       FROM people p
       ${pageLateralSql}
       WHERE ${whereSql}
       ORDER BY ${orderBySql(filters.sort ?? "name")}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
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
  });
}

export async function listPublicPeople(
  options: WorkspaceStoreOptions & { archiveId: string }
): Promise<PersonSummary[]> {
  requireExplicitArchiveId(options);

  return withWorkspaceReadTransaction(options, async (client, archiveId) => {
    const peopleResult = await client.query<PersonRow>(
      `SELECT p.id, p.slug, p.display_name, p.given_name, p.surname, p.sex,
         p.birth_date, p.birth_place, p.death_date, p.death_place,
         p.living_status, p.privacy, p.published, ARRAY[]::text[] AS relatives
       FROM people p
       WHERE p.archive_id = $1
         AND p.published
         AND p.privacy = 'public'
         AND p.living_status = 'deceased'
       ORDER BY p.sort_order ASC, p.display_name ASC`,
      [archiveId]
    );
    const publishable = peopleResult.rows.map((row) => mapPerson(row, []));
    if (publishable.length === 0) {
      return [];
    }

    const factsResult = await client.query<FactRow>(
      `SELECT pf.id, pf.person_id, pf.fact_type, pf.date_text, pf.place_text,
         pf.value_text, pf.source_text, pf.privacy, pf.confidence
       FROM person_facts pf
       WHERE pf.archive_id = $1
         AND pf.person_id = ANY($2)
         AND pf.privacy = 'public'
       ORDER BY pf.sort_order ASC, pf.id ASC`,
      [archiveId, publishable.map((person) => person.id)]
    );
    const factsByPerson = new Map<string, PersonFact[]>();
    for (const row of factsResult.rows) {
      const facts = factsByPerson.get(row.person_id) ?? [];
      factsByPerson.set(row.person_id, [...facts, mapFact(row)]);
    }

    return publishable.map((person) => ({ ...person, facts: factsByPerson.get(person.id) ?? [] }));
  });
}

export async function getPublicPersonBySlug(
  slug: string,
  options: WorkspaceStoreOptions & { archiveId: string }
): Promise<{ person: PersonSummary; publishedRelatives: PersonSummary[] } | undefined> {
  requireExplicitArchiveId(options);

  return withWorkspaceReadTransaction(options, async (client, archiveId) => {
    const personResult = await client.query<PersonRow>(
      `SELECT p.id, p.slug, p.display_name, p.given_name, p.surname, p.sex,
         p.birth_date, p.birth_place, p.death_date, p.death_place,
         p.living_status, p.privacy, p.published, ARRAY[]::text[] AS relatives
       FROM people p
       WHERE p.archive_id = $1
         AND p.slug = $2
         AND p.published
         AND p.privacy = 'public'
         AND p.living_status = 'deceased'
       LIMIT 1`,
      [archiveId, slug]
    );
    const row = personResult.rows[0];
    if (!row) {
      return undefined;
    }

    const withoutFacts = mapPerson(row, []);

    const factsResult = await client.query<FactRow>(
      `SELECT pf.id, pf.person_id, pf.fact_type, pf.date_text, pf.place_text,
         pf.value_text, pf.source_text, pf.privacy, pf.confidence
       FROM person_facts pf
       WHERE pf.archive_id = $1
         AND pf.person_id = $2
         AND pf.privacy = 'public'
       ORDER BY pf.sort_order ASC, pf.id ASC`,
      [archiveId, withoutFacts.id]
    );
    const relativeRows = await client.query<PersonRow>(
      `SELECT relative_person.id, relative_person.slug, relative_person.display_name, relative_person.given_name,
         relative_person.surname, relative_person.sex, relative_person.birth_date, relative_person.birth_place,
         relative_person.death_date, relative_person.death_place, relative_person.living_status,
         relative_person.privacy, relative_person.published, ARRAY[]::text[] AS relatives
       FROM people subject
       CROSS JOIN LATERAL unnest(subject.relatives) WITH ORDINALITY AS link(relative_id, position)
       JOIN people relative_person
         ON relative_person.archive_id = subject.archive_id
        AND relative_person.id = link.relative_id
       WHERE subject.archive_id = $1
         AND subject.id = $2
         AND relative_person.published
         AND relative_person.privacy = 'public'
         AND relative_person.living_status = 'deceased'
       ORDER BY link.position ASC`,
      [archiveId, withoutFacts.id]
    );
    const publishedRelatives = relativeRows.rows.map((relative) => mapPerson(relative, []));
    const person = {
      ...withoutFacts,
      facts: factsResult.rows.map(mapFact),
      relatives: publishedRelatives.map((relative) => relative.id)
    };

    return { person, publishedRelatives };
  });
}

export async function listPublicPlaces(
  options: WorkspaceStoreOptions & { archiveId: string }
): Promise<PublicPlaceProjection[]> {
  requireExplicitArchiveId(options);

  return withWorkspaceReadTransaction(options, async (client, archiveId) => {
    const result = await client.query<PublicPlaceRow>(
      `SELECT pf.place_text AS name,
         count(*)::int AS reference_count,
         array_agg(DISTINCT p.display_name ORDER BY p.display_name) AS person_names
       FROM people p
       JOIN person_facts pf
         ON pf.archive_id = p.archive_id
        AND pf.person_id = p.id
       WHERE p.archive_id = $1
         AND p.published
         AND p.privacy = 'public'
         AND p.living_status = 'deceased'
         AND pf.privacy = 'public'
         AND nullif(btrim(pf.place_text), '') IS NOT NULL
       GROUP BY pf.place_text
       ORDER BY pf.place_text ASC`,
      [archiveId]
    );

    return result.rows.map((row) => ({
      name: row.name,
      referenceCount: row.reference_count,
      personNames: row.person_names
    }));
  });
}

export async function readArchiveBranding(
  options: WorkspaceStoreOptions & { archiveId: string }
): Promise<{ name: string; tagline: string }> {
  requireExplicitArchiveId(options);

  return withWorkspaceReadTransaction(options, async (client, archiveId) => {
    const result = await client.query<{ name: string; tagline: string }>(
      "SELECT name, tagline FROM archives WHERE id = $1",
      [archiveId]
    );
    return { name: result.rows[0].name, tagline: result.rows[0].tagline };
  });
}

async function loadPeopleStats(client: PoolClient, archiveId: string): Promise<PeopleSearchStats> {
  const result = await client.query<{ total: number; published: number; protected: number; living: number }>(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE published)::int AS published,
       count(*) FILTER (WHERE privacy <> 'public')::int AS protected,
       count(*) FILTER (WHERE living_status = 'living')::int AS living
     FROM people WHERE archive_id = $1`,
    [archiveId]
  );
  const row = result.rows[0];
  return { total: row.total, published: row.published, protectedCount: row.protected, living: row.living };
}

async function countFilteredPeople(
  client: PoolClient,
  whereSql: string,
  lateralSql: string,
  params: unknown[]
): Promise<number> {
  const result = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM people p ${lateralSql} WHERE ${whereSql}`,
    params
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
    aliases: normalizeAliases(row.aliases ?? [], row.display_name),
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

function normalizeAliases(values: string[], displayName: string): string[] {
  const displayNameKey = normalizeAliasKey(displayName);
  const aliases = new Map<string, string>();

  for (const value of values) {
    const alias = value.trim();
    const key = normalizeAliasKey(alias);
    if (!alias || !key || key === displayNameKey || aliases.has(key)) {
      continue;
    }
    aliases.set(key, alias);
  }

  return [...aliases.values()];
}

function normalizeAliasKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
    relatives: row.relatives ?? []
  };
}

function requireExplicitArchiveId(options: WorkspaceStoreOptions & { archiveId: string }): string {
  const archiveId = options.archiveId?.trim();
  if (!archiveId) {
    throw new Error("Public archive queries require an explicit archiveId.");
  }
  return archiveId;
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
