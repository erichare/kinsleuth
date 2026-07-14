import { describe, expect, it } from "vitest";
import type { DnaMatch } from "@/lib/models";
import { filterDnaMatches, helpfulnessBucket, paginateDnaMatches, type ScoredDnaMatch } from "@/lib/dna-search";

const matches: ScoredDnaMatch[] = [
  scored(
    {
      id: "dna-march",
      displayName: "J. March",
      totalCm: 86,
      predictedRelationship: "likely 3C",
      side: "maternal",
      treeStatus: "partial",
      surnames: ["March", "Hartwell"],
      places: ["Lantern Bay", "Northstar Cove"],
      sharedMatches: ["A. Bellandi"],
      notes: "Partial tree with Lantern Bay overlap.",
      triageStatus: "high_priority"
    },
    92
  ),
  scored(
    {
      id: "dna-mercer",
      displayName: "L. Mercer",
      totalCm: 64,
      predictedRelationship: "likely 3C",
      side: "paternal",
      treeStatus: "none",
      surnames: [],
      places: ["Ceraluna Alta"],
      sharedMatches: [],
      notes: "",
      triageStatus: "needs_review"
    },
    39
  ),
  scored(
    {
      id: "dna-bellandi",
      displayName: "A. Bellandi",
      totalCm: 143,
      predictedRelationship: "likely 3C",
      side: "maternal",
      treeStatus: "public",
      surnames: ["Bellandi"],
      places: ["Lantern Bay"],
      sharedMatches: ["J. March"],
      notes: "Public tree.",
      triageStatus: "triaged"
    },
    88
  )
];

describe("DNA match search", () => {
  it("searches match names, surnames, places, and notes", () => {
    expect(filterDnaMatches(matches, { query: "hartwell lantern" }).map((match) => match.id)).toEqual(["dna-march"]);
    expect(filterDnaMatches(matches, { query: "ceraluna alta" }).map((match) => match.id)).toEqual(["dna-mercer"]);
  });

  it("filters by side, tree status, triage status, and helpfulness", () => {
    expect(filterDnaMatches(matches, { side: "maternal" }).map((match) => match.id)).toEqual(["dna-march", "dna-bellandi"]);
    expect(filterDnaMatches(matches, { treeStatus: "none" }).map((match) => match.id)).toEqual(["dna-mercer"]);
    expect(filterDnaMatches(matches, { status: "triaged" }).map((match) => match.id)).toEqual(["dna-bellandi"]);
    expect(filterDnaMatches(matches, { helpfulness: "low" }).map((match) => match.id)).toEqual(["dna-mercer"]);
  });

  it("sorts by helpfulness by default and paginates safely", () => {
    const filtered = filterDnaMatches(matches);
    const page = paginateDnaMatches(filtered, 3, 2);

    expect(filtered.map((match) => match.id)).toEqual(["dna-march", "dna-bellandi", "dna-mercer"]);
    expect(page.page).toBe(2);
    expect(page.items.map((match) => match.id)).toEqual(["dna-mercer"]);
  });

  it("buckets helpfulness scores", () => {
    expect(helpfulnessBucket(82)).toBe("high");
    expect(helpfulnessBucket(55)).toBe("medium");
    expect(helpfulnessBucket(12)).toBe("low");
  });
});

function scored(match: Omit<DnaMatch, "longestSegmentCm">, helpfulnessScore: number): ScoredDnaMatch {
  return { ...match, helpfulnessScore };
}
