"use client";

import { useRef, useState } from "react";
import { Status } from "@/components/ui";

const fixtureId = "hartwell-mercer-sample-v1";

const sampleImportActions = [
  {
    action: "review",
    label: "Review sample",
    detail: "Preview the fixed fictional GEDCOM and its record-level changes."
  },
  {
    action: "apply",
    label: "Apply sample",
    detail: "Add the bundled people and citation to this disposable sandbox."
  },
  {
    action: "rollback",
    label: "Roll back sample",
    detail: "Restore the sandbox backup created immediately before the sample was applied."
  }
] as const;

type SampleImportAction = (typeof sampleImportActions)[number]["action"];

type SampleImportResponse = {
  action?: SampleImportAction;
  snapshot?: {
    recordCount?: number;
    sourceName?: string;
  };
  peopleImported?: number;
  sourcesImported?: number;
  rawRecordCount?: number;
  restored?: boolean;
  error?: string;
};

export function DemoSampleImportPanel() {
  const [pendingAction, setPendingAction] = useState<SampleImportAction | null>(null);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  async function runAction(action: SampleImportAction) {
    setPendingAction(action);
    setFailed(false);
    setStatus("");

    const response = await fetch("/api/demo/sample-import", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixtureId, action })
    }).catch(() => null);
    const result = response
      ? await response.json().catch(() => ({})) as SampleImportResponse
      : {};

    if (!response?.ok) {
      setFailed(true);
      setStatus(result.error ?? "The bundled sample operation could not be completed.");
    } else {
      setStatus(describeResult(action, result));
    }
    setPendingAction(null);
    window.requestAnimationFrame(() => statusRef.current?.focus());
  }

  return (
    <section aria-labelledby="demo-sample-import-heading" className="app-card">
      <div className="app-card-header">
        <div>
          <span className="card-kicker">Bundled fictional GEDCOM</span>
          <h2 id="demo-sample-import-heading">Try review, apply, and rollback</h2>
        </div>
        <Status tone="private">No upload</Status>
      </div>
      <p className="muted">
        This fixed sample runs entirely on the server. It cannot accept a file, URL, or visitor-written family data.
        Use the actions in order to exercise the same bounded import lifecycle as a private archive.
      </p>
      <div className="evidence-list">
        {sampleImportActions.map((item) => (
          <div className="evidence-item" key={item.action}>
            <div className="evidence-item-heading">
              <strong>{item.label}</strong>
              <button
                aria-busy={pendingAction === item.action}
                className={item.action === "apply" ? "button" : "button-secondary"}
                disabled={pendingAction !== null}
                onClick={() => runAction(item.action)}
                type="button"
              >
                {pendingAction === item.action ? "Working…" : item.label}
              </button>
            </div>
            <p className="muted">{item.detail}</p>
          </div>
        ))}
      </div>
      <p
        aria-live="polite"
        className={failed ? "form-error" : "muted"}
        ref={statusRef}
        role={failed ? "alert" : "status"}
        tabIndex={-1}
      >
        {status}
      </p>
    </section>
  );
}

function describeResult(action: SampleImportAction, result: SampleImportResponse): string {
  if (action === "review") {
    const recordCount = result.snapshot?.recordCount ?? 0;
    return `Review ready: ${recordCount.toLocaleString()} fictional GEDCOM records would be added.`;
  }
  if (action === "apply") {
    return `Sample applied: ${(result.peopleImported ?? 0).toLocaleString()} people, ${(result.sourcesImported ?? 0).toLocaleString()} source citations, and ${(result.rawRecordCount ?? 0).toLocaleString()} raw records were added.`;
  }
  return result.restored
    ? "Rollback complete. The sandbox was restored to its pre-sample state."
    : "Rollback completed.";
}
