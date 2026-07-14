"use client";

import { useRef, useState } from "react";
import type { ResearchCase, ResearchHypothesis } from "@/lib/models";
import { Confidence, Status } from "./ui";

export type HypothesisDecisionSubmission = {
  requestId: string;
  expectedUpdatedAt: string;
  status: ResearchHypothesis["status"];
  reason: string;
};

export type HypothesisDecisionRequestState = {
  fingerprint: string;
  requestId: string;
};

export function hypothesisDecisionRequestFor(
  previous: HypothesisDecisionRequestState | undefined,
  draft: Omit<HypothesisDecisionSubmission, "requestId">,
  createRequestId: () => string = () => crypto.randomUUID()
): HypothesisDecisionRequestState {
  const fingerprint = JSON.stringify([
    draft.expectedUpdatedAt,
    draft.status,
    draft.reason.trim()
  ]);
  if (previous?.fingerprint === fingerprint) {
    return previous;
  }
  return { fingerprint, requestId: createRequestId() };
}

export function HypothesisWorkspace({
  hypotheses,
  canWrite,
  busyId,
  isLocked,
  onAdd,
  onDecide
}: {
  hypotheses: ResearchCase["hypotheses"];
  canWrite: boolean;
  busyId: string;
  isLocked: boolean;
  onAdd: (statement: string) => Promise<void>;
  onDecide: (hypothesis: ResearchHypothesis, input: HypothesisDecisionSubmission) => Promise<void>;
}) {
  const [statement, setStatement] = useState("");
  const [addError, setAddError] = useState("");

  async function addHypothesis(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statement.trim()) {
      setAddError("Write one testable explanation first.");
      return;
    }
    setAddError("");
    try {
      await onAdd(statement.trim());
      setStatement("");
    } catch {
      // The parent keeps the server error in the shared live message.
    }
  }

  return (
    <section className="app-card research-hypotheses" aria-labelledby="working-hypotheses-heading">
      <div className="app-card-header">
        <div>
          <span className="card-kicker">Possibilities, not facts</span>
          <h2 id="working-hypotheses-heading">Working hypotheses</h2>
          <p className="muted">Keep the live possibilities visible, and write down why one changes.</p>
        </div>
        <Status tone="private">{hypotheses.length}</Status>
      </div>

      {canWrite ? (
        <form className="hypothesis-add-form" onSubmit={addHypothesis}>
          <label className="field">
            <span>Add a possible explanation</span>
            <input disabled={isLocked} maxLength={1200} onChange={(event) => setStatement(event.target.value)} placeholder="Samuel Mercer used the name Samuel March in Northstar Cove (fictional example)" value={statement} />
          </label>
          <button className="button-secondary" disabled={isLocked || busyId === "new-hypothesis"} type="submit">
            {busyId === "new-hypothesis" ? "Adding..." : "Add hypothesis"}
          </button>
          {addError ? <p className="form-error" role="alert">{addError}</p> : null}
        </form>
      ) : (
        <p className="research-readonly-note">An editor can add or update hypotheses for this case.</p>
      )}

      <div className="research-hypothesis-list">
        {hypotheses.map((hypothesis) => (
          <HypothesisCard
            busy={busyId === hypothesis.id}
            canWrite={canWrite}
            hypothesis={hypothesis}
            key={`${hypothesis.id}:${hypothesis.updatedAt ?? "legacy"}`}
            locked={isLocked}
            onDecide={onDecide}
          />
        ))}
      </div>
      {hypotheses.length === 0 ? <p className="muted empty-state">No hypotheses yet. Add one testable explanation to give the guide a starting point.</p> : null}
    </section>
  );
}

