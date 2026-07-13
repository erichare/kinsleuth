import { NextResponse } from "next/server";
import {
  type DnaHelpfulnessFilter,
  type DnaSideFilter,
  type DnaSortKey,
  type DnaStatusFilter,
  type DnaTreeFilter
} from "@/lib/dna-search";
import { parsePositiveInteger } from "@/lib/pagination";
import { createDnaHypothesesForMatches, searchDnaMatchesPageFromDb } from "@/lib/store/dna-queries";

export const dynamic = "force-dynamic";

const statusValues = new Set<DnaStatusFilter>(["all", "high_priority", "needs_review", "triaged", "ignored"]);
const sideValues = new Set<DnaSideFilter>(["all", "maternal", "paternal", "both", "unknown"]);
const treeValues = new Set<DnaTreeFilter>(["all", "public", "partial", "private", "none", "unknown"]);
const helpfulnessValues = new Set<DnaHelpfulnessFilter>(["all", "high", "medium", "low"]);
const sortValues = new Set<DnaSortKey>(["helpfulness", "cm", "name"]);

export async function GET(request: Request) {
  const url = new URL(request.url);

  const result = await searchDnaMatchesPageFromDb(
    {
      query: url.searchParams.get("query") ?? "",
      status: parseEnum(url.searchParams.get("status"), statusValues, "all"),
      side: parseEnum(url.searchParams.get("side"), sideValues, "all"),
      treeStatus: parseEnum(url.searchParams.get("treeStatus"), treeValues, "all"),
      helpfulness: parseEnum(url.searchParams.get("helpfulness"), helpfulnessValues, "all"),
      sort: parseEnum(url.searchParams.get("sort"), sortValues, "helpfulness")
    },
    {
      page: parsePositiveInteger(url.searchParams.get("page"), 1),
      pageSize: parsePositiveInteger(url.searchParams.get("pageSize"), 25)
    }
  );
  const hypotheses = await createDnaHypothesesForMatches(result.items);

  return NextResponse.json({ ...result, hypotheses });
}

function parseEnum<T extends string>(value: string | null, allowed: Set<T>, fallback: T): T {
  return value && allowed.has(value as T) ? (value as T) : fallback;
}
