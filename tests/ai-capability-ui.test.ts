import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AIAnalystWorkspace, AnalysisResult } from "@/components/ai-analyst-workspace";

const baseProps = {
  initialQuestion: "Which source should I verify next?",
  cases: [],
  initialRuns: [],
  anomalies: [],
  counts: { people: 12, cases: 0, dnaHypotheses: 3 },
  dnaHypotheses: []
};

const staleProviderRun = {
  id: "run-stale-provider",
  question: "Which source should I verify?",
  answer: "Recommendation: Verify the transcript.",
  status: "configuration_required" as const,
  providerStatus: "not_configured" as const,
  provider: "api.openai.com",
  model: "gpt-5-mini",
  evidenceUsed: ["1 source"],
  uncertainty: [],
  anomalyCount: 0,
  suggestions: [],
  contextReferences: [],
  createdAt: "2026-07-14T12:00:00.000Z"
};

describe("AI analyst capability UI", () => {
  it("presents local-only analysis without DNA when both capabilities are disabled", () => {
    const html = renderToStaticMarkup(createElement(AIAnalystWorkspace, {
      ...baseProps,
      dnaEnabled: false,
      externalAiEnabled: false
    }));

    expect(html).not.toMatch(/DNA/i);
    expect(html).toMatch(/deterministic local checks/i);
    expect(html).toMatch(/no external provider/i);
    expect(html).not.toMatch(/sends full private workspace context/i);
    expect(html).not.toMatch(/provider fallback|provider answered/i);
  });

  it("projects stale saved provider runs as local in hosted mode", () => {
    const html = renderToStaticMarkup(createElement(AIAnalystWorkspace, {
      ...baseProps,
      initialRuns: [staleProviderRun],
      dnaEnabled: false,
      externalAiEnabled: false
    }));

    expect(html).toMatch(/local analysis/i);
    expect(html).not.toMatch(/api\.openai\.com|gpt-5-mini|needs key/i);
  });

  it("projects a fresh hosted result without provider, model, or needs-key details", () => {
    const html = renderToStaticMarkup(createElement(AnalysisResult, {
      externalAiEnabled: false,
      result: {
        ...staleProviderRun,
        anomalies: [],
        promptPreview: "local",
        error: undefined
      }
    }));

    expect(html).toMatch(/deterministic local analysis/i);
    expect(html).not.toMatch(/api\.openai\.com|gpt-5-mini|needs key/i);
  });

  it("preserves DNA and provider-aware copy when capabilities are enabled", () => {
    const html = renderToStaticMarkup(createElement(AIAnalystWorkspace, {
      ...baseProps,
      initialRuns: [staleProviderRun],
      dnaEnabled: true,
      externalAiEnabled: true
    }));

    expect(html).toMatch(/DNA hypotheses/i);
    expect(html).toMatch(/sends full private workspace context/i);
    expect(html).toMatch(/api\.openai\.com|needs key/i);
  });
});
