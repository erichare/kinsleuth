import { describe, expect, it } from "vitest";

import { isGuidedResearchEnabled } from "@/lib/guided-research-config";

describe("guided research rollout configuration", () => {
  it("defaults on so a normal deployment receives the guided loop", () => {
    expect(isGuidedResearchEnabled({})).toBe(true);
  });

  it.each(["false", "FALSE", "0", "off", "no"])("treats %s as disabled", (value) => {
    expect(isGuidedResearchEnabled({ KINRESOLVE_GUIDED_RESEARCH_ENABLED: value })).toBe(false);
  });

  it.each(["true", "1", "on", "yes", "unexpected"])("keeps %s enabled", (value) => {
    expect(isGuidedResearchEnabled({ KINRESOLVE_GUIDED_RESEARCH_ENABLED: value })).toBe(true);
  });
});
