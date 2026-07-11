import { NextResponse } from "next/server";
import { z } from "zod";
import { runAIAnalysis } from "@/lib/ai";
import { createWorkspaceDnaHypotheses, readWorkspace, saveAIAnalysisRun } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const analyzeSchema = z.object({
  role: z.enum(["owner", "admin", "editor", "contributor", "viewer"]).optional(),
  question: z.string().trim().min(1).max(1200),
  caseId: z.string().trim().optional()
});

export async function POST(request: Request) {
  const parsed = analyzeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A research question is required." }, { status: 400 });
  }

  const body = parsed.data;

  try {
    const workspace = await readWorkspace();
    const linkedCaseId = body.caseId && workspace.cases.some((researchCase) => researchCase.id === body.caseId) ? body.caseId : undefined;
    const result = await runAIAnalysis({
      role: body.role ?? "viewer",
      question: body.question,
      selectedCaseId: linkedCaseId,
      people: workspace.people,
      cases: workspace.cases,
      sources: workspace.sources,
      dnaMatches: workspace.dnaMatches,
      dnaHypotheses: createWorkspaceDnaHypotheses(workspace),
      provider: {
        baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY,
        chatModel: process.env.AI_CHAT_MODEL ?? "gpt-5-mini",
        embeddingModel: process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        mode: process.env.AI_API_MODE === "chat" ? "chat" : "responses"
      }
    });
    const run = await saveAIAnalysisRun({
      question: body.question,
      answer: result.answer,
      status: result.status,
      evidenceUsed: result.evidenceUsed,
      uncertainty: result.uncertainty,
      anomalyCount: result.anomalies.length,
      suggestions: result.suggestions,
      contextReferences: result.contextReferences,
      provider: result.provider,
      model: result.model,
      providerStatus: result.providerStatus,
      promptPreview: result.promptPreview,
      error: result.error,
      linkedCaseId
    });

    return NextResponse.json({ ...result, run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI analysis failed";

    if (message.startsWith("Role ") && message.includes("cannot perform")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    if (message.startsWith("Provider returned ")) {
      return NextResponse.json({ error: message }, { status: 502 });
    }

    console.error("AI analysis failed", error);
    return NextResponse.json({ error: "AI analysis failed. Check the server logs for details." }, { status: 500 });
  }
}
