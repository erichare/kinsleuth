"use client";

import { useEffect, useState } from "react";

import { DemoFeedbackForm } from "./demo-feedback-form";

type DemoSessionView = {
  expiresAt: string;
  aiAttemptsRemaining: number;
};

type DemoSessionResponse = Partial<DemoSessionView> & {
  session?: Partial<DemoSessionView>;
  workspaceUrl?: string;
  url?: string;
  error?: string;
};

export function DemoSessionBar() {
  const [session, setSession] = useState<DemoSessionView | null>(null);
  const [pending, setPending] = useState<"reset" | "end" | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [status, setStatus] = useState("Loading demo session details…");

  useEffect(() => {
    let active = true;
    void fetch("/api/demo/session", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session details are temporarily unavailable.");
        return response.json() as Promise<DemoSessionResponse>;
      })
      .then((payload) => {
        if (!active) return;
        const view = sessionView(payload);
        if (!view) throw new Error("Session details are temporarily unavailable.");
        setSession(view);
        setStatus("");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus(error instanceof Error ? error.message : "Session details are temporarily unavailable.");
      });

    return () => {
      active = false;
    };
  }, []);

  async function resetDemo() {
    setPending("reset");
    setStatus("Preparing a fresh fictional archive…");
    const result = await mutateSession("/api/demo/session/reset");
    if (result.ok) {
      window.location.assign(result.destination || "/app");
      return;
    }
    setPending(null);
    setConfirmReset(false);
    setStatus(result.error);
  }

  async function endDemo() {
    setPending("end");
    setStatus("Ending this demo session…");
    const result = await mutateSession("/api/demo/session/end");
    if (result.ok) {
      window.location.assign("/");
      return;
    }
    setPending(null);
    setStatus(result.error);
  }

  return (
    <section aria-label="Demo workspace controls" className="demo-session-bar">
      <div className="demo-session-summary">
        <strong>Demo workspace</strong>
        {session ? (
          <>
            <span>Expires <time dateTime={session.expiresAt}>{formatExpiry(session.expiresAt)}</time></span>
            <span><strong>{session.aiAttemptsRemaining}</strong> AI attempts remaining</span>
          </>
        ) : (
          <span>24-hour fictional sandbox</span>
        )}
      </div>

      <div className="demo-session-actions">
        {!confirmReset ? (
          <button className="button-ghost" disabled={pending !== null} onClick={() => setConfirmReset(true)} type="button">
            Reset demo
          </button>
        ) : (
          <div aria-label="Confirm demo reset" className="demo-reset-confirm" role="group">
            <span>Replace all demo changes?</span>
            <button className="button-secondary" disabled={pending !== null} onClick={resetDemo} type="button">
              {pending === "reset" ? "Resetting…" : "Yes, reset"}
            </button>
            <button className="button-ghost" disabled={pending !== null} onClick={() => setConfirmReset(false)} type="button">
              Cancel
            </button>
          </div>
        )}
        <button className="button-ghost" disabled={pending !== null} onClick={endDemo} type="button">
          {pending === "end" ? "Ending…" : "End demo"}
        </button>
        <details className="demo-feedback">
          <summary>Share feedback</summary>
          <div className="demo-feedback-panel">
            <DemoFeedbackForm />
          </div>
        </details>
      </div>

      <p aria-live="polite" className={status.includes("unavailable") ? "form-error demo-session-status" : "sr-only"} role="status">
        {status}
      </p>
    </section>
  );
}

async function mutateSession(path: string): Promise<{ ok: true; destination?: string } | { ok: false; error: string }> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}"
  }).catch(() => null);
  if (!response) return { ok: false, error: "The demo service could not be reached. Try again." };

  const payload = (await response.json().catch(() => ({}))) as DemoSessionResponse;
  if (!response.ok) {
    return { ok: false, error: payload.error || "The demo action could not be completed. Try again." };
  }
  return { ok: true, destination: payload.workspaceUrl || payload.url };
}

function sessionView(payload: DemoSessionResponse): DemoSessionView | null {
  const value = payload.session ?? payload;
  if (typeof value.expiresAt !== "string" || !Number.isInteger(value.aiAttemptsRemaining)) return null;
  return {
    expiresAt: value.expiresAt,
    aiAttemptsRemaining: value.aiAttemptsRemaining as number
  };
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "within 24 hours";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
