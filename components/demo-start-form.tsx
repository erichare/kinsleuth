"use client";

import { useEffect, useState, type FormEvent } from "react";

import { recordPlausibleEvent } from "@/lib/plausible-client";
import {
  publicDemoGuidedStartPath,
  publicDemoNoticeVersion
} from "@/lib/public-demo-contract";

type StartResponse = {
  workspaceUrl?: string;
  url?: string;
  error?: string;
  familyUrl?: string;
  challengeUrl?: string;
};

export function DemoStartForm() {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const readyTimer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(readyTimer);
  }, []);

  async function startDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setShowFallback(false);

    try {
      const response = await fetch("/api/demo/sessions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noticeVersion: publicDemoNoticeVersion })
      });
      const payload = (await response.json().catch(() => ({}))) as StartResponse;
      if (!response.ok) {
        setError(payload.error || "The demo is busy right now. Try again in a moment.");
        setShowFallback(
          response.status === 429
          && payload.familyUrl === "/family"
          && payload.challengeUrl === "/challenge"
        );
        setPending(false);
        return;
      }

      recordPlausibleEvent("demo_session_started");
      window.location.assign(payload.workspaceUrl || payload.url || publicDemoGuidedStartPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The demo could not start. Please try again.");
      setPending(false);
    }
  }

  return (
    <form action="/api/demo/sessions" method="post" onSubmit={startDemo}>
      <input name="noticeVersion" type="hidden" value={publicDemoNoticeVersion} />
      <button className="button" disabled={!ready || pending} type="submit">
        {pending ? "Preparing your workspace…" : "Start guided demo"}
      </button>
      <div aria-live="polite" className={error ? "form-error" : "sr-only"} role={error ? "alert" : "status"}>
        <p>{error || (pending ? "Preparing a private fictional workspace." : "")}</p>
        {showFallback ? (
          <nav aria-label="Other fictional demo options">
            <a href="/family">Explore the fictional family</a>
            {" · "}
            <a href="/challenge">Try the research challenge</a>
          </nav>
        ) : null}
      </div>
    </form>
  );
}
