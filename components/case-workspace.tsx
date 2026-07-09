"use client";

import Link from "next/link";
import { useState } from "react";
import type { ResearchCase } from "@/lib/models";
import { Confidence, Status } from "./ui";

type CaseDraft = {
  title: string;
  question: string;
  focus: string;
  firstHypothesis: string;
  firstEvidence: string;
};

const initialDraft: CaseDraft = {
  title: "New DNA connection case",
  question: "How does this DNA match connect to the maternal Riemer line?",
  focus: "DNA + Chicago/Limerick evidence",
  firstHypothesis: "The match connects through the Riemer maternal branch before 1900.",
  firstEvidence: "The match shares 238 cM, has a partial Fletcher tree, and overlaps Chicago/Limerick/Cornwall places."
};

export function CaseWorkspace({ initialCases }: { initialCases: ResearchCase[] }) {
  const [cases, setCases] = useState(initialCases);
  const [draft, setDraft] = useState(initialDraft);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function createCase() {
    setStatus("loading");
    const response = await fetch("/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        question: draft.question,
        focus: draft.focus,
        hypotheses: draft.firstHypothesis
          ? [
              {
                id: "hyp-draft",
                statement: draft.firstHypothesis,
                confidence: 0.45,
                status: "open"
              }
            ]
          : [],
        evidence: draft.firstEvidence
          ? [
              {
                id: "ev-draft",
                title: "Initial evidence note",
                type: "Research note",
                summary: draft.firstEvidence,
                confidence: 0.5
              }
            ]
          : []
      })
    });

    if (!response.ok) {
      setStatus("error");
      return;
    }

    const created = (await response.json()) as ResearchCase;
    setCases((current) => [created, ...current]);
    setStatus("idle");
  }

  return (
    <>
      <div className="app-grid">
        <div className="app-card">
          <h2>Investigation cases</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Question</th>
                <th>Status</th>
                <th>Hypotheses</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((researchCase) => (
                <tr key={researchCase.id}>
                  <td>
                    <Link href={`/app/cases/${researchCase.id}`}>{researchCase.title}</Link>
                    <div className="muted">{researchCase.focus}</div>
                  </td>
                  <td>{researchCase.question}</td>
                  <td>
                    <Status tone={researchCase.status === "planning" ? "warning" : "ok"}>{researchCase.status}</Status>
                  </td>
                  <td>{researchCase.hypotheses.length}</td>
                  <td>
                    {researchCase.evidence.length}
                    {countDnaEvidence(researchCase) ? <div className="muted">{countDnaEvidence(researchCase)} DNA</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="app-card">
          <h2>New case</h2>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <Field label="Title" value={draft.title} onChange={(value) => setDraft({ ...draft, title: value })} />
            <TextArea label="Research question" value={draft.question} onChange={(value) => setDraft({ ...draft, question: value })} />
            <Field label="Focus" value={draft.focus} onChange={(value) => setDraft({ ...draft, focus: value })} />
            <TextArea label="First hypothesis" value={draft.firstHypothesis} onChange={(value) => setDraft({ ...draft, firstHypothesis: value })} />
            <TextArea label="First evidence note" value={draft.firstEvidence} onChange={(value) => setDraft({ ...draft, firstEvidence: value })} />
            <button className="button" disabled={status === "loading"} onClick={createCase}>
              {status === "loading" ? "Creating..." : "Create case"}
            </button>
            {status === "error" ? <Status tone="warning">Case creation failed</Status> : null}
          </div>
        </aside>
      </div>

      <div className="app-card" style={{ marginTop: 20 }}>
        <h2>Evidence confidence</h2>
        <div className="evidence-list">
          {cases.flatMap((researchCase) => researchCase.evidence).map((evidence) => (
            <div className="evidence-item" key={evidence.id}>
              <div className="evidence-item-heading">
                <strong>{evidence.title}</strong>
                {evidence.linkedDnaMatchId ? <Status tone="warning">DNA linked</Status> : <Status>{evidence.type}</Status>}
              </div>
              <p className="muted">{evidence.summary}</p>
              <Confidence value={evidence.confidence} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function countDnaEvidence(researchCase: ResearchCase): number {
  return researchCase.evidence.filter((evidence) => evidence.linkedDnaMatchId).length;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
