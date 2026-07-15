"use client";

import { useState } from "react";

const deletionConfirmation = "REQUEST DELETION REVIEW";

export function DataPortabilityControl() {
  const [exportState, setExportState] = useState<"idle" | "working">("idle");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string>();

  async function downloadResearchArchive() {
    setExportState("working");
    setMessage(undefined);
    try {
      const response = await fetch("/api/exports/research-archive", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error("export-failed");
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileName = /filename="([a-z0-9._-]+)"/i.exec(disposition)?.[1]
        ?? "kin-resolve-research-archive.json";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Your structured research archive is ready.");
    } catch {
      setMessage("The research archive could not be prepared. Please try again.");
    } finally {
      setExportState("idle");
    }
  }

  async function requestDeletionReview() {
    setMessage(undefined);
    try {
      const response = await fetch("/api/data-operations/deletion-request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation })
      });
      if (!response.ok) throw new Error("request-failed");
      setConfirmation("");
      setMessage("Deletion review requested. Support will verify your export and the isolated-cell teardown with you.");
    } catch {
      setMessage(`Type ${deletionConfirmation} exactly before requesting deletion review.`);
    }
  }

  return (
    <section className="app-card" style={{ marginTop: 20 }}>
      <div className="app-card-header">
        <div>
          <h2>Your data</h2>
          <p className="muted">
            GEDCOM covers the family tree. The structured archive also includes cases, evidence, tasks, source notes, import history, and your beta legal record.
          </p>
        </div>
        <button
          className="button-secondary"
          disabled={exportState === "working"}
          onClick={downloadResearchArchive}
          type="button"
        >
          {exportState === "working" ? "Preparing…" : "Download research archive"}
        </button>
      </div>

      <div className="field" style={{ marginTop: 20 }}>
        <span>Request complete deletion review</span>
        <p className="muted">
          This records a request; it does not delete anything immediately. For the private beta, support verifies export, access revocation, both object namespaces, the dedicated database/storage cell, and backup-expiry tracking before final teardown.
        </p>
        <input
          autoComplete="off"
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={deletionConfirmation}
          value={confirmation}
        />
      </div>
      <button
        className="button-secondary"
        disabled={confirmation !== deletionConfirmation}
        onClick={requestDeletionReview}
        type="button"
      >
        Request deletion review
      </button>
      {message ? <p className="muted" role="status" style={{ marginTop: 12 }}>{message}</p> : null}
    </section>
  );
}
