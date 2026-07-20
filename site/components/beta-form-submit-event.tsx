"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    plausible?: (eventName: string) => void;
  }
}

/**
 * Records one fixed, aggregate Plausible event when the beta interest form is
 * submitted. No field values, props, or personal details are attached, and the
 * call is a no-op unless the release-gated analytics script is loaded.
 */
export function BetaFormSubmitEvent({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return undefined;
    const recordSubmission = () => {
      window.plausible?.("beta_application_submitted");
    };
    form.addEventListener("submit", recordSubmission);
    return () => form.removeEventListener("submit", recordSubmission);
  }, [formId]);
  return null;
}
