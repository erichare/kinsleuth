import type { PersonSummary, PrivacyLevel, ResearchCase, SourceDocument } from "./models";
import { paginateItems, type PaginationInput, type PaginationResult } from "./pagination";

export type SourcePrivacyFilter = "all" | PrivacyLevel;
export type SourceLinkFilter = "all" | "linked" | "unlinked" | "person" | "case";
export type SourceSortKey = "created" | "title" | "confidence";

export type SourceSearchFilters = {
  query?: string;
  privacy?: SourcePrivacyFilter;
  sourceType?: string;
  linkStatus?: SourceLinkFilter;
  sort?: SourceSortKey;
};

export type SourceListItem = {
  id: string;
  title: string;
  sourceType: string;
  repository?: string;
  fileName?: string;
  citationDate?: string;
  linkedPersonId?: string;
  linkedPersonName?: string;
  linkedCaseId?: string;
  linkedCaseTitle?: string;
  privacy: PrivacyLevel;
  confidence: number;
  createdAt: string;
  transcriptPreview?: string;
  notesPreview?: string;
};

export type SourceSearchStats = {
  total: number;
  linked: number;
  unlinked: number;
  publicCount: number;
  protectedCount: number;
  transcripts: number;
};

export type SourceSearchResult = PaginationResult<SourceListItem> & {
  stats: SourceSearchStats;
  types: string[];
};

export type PersonLinkOption = {
  id: string;
  displayName: string;
  detail: string;
};

export type CaseLinkOption = {
  id: string;
  title: string;
};

type SourceLookups = {
  peopleById: Map<string, string>;
  casesById: Map<string, string>;
};

export function searchSourcesPage(
  sources: SourceDocument[],
  people: PersonSummary[],
  cases: ResearchCase[],
  filters: SourceSearchFilters = {},
  pagination: PaginationInput = { page: 1, pageSize: 50 }
): SourceSearchResult {
  const lookups = createSourceLookups(people, cases);
  const filteredSources = filterSources(sources, filters, lookups);
  const page = paginateItems(filteredSources, pagination);

  return {
    ...page,
    items: page.items.map((source) => toSourceListItem(source, lookups)),
    stats: summarizeSources(sources),
    types: sourceTypes(sources)
  };
}

export function filterSources(sources: SourceDocument[], filters: SourceSearchFilters = {}, lookups: SourceLookups = createSourceLookups([], [])): SourceDocument[] {
  const terms = normalizeSearchTerms(filters.query);
  const privacy = filters.privacy ?? "all";
  const sourceType = filters.sourceType?.trim() || "all";
  const linkStatus = filters.linkStatus ?? "all";
  const sort = filters.sort ?? "created";

  return sources
    .filter((source) => {
      if (privacy !== "all" && source.privacy !== privacy) return false;
      if (sourceType !== "all" && source.sourceType !== sourceType) return false;
      if (linkStatus === "linked" && !isLinked(source)) return false;
      if (linkStatus === "unlinked" && isLinked(source)) return false;
      if (linkStatus === "person" && !source.linkedPersonId) return false;
      if (linkStatus === "case" && !source.linkedCaseId) return false;

      if (terms.length === 0) {
        return true;
      }

      const searchText = buildSourceSearchText(source, lookups);
      return terms.every((term) => searchText.includes(term));
    })
    .sort((left, right) => compareSources(left, right, sort));
}

export function summarizeSources(sources: SourceDocument[]): SourceSearchStats {
  return sources.reduce<SourceSearchStats>(
    (stats, source) => {
      const linked = isLinked(source);

      stats.total += 1;
      stats.linked += linked ? 1 : 0;
      stats.unlinked += linked ? 0 : 1;
      stats.publicCount += source.privacy === "public" ? 1 : 0;
      stats.protectedCount += source.privacy !== "public" ? 1 : 0;
      stats.transcripts += source.transcript?.trim() ? 1 : 0;
      return stats;
    },
    {
      total: 0,
      linked: 0,
      unlinked: 0,
      publicCount: 0,
      protectedCount: 0,
      transcripts: 0
    }
  );
}

