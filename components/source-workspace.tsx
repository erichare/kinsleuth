"use client";

import { useMemo, useState } from "react";
import type { PersonSummary, ResearchCase, SourceDocument } from "@/lib/models";
import { Confidence, Status } from "./ui";

type Props = {
  initialSources: SourceDocument[];
  people: PersonSummary[];
  cases: ResearchCase[];
};

const initialForm = {
  title: "",
  sourceType: "Document",
  repository: "",
  citationDate: "",
  linkedPersonId: "",
  linkedCaseId: "",
  transcript: "",
  notes: "",
  privacy: "private",
  confidence: "0.70"
};

export function SourceWorkspace({ initialSources, people, cases }: Props) {
  const [sources, setSources] = useState(initialSources);
  const [form, setForm] = useState(initialForm);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person.displayName])), [people]);
  const casesById = useMemo(() => new Map(cases.map((researchCase) => [researchCase.id, researchCase.title])), [cases]);

  async function saveSource() {
    setStatus("saving");
    setError("");

    const formData = new FormData();
    for (const [key, value] of Object.entries(form)) {
      formData.set(key, value);
    }
    if (file) {
      formData.set("file", file);
    }

    const response = await fetch("/api/uploads", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      setStatus("error");
      setError(await response.text());
      return;
    }

    const created = (await response.json()) as SourceDocument;
    setSources((current) => [created, ...current.filter((source) => source.id !== created.id)]);
    setForm(initialForm);
    setFile(null);
    setStatus("idle");
  }

  return (
    <>
      <div className="app-grid">
        <section className="app-card">
          <h2>Source register</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Linked to</th>
                <th>Privacy</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id}>
                  <td>
                    <strong>{source.title}</strong>
                    <div className="muted">
                      {source.fileName ?? "Transcript only"} · {source.repository || "No repository yet"}
                    </div>
                  </td>
                  <td>{source.sourceType}</td>
                  <td>
                    {source.linkedPersonId ? <div>{peopleById.get(source.linkedPersonId) ?? source.linkedPersonId}</div> : null}
                    {source.linkedCaseId ? <div>{casesById.get(source.linkedCaseId) ?? source.linkedCaseId}</div> : null}
                    {!source.linkedPersonId && !source.linkedCaseId ? <span className="muted">Unlinked</span> : null}
                  </td>
                  <td>
                    <Status tone={source.privacy === "public" ? "ok" : source.privacy === "sensitive" ? "warning" : "private"}>{source.privacy}</Status>
                  </td>
                  <td>
                    <Confidence value={source.confidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="app-card">
          <h2>Add source</h2>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <Field label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
            <Field label="Type" value={form.sourceType} onChange={(value) => setForm({ ...form, sourceType: value })} />
            <Field label="Repository" value={form.repository} onChange={(value) => setForm({ ...form, repository: value })} />
            <Field label="Citation date" value={form.citationDate} onChange={(value) => setForm({ ...form, citationDate: value })} />
            <SelectField label="Linked person" value={form.linkedPersonId} onChange={(value) => setForm({ ...form, linkedPersonId: value })}>
              <option value="">Unlinked</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </SelectField>
            <SelectField label="Linked case" value={form.linkedCaseId} onChange={(value) => setForm({ ...form, linkedCaseId: value })}>
              <option value="">Unlinked</option>
              {cases.map((researchCase) => (
                <option key={researchCase.id} value={researchCase.id}>
                  {researchCase.title}
                </option>
              ))}
            </SelectField>
            <SelectField label="Privacy" value={form.privacy} onChange={(value) => setForm({ ...form, privacy: value })}>
              <option value="private">Private</option>
              <option value="sensitive">Sensitive</option>
              <option value="public">Public</option>
            </SelectField>
            <Field label="Confidence 0-1" value={form.confidence} onChange={(value) => setForm({ ...form, confidence: value })} />
            <div className="field">
              <label>File</label>
              <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </div>
            <TextArea label="Transcript" value={form.transcript} onChange={(value) => setForm({ ...form, transcript: value })} />
            <TextArea label="Notes" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
            <button className="button" disabled={status === "saving"} onClick={saveSource}>
              {status === "saving" ? "Saving..." : "Save source"}
            </button>
            {status === "error" ? <Status tone="warning">Upload failed</Status> : null}
            {error ? <p className="muted">{error}</p> : null}
          </div>
        </aside>
      </div>

      <section className="app-card" style={{ marginTop: 20 }}>
        <h2>Transcripts</h2>
        <div className="evidence-list">
          {sources.filter((source) => source.transcript).map((source) => (
            <div className="evidence-item" key={source.id}>
              <strong>{source.title}</strong>
              <p>{source.transcript}</p>
              {source.notes ? <p className="muted">{source.notes}</p> : null}
            </div>
          ))}
        </div>
      </section>
    </>
  );
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

function SelectField({ label, value, children, onChange }: { label: string; value: string; children: React.ReactNode; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </div>
  );
}
