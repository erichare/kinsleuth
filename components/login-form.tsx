"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { toPublicLoginError } from "@/lib/login-error";
import { Status } from "./ui";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState(toPublicLoginError(undefined));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");

    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setMessage(toPublicLoginError(result.error));
        setStatus("error");
        return;
      }

      window.location.assign(nextPath || "/app");
    } catch (error) {
      setMessage(toPublicLoginError(error));
      setStatus("error");
    }
  }

  return (
    <form aria-busy={status === "loading"} className="form-grid" style={{ gridTemplateColumns: "1fr" }} onSubmit={submit}>
      <label className="field">
        <span>Email</span>
        <input
          autoComplete="email"
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          aria-describedby={status === "error" ? "login-password-error" : undefined}
          aria-invalid={status === "error"}
          autoComplete="current-password"
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button aria-busy={status === "loading"} className="button" disabled={status === "loading"} type="submit">
        {status === "loading" ? "Signing in..." : "Sign in"}
      </button>
      {status === "error" ? (
        <span aria-atomic="true" id="login-password-error" role="alert">
          <Status tone="warning">{message}</Status>
        </span>
      ) : null}
    </form>
  );
}
