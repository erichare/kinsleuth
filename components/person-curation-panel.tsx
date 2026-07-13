"use client";

import { useState } from "react";
import type { PersonSummary, PrivacyLevel } from "@/lib/models";
import { Status } from "./ui";

export function PersonCurationPanel({ person }: { person: PersonSummary }) {
  const [published, setPublished] = useState(person.published);
  const [privacy, setPrivacy] = useState<PrivacyLevel>(person.privacy);
  const [livingStatus, setLivingStatus] = useState<PersonSummary["livingStatus"]>(person.livingStatus);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    setStatus("saving");
    try {
      const response = await fetch(`/api/people/${encodeURIComponent(person.id)}/curation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ published, privacy, livingStatus })
      });
      setStatus(response.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="panel curation-panel" style={{ boxShadow: "none" }}>
      <strong>Public curation</strong>
      <p className="muted">Review privacy before a profile appears on public pages.</p>
      <div aria-busy={status === "saving"} className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <label className="check-row">
          <input checked={published} type="checkbox" onChange={(event) => setPublished(event.target.checked)} />
          Published
        </label>
        <label className="field">
          <span>Privacy</span>
          <select value={privacy} onChange={(event) => setPrivacy(event.target.value as PrivacyLevel)}>
            <option value="private">Private</option>
            <option value="sensitive">Sensitive</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label className="field">
          <span>Living status</span>
          <select value={livingStatus} onChange={(event) => setLivingStatus(event.target.value as PersonSummary["livingStatus"])}>
            <option value="unknown">Unknown</option>
            <option value="living">Living</option>
            <option value="deceased">Deceased</option>
          </select>
        </label>
        <button aria-busy={status === "saving"} className="button" disabled={status === "saving"} onClick={save} type="button">
          {status === "saving" ? "Saving..." : "Save curation"}
        </button>
        {status === "saved" ? (
          <span aria-atomic="true" role="status">
            <Status>Saved</Status>
          </span>
        ) : null}
        {status === "error" ? (
          <span aria-atomic="true" role="alert">
            <Status tone="warning">Save failed</Status>
          </span>
        ) : null}
      </div>
    </div>
  );
}
