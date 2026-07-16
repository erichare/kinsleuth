"use client";

import { useState, type FormEvent } from "react";

const ratings = [1, 2, 3, 4, 5] as const;

export function DemoFeedbackForm() {
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState("");

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatus("");

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/demo/feedback", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        usefulness: Number(form.get("usefulness")),
        clarity: Number(form.get("clarity")),
        featureInterest: form.get("featureInterest"),
        betaInterest: form.get("betaInterest") === "yes"
      })
    }).catch(() => null);

    if (!response?.ok) {
      setPending(false);
      setStatus("Feedback could not be saved. Your demo work is unaffected.");
      return;
    }

    setPending(false);
    setSubmitted(true);
    setStatus("Thanks—your ratings were saved without free-form text or contact details.");
  }

  return (
    <form className="demo-feedback-form" onSubmit={submitFeedback}>
      <fieldset disabled={pending || submitted}>
        <legend>Was this demo useful?</legend>
        <div className="demo-rating" role="radiogroup" aria-label="Usefulness rating">
          {ratings.map((rating) => (
            <label key={rating}>
              <input name="usefulness" required type="radio" value={rating} />
              <span>{rating}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={pending || submitted}>
        <legend>Was the guided task clear?</legend>
        <div className="demo-rating" role="radiogroup" aria-label="Clarity rating">
          {ratings.map((rating) => (
            <label key={rating}>
              <input name="clarity" required type="radio" value={rating} />
              <span>{rating}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span>What would you explore next?</span>
        <select defaultValue="" disabled={pending || submitted} name="featureInterest" required>
          <option disabled value="">Choose one</option>
          <option value="research-cases">Research cases</option>
          <option value="sources">Sources and citations</option>
          <option value="gedcom">GEDCOM review</option>
          <option value="dna">DNA clues</option>
          <option value="ai">Curated AI analysis</option>
          <option value="public-family">Public family archive</option>
        </select>
      </label>

      <fieldset disabled={pending || submitted}>
        <legend>Interested in the private beta?</legend>
        <div className="demo-feedback-choice">
          <label><input name="betaInterest" required type="radio" value="yes" /> Yes</label>
          <label><input name="betaInterest" required type="radio" value="no" /> Not yet</label>
        </div>
      </fieldset>

      <button className="button" disabled={pending || submitted} type="submit">
        {submitted ? "Feedback saved" : pending ? "Saving…" : "Send ratings"}
      </button>
      <p aria-live="polite" className={status && !submitted ? "form-error" : "muted"} role="status">
        {status}
      </p>
    </form>
  );
}
