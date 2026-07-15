"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Status } from "./ui";

export function SetupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("Could not create the account");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");

    try {
      const result = await authClient.signUp.email({
        name: name.trim() || email.split("@")[0] || "Owner",
        email,
        password
      });
      if (result.error) {
        setMessage(result.error.message || "Could not create the account");
        setStatus("error");
        return;
      }

      // Claims the owner membership on the default self-hosted archive; the
      // self-hosted server also heals this if the request never lands.
      await fetch("/api/setup/claim", { method: "POST" }).catch(() => undefined);
      window.location.assign("/app");
    } catch {
      setMessage("Could not create the account. Try again.");
      setStatus("error");
    }
  }

  return (
    <form aria-busy={status === "loading"} className="form-grid" style={{ gridTemplateColumns: "1fr" }} onSubmit={submit}>
      <label className="field">
        <span>Name</span>
        <input autoComplete="name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span>Email</span>
        <input autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field">
        <span>Password (at least 10 characters)</span>
        <input
          autoComplete="new-password"
          minLength={10}
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button aria-busy={status === "loading"} className="button" disabled={status === "loading"} type="submit">
        {status === "loading" ? "Creating account..." : "Create owner account"}
      </button>
      {status === "error" ? (
        <span aria-atomic="true" role="alert">
          <Status tone="warning">{message}</Status>
        </span>
      ) : null}
    </form>
  );
}
