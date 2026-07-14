type GuidedResearchEnvironment = Readonly<Record<string, string | undefined>>;

const disabledValues = new Set(["0", "false", "no", "off"]);

export function isGuidedResearchEnabled(
  environment: GuidedResearchEnvironment = process.env
): boolean {
  const configured = environment.KINRESOLVE_GUIDED_RESEARCH_ENABLED?.trim().toLowerCase();
  return configured === undefined || !disabledValues.has(configured);
}
