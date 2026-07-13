import type { DnaMatch, DnaSide, DnaTreeStatus } from "./models";
import { paginateItems, type PaginationInput, type PaginationResult } from "./pagination";

export type ScoredDnaMatch = DnaMatch & { helpfulnessScore: number };

export type DnaStatusFilter = "all" | DnaMatch["triageStatus"];
export type DnaSideFilter = "all" | DnaSide;
export type DnaTreeFilter = "all" | DnaTreeStatus;
export type DnaHelpfulnessFilter = "all" | "high" | "medium" | "low";
export type DnaSortKey = "helpfulness" | "cm" | "name";

export type DnaMatchFilters = {
  query?: string;
  status?: DnaStatusFilter;
  side?: DnaSideFilter;
  treeStatus?: DnaTreeFilter;
  helpfulness?: DnaHelpfulnessFilter;
  sort?: DnaSortKey;
};

export type DnaPaginationResult = PaginationResult<ScoredDnaMatch>;

export type DnaSearchStats = {
  total: number;
  highPriority: number;
  needsReview: number;
};

export type DnaSearchResult = DnaPaginationResult & { stats: DnaSearchStats };

// The link-to-case panel only renders a case picker, so it gets id/title pairs
// instead of full ResearchCase objects.
export type DnaCaseOption = {
  id: string;
  title: string;
};

export const maximumDnaPageSize = 250;

export function searchDnaMatchesPage(
  matches: ScoredDnaMatch[],
  filters: DnaMatchFilters = {},
  pagination: PaginationInput = { page: 1, pageSize: 25 }
): DnaSearchResult {
  const filtered = filterDnaMatches(matches, filters);
  const page = paginateDnaMatches(filtered, pagination.page, pagination.pageSize);

  return {
    ...page,
    stats: {
      total: matches.length,
      highPriority: matches.filter((match) => match.triageStatus === "high_priority").length,
      needsReview: matches.filter((match) => match.triageStatus === "needs_review").length
    }
  };
}

export function filterDnaMatches(matches: ScoredDnaMatch[], filters: DnaMatchFilters = {}): ScoredDnaMatch[] {
  const terms = normalizeSearchTerms(filters.query);
  const status = filters.status ?? "all";
  const side = filters.side ?? "all";
  const treeStatus = filters.treeStatus ?? "all";
  const helpfulness = filters.helpfulness ?? "all";
  const sort = filters.sort ?? "helpfulness";

  return matches
    .filter((match) => {
      if (status !== "all" && match.triageStatus !== status) return false;
      if (side !== "all" && match.side !== side) return false;
      if (treeStatus !== "all" && match.treeStatus !== treeStatus) return false;
      if (helpfulness !== "all" && helpfulnessBucket(match.helpfulnessScore) !== helpfulness) return false;

      if (terms.length === 0) {
        return true;
      }

      const searchText = buildDnaSearchText(match);
      return terms.every((term) => searchText.includes(term));
    })
    .sort((left, right) => compareDnaMatches(left, right, sort));
}

export function paginateDnaMatches(matches: ScoredDnaMatch[], page: number, pageSize: number): DnaPaginationResult {
  return paginateItems(matches, { page, pageSize }, maximumDnaPageSize);
}

export function helpfulnessBucket(score: number): "high" | "medium" | "low" {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function buildDnaSearchText(match: DnaMatch): string {
  return normalizeSearchValue(
    [
      match.id,
      match.displayName,
      match.totalCm,
      match.longestSegmentCm,
      match.sharedDnaPercent,
      match.predictedRelationship,
      match.side,
      match.treeStatus,
      match.triageStatus,
      match.surnames.join(" "),
      match.places.join(" "),
      match.sharedMatches.join(" "),
      match.notes,
      match.ancestryUrl
    ]
      .filter((value) => value !== undefined && value !== null)
      .join(" ")
  );
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

function compareDnaMatches(left: ScoredDnaMatch, right: ScoredDnaMatch, sort: DnaSortKey): number {
  if (sort === "cm") {
    return right.totalCm - left.totalCm || compareNames(left, right);
  }

  if (sort === "name") {
    return compareNames(left, right);
  }

  return right.helpfulnessScore - left.helpfulnessScore || right.totalCm - left.totalCm || compareNames(left, right);
}

function compareNames(left: DnaMatch, right: DnaMatch): number {
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
}
