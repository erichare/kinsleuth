"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Status } from "./ui";

export function ArchiveBrandingForm({
  initialName,
  initialTagline,
  publicArchiveEnabled = true
}: {
  initialName: string;
  initialTagline: string;
  publicArchiveEnabled?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [tagline, setTagline] = useState(initialTagline);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/settings/archive", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, tagline })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Save failed");
        setStatus("error");
        return;
      }

      const saved = (await response.json()) as { name: string; tagline: string };
      setName(saved.name);
      setTagline(saved.tagline);
      setStatus("saved");
      router.refresh();
    } catch {
      setErrorMessage("Save failed. Check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <form aria-busy={status === "saving"} className="form-grid" style={{ gridTemplateColumns: "1fr" }} onSubmit={save}>
      <label className="field">
        <span>Archive name</span>
        <input
          maxLength={120}
          name="archive-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        <span>Tagline</span>
        <input
          maxLength={200}
          name="archive-tagline"
          placeholder={publicArchiveEnabled ? "Family history. Openly shared." : "Private family research."}
          value={tagline}
          onChange={(event) => setTagline(event.target.value)}
        />
      </label>
      <button className="button" disabled={status === "saving"} type="submit">
        {status === "saving" ? "Saving..." : "Save branding"}
      </button>
      {status === "saved" ? (
        <span aria-atomic="true" role="status">
          <Status>
            {publicArchiveEnabled
              ? "Saved. The new name appears across the workspace and public archive."
              : "Saved. The new name appears across the private workspace."}
          </Status>
        </span>
      ) : null}
      {status === "error" && errorMessage ? (
        <span aria-atomic="true" role="alert">
          <Status tone="warning">{errorMessage}</Status>
        </span>
      ) : null}
    </form>
  );
}
