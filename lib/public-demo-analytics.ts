import { publicDemoEnabled } from "./public-demo-config";

type Environment = Record<string, string | undefined>;

export type PublicDemoAnalyticsMode = "off" | "plausible";

export function parsePublicDemoAnalyticsMode(
  value: string | undefined
): PublicDemoAnalyticsMode {
  if (value === undefined || value === "off") return "off";
  if (value === "plausible") return "plausible";
  throw new Error("KINRESOLVE_PUBLIC_DEMO_ANALYTICS must be exactly off or plausible.");
}

export function publicDemoAnalyticsMode(
  environment: Environment = process.env
): PublicDemoAnalyticsMode {
  return parsePublicDemoAnalyticsMode(environment.KINRESOLVE_PUBLIC_DEMO_ANALYTICS);
}

/**
 * The cookieless Plausible script is served only when the public demo is
 * enabled AND the analytics mode is explicitly plausible. Self-hosted and
 * private deployments keep the default off and load no analytics script.
 */
export function publicDemoAnalyticsScriptEnabled(
  environment: Environment = process.env
): boolean {
  return publicDemoAnalyticsMode(environment) === "plausible" && publicDemoEnabled(environment);
}
