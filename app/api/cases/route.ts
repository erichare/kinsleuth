import { NextResponse } from "next/server";
import { z } from "zod";
import {
  projectCaseSearchResultForDnaCapability,
  projectEvidenceQueueForDnaCapability,
  isDnaResearchCase,
  type CaseEvidenceFilter,
  type CasePrivacyFilter,
  type CaseSortKey,
  type CaseStatusFilter
} from "@/lib/case-search";
import { projectCaseApiResponse } from "@/lib/api-case-projection";
import { withPermission } from "@/lib/api-authorization";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { parsePositiveInteger } from "@/lib/pagination";
import { captureOperationalError, emitOperationalEvent } from "@/lib/observability";
import { caseEvidenceQueueFromDb, searchCasesPageFromDb } from "@/lib/store/case-queries";
import { createNewCase } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const statusValues = new Set<CaseStatusFilter>(["all", "active", "planning", "paused", "resolved"]);
const privacyValues = new Set<CasePrivacyFilter>(["all", "public", "private", "sensitive"]);
const evidenceValues = new Set<CaseEvidenceFilter>(["all", "dna", "no_evidence", "low_confidence"]);
const sortValues = new Set<CaseSortKey>(["status", "title", "evidence"]);

const confidenceSchema = z.number().min(0, "Confidence cannot be below zero").max(1, "Confidence cannot exceed one");
const newHypothesisSchema = z
  .object({
    statement: z.string().trim().min(1, "Hypothesis statement is required").max(1200, "Hypothesis statement is too long"),
    confidence: confidenceSchema.optional()
  })
  .strict();
const newEvidenceSchema = z
  .object({
    title: z.string().trim().min(1, "Evidence title is required").max(240, "Evidence title is too long"),
    type: z.string().trim().min(1, "Evidence type is required").max(120, "Evidence type is too long"),
    summary: z.string().trim().min(1, "Evidence summary is required").max(8000, "Evidence summary is too long"),
    confidence: confidenceSchema.optional()
  })
  .strict();
const newCaseSchema = z
  .object({
    title: z.string().trim().min(1, "Case title is required").max(240, "Case title is too long"),
    question: z.string().trim().min(1, "Research question is required").max(2000, "Research question is too long"),
    focus: z.string().trim().max(1200, "Case focus is too long").optional(),
    hypotheses: z.array(newHypothesisSchema).max(20, "A new case can include at most 20 hypotheses").optional(),
    evidence: z.array(newEvidenceSchema).max(50, "A new case can include at most 50 evidence notes").optional()
  })
  .strict();

export const GET = withPermission("cases:read", async (request, authorization) => {
  const url = new URL(request.url);
  const capabilities = resolveHostedCapabilities();
  const queryOptions = {
    archiveId: authorization.archiveId,
    includeDnaEvidence: capabilities.dna
  };

  if (url.searchParams.get("view") === "evidence-queue") {
    const queue = await caseEvidenceQueueFromDb(queryOptions);
    return NextResponse.json(projectEvidenceQueueForDnaCapability(queue, capabilities.dna));
  }

  const requestedEvidence = parseEnum(url.searchParams.get("evidence"), evidenceValues, "all");
  const result = await searchCasesPageFromDb(
      {
        query: url.searchParams.get("query") ?? "",
        status: parseEnum(url.searchParams.get("status"), statusValues, "all"),
        privacy: parseEnum(url.searchParams.get("privacy"), privacyValues, "all"),
        evidence: capabilities.dna || requestedEvidence !== "dna" ? requestedEvidence : "all",
        sort: parseEnum(url.searchParams.get("sort"), sortValues, "status")
      },
      {
        page: parsePositiveInteger(url.searchParams.get("page"), 1),
        pageSize: parsePositiveInteger(url.searchParams.get("pageSize"), 25)
      },
      queryOptions
    );
  return NextResponse.json(projectCaseSearchResultForDnaCapability(result, capabilities.dna));
});

export const POST = withPermission("cases:write", async (request, authorization) => {
  try {
    const body = await readJson(request);
    if (!body.ok) {
      return body.response;
    }
    const parsed = newCaseSchema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid new case" },
        { status: 400 }
      );
    }

    if (
      !resolveHostedCapabilities().dna
      && isDnaResearchCase({
        id: "",
        title: parsed.data.title,
        question: parsed.data.question,
        focus: parsed.data.focus
      })
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const created = await createNewCase(parsed.data, { archiveId: authorization.archiveId });
    await emitOperationalEvent({
      event: "case_created",
      severity: "info",
      requestId: authorization.requestId,
      route: "/api/cases"
    });
    return NextResponse.json(projectCaseApiResponse(created), { status: 201 });
  } catch (error) {
    if (isUniqueConflict(error)) {
      return NextResponse.json(
        { error: "The case could not be created because an identifier already exists" },
        { status: 409 }
      );
    }

    await captureOperationalError({
      event: "api_error",
      requestId: authorization.requestId,
      route: "/api/cases"
    }, error);
    return NextResponse.json({ error: "Unable to create the case" }, { status: 500 });
  }
});

async function readJson(
  request: Request
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request body must be JSON" }, { status: 400 })
    };
  }
}

function isUniqueConflict(error: unknown): boolean {
  return isRecord(error) && error.code === "23505";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEnum<T extends string>(value: string | null, allowed: Set<T>, fallback: T): T {
  return value && allowed.has(value as T) ? (value as T) : fallback;
}
