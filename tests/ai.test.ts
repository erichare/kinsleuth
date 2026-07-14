import { describe, expect, it } from "vitest";
import { findStructuredAnomalies, runAIAnalysis } from "@/lib/ai";
import { demoCases, demoDnaHypotheses, demoDnaMatches, demoPeople } from "@/lib/demo-data";

const baseRequest = {
  question: "What connects this branch?",
  people: demoPeople,
  cases: demoCases,
  sources: [],
  dnaMatches: demoDnaMatches,
  dnaHypotheses: demoDnaHypotheses
};

describe("AI analysis", () => {
  it("finds structured anomalies without an AI provider", () => {
    const anomalies = findStructuredAnomalies([
      {
        ...demoPeople[0],
        deathDate: "1910",
        birthDate: "1920"
      }
    ]);

    expect(anomalies.some((anomaly) => anomaly.type === "date_conflict")).toBe(true);
  });

  it("flags published people without confirmed death evidence as privacy risks", () => {
    const anomalies = findStructuredAnomalies([
      {
        ...demoPeople[0],
        published: true,
        livingStatus: "unknown"
      }
    ]);

    expect(anomalies.some((anomaly) => anomaly.type === "privacy_risk")).toBe(true);
  });

  it("requires owner/admin role for whole-tree analysis", async () => {
    await expect(
      runAIAnalysis({
        role: "viewer",
        ...baseRequest,
        provider: {
          baseUrl: "https://api.openai.com/v1",
          chatModel: "gpt-5-mini",
          embeddingModel: "text-embedding-3-small"
        }
      })
    ).rejects.toThrow(/cannot perform/);
  });

  it("returns configuration_required when API key is absent", async () => {
    const result = await runAIAnalysis({
      role: "owner",
      ...baseRequest,
      provider: {
        baseUrl: "https://api.openai.com/v1",
        chatModel: "gpt-5-mini",
        embeddingModel: "text-embedding-3-small"
      }
    });

    expect(result.status).toBe("configuration_required");
    expect(result.evidenceUsed).toContain(`${demoPeople.length} people`);
  });

  it("calls a configured provider and returns staged suggestions", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            answer: "Provider recommendation: verify the Mercer branch.",
            uncertainty: ["Treat DNA as directional."],
            evidenceUsed: ["case-northstar-dna-cluster"],
            suggestions: [
              {
                type: "task",
                title: "Check Mercer harbor register",
                summary: "Look for direct documentary support.",
                linkedCaseId: "case-northstar-dna-cluster",
                contextRefs: ["case-northstar-dna-cluster"],
                confidence: 0.73
              }
            ]
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );

    const result = await runAIAnalysis({
      role: "owner",
      ...baseRequest,
      selectedCaseId: "case-northstar-dna-cluster",
      provider: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        chatModel: "gpt-5-mini",
        embeddingModel: "text-embedding-3-small",
        fetcher
      }
    });

    expect(result.status).toBe("ready");
    expect(result.answer).toContain("Provider recommendation");
    expect(result.suggestions[0]).toMatchObject({
      title: "Check Mercer harbor register",
      linkedCaseId: "case-northstar-dna-cluster"
    });
  });

  it("returns provider_error with local fallback when provider calls fail", async () => {
    const fetcher: typeof fetch = async () => new Response("bad key", { status: 401 });

    const result = await runAIAnalysis({
      role: "owner",
      ...baseRequest,
      provider: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        chatModel: "gpt-5-mini",
        embeddingModel: "text-embedding-3-small",
        fetcher
      }
    });

    expect(result.status).toBe("provider_error");
    expect(result.answer).toContain("Recommendation:");
    expect(result.error).toContain("401");
  });
});
