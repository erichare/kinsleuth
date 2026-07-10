import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFamilyRelationshipMap, extractPeople, parseGedcom, textWithContinuations } from "@/lib/gedcom/parser";

describe("GEDCOM parser", () => {
  it("parses synthetic GEDCOM records and summary counts", () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const parsed = parseGedcom(content);

    expect(parsed.summary.individuals).toBe(3);
    expect(parsed.summary.families).toBe(2);
    expect(parsed.summary.sources).toBe(1);
    expect(parsed.summary.media).toBe(1);
    expect(parsed.summary.dateRange?.minYear).toBe(1858);
    expect(parsed.summary.dateRange?.maxYear).toBe(1961);
  });

  it("extracts people, events, places, relationships, and notes", () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const people = extractPeople(parseGedcom(content).records);
    const elizabeth = people.find((person) => person.displayName === "Elizabeth Katherine Riemer");

    expect(elizabeth).toBeDefined();
    expect(elizabeth?.surname).toBe("Riemer");
    expect(elizabeth?.birthPlace).toBe("Chicago, Cook, Illinois, USA");
    expect(elizabeth?.facts.map((fact) => fact.type)).toContain("BIRT");
    expect(elizabeth?.relatives).toContain("@I2@");
    expect(elizabeth?.relatives).not.toContain("@F1@");
    expect(elizabeth?.notes).toContain("Synthetic ancestor");
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

  it("rejects malformed lines", () => {
    expect(() => parseGedcom("not a gedcom line")).toThrow(/Invalid GEDCOM line/);
  });
});
