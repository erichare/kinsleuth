import { NextResponse } from "next/server";
import { parsePositiveInteger } from "@/lib/pagination";
import { type SourceLinkFilter, type SourcePrivacyFilter, type SourceSortKey } from "@/lib/source-search";
import { searchSourcesPageFromDb } from "@/lib/store/source-queries";

export const dynamic = "force-dynamic";

const privacyValues = new Set<SourcePrivacyFilter>(["all", "public", "private", "sensitive"]);
const linkValues = new Set<SourceLinkFilter>(["all", "linked", "unlinked", "person", "case"]);
const sortValues = new Set<SourceSortKey>(["created", "title", "confidence"]);

export async function GET(request: Request) {
  const url = new URL(request.url);

  return NextResponse.json(
    await searchSourcesPageFromDb(
      {
        query: url.searchParams.get("query") ?? "",
        privacy: parseEnum(url.searchParams.get("privacy"), privacyValues, "all"),
        sourceType: url.searchParams.get("sourceType") ?? "all",
        linkStatus: parseEnum(url.searchParams.get("linkStatus"), linkValues, "all"),
        sort: parseEnum(url.searchParams.get("sort"), sortValues, "created")
      },
      {
        page: parsePositiveInteger(url.searchParams.get("page"), 1),
        pageSize: parsePositiveInteger(url.searchParams.get("pageSize"), 50)
      }
    )
  );
}

function parseEnum<T extends string>(value: string | null, allowed: Set<T>, fallback: T): T {
  return value && allowed.has(value as T) ? (value as T) : fallback;
}
