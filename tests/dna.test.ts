import { describe, expect, it } from "vitest";
import { createDnaConnectionHypothesis, plausibleRelationships, scoreDnaMatch } from "@/lib/dna";
import { demoDnaMatches, demoPeople } from "@/lib/demo-data";

describe("DNA triage", () => {
  it("scores matches with trees, side hints, surnames, places, and shared matches higher", () => {
    const strong = scoreDnaMatch(demoDnaMatches[0]);
    const weak = scoreDnaMatch(demoDnaMatches[2]);

    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThanOrEqual(70);
  });

  it("returns plausible relationship ranges for 86 cM", () => {
    const labels = plausibleRelationships(86).map((range) => range.label);

    expect(labels).toContain("2C");
    expect(labels).toContain("2C1R");
  });

  it("creates branch, geography, evidence, and uncertainty hypotheses", () => {
    const hypothesis = createDnaConnectionHypothesis(demoDnaMatches[0], demoPeople);

    expect(hypothesis.likelyBranch).toBe("Paternal branch");
    expect(hypothesis.geography).toContain("Northstar Cove, Nova Scotia");
    expect(hypothesis.candidateCommonAncestors).toContain("Samuel Rowan Mercer");
    expect(hypothesis.evidence.length).toBeGreaterThan(3);
    expect(hypothesis.uncertainty.length).toBeGreaterThan(1);
  });

  it("falls back to the closest relationship when shared cM exceeds every range", () => {
    const hypothesis = createDnaConnectionHypothesis({ ...demoDnaMatches[0], totalCm: 3800 }, demoPeople);

    expect(hypothesis.likelyGeneration).toBe("direct parent-child");
  });

  it("matches surnames and places case-insensitively", () => {
    const hypothesis = createDnaConnectionHypothesis(
      { ...demoDnaMatches[0], surnames: ["MERCER"], places: ["northstar cove, nova scotia"] },
      demoPeople
    );

    expect(hypothesis.candidateCommonAncestors).toContain("Samuel Rowan Mercer");
  });
});
