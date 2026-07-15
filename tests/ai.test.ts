import { describe, expect, it, vi } from "vitest";
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

  it("keeps hosted analysis local and strips disabled DNA before deriving evidence", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("should not be called"));
    const hostedEnvironment = {
      KINRESOLVE_DEPLOYMENT_MODE: "hosted",
      KINRESOLVE_DATASET_MODE: "pilot",
      KINRESOLVE_DNA_ENABLED: "false",
      KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
      KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
      KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
      KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
      KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
      KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
    } as const;
    for (const [name, value] of Object.entries(hostedEnvironment)) vi.stubEnv(name, value);

    try {
      const privateDnaMatch = {
        ...demoDnaMatches[0],
        id: "dna-private-boundary",
        displayName: "Private boundary match"
      };
      const privateDnaHypothesis = {
        ...demoDnaHypotheses[0],
        matchId: privateDnaMatch.id,
        likelyBranch: "Private DNA branch"
      };
      const documentaryCase = {
        ...demoCases[0],
        id: "case-documentary-boundary",
        title: "Documentary boundary review",
        question: "Which register should be verified?",
        focus: "Primary records",
        hypotheses: [],
        tasks: [],
        evidence: [
          {
            id: "evidence-documentary",
            title: "Parish register transcript",
            type: "Transcript",
            summary: "A saved documentary transcript.",
            confidence: 0.8
          },
          {
            id: "evidence-private-dna",
            title: "Private DNA evidence",
            type: "DNA match",
            summary: "Private match evidence that must not reach hosted analysis.",
            confidence: 0.7,
            linkedDnaMatchId: privateDnaMatch.id
          }
        ]
      };
      const result = await runAIAnalysis({
        role: "owner",
        ...baseRequest,
        cases: [documentaryCase],
        dnaMatches: [privateDnaMatch],
        dnaHypotheses: [privateDnaHypothesis],
        provider: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "configured-but-disabled",
          chatModel: "gpt-5-mini",
          embeddingModel: "text-embedding-3-small",
          fetcher
        }
      });

      expect(result.status).toBe("ready");
      expect(result.providerStatus).toBe("not_configured");
      expect(result.provider).toBe("local");
      expect(result.model).toBe("deterministic");
      expect(result.answer).toContain("Recommendation:");
      expect(result.uncertainty.join(" ")).toMatch(/disabled.*deployment/i);
      expect(result.answer).not.toMatch(/DNA|private boundary/i);
      expect(result.evidenceUsed.join(" ")).not.toMatch(/DNA|private boundary/i);
      expect(result.promptPreview).not.toMatch(/DNA|private boundary/i);
      expect(result.contextReferences).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: privateDnaMatch.id })
      ]));
      expect(result.suggestions).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ contextRefs: expect.arrayContaining([privateDnaMatch.id]) })
      ]));
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
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
