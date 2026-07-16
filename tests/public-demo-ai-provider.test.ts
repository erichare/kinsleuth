import { describe, expect, it, vi } from "vitest";

import { runAIAnalysis } from "@/lib/ai";
import { demoCases, demoPeople } from "@/lib/demo-data";

describe("public demo provider request bounds", () => {
  it("sends the configured output cap and an abortable request", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({ answer: "Bounded fictional analysis." })
    }), { status: 200 }));

    const result = await runAIAnalysis({
      role: "owner",
      question: "Review only this fictional case.",
      selectedCaseId: demoCases[0].id,
      people: demoPeople,
      cases: [demoCases[0]],
      sources: [],
      dnaMatches: [],
      dnaHypotheses: [],
      provider: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "demo-test-key",
        chatModel: "gpt-5-mini",
        embeddingModel: "text-embedding-3-small",
        maximumOutputTokens: 800,
        timeoutMs: 20_000,
        fetcher
      }
    });

    expect(result.providerStatus).toBe("completed");
    const [, init] = fetcher.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ max_output_tokens: 800 });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
