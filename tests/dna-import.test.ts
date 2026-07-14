import { describe, expect, it } from "vitest";
import { parseCsvRows } from "@/lib/csv";
import { mapDnaCsvRows } from "@/lib/dna-import";

describe("DNA CSV import mapping", () => {
  it("maps common Ancestry-style columns into DNA matches", () => {
    const csv = [
      "Match Name,Shared cM,Longest Segment,Predicted Relationship,Side,Tree Status,Surnames,Places,Shared Matches,Notes,Ancestry URL",
      '"J. Mercer","86 cM",12.7,likely 3C,maternal,partial,"Mercer; Hartwell","Lantern Bay; Northstar Cove","M. March; A. Bellandi","Useful partial tree",https://example.test/match'
    ].join("\n");
    const result = mapDnaCsvRows(parseCsvRows(csv));

    expect(result.skipped).toEqual([]);
    expect(result.matches[0]).toMatchObject({
      displayName: "J. Mercer",
      totalCm: 86,
      longestSegmentCm: 12.7,
      predictedRelationship: "likely 3C",
      side: "maternal",
      treeStatus: "partial",
      surnames: ["Mercer", "Hartwell"],
      places: ["Lantern Bay", "Northstar Cove"],
      sharedMatches: ["M. March", "A. Bellandi"],
      ancestryUrl: "https://example.test/match"
    });
  });

  it("classifies unlinked trees as partial rather than public", () => {
    const csv = "Name,cM,Tree\nUnlinked Match,120,Unlinked tree\nLinked Match,130,Linked public tree";
    const result = mapDnaCsvRows(parseCsvRows(csv));

    expect(result.matches[0]).toMatchObject({ displayName: "Unlinked Match", treeStatus: "partial" });
    expect(result.matches[1]).toMatchObject({ displayName: "Linked Match", treeStatus: "public" });
  });

  it("reports skipped rows without rejecting valid rows", () => {
    const csv = "Name,cM,Tree\nNo cM,,public\nValid Match,61,Public linked tree";
    const result = mapDnaCsvRows(parseCsvRows(csv));

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      displayName: "Valid Match",
      treeStatus: "public"
    });
    expect(result.skipped).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        reason: "missing numeric shared cM"
      })
    ]);
  });
});
