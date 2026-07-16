"use client";

import { useEffect, useState } from "react";

import type { ResearchCase } from "@/lib/models";

type FixedOutcome = "found" | "not_found" | "inconclusive";
type CuratedQuestion = "case_next_steps" | "evidence_gaps" | "dna_cluster_summary";

const fixedOutcomes: ReadonlyArray<{
  value: FixedOutcome;
  label: string;
  detail: string;
}> = [
  {
    value: "found",
    label: "Likely the same writer",
    detail: "The shared forms are distinctive enough to support the connection."
  },
  {
    value: "not_found",
    label: "Likely different writers",
    detail: "The differences outweigh the shared features."
  },
  {
    value: "inconclusive",
    label: "Not enough to decide",
    detail: "Some features match, but another record is still needed."
  }
];

const curatedQuestions: ReadonlyArray<{
  id: CuratedQuestion;
  label: string;
}> = [
  { id: "case_next_steps", label: "Suggest the next three checks" },
  { id: "evidence_gaps", label: "Show the important evidence gaps" },
  { id: "dna_cluster_summary", label: "Summarize the fictional DNA cluster" }
];

type JourneyResponse = {
  error?: string;
  nextAssignment?: {
    title?: string;
    summary?: string;
  };
};

type AiResponse = {
  error?: string;
  remainingAiAttempts?: number;
  analysis?: {
    answer?: string;
    fallback?: boolean;
    label?: string;
    uncertainty?: string[];
  };
};

