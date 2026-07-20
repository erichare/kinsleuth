export type MarketingAnalyticsMode = "off" | "plausible";

export function parseMarketingAnalyticsMode(value: string | undefined): MarketingAnalyticsMode {
  if (value === undefined || value === "off") return "off";
  if (value === "plausible") return "plausible";
  throw new Error("KINRESOLVE_MARKETING_ANALYTICS must be exactly off or plausible.");
}

export const marketingAnalyticsMode = parseMarketingAnalyticsMode(
  process.env.KINRESOLVE_MARKETING_ANALYTICS
);
