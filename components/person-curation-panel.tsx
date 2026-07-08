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
    const response = await fetch(`/api/people/${person.id}/curation`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ published, privacy, livingStatus })
    });

    setStatus(response.ok ? "saved" : "error");
  }

  return (
    <div className="panel curation-panel" style={{ boxShadow: "none" }}>
      <strong>Public curation</strong>
      <p className="muted">Review privacy before a profile appears on public pages.</p>
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <label className="check-row">
          <input checked={published} type="checkbox" onChange={(event) => setPublished(event.target.checked)} />
          Published
        </label>
        <div className="field">
          <label>Privacy</label>
          <select value={privacy} onChange={(event) => setPrivacy(event.target.value as PrivacyLevel)}>
            <option value="private">Private</option>
            <option value="sensitive">Sensitive</option>
            <option value="public">Public</option>
          </select>
        </div>
        <div className="field">
          <label>Living status</label>
          <select value={livingStatus} onChange={(event) => setLivingStatus(event.target.value as PersonSummary["livingStatus"])}>
            <option value="unknown">Unknown</option>
            <option value="living">Living</option>
            <option value="deceased">Deceased</option>
          </select>
        </div>
        <button className="button" disabled={status === "saving"} onClick={save}>
          {status === "saving" ? "Saving..." : "Save curation"}
        </button>
        {status === "saved" ? <Status>Saved</Status> : null}
        {status === "error" ? <Status tone="warning">Save failed</Status> : null}
      </div>
    </div>
  );
}
