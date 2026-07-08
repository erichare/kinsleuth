import { describe, expect, it } from "vitest";
import { demoPeople } from "@/lib/demo-data";
import { buildPublicationPlan, evaluatePublicationReadiness } from "@/lib/publishing";
import type { PersonSummary } from "@/lib/models";

describe("publishing readiness", () => {
  it("marks the curated public demo profile ready", () => {
    const profile = evaluatePublicationReadiness(demoPeople[0]);

    expect(profile.status).toBe("ready");
    expect(profile.previewPath).toBe(`/people/${demoPeople[0].slug}`);
    expect(profile.sourceCoverage).toBe(100);
    expect(profile.blockerCount).toBe(0);
  });

  it("blocks private profiles before publication", () => {
    const profile = evaluatePublicationReadiness(demoPeople[1]);

    expect(profile.status).toBe("blocked");
    expect(profile.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "privacy",
          severity: "blocker"
        })
      ])
    );
  });

  it("blocks living people even when their facts look public", () => {
    const livingPerson: PersonSummary = {
      ...demoPeople[0],
      id: "p-living-test",
      displayName: "Living Test Person",
      livingStatus: "living",
      published: false
    };

    const profile = evaluatePublicationReadiness(livingPerson);

    expect(profile.status).toBe("blocked");
    expect(profile.recommendedAction).toContain("Resolve blockers");
  });

  it("summarizes the publication queue", () => {
    const plan = buildPublicationPlan(demoPeople);

    expect(plan.summary.total).toBe(demoPeople.length);
    expect(plan.summary.ready).toBe(1);
    expect(plan.summary.blocked).toBeGreaterThan(0);
    expect(plan.profiles[0].status).toBe("blocked");
  });
});
