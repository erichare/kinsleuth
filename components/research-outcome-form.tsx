"use client";

import { useEffect, useRef, useState } from "react";
import type { ResearchCase, ResearchSearchScope, ResearchTask, ResearchTaskOutcome } from "@/lib/models";

export type ResearchOutcomeSubmission = {
  requestId: string;
  expectedTaskUpdatedAt: string;
  outcome: ResearchTaskOutcome["type"];
  note: string;
  searchScope?: ResearchSearchScope;
  correctsOutcomeId?: string;
  hypothesisDecision?: {
    hypothesisId: string;
    status: ResearchCase["hypotheses"][number]["status"];
    reason: string;
    expectedHypothesisUpdatedAt: string;
  };
};

const outcomeOptions: Array<{ value: ResearchTaskOutcome["type"]; label: string; detail: string }> = [
  { value: "found", label: "I found something useful", detail: "A record or clue changed what you know." },
  { value: "not_found", label: "I did not find the record", detail: "Record exactly where and how you searched." },
  { value: "inconclusive", label: "The result was inconclusive", detail: "The search did not clearly help or hurt a path." },
  { value: "blocked", label: "I could not complete it", detail: "Access, time, or missing information stopped the work." },
  { value: "already_tried", label: "I already tried this", detail: "Capture the earlier search so it is not suggested again." }
];

