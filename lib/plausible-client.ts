/**
 * Fixed-name, aggregate Plausible events for the public demo. The database
 * event funnel (`public_demo_events`) remains the KPI source of truth; these
 * browser events are additive, carry no props or personal details, and are
 * no-ops unless the env-gated Plausible script is loaded.
 */
export type PlausibleDemoEventName =
  | "demo_session_started"
  | "mystery_outcome_recorded"
  | "beta_cta_clicked";

declare global {
  interface Window {
    plausible?: (eventName: string) => void;
  }
}

export function recordPlausibleEvent(eventName: PlausibleDemoEventName): void {
  if (typeof window === "undefined") return;
  try {
    window.plausible?.(eventName);
  } catch {
    // Optional aggregate analytics must never affect the demo experience.
  }
}
