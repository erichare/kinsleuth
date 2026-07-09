"use client";

import { useState } from "react";
import { Icons } from "@/components/icons";
import { Confidence, Metric, Status } from "@/components/ui";
import type { AIAnalysisResult, StructuredAnomaly } from "@/lib/ai";
import type { DnaConnectionHypothesis } from "@/lib/models";

type Props = {
  initialQuestion: string;
  anomalies: StructuredAnomaly[];
  counts: {
    people: number;
    cases: number;
    dnaHypotheses: number;
  };
  dnaHypotheses: DnaConnectionHypothesis[];
};

const suggestedQuestions = [
  "Which DNA lead should I investigate next?",
  "What privacy or publication risks should block sharing?",
  "Which vital events need better source coverage?"
];

export function AIAnalystWorkspace({ initialQuestion, anomalies, counts, dnaHypotheses }: Props) {
  const [question, setQuestion] = useState(initialQuestion);
  const [result, setResult] = useState<AIAnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  async function runAnalysis(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      setError("Add a research question first.");
      return;
    }

    setIsRunning(true);
    setError("");

    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "owner", question: trimmedQuestion })
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "AI analysis failed");
      }

      setResult(body as AIAnalysisResult);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "AI analysis failed");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="ai-workspace">
      <div className="metric-row ai-metric-row">
        <Metric label="People indexed" value={counts.people.toLocaleString()} detail="available to local checks" />
        <Metric label="Cases" value={counts.cases.toLocaleString()} detail="research questions" />
        <Metric label="DNA hypotheses" value={counts.dnaHypotheses.toLocaleString()} detail="ranked leads" />
        <Metric label="Structured flags" value={anomalies.length.toLocaleString()} detail="privacy and source checks" />
      </div>

      <div className="app-grid ai-grid">
        <section className="app-card analyst-panel">
          <div className="app-card-header">
            <div>
              <h2>Ask the analyst</h2>
              <p className="muted">Runs deterministic tree, privacy, source, case, and DNA checks against the current workspace.</p>
            </div>
            <Status tone={result?.status === "ready" ? "ok" : "private"}>{result?.status === "ready" ? "Provider ready" : "Local mode"}</Status>
          </div>

          <form onSubmit={runAnalysis}>
            <label className="field">
              <span>Research question</span>
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
            </label>
            <div className="prompt-row" aria-label="Suggested research questions">
              {suggestedQuestions.map((suggestion) => (
                <button className="prompt-chip" key={suggestion} onClick={() => setQuestion(suggestion)} type="button">
                  {suggestion}
                </button>
              ))}
            </div>
            <div className="hero-actions">
              <button className="button" disabled={isRunning} type="submit">
                <Icons.Brain size={16} aria-hidden />
                {isRunning ? "Analyzing..." : "Run analysis"}
              </button>
              <Status tone="private">Owner/Admin only</Status>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
          </form>

          <AnalysisResult result={result} />
        </section>

        <aside className="app-card">
          <div className="app-card-header">
            <div>
              <h2>Structured checks</h2>
              <p className="muted">Deterministic findings that feed the recommendation.</p>
            </div>
            <Icons.FileSearch size={18} aria-hidden />
          </div>
          <div className="evidence-list">
            {anomalies.length > 0 ? (
              anomalies.map((anomaly) => (
                <AnomalyItem anomaly={anomaly} key={anomaly.title} />
              ))
            ) : (
              <div className="evidence-item">
                <strong>No high-risk anomalies in demo data</strong>
                <p className="muted">
                  {counts.people.toLocaleString()} people, {counts.cases.toLocaleString()} cases, and {counts.dnaHypotheses.toLocaleString()} DNA hypotheses checked.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      <section className="app-card">
        <div className="app-card-header">
          <div>
            <h2>Connection hypotheses</h2>
            <p className="muted">Current DNA leads ranked before an external provider is involved.</p>
          </div>
          <Icons.Dna size={18} aria-hidden />
        </div>
        <div className="hypothesis-grid">
          {dnaHypotheses.map((hypothesis) => (
            <div className="hypothesis-panel" key={hypothesis.matchId}>
              <strong>{hypothesis.likelyBranch}</strong>
              <p>{hypothesis.explanation}</p>
              <div className="evidence-inline">
                <Confidence value={hypothesis.confidence} />
                <span className="muted">{hypothesis.likelyGeneration}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AnalysisResult({ result }: { result: AIAnalysisResult | null }) {
  if (!result) {
    return (
      <div className="analysis-empty">
        <Icons.Brain size={24} aria-hidden />
        <div>
          <strong>Ready for a local pass</strong>
          <p className="muted">Run analysis to get a recommended lead, evidence hygiene notes, publication safety checks, and uncertainty.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-result">
      <div className="analysis-result-header">
        <h2>Recommendation</h2>
        <Status tone={result.status === "ready" ? "ok" : "warning"}>{result.status === "ready" ? "Ready" : "Needs API key"}</Status>
      </div>
      <div className="analysis-answer">
        {result.answer.split("\n\n").map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div className="analysis-columns">
        <ResultList title="Evidence used" items={result.evidenceUsed} />
        <ResultList title="Uncertainty" items={result.uncertainty} />
      </div>
    </div>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="analysis-list">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AnomalyItem({ anomaly }: { anomaly: StructuredAnomaly }) {
  return (
    <div className="evidence-item">
      <div className="evidence-item-heading">
        <strong>{anomaly.title}</strong>
        <Status tone={anomaly.severity === "high" ? "warning" : "private"}>{anomaly.severity}</Status>
      </div>
      <p className="muted">{anomaly.evidence.join(" · ")}</p>
    </div>
  );
}