export function ResearchOutcomeForm({
  task,
  hypotheses,
  initialOutcome = "found",
  correctingOutcome,
  isSaving,
  onCancel,
  onSubmit
}: {
  task: ResearchTask;
  hypotheses: ResearchCase["hypotheses"];
  initialOutcome?: ResearchTaskOutcome["type"];
  correctingOutcome?: ResearchTaskOutcome;
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (input: ResearchOutcomeSubmission) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<ResearchTaskOutcome["type"]>(correctingOutcome?.type ?? initialOutcome);
  const [note, setNote] = useState(correctingOutcome?.note ?? "");
  const [repository, setRepository] = useState(correctingOutcome?.searchScope?.repository ?? "");
  const [collection, setCollection] = useState(correctingOutcome?.searchScope?.collection ?? "");
  const [dateRange, setDateRange] = useState(correctingOutcome?.searchScope?.dateRange ?? "");
  const [query, setQuery] = useState(correctingOutcome?.searchScope?.query ?? "");
  const [hypothesisId, setHypothesisId] = useState(task.targetHypothesisId ?? "");
  const [hypothesisStatus, setHypothesisStatus] = useState<"none" | ResearchCase["hypotheses"][number]["status"]>("none");
  const [reason, setReason] = useState("");
  const [confirmedRuleOut, setConfirmedRuleOut] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const needsScope = outcome === "not_found" || outcome === "already_tried";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note.trim()) {
      setError("Write down what you learned before saving.");
      return;
    }
    if (needsScope && !repository.trim()) {
      setError("Name the repository, website, archive, or other place you searched.");
      return;
    }
    if (hypothesisStatus !== "none" && (!hypothesisId || !reason.trim())) {
      setError("Choose a hypothesis and explain why its status should change.");
      return;
    }
    if (hypothesisStatus === "rejected" && !confirmedRuleOut) {
      setError("Confirm that you are explicitly ruling out this path.");
      return;
    }

    const hypothesis = hypotheses.find((item) => item.id === hypothesisId);
    if (hypothesisStatus !== "none" && !hypothesis?.updatedAt) {
      setError("Refresh this case before changing that hypothesis.");
      return;
    }
    if (!task.updatedAt) {
      setError("Refresh this case before recording the result.");
      return;
    }

    requestId.current ||= crypto.randomUUID();
    setError("");
    await onSubmit({
      requestId: requestId.current,
      expectedTaskUpdatedAt: task.updatedAt,
      outcome,
      note: note.trim(),
      correctsOutcomeId: correctingOutcome?.id,
      searchScope: needsScope
        ? {
            repository: repository.trim(),
            collection: collection.trim() || undefined,
            dateRange: dateRange.trim() || undefined,
            query: query.trim() || undefined
          }
        : undefined,
      hypothesisDecision:
        hypothesisStatus !== "none" && hypothesis
          ? {
              hypothesisId: hypothesis.id,
              status: hypothesisStatus,
              reason: reason.trim(),
              expectedHypothesisUpdatedAt: hypothesis.updatedAt!
            }
          : undefined
    });
  }

  return (
    <form aria-busy={isSaving} aria-labelledby="research-outcome-heading" className="research-outcome-form" onSubmit={submit}>
      <div>
        <span className="card-kicker">{correctingOutcome ? "Append a correction" : "Close the loop"}</span>
        <h3 id="research-outcome-heading" ref={headingRef} tabIndex={-1}>
          {correctingOutcome ? "Correct a recorded result" : "What happened?"}
        </h3>
        <p className="research-outcome-task"><strong>Assignment:</strong> {task.title}</p>
        <p className="muted">
          {correctingOutcome
            ? "The original result stays in the history. This correction will be added after it."
            : "Your result stays with this case and helps the guide avoid sending you down the same path."}
        </p>
      </div>

      <fieldset className="research-choice-group">
        <legend>Outcome</legend>
        {outcomeOptions.map((option) => (
          <label className="research-choice" key={option.value}>
            <input checked={outcome === option.value} name="outcome" onChange={() => setOutcome(option.value)} type="radio" value={option.value} />
            <span><strong>{option.label}</strong><small>{option.detail}</small></span>
          </label>
        ))}
      </fieldset>

      {needsScope ? (
        <div className="research-scope-grid">
          <label className="field">
            <span>Where did you search?</span>
            <input maxLength={240} onChange={(event) => setRepository(event.target.value)} placeholder="Lantern Bay Historical Room (fictional example)" value={repository} />
          </label>
          <label className="field">
            <span>Collection</span>
            <input maxLength={500} onChange={(event) => setCollection(event.target.value)} placeholder="Harbor payrolls and boarding ledgers (fictional example)" value={collection} />
          </label>
          <label className="field">
            <span>Date range</span>
            <input maxLength={120} onChange={(event) => setDateRange(event.target.value)} placeholder="1906–1922 (fictional example)" value={dateRange} />
          </label>
          <label className="field">
            <span>Names or query used</span>
            <input maxLength={1200} onChange={(event) => setQuery(event.target.value)} placeholder="Samuel Mercer, Samuel March, coat repair..." value={query} />
          </label>
        </div>
      ) : null}

      <label className="field">
        <span>What did you learn?</span>
        <textarea maxLength={4000} onChange={(event) => setNote(event.target.value)} placeholder="Include enough detail that future-you will know what was checked and what the result means." value={note} />
      </label>

      {hypotheses.length > 0 ? (
        <fieldset className="research-decision-fieldset">
          <legend>Does this change a hypothesis?</legend>
          <p className="muted">A missing record is not proof that a hypothesis is false. You choose what the result means.</p>
          <label className="field">
            <span>Hypothesis</span>
            <select onChange={(event) => setHypothesisId(event.target.value)} value={hypothesisId}>
              <option value="">Choose a hypothesis</option>
              {hypotheses.map((hypothesis) => <option key={hypothesis.id} value={hypothesis.id}>{hypothesis.statement}</option>)}
            </select>
          </label>
          <div aria-label="Hypothesis effect" className="research-effect-options" role="group">
            {(["none", "open", "supported", "weakened", "rejected"] as const).map((status) => (
              <button aria-pressed={hypothesisStatus === status} className={hypothesisStatus === status ? "active" : undefined} key={status} onClick={() => setHypothesisStatus(status)} type="button">
                {status === "none" ? "No change" : status === "rejected" ? "Rule out" : status}
              </button>
            ))}
          </div>
          {hypothesisStatus !== "none" ? (
            <label className="field">
              <span>Why?</span>
              <textarea maxLength={2000} onChange={(event) => setReason(event.target.value)} placeholder="Explain the decision in your own words." value={reason} />
            </label>
          ) : null}
          {hypothesisStatus === "rejected" ? (
            <label className="research-confirmation">
              <input checked={confirmedRuleOut} onChange={(event) => setConfirmedRuleOut(event.target.checked)} type="checkbox" />
              <span>I am explicitly ruling out this path for this case; this is not an automatic conclusion.</span>
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="research-form-actions">
        <button className="button" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save result"}</button>
        <button className="button-ghost" disabled={isSaving} onClick={onCancel} type="button">Cancel</button>
      </div>
    </form>
  );
}
