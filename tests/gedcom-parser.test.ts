import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFamilyRelationshipMap, extractPeople, parseGedcom, parseGedcomLine, textWithContinuations } from "@/lib/gedcom/parser";

describe("GEDCOM parser", () => {
  it("parses fictional GEDCOM records and summary counts", () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const parsed = parseGedcom(content);

    expect(parsed.summary.individuals).toBe(8);
    expect(parsed.summary.families).toBe(3);
    expect(parsed.summary.sources).toBe(4);
    expect(parsed.summary.media).toBe(1);
    expect(parsed.summary.dateRange?.minYear).toBe(1856);
    expect(parsed.summary.dateRange?.maxYear).toBe(1998);
  });

  it("extracts people, events, places, relationships, and notes", () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const people = extractPeople(parseGedcom(content).records);
    const nora = people.find((person) => person.displayName === "Nora Elise Hartwell");

    expect(nora).toBeDefined();
    expect(nora?.surname).toBe("Hartwell");
    expect(nora?.birthPlace).toBe("Lantern Bay, Wisconsin");
    expect(nora?.facts.map((fact) => fact.type)).toContain("BIRT");
    expect(nora?.relatives).toContain("@I2@");
    expect(nora?.relatives).not.toContain("@F1@");
    expect(nora?.notes).toContain("Nora's journal calls the memory box Amalia's tin");
  });

  it("resolves family records into person-to-person relationship links", () => {
    const parsed = parseGedcom(`0 @I1@ INDI
1 NAME Parent One /Example/
0 @I2@ INDI
1 NAME Parent Two /Example/
0 @I3@ INDI
1 NAME Child One /Example/
0 @I4@ INDI
1 NAME Child Two /Example/
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I4@`);
    const relationships = buildFamilyRelationshipMap(parsed.records);

    expect(relationships.get("@I1@")).toEqual(["@I2@", "@I3@", "@I4@"]);
    expect(relationships.get("@I3@")).toEqual(["@I1@", "@I2@", "@I4@"]);
  });

  it("unions relationships for a person who is a child in one family and a parent in another", () => {
    const parsed = parseGedcom(`0 @I1@ INDI
1 NAME Grandparent One /Example/
0 @I2@ INDI
1 NAME Grandparent Two /Example/
0 @I3@ INDI
1 NAME Middle Generation /Example/
0 @I5@ INDI
1 NAME Grandchild /Example/
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I3@
1 CHIL @I5@`);
    const relationships = buildFamilyRelationshipMap(parsed.records);

    expect(relationships.get("@I3@")).toEqual(["@I1@", "@I2@", "@I5@"]);
    expect(relationships.get("@I5@")).toEqual(["@I3@"]);
    expect(relationships.get("@I1@")).toEqual(["@I2@", "@I3@"]);
  });

  it("preserves continuation text", () => {
    const parsed = parseGedcom("0 @N1@ NOTE First line\n1 CONT Second line\n1 CONC joined");
    expect(textWithContinuations(parsed.records[0].root)).toBe("First line\nSecond linejoined");
  });

  it("preserves the leading space of CONC values split mid sentence", () => {
    const parsed = parseGedcom("0 @N1@ NOTE This is a long note that was split by the\n1 CONC  exporter mid sentence");
    expect(textWithContinuations(parsed.records[0].root)).toBe("This is a long note that was split by the exporter mid sentence");
  });

  it("preserves leading indentation on CONT lines", () => {
    const parsed = parseGedcom("0 @N1@ NOTE Transcript:\n1 CONT   indented body line");
    expect(textWithContinuations(parsed.records[0].root)).toBe("Transcript:\n  indented body line");
  });

  it("strips a UTF-8 BOM and tolerates blank and indented lines", () => {
    const parsed = parseGedcom("\uFEFF0 HEAD\n   \n\n  1 SOUR KinSleuth\n\t0 TRLR\n");

    expect(parsed.records.map((record) => record.type)).toEqual(["HEAD", "TRLR"]);
    expect(parsed.records[0].root.children[0].tag).toBe("SOUR");
  });

  it("tolerates repeated delimiters before the tag but treats extra spaces after it as value", () => {
    const pointerLine = parseGedcomLine("0   @I1@   INDI", 0);
    expect(pointerLine.xref).toBe("@I1@");
    expect(pointerLine.tag).toBe("INDI");
    expect(pointerLine.value).toBeUndefined();

    const noteLine = parseGedcomLine("1 NOTE  double spaced", 1);
    expect(noteLine.value).toBe(" double spaced");
  });

  it("rejects malformed lines", () => {
    expect(() => parseGedcom("not a gedcom line")).toThrow(/Invalid GEDCOM line/);
  });

  it("bounds malformed-line excerpts so API errors stay small", () => {
    const invalidLine = "x".repeat(1_000_000);

    expect(() => parseGedcom(invalidLine)).toThrowError(
      expect.objectContaining({ message: expect.stringMatching(/^Invalid GEDCOM line 1: x{157}\.\.\.$/) })
    );
  });
});
