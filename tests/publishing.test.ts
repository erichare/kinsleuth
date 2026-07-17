import { describe, expect, it } from "vitest";
import { demoPeople } from "@/lib/demo-data";
import { buildPublicationPlan, buildPublicationReview, evaluatePublicationReadiness } from "@/lib/publishing";
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
    const privateProfile: PersonSummary = {
      ...demoPeople[1],
      id: "p-private-test",
      slug: "private-test-person",
      privacy: "private",
      published: false
    };
    const profile = evaluatePublicationReadiness(privateProfile);

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

  it("keeps all 16 fictional demo profiles curated and public", () => {
    const plan = buildPublicationPlan(demoPeople);

    expect(plan.summary.total).toBe(demoPeople.length);
    expect(plan.summary.ready).toBe(demoPeople.length - 1);
    expect(plan.summary.needsReview).toBe(1);
    expect(plan.summary.blocked).toBe(0);
    expect(plan.summary.published).toBe(demoPeople.length);
    expect(plan.summary.draft).toBe(0);
    expect(demoPeople).toHaveLength(16);
    expect(demoPeople.every((person) => person.livingStatus === "deceased")).toBe(true);
    expect(demoPeople.every((person) => person.privacy === "public" && person.published)).toBe(true);
    expect(plan.profiles.find((profile) => profile.personId === "p-samuel-mercer")?.status).toBe("needs_review");
  });

  it("paginates profile and blocker review queues", () => {
    const blockedPerson: PersonSummary = {
      ...demoPeople[0],
      id: "p-blocked-review-test",
      slug: "blocked-review-test",
      displayName: "Blocked Review Test",
      privacy: "private",
      published: false
    };
    const review = buildPublicationReview([...demoPeople, blockedPerson], {
      profilePage: 1,
      blockerPage: 1,
      pageSize: 1
    });

    expect(review.profiles.items).toHaveLength(1);
    expect(review.profiles.total).toBe(demoPeople.length + 1);
    expect(review.blockers.items).toHaveLength(1);
    expect(review.summary.blockerCount).toBe(1);
  });
});
