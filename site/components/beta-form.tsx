"use client";

import { FormEvent, useMemo, useState } from "react";
import { site } from "@/lib/site";

function field(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

export function BetaForm() {
  const [status, setStatus] = useState<"idle" | "copied" | "copy-failed" | "routing-pending">("idle");
  const mailSubject = useMemo(() => encodeURIComponent("Kin Resolve private beta interest"), []);

  function applicationBody(form: FormData) {
    return [
      "Kin Resolve private beta interest",
      "",
      `Name: ${field(form, "name")}`,
      `Email: ${field(form, "email")}`,
      `Research role: ${field(form, "role")}`,
      `Current software: ${field(form, "software") || "Not provided"}`,
      `Approximate archive size: ${field(form, "archiveSize") || "Not provided"}`,
      `Interested in: ${field(form, "interest")}`,
      "",
      "Primary research problem:",
      field(form, "problem"),
      "",
      `Feedback sessions: ${field(form, "feedback")}`,
      "",
      `Consent to beta communications: ${field(form, "consent") ? "Yes" : "No"}`
    ].join("\n");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!site.betaIntakeReady) {
      setStatus("routing-pending");
      return;
    }
    const form = new FormData(event.currentTarget);
    const body = encodeURIComponent(applicationBody(form));
    window.location.href = `mailto:${site.betaEmail}?subject=${mailSubject}&body=${body}`;
  }

  async function copyApplication() {
    const form = document.querySelector<HTMLFormElement>("#beta-interest-form");
    if (!form) return;
    if (!form.reportValidity()) {
      setStatus("idle");
      return;
    }
    const body = applicationBody(new FormData(form));
    try {
      await navigator.clipboard.writeText(body);
      setStatus("copied");
    } catch {
      setStatus("copy-failed");
    }
  }

  return (
    <form
      action={`mailto:${site.betaEmail}?subject=${mailSubject}`}
      className="beta-form"
      encType="text/plain"
      id="beta-interest-form"
      method="post"
      onSubmit={handleSubmit}
    >
      <div className="form-grid">
        <label>
          <span>Name</span>
          <input autoComplete="name" name="name" required />
        </label>
        <label>
          <span>Email</span>
          <input autoComplete="email" name="email" required type="email" />
        </label>
        <label>
          <span>I’m a…</span>
          <select defaultValue="" name="role" required>
            <option disabled value="">Select one</option>
            <option>Family historian</option>
            <option>Professional genealogist</option>
            <option>Genealogical society member</option>
            <option>Developer or self-hoster</option>
            <option>Other researcher</option>
          </select>
        </label>
        <label>
          <span>Current genealogy software</span>
          <input name="software" placeholder="Optional" />
        </label>
        <label>
          <span>Approximate archive size</span>
          <select defaultValue="" name="archiveSize">
            <option value="">Prefer not to say</option>
            <option>Under 1,000 people</option>
            <option>1,000–10,000 people</option>
            <option>10,000–50,000 people</option>
            <option>More than 50,000 people</option>
          </select>
        </label>
        <label>
          <span>Most interested in</span>
          <select defaultValue="" name="interest" required>
            <option disabled value="">Select one</option>
            <option>Hosted private beta</option>
            <option>Self-hosting</option>
            <option>Both hosted and self-hosted</option>
          </select>
        </label>
      </div>
      <label>
        <span>What research problem would you bring to the beta?</span>
        <textarea name="problem" required rows={5} placeholder="Describe the workflow or unresolved question—not personal records or DNA details." />
      </label>
      <fieldset>
        <legend>Would you participate in an occasional feedback session?</legend>
        <label className="radio-label"><input defaultChecked name="feedback" type="radio" value="Yes" /> Yes</label>
        <label className="radio-label"><input name="feedback" type="radio" value="Maybe" /> Maybe</label>
        <label className="radio-label"><input name="feedback" type="radio" value="No" /> No</label>
      </fieldset>
      <label className="consent-label">
        <input name="consent" required type="checkbox" />
        <span>I agree to receive Kin Resolve beta communications. I understand this page opens my email app and does not store this form on the website.</span>
      </label>
      <div className="form-warning">
        <strong>Keep family data out of this application.</strong>
        <span>Do not include names of living people, record images, GEDCOM files, DNA files, or genetic information.</span>
      </div>
      <div className="form-actions">
        <button className="button" disabled={!site.betaIntakeReady} type="submit">
          {site.betaIntakeReady ? "Open email application" : "Email routing pending"}
        </button>
        <button className="button button-secondary" onClick={copyApplication} type="button">
          {status === "copied" ? "Application copied" : status === "copy-failed" ? "Copy unavailable" : "Copy application"}
        </button>
      </div>
      <p className="form-note" aria-live="polite">
        {status === "copied"
          ? "Application copied to your clipboard."
          : status === "copy-failed"
            ? "The browser could not copy the application. Select the form text manually or try a secure browser context."
            : status === "routing-pending"
              ? "Email routing is not active yet."
              : site.betaIntakeReady
                ? `Submitting opens your email application with the completed form addressed to ${site.betaEmail}. Nothing is stored on this site.`
                : "Email routing is not active in this protected preview. You can review and copy the application format; sending stays disabled until the mailbox is verified."}
      </p>
    </form>
  );
}
