import { NextResponse } from "next/server";
import { z } from "zod";

import { runAIAnalysis, type AIAnalysisResult } from "@/lib/ai";
import { withDemoGuestCapability } from "@/lib/api-authorization";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import {
  publicDemoAiLimits,
  publicDemoAiPrompts
} from "@/lib/public-demo-ai-policy";
import { publicDemoGuidedCaseId } from "@/lib/public-demo-contract";
import {
  completePublicDemoAiAttempt,
  recordPublicDemoEvent,
  reservePublicDemoAiAttempt
} from "@/lib/public-demo-session-store";
import {
  createWorkspaceDnaHypotheses,
  readWorkspace,
  saveAIAnalysisRun
} from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

const requestSchema = z.object({
  caseId: z.literal(publicDemoGuidedCaseId),
  questionId: z.enum([
    "case_next_steps",
    "evidence_gaps",
    "dna_cluster_summary"
  ])
}).strict();

export const POST = withDemoGuestCapability("demo:ai", async (request, authorization) => {
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return privateJson({ error: "Choose one of the curated demo questions." }, 400);
  }

  const archiveOptions = { archiveId: authorization.archiveId };
  const workspace = await readWorkspace(archiveOptions);
  const selectedCase = workspace.cases.find(({ id }) => id === parsed.data.caseId);
  const guidedTask = selectedCase?.tasks.find(({ id }) => id === "task-compare-signatures");
  if (!selectedCase || guidedTask?.status !== "done" || !guidedTask.outcomes?.length) {
    return privateJson({ error: "Complete the guided signature outcome before trying AI." }, 409);
  }

  let reservation: Awaited<ReturnType<typeof reservePublicDemoAiAttempt>>;
  try {
    reservation = await reservePublicDemoAiAttempt({
      sessionId: authorization.sessionId,
      promptId: parsed.data.questionId
    });
  } catch (error) {
    return aiLimitResponse(error);
  }

  await recordPublicDemoEvent({
    eventName: "ai_attempted",
    sessionId: authorization.sessionId
  });

  const capabilities = resolveHostedCapabilities();
  let result: AIAnalysisResult;
  try {
    result = await runAIAnalysis({
      role: "owner",
      question: publicDemoAiPrompts[parsed.data.questionId],
      selectedCaseId: selectedCase.id,
      people: workspace.people,
      cases: workspace.cases,
      sources: workspace.sources,
      dnaMatches: capabilities.dna ? workspace.dnaMatches : [],
      dnaHypotheses: capabilities.dna ? createWorkspaceDnaHypotheses(workspace) : [],
      provider: {
        baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: capabilities.externalAi
          ? process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY
          : undefined,
        chatModel: process.env.AI_CHAT_MODEL ?? "gpt-5-mini",
        embeddingModel: process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        maximumOutputTokens: publicDemoAiLimits.maximumOutputTokens,
        mode: process.env.AI_API_MODE === "chat" ? "chat" : "responses",
        timeoutMs: publicDemoAiLimits.timeoutMs
      }
    });
  } catch {
    await completePublicDemoAiAttempt({
      attemptId: reservation.attemptId,
      outcome: "failed"
    });
    return privateJson({
      analysis: deterministicUnavailableAnalysis(),
      remainingAiAttempts: reservation.remaining
    });
  }

  const fallback = result.providerStatus !== "completed";
  const uncertainty = fallback
    ? [
        "External AI was unavailable, so this is a deterministic analysis of the fictional sandbox.",
        "Treat every suggestion as a research lead rather than a conclusion."
      ]
    : result.uncertainty;
  const safeResult = {
    anomalies: result.anomalies,
    answer: result.answer,
    contextReferences: result.contextReferences,
    evidenceUsed: result.evidenceUsed,
    fallback,
    label: fallback ? "Deterministic demo analysis" : "Curated external AI analysis",
    suggestions: result.suggestions,
    uncertainty
  };

  try {
    await saveAIAnalysisRun({
      question: publicDemoAiPrompts[parsed.data.questionId],
      answer: result.answer,
      status: result.status,
      evidenceUsed: result.evidenceUsed,
      uncertainty,
      anomalyCount: result.anomalies.length,
      suggestions: result.suggestions,
      contextReferences: result.contextReferences,
      provider: fallback ? "local" : result.provider,
      model: fallback ? "deterministic" : result.model,
      providerStatus: result.providerStatus,
      promptPreview: `Curated public demo prompt: ${parsed.data.questionId}`,
      linkedCaseId: selectedCase.id
    }, archiveOptions);
  } catch {
    // The attempt is intentionally still consumed. The visitor can use the
    // safe in-memory result even if disposable history persistence fails.
  }

  await completePublicDemoAiAttempt({
    attemptId: reservation.attemptId,
    outcome: fallback ? "failed" : "completed"
  });

  return privateJson({
    analysis: safeResult,
    remainingAiAttempts: reservation.remaining
  });
});

function aiLimitResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "";
  const retryAfter = /daily/i.test(message) ? 3600 : /concurrency/i.test(message) ? 5 : 0;
  return privateJson(
    { error: "The curated AI demo limit has been reached." },
    429,
    { "retry-after": String(retryAfter) }
  );
}

function deterministicUnavailableAnalysis() {
  return {
    anomalies: [],
    answer: "The external analysis was unavailable. Compare the two fictional signatures, verify the surname variant in the bounded ledger, and keep the identity hypothesis open until an independent record corroborates it.",
    contextReferences: [],
    evidenceUsed: [],
    fallback: true,
    label: "Deterministic demo analysis",
    suggestions: [],
    uncertainty: [
      "External AI was unavailable, so this is a deterministic analysis of the fictional sandbox.",
      "Treat every suggestion as a research lead rather than a conclusion."
    ]
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function privateJson(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
      ...headers
    }
  });
}
