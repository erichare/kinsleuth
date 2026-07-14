import { describe, expect, it } from "vitest";
import { demoCases, demoDnaMatches, demoPeople } from "@/lib/demo-data";
import { buildQualityReport, buildQualityReportPage } from "@/lib/quality";

describe("quality reports", () => {
  it("summarizes source, DNA, and case quality counts", () => {
    const report = buildQualityReport(demoPeople, demoDnaMatches, demoCases);

    expect(report.score).toBeLessThan(100);
    expect(report.summary.sourceGaps).toBeGreaterThan(0);
    expect(report.summary.dnaGaps).toBe(0);
    expect(report.summary.caseGaps).toBe(0);
    expect(report.issues[0].severity).toMatch(/high|medium/);
  });

  it("flags high-cM DNA matches without a usable tree", () => {
    const report = buildQualityReport([], [{ ...demoDnaMatches[0], treeStatus: "none", totalCm: 247 }], []);

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "dna",
          severity: "high"
        })
      ])
    );
  });

  it("paginates issue rows while preserving report summary", () => {
    const report = buildQualityReportPage(demoPeople, demoDnaMatches, demoCases, { page: 1, pageSize: 2 });

    expect(report.issues.items).toHaveLength(1);
    expect(report.issues.total).toBe(1);
    expect(report.summary.sourceGaps).toBeGreaterThan(0);
  });

  it("keeps issue ids unique when imported people produce duplicate anomaly titles", () => {
    const duplicatePeople = [
      {
        ...demoPeople[0],
        id: "dup-1",
        displayName: "Same Name",
        facts: [{ id: "dup-1-birth", type: "BIRT", date: "1927", confidence: 0.45 }]
      },
      {
        ...demoPeople[0],
        id: "dup-2",
        displayName: "Same Name",
        facts: [{ id: "dup-2-birth", type: "BIRT", date: "1928", confidence: 0.45 }]
      }
    ];
    const report = buildQualityReport(duplicatePeople, [], []);
    const ids = report.issues.map((issue) => issue.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
