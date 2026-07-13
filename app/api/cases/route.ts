import { NextResponse } from "next/server";
import {
  type CaseEvidenceFilter,
  type CasePrivacyFilter,
  type CaseSortKey,
  type CaseStatusFilter
} from "@/lib/case-search";
import type { ResearchCase } from "@/lib/models";
import { parsePositiveInteger } from "@/lib/pagination";
import { caseEvidenceQueueFromDb, searchCasesPageFromDb } from "@/lib/store/case-queries";
import { createCase } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const statusValues = new Set<CaseStatusFilter>(["all", "active", "planning", "paused", "resolved"]);
const privacyValues = new Set<CasePrivacyFilter>(["all", "public", "private", "sensitive"]);
const evidenceValues = new Set<CaseEvidenceFilter>(["all", "dna", "no_evidence", "low_confidence"]);
const sortValues = new Set<CaseSortKey>(["status", "title", "evidence"]);

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("view") === "evidence-queue") {
    return NextResponse.json(await caseEvidenceQueueFromDb());
  }

  return NextResponse.json(
    await searchCasesPageFromDb(
      {
        query: url.searchParams.get("query") ?? "",
        status: parseEnum(url.searchParams.get("status"), statusValues, "all"),
        privacy: parseEnum(url.searchParams.get("privacy"), privacyValues, "all"),
        evidence: parseEnum(url.searchParams.get("evidence"), evidenceValues, "all"),
        sort: parseEnum(url.searchParams.get("sort"), sortValues, "status")
      },
      {
        page: parsePositiveInteger(url.searchParams.get("page"), 1),
        pageSize: parsePositiveInteger(url.searchParams.get("pageSize"), 25)
      }
    )
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ResearchCase>;

  try {
    return NextResponse.json(await createCase(body), { status: 201 });
  } catch {
    return NextResponse.json({ error: "title and question are required" }, { status: 400 });
  }
}

function parseEnum<T extends string>(value: string | null, allowed: Set<T>, fallback: T): T {
  return value && allowed.has(value as T) ? (value as T) : fallback;
}
