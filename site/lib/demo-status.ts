import { betaStatus } from "@/lib/beta-status";
import { site } from "@/lib/site";

export type MarketingDemoMode = "pending" | "live";

export function parseMarketingDemoMode(value: string | undefined): MarketingDemoMode {
  if (value === undefined || value === "pending") return "pending";
  if (value === "live") return "live";
  throw new Error("KINRESOLVE_MARKETING_DEMO_MODE must be exactly pending or live.");
}

export const marketingDemoMode = parseMarketingDemoMode(
  process.env.KINRESOLVE_MARKETING_DEMO_MODE
);

export const demoLive = marketingDemoMode === "live";

const demoModeStatus = {
  pending: {
    ctaLabel: "Try Kin Resolve",
    ctaHref: site.demoUrl,
    ctaNote: betaStatus.rollout,
    statusLine: "Source available under AGPL-3.0-only."
  },
  live: {
    ctaLabel: "Solve the passenger mystery",
    ctaHref: site.demoUrl,
    ctaNote: "No signup · about 2 minutes · every record is fictional.",
    statusLine: "The public demo is live. The hosted workspace remains an invitation-only private beta."
  }
} as const;

const selectedDemoStatus = demoModeStatus[marketingDemoMode];

export const demoStatus = {
  demoMode: marketingDemoMode,
  ...selectedDemoStatus
} as const;
