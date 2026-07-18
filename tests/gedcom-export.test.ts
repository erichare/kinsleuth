import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { prepareGedcomImport } from "@/lib/gedcom/apply";
import { exportGedcom, type GedcomExportInput } from "@/lib/gedcom/exporter";
import { extractPeople, findChild, parseGedcom, textWithContinuations } from "@/lib/gedcom/parser";
import type { PersonSummary } from "@/lib/models";

const fixtureContent = readFileSync("fixtures/synthetic-family.ged", "utf8");
const exportedAt = new Date("2026-07-13T08:00:00Z");

function curatedPerson(overrides: Partial<PersonSummary> = {}): PersonSummary {
  return {
    id: "p-nora-hartwell",
    slug: "nora-elise-hartwell",
    displayName: "Nora Elise Hartwell",
    givenName: "Nora Elise",
    surname: "Hartwell",
    birthDate: "3 OCT 1889",
    deathDate: "9 JUN 1968",
    sex: "F",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    facts: [
      { id: "fact-1", type: "BIRT", date: "3 OCT 1889", place: "Lantern Bay, Wisconsin", confidence: 0.8, privacy: "public" },
      { id: "fact-2", type: "DEAT", date: "9 JUN 1968", place: "Lantern Bay, Wisconsin", confidence: 0.8, privacy: "public" },
      { id: "fact-3", type: "OCCU", value: "Map illustrator", confidence: 0.5, privacy: "private" },
      { id: "fact-4", type: "EVEN", value: "Harbor guild registration", date: "1913", confidence: 0.5, privacy: "private" }
    ],
    relatives: [],
    notes: "Fictional demo person and careful mapmaker.\nResearch contact: archive@example.com",
    ...overrides
  };
}

function workspaceFromFixture(): GedcomExportInput {
  const prepared = prepareGedcomImport("synthetic-family.ged", fixtureContent, exportedAt);
  return {
    archiveName: "Hartwell–Mercer Family Archive",
    people: prepared.people,
    rawRecords: prepared.rawRecords,
    imports: [{ id: prepared.appliedImport.id, appliedAt: prepared.appliedImport.appliedAt }]
  };
}