export function DemoGuidedCaseJourney({ initialCase }: { initialCase: ResearchCase }) {
  const guidedTask = initialCase.tasks.find(({ id }) => id === "task-compare-signatures");
  const initiallyCompleted = guidedTask?.status === "done" && Boolean(guidedTask.outcomes?.length);
  const [outcomeCompleted, setOutcomeCompleted] = useState(initiallyCompleted);
  const [selectedOutcome, setSelectedOutcome] = useState<FixedOutcome | null>(null);
  const [nextAssignment, setNextAssignment] = useState(initiallyCompleted
    ? defaultNextAssignment
    : null);
  const [pending, setPending] = useState<"outcome" | CuratedQuestion | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<AiResponse["analysis"]>();
  const [remainingAiAttempts, setRemainingAiAttempts] = useState<number | null>(null);

  useEffect(() => {
    if (outcomeCompleted) return;
    void requestJson<JourneyResponse>(
      `/api/demo/cases/${encodeURIComponent(initialCase.id)}/guide`,
      { command: "start_assignment" }
    ).catch(() => undefined);
  }, [initialCase.id, outcomeCompleted]);

  async function saveOutcome(outcome: FixedOutcome) {
    setSelectedOutcome(outcome);
    setPending("outcome");
    setError("");
    setMessage("");
    try {
      const response = await requestJson<JourneyResponse>(
        `/api/demo/cases/${encodeURIComponent(initialCase.id)}/guide`,
        { command: "record_outcome", outcome }
      );
      setOutcomeCompleted(true);
      setNextAssignment({
        title: response.nextAssignment?.title ?? defaultNextAssignment.title,
        summary: response.nextAssignment?.summary ?? defaultNextAssignment.summary
      });
      setMessage("Outcome saved. Your next assignment is ready.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The outcome could not be saved.");
    } finally {
      setPending(null);
    }
  }

  async function runCuratedAi(questionId: CuratedQuestion) {
    setPending(questionId);
    setError("");
    setMessage("");
    try {
      const response = await requestJson<AiResponse>("/api/demo/ai", {
        caseId: initialCase.id,
        questionId
      });
      setAnalysis(response.analysis);
      if (Number.isInteger(response.remainingAiAttempts)) {
        setRemainingAiAttempts(response.remainingAiAttempts as number);
      }
      setMessage(response.analysis?.fallback
        ? "External AI was unavailable; a deterministic demo analysis is shown instead."
        : "Curated AI analysis complete.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The curated analysis could not run.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="demo-guided-heading" className="demo-guided-journey">
      <header className="demo-guided-heading">
        <div>
          <span className="card-kicker">Guided task · about two minutes</span>
          <h2 id="demo-guided-heading">Do these signatures point to the same fictional person?</h2>
        </div>
        <span className="demo-fiction-badge">Fictional records</span>
      </header>

      <p className="demo-guided-instruction">
        Compare the capital S, the open lower-case a, and the unusually tall final stroke. Then choose the fixed outcome that best fits the two records.
      </p>

      <div aria-label="Two fictional signature records" className="demo-signature-grid">
        <article className="demo-signature-record">
          <span>Record A</span>
          <h3>Fictional 1907 passenger-list signature</h3>
          <div aria-label="Samuel March signature transcription" className="demo-signature-sample">Samuel March</div>
          <ul>
            <li>Broad capital S with a low middle join</li>
            <li>Open lower-case a</li>
            <li>Tall final h stroke leaning right</li>
          </ul>
        </article>
        <article className="demo-signature-record">
          <span>Record B</span>
          <h3>Fictional 1909 marriage signature</h3>
          <div aria-label="Samuel Mercer signature transcription" className="demo-signature-sample">Samuel Mercer</div>
          <ul>
            <li>Broad capital S with a low middle join</li>
            <li>Open lower-case a</li>
            <li>Tall final r stroke leaning right</li>
          </ul>
        </article>
      </div>

      <fieldset className="demo-outcome-options" disabled={pending !== null || outcomeCompleted}>
        <legend>Choose your research outcome</legend>
        {fixedOutcomes.map((option) => (
          <button
            aria-pressed={selectedOutcome === option.value}
            className={selectedOutcome === option.value ? "selected" : undefined}
            key={option.value}
            onClick={() => saveOutcome(option.value)}
            type="button"
          >
            <strong>{option.label}</strong>
            <span>{option.detail}</span>
          </button>
        ))}
      </fieldset>

      {outcomeCompleted && nextAssignment ? (
        <section aria-live="polite" className="demo-next-assignment">
          <span className="card-kicker">Next assignment</span>
          <h3>{nextAssignment.title}</h3>
          <p>{nextAssignment.summary}</p>
          <a
            className="button-secondary"
            href="https://kinresolve.com/beta"
            onClick={trackBetaCta}
          >
            Apply for the private beta
          </a>
        </section>
      ) : null}

      {outcomeCompleted ? (
        <section aria-labelledby="demo-curated-ai-heading" className="demo-curated-ai">
          <div>
            <span className="card-kicker">Optional · curated AI</span>
            <h3 id="demo-curated-ai-heading">Ask one fixed follow-up</h3>
            <p>Only the selected synthetic question and this fictional sandbox are sent to the configured provider.</p>
          </div>
          <div className="demo-ai-actions">
            {curatedQuestions.map((question) => (
              <button
                className="button-secondary"
                disabled={pending !== null || remainingAiAttempts === 0}
                key={question.id}
                onClick={() => runCuratedAi(question.id)}
                type="button"
              >
                {pending === question.id ? "Analyzing…" : question.label}
              </button>
            ))}
          </div>
          {remainingAiAttempts !== null ? (
            <p className="muted">{remainingAiAttempts} curated AI attempts remain in this sandbox.</p>
          ) : null}
          {analysis?.answer ? (
            <article className="demo-ai-result" tabIndex={-1}>
              <span>{analysis.label ?? (analysis.fallback ? "Deterministic demo analysis" : "Curated AI analysis")}</span>
              <p>{analysis.answer}</p>
              {analysis.uncertainty?.length ? (
                <ul>{analysis.uncertainty.map((item) => <li key={item}>{item}</li>)}</ul>
              ) : null}
            </article>
          ) : null}
        </section>
      ) : null}

      <p aria-live="polite" className={error ? "form-error" : "research-success-message"} role={error ? "alert" : "status"}>
        {error || message}
      </p>
    </section>
  );
}

function trackBetaCta(): void {
  void fetch("/api/demo/events", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventName: "beta_cta_clicked" })
  }).catch(() => undefined);
}

const defaultNextAssignment = {
  title: "Check the bounded Northstar Cove departure ledger",
  summary: "Look for Mercer, March, and damaged M— surname variants in the fictional April–May 1907 pages."
};

async function requestJson<ResponseBody>(url: string, body: Record<string, unknown>): Promise<ResponseBody> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const value = await response.json().catch(() => ({})) as ResponseBody & { error?: string };
  if (!response.ok) throw new Error(value.error ?? "The demo request could not be completed.");
  return value;
}
