import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createImportSnapshot, diffImportSnapshots } from "@/lib/gedcom/importer";

describe("import snapshots", () => {
  it("creates stable snapshot summaries", () => {
    const snapshot = createImportSnapshot("demo.ged", "0 HEAD\n0 @I1@ INDI\n1 NAME Test /Person/\n0 TRLR");

    expect(snapshot.records).toHaveLength(3);
    expect(snapshot.summary.individuals).toBe(1);
    expect(snapshot.checksum).toMatch(/[a-f0-9]{8}/);
  });

  it("detects added, changed, deleted, and unchanged records", () => {
    const previous = createImportSnapshot("previous.ged", "0 HEAD\n0 @I1@ INDI\n1 NAME Test /Person/\n0 @I2@ INDI\n1 NAME Gone /Person/\n0 TRLR");
    const next = createImportSnapshot("next.ged", "0 HEAD\n0 @I1@ INDI\n1 NAME Test /Changed/\n0 @I3@ INDI\n1 NAME New /Person/\n0 TRLR");
    const diff = diffImportSnapshots(previous, next);

    expect(diff.changed).toBe(1);
    expect(diff.added).toBe(1);
    expect(diff.deleted).toBe(1);
    expect(diff.unchanged).toBe(2);
  });

  it("reports zero changes for byte-identical files with duplicated records", () => {
    const fixture = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const duplicated = `${fixture}\n${fixture}`;
    const previous = createImportSnapshot("previous.ged", duplicated);
    const next = createImportSnapshot("next.ged", duplicated);
    const diff = diffImportSnapshots(previous, next);

    expect(diff.added).toBe(0);
    expect(diff.changed).toBe(0);
    expect(diff.deleted).toBe(0);
    expect(diff.unchanged).toBe(previous.records.length);
  });

  it("does not invent changes for records without xrefs in byte-identical files", () => {
    const content = "0 HEAD\n0 NOTE first stray note\n0 NOTE second stray note\n0 TRLR";
    const diff = diffImportSnapshots(createImportSnapshot("previous.ged", content), createImportSnapshot("next.ged", content));

    expect(diff.added).toBe(0);
    expect(diff.changed).toBe(0);
    expect(diff.deleted).toBe(0);
    expect(diff.unchanged).toBe(4);
  });

  it("tracks duplicated xrefs by occurrence instead of collapsing them", () => {
    const previous = createImportSnapshot("previous.ged", "0 @I1@ INDI\n1 NAME First /Copy/\n0 @I1@ INDI\n1 NAME Second /Copy/");
    const next = createImportSnapshot("next.ged", "0 @I1@ INDI\n1 NAME First /Copy/");
    const diff = diffImportSnapshots(previous, next);

    expect(diff.added).toBe(0);
    expect(diff.changed).toBe(0);
    expect(diff.unchanged).toBe(1);
    expect(diff.deleted).toBe(1);
  });

  it("previews a GEDCOM larger than the Vercel request limit", () => {
    const personCount = 65_000;
    const note = "x".repeat(96);
    const content = Array.from({ length: personCount }, (_, index) => (
      `0 @I${index}@ INDI\n1 NAME Person ${index} /Loadtest/\n1 BIRT\n2 DATE 1 JAN ${1800 + (index % 200)}\n1 NOTE ${note}`
    )).join("\n");

    expect(Buffer.byteLength(content)).toBeGreaterThan(10.5 * 1024 * 1024);
    const snapshot = createImportSnapshot("large-family.ged", content);

    expect(snapshot.records).toHaveLength(personCount);
    expect(snapshot.summary.individuals).toBe(personCount);
    expect(snapshot.summary.dateRange).toEqual({ minYear: 1800, maxYear: 1999 });
  }, 20_000);
});