describe("GEDCOM export", () => {
  it("generates a parseable file with header, submitter, and trailer for curated people", () => {
    const result = exportGedcom(
      { archiveName: "Test Archive", people: [curatedPerson()], rawRecords: [], imports: [] },
      { now: exportedAt }
    );

    const parsed = parseGedcom(result.content);
    const types = parsed.records.map((record) => record.type);
    expect(types.filter((type) => type === "HEAD")).toHaveLength(1);
    expect(types.filter((type) => type === "TRLR")).toHaveLength(1);
    expect(types.filter((type) => type === "SUBM")).toHaveLength(1);
    expect(types[types.length - 1]).toBe("TRLR");

    const head = parsed.records.find((record) => record.type === "HEAD");
    expect(findChild(head!.root, "CHAR")?.value).toBe("UTF-8");
    expect(findChild(head!.root, "SOUR")?.value).toBe("KINSLEUTH");
    const gedc = findChild(head!.root, "GEDC");
    expect(findChild(gedc!, "VERS")?.value).toBe("5.5.1");
    expect(findChild(gedc!, "FORM")?.value).toBe("LINEAGE-LINKED");
    expect(findChild(head!.root, "DATE")?.value).toBe("13 JUL 2026");
    expect(findChild(head!.root, "SUBM")?.value).toMatch(/^@.+@$/);

    expect(result.fileName).toBe("test-archive-2026-07-13.ged");
    expect(result.summary.individuals).toBe(1);
    expect(result.summary.synthesizedPeople).toBe(1);
  });

  it("synthesizes INDI records with names, sex, facts, and multi-line notes", () => {
    const result = exportGedcom(
      { archiveName: "Test Archive", people: [curatedPerson()], rawRecords: [], imports: [] },
      { now: exportedAt }
    );

    const parsed = parseGedcom(result.content);
    const indi = parsed.records.find((record) => record.type === "INDI");
    expect(indi).toBeDefined();
    expect(textWithContinuations(findChild(indi!.root, "NAME"))).toBe("Nora Elise /Hartwell/");
    expect(findChild(indi!.root, "SEX")?.value).toBe("F");

    const birth = findChild(indi!.root, "BIRT");
    expect(findChild(birth!, "DATE")?.value).toBe("3 OCT 1889");
    expect(findChild(birth!, "PLAC")?.value).toBe("Lantern Bay, Wisconsin");

    expect(findChild(indi!.root, "OCCU")?.value).toBe("Map illustrator");
    const even = findChild(indi!.root, "EVEN");
    expect(findChild(even!, "TYPE")?.value).toBe("Harbor guild registration");
    expect(findChild(even!, "DATE")?.value).toBe("1913");

    expect(textWithContinuations(findChild(indi!.root, "NOTE"))).toBe(
      "Fictional demo person and careful mapmaker.\nResearch contact: archive@example.com"
    );
  });

  it("splits very long note lines with CONC and round-trips them through the parser", () => {
    const longLine = "History ".repeat(80).trim();
    const result = exportGedcom(
      { archiveName: "Test Archive", people: [curatedPerson({ notes: longLine })], rawRecords: [], imports: [] },
      { now: exportedAt }
    );

    for (const line of result.content.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(255);
    }

    const parsed = parseGedcom(result.content);
    const indi = parsed.records.find((record) => record.type === "INDI");
    expect(textWithContinuations(findChild(indi!.root, "NOTE"))).toBe(longLine);
  });

  it("passes imported raw records through with original structure intact", () => {
    const result = exportGedcom(workspaceFromFixture(), { now: exportedAt });

    const parsed = parseGedcom(result.content);
    expect(parsed.summary.individuals).toBe(16);
    expect(parsed.summary.families).toBe(7);
    expect(parsed.summary.sources).toBe(4);
    expect(parsed.summary.media).toBe(1);
    expect(parsed.records.filter((record) => record.type === "HEAD")).toHaveLength(1);
    expect(parsed.records.filter((record) => record.type === "TRLR")).toHaveLength(1);

    const family = parsed.records.find((record) => record.xref === "@F1@");
    expect(findChild(family!.root, "HUSB")?.value).toBe("@I2@");
    expect(findChild(family!.root, "WIFE")?.value).toBe("@I1@");

    expect(result.content).toContain("1 NAME Nora Elise /Hartwell/");
    expect(result.summary.synthesizedPeople).toBe(0);
  });

  it("round-trips curation flags through _KS_ tags on export and re-import", () => {
    const workspace = workspaceFromFixture();
    const nora = workspace.people.find((person) => person.id === "@I1@");
    nora!.privacy = "sensitive";
    nora!.published = true;
    nora!.livingStatus = "deceased";

    const firstExport = exportGedcom(workspace, { now: exportedAt });
    const reimported = prepareGedcomImport("round-trip.ged", firstExport.content, exportedAt);
    const reimportedNora = reimported.people.find((person) => person.id === "@I1@");

    expect(reimportedNora?.privacy).toBe("sensitive");
    expect(reimportedNora?.published).toBe(true);
    expect(reimportedNora?.livingStatus).toBe("deceased");
    expect(reimportedNora?.displayName).toBe("Nora Elise Hartwell");

    const secondExport = exportGedcom(
      {
        archiveName: workspace.archiveName,
        people: reimported.people,
        rawRecords: reimported.rawRecords,
        imports: [{ id: reimported.appliedImport.id, appliedAt: reimported.appliedImport.appliedAt }]
      },
      { now: exportedAt }
    );

    const privacyTagCount = secondExport.content.split("\n").filter((line) => line === "1 _KS_PRIVACY sensitive").length;
    expect(privacyTagCount).toBe(1);
  });

  it("round-trips secondary names as alias facts without duplicating the canonical name", () => {
    const person = curatedPerson({
      facts: [
        ...curatedPerson().facts,
        {
          id: "fact-name-canonical",
          type: "NAME",
          value: "Nora Elise /Hartwell/",
          confidence: 0.9,
          privacy: "public"
        },
        {
          id: "fact-name-married",
          type: "NAME",
          value: "Nora Elise /Mercer/",
          date: "8 JAN 1922",
          place: "Lantern Bay, Wisconsin",
          source: "@S1@",
          confidence: 0.86,
          privacy: "public"
        },
        {
          id: "fact-name-journal",
          type: "NAME",
          value: "Nora E. Hartwell Mercer",
          date: "1922",
          source: "Fictional household journal",
          confidence: 0.8,
          privacy: "private"
        }
      ]
    });

    const exported = exportGedcom(
      { archiveName: "Test Archive", people: [person], rawRecords: [], imports: [] },
      { now: exportedAt }
    );
    const reimported = prepareGedcomImport("round-trip-names.ged", exported.content, exportedAt);
    const [reimportedPerson] = reimported.people;
    const nameFacts = reimportedPerson.facts.filter((fact) => fact.type === "NAME");

    expect(reimportedPerson.displayName).toBe("Nora Elise Hartwell");
    expect(nameFacts).toEqual([
      expect.objectContaining({
        value: "Nora Elise /Mercer/",
        date: "8 JAN 1922",
        place: "Lantern Bay, Wisconsin",
        source: "@S1@"
      }),
      expect.objectContaining({
        value: "Nora E. Hartwell Mercer",
        date: "1922",
        source: "Fictional household journal"
      })
    ]);
  });

  it("ignores malformed curation tags on import and keeps safe defaults", () => {
    const content = [
      "0 HEAD",
      "1 GEDC",
      "2 VERS 5.5.1",
      "1 CHAR UTF-8",
      "0 @I1@ INDI",
      "1 NAME Test /Person/",
      "1 _KS_PRIVACY everything-goes",
      "1 _KS_PUBLISHED maybe",
      "1 _KS_LIVING immortal",
      "0 TRLR"
    ].join("\n");

    const [person] = extractPeople(parseGedcom(content).records);
    expect(person.privacy).toBe("private");
    expect(person.published).toBe(false);
    expect(person.livingStatus).toBe("unknown");
  });

  it("keeps the newest version of a record when multiple imports share an xref", () => {
    const older = prepareGedcomImport(
      "older.ged",
      "0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Old /Name/\n0 TRLR",
      new Date("2026-01-01T00:00:00Z")
    );
    const newer = prepareGedcomImport(
      "newer.ged",
      "0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME New /Name/\n0 TRLR",
      new Date("2026-06-01T00:00:00Z")
    );

    const result = exportGedcom(
      {
        archiveName: "Test Archive",
        people: newer.people,
        rawRecords: [...newer.rawRecords, ...older.rawRecords],
        imports: [
          { id: newer.appliedImport.id, appliedAt: newer.appliedImport.appliedAt },
          { id: older.appliedImport.id, appliedAt: older.appliedImport.appliedAt }
        ]
      },
      { now: exportedAt }
    );

    expect(result.content).toContain("1 NAME New /Name/");
    expect(result.content).not.toContain("1 NAME Old /Name/");
    const parsed = parseGedcom(result.content);
    expect(parsed.summary.individuals).toBe(1);
  });

  it("reuses an imported submitter record instead of synthesizing a duplicate", () => {
    const withSubmitter = prepareGedcomImport(
      "submitter.ged",
      "0 HEAD\n1 CHAR UTF-8\n1 SUBM @SUB1@\n0 @SUB1@ SUBM\n1 NAME Original Submitter\n0 @I1@ INDI\n1 NAME Test /Person/\n0 TRLR",
      exportedAt
    );

    const result = exportGedcom(
      {
        archiveName: "Test Archive",
        people: withSubmitter.people,
        rawRecords: withSubmitter.rawRecords,
        imports: [{ id: withSubmitter.appliedImport.id, appliedAt: withSubmitter.appliedImport.appliedAt }]
      },
      { now: exportedAt }
    );

    const parsed = parseGedcom(result.content);
    const submitters = parsed.records.filter((record) => record.type === "SUBM");
    expect(submitters).toHaveLength(1);
    expect(submitters[0].xref).toBe("@SUB1@");
    const head = parsed.records.find((record) => record.type === "HEAD");
    expect(findChild(head!.root, "SUBM")?.value).toBe("@SUB1@");
  });

  it("synthesizes a valid xref for individuals whose original record had none", () => {
    const prepared = prepareGedcomImport(
      "no-xref.ged",
      "0 HEAD\n1 CHAR UTF-8\n0 INDI\n1 NAME No /Xref/\n0 TRLR",
      exportedAt
    );

    const result = exportGedcom(
      {
        archiveName: "Test Archive",
        people: prepared.people,
        rawRecords: prepared.rawRecords,
        imports: [{ id: prepared.appliedImport.id, appliedAt: prepared.appliedImport.appliedAt }]
      },
      { now: exportedAt }
    );

    const parsed = parseGedcom(result.content);
    const individuals = parsed.records.filter((record) => record.type === "INDI");
    expect(individuals).toHaveLength(1);
    expect(individuals[0].xref).toBe("@KS1@");
    expect(textWithContinuations(findChild(individuals[0].root, "NAME"))).toBe("No /Xref/");
    expect(result.summary.individuals).toBe(1);
    expect(result.summary.synthesizedPeople).toBe(1);
  });

  it("can omit curation tags entirely", () => {
    const result = exportGedcom(workspaceFromFixture(), { now: exportedAt, includeCurationTags: false });
    expect(result.content).not.toContain("_KS_");
  });
});
