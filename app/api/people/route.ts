import { NextResponse } from "next/server";
import { type PeopleLivingFilter, type PeoplePrivacyFilter, type PeoplePublicationFilter, type PeopleSortKey } from "@/lib/people-search";
import { parsePositiveInteger } from "@/lib/pagination";
import { searchPeoplePageFromDb } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

const publicationValues = new Set<PeoplePublicationFilter>(["all", "published", "unpublished"]);
const privacyValues = new Set<PeoplePrivacyFilter>(["all", "public", "private", "sensitive"]);
const livingValues = new Set<PeopleLivingFilter>(["all", "living", "deceased", "unknown"]);
const sortValues = new Set<PeopleSortKey>(["name", "birth", "death", "facts"]);

export async function GET(request: Request) {
  const url = new URL(request.url);

  return NextResponse.json(
    await searchPeoplePageFromDb(
      {
        query: url.searchParams.get("query") ?? "",
        publication: parseEnum(url.searchParams.get("publication"), publicationValues, "all"),
        privacy: parseEnum(url.searchParams.get("privacy"), privacyValues, "all"),
        livingStatus: parseEnum(url.searchParams.get("livingStatus"), livingValues, "all"),
        sort: parseEnum(url.searchParams.get("sort"), sortValues, "name")
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
