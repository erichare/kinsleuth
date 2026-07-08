"use client";

import { useState } from "react";
import { Status } from "./ui";

export function LoginForm({ nextPath, authRequired }: { nextPath: string; authRequired: boolean }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, next: nextPath })
    });

    if (!response.ok) {
      setStatus("error");
      return;
    }

    const body = (await response.json()) as { next?: string };
    window.location.assign(body.next || "/app");
  }

  async function openWithoutPassword() {
    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ next: nextPath })
    });
    window.location.assign(nextPath);
  }

  if (!authRequired) {
    return (
      <div className="hero-actions">
        <button className="button" onClick={() => void openWithoutPassword()}>
          Open workspace
        </button>
        <Status tone="warning">Password not configured</Status>
      </div>
    );
  }

  return (
    <form className="form-grid" style={{ gridTemplateColumns: "1fr" }} onSubmit={submit}>
      <div className="field">
        <label>Password</label>
        <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      <button className="button" disabled={status === "loading"} type="submit">
        {status === "loading" ? "Opening..." : "Open workspace"}
      </button>
      {status === "error" ? <Status tone="warning">Invalid password</Status> : null}
    </form>
  );
}