function HypothesisCard({
  hypothesis,
  canWrite,
  busy,
  locked,
  onDecide
}: {
  hypothesis: ResearchHypothesis;
  canWrite: boolean;
  busy: boolean;
  locked: boolean;
  onDecide: (hypothesis: ResearchHypothesis, input: HypothesisDecisionSubmission) => Promise<void>;
}) {
  const [status, setStatus] = useState<ResearchHypothesis["status"]>(hypothesis.status);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const decisionRequestRef = useRef<HypothesisDecisionRequestState | undefined>(undefined);
  const decisions = hypothesis.decisions ?? [];

  async function save() {
    if (!reason.trim()) {
      setError("Explain why this hypothesis should change.");
      return;
    }
    if (status === "rejected" && !confirmed) {
      setError("Confirm that you are explicitly ruling out this path.");
      return;
    }
    if (!hypothesis.updatedAt) {
      setError("Refresh this case before changing the hypothesis.");
      return;
    }
    setError("");
    const request = hypothesisDecisionRequestFor(
      decisionRequestRef.current,
      {
        expectedUpdatedAt: hypothesis.updatedAt,
        status,
        reason: reason.trim()
      }
    );
    decisionRequestRef.current = request;
    try {
      await onDecide(hypothesis, {
        requestId: request.requestId,
        expectedUpdatedAt: hypothesis.updatedAt,
        status,
        reason: reason.trim()
      });
      decisionRequestRef.current = undefined;
      setReason("");
      setConfirmed(false);
    } catch {
      // Preserve the user's reason while the shared message explains the error.
    }
  }

  return (
    <article className={`research-hypothesis-card ${hypothesis.status === "rejected" ? "is-ruled-out" : ""}`}>
      <div className="research-hypothesis-heading">
        <strong>{hypothesis.statement}</strong>
        <Status tone={hypothesis.status === "rejected" ? "danger" : hypothesis.status === "weakened" ? "warning" : "private"}>
          {hypothesis.status === "rejected" ? "ruled out" : hypothesis.status}
        </Status>
      </div>
      <Confidence value={hypothesis.confidence} />
      {decisions.length > 0 ? (
        <ol aria-label={`Decision history for ${hypothesis.statement}`} className="research-history-list research-decision-history">
          {decisions.map((decision, index) => (
            <li className="research-history-entry" key={decision.id}>
              <div className="research-history-meta">
                <span>Decision {index + 1} · {statusLabel(decision.fromStatus)} to {statusLabel(decision.toStatus)}</span>
                <time dateTime={decision.createdAt}>{formatResearchDate(decision.createdAt)}</time>
              </div>
              <p>{decision.reason}</p>
              <small>{decision.actorName}</small>
            </li>
          ))}
        </ol>
      ) : hypothesis.status !== "open" ? (
        <p className="research-legacy-note">This was marked {hypothesis.status} before decision reasons were recorded.</p>
      ) : null}

      {canWrite ? (
        <div className="research-hypothesis-controls">
          <label className="field">
            <span>Update status</span>
            <select disabled={locked} onChange={(event) => setStatus(event.target.value as ResearchHypothesis["status"])} value={status}>
              <option value="open">Open</option>
              <option value="supported">Supported</option>
              <option value="weakened">Weakened</option>
              <option value="rejected">Rule out</option>
            </select>
          </label>
          <label className="field">
            <span>Reason</span>
            <textarea disabled={locked} maxLength={2000} onChange={(event) => setReason(event.target.value)} placeholder="What evidence or result changed your view?" value={reason} />
          </label>
          {status === "rejected" ? (
            <label className="research-confirmation">
              <input checked={confirmed} disabled={locked} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
              <span>I am explicitly ruling out this path; a missing record alone is not proof.</span>
            </label>
          ) : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button-secondary" disabled={busy || locked} onClick={save} type="button">{busy ? "Saving..." : "Save decision"}</button>
        </div>
      ) : null}
    </article>
  );
}

function statusLabel(status: ResearchHypothesis["status"]): string {
  return status === "rejected" ? "ruled out" : status;
}

function formatResearchDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recorded previously";
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}
