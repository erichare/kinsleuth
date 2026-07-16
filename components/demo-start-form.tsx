"use client";

import { useState, type FormEvent } from "react";

import {
  publicDemoGuidedStartPath,
  publicDemoNoticeVersion
} from "@/lib/public-demo-contract";

type StartResponse = {
  workspaceUrl?: string;
  url?: string;
  error?: string;
};

export function DemoStartForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function startDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/demo/sessions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noticeVersion: publicDemoNoticeVersion })
      });
      const payload = (await response.json().catch(() => ({}))) as StartResponse;
      if (!response.ok) {
        throw new Error(payload.error || "The demo is busy right now. Try again in a moment.");
      }

      window.location.assign(payload.workspaceUrl || payload.url || publicDemoGuidedStartPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The demo could not start. Please try again.");
      setPending(false);
    }
  }

  return (
    <form action="/api/demo/sessions" method="post" onSubmit={startDemo}>
      <input name="noticeVersion" type="hidden" value={publicDemoNoticeVersion} />
      <button className="button" disabled={pending} type="submit">
        {pending ? "Preparing your workspace…" : "Start guided demo"}
      </button>
      <p aria-live="polite" className={error ? "form-error" : "sr-only"} role={error ? "alert" : "status"}>
        {error || (pending ? "Preparing a private fictional workspace." : "")}
      </p>
    </form>
  );
}