export function buildPersonLinkOptions(people: PersonSummary[], sources: SourceDocument[] = [], limit = 30): PersonLinkOption[] {
  const linkedPersonIds = new Set(sources.flatMap((source) => (source.linkedPersonId ? [source.linkedPersonId] : [])));
  const sortedPeople = [...people].sort((left, right) => {
    const linkedDelta = Number(linkedPersonIds.has(right.id)) - Number(linkedPersonIds.has(left.id));
    const publishedDelta = Number(right.published) - Number(left.published);
    return linkedDelta || publishedDelta || left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
  });

  return sortedPeople.slice(0, limit).map(toPersonLinkOption);
}

export function buildCaseLinkOptions(cases: ResearchCase[], limit = 100): CaseLinkOption[] {
  return [...cases]
    .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }))
    .slice(0, limit)
    .map((researchCase) => ({
      id: researchCase.id,
      title: researchCase.title
    }));
}

export function toPersonLinkOption(person: PersonSummary): PersonLinkOption {
  return {
    id: person.id,
    displayName: person.displayName,
    detail: [person.birthDate, person.birthPlace].filter(Boolean).join(" · ") || person.slug
  };
}

function toSourceListItem(source: SourceDocument, lookups: SourceLookups): SourceListItem {
  return {
    id: source.id,
    title: source.title,
    sourceType: source.sourceType,
    repository: source.repository,
    fileName: source.fileName,
    citationDate: source.citationDate,
    linkedPersonId: source.linkedPersonId,
    linkedPersonName: source.linkedPersonId ? lookups.peopleById.get(source.linkedPersonId) : undefined,
    linkedCaseId: source.linkedCaseId,
    linkedCaseTitle: source.linkedCaseId ? lookups.casesById.get(source.linkedCaseId) : undefined,
    privacy: source.privacy,
    confidence: source.confidence,
    createdAt: source.createdAt,
    transcriptPreview: excerpt(source.transcript),
    notesPreview: excerpt(source.notes)
  };
}

function sourceTypes(sources: SourceDocument[]): string[] {
  return Array.from(new Set(sources.map((source) => source.sourceType).filter(Boolean))).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

function createSourceLookups(people: PersonSummary[], cases: ResearchCase[]): SourceLookups {
  return {
    peopleById: new Map(people.map((person) => [person.id, person.displayName])),
    casesById: new Map(cases.map((researchCase) => [researchCase.id, researchCase.title]))
  };
}

function buildSourceSearchText(source: SourceDocument, lookups: SourceLookups): string {
  return normalizeSearchValue(
    [
      source.id,
      source.title,
      source.sourceType,
      source.repository,
      source.fileName,
      source.citationDate,
      source.url,
      source.ancestryApid,
      source.linkedPersonId,
      source.linkedPersonId ? lookups.peopleById.get(source.linkedPersonId) : undefined,
      source.linkedCaseId,
      source.linkedCaseId ? lookups.casesById.get(source.linkedCaseId) : undefined,
      source.transcript,
      source.notes,
      source.privacy
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function compareSources(left: SourceDocument, right: SourceDocument, sort: SourceSortKey): number {
  if (sort === "title") {
    return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
  }

  if (sort === "confidence") {
    return right.confidence - left.confidence || compareCreatedAt(left, right);
  }

  return compareCreatedAt(left, right);
}

function compareCreatedAt(left: SourceDocument, right: SourceDocument): number {
  return compareNullableStrings(right.createdAt, left.createdAt) || left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
}

function compareNullableStrings(left?: string, right?: string): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function isLinked(source: SourceDocument): boolean {
  return Boolean(source.linkedPersonId || source.linkedCaseId);
}

function excerpt(value?: string, maxLength = 180): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}...` : normalized;
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
