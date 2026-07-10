import { describe, expect, it } from "vitest";
import type { AppliedGedcomImport, PersonSummary, RawGedcomRecord } from "@/lib/models";
import { repairGedcomRelationshipLinksInWorkspace, type WorkspaceData } from "@/lib/workspace-store";

function makePerson(id: string, displayName: string, overrides: Partial<PersonSummary> = {}): PersonSummary {
  return {
    id,
    slug: id.replace(/@/g, "").toLowerCase(),
    displayName,
    livingStatus: "unknown",
    privacy: "private",
    published: false,
    facts: [],
    relatives: [],
    ...overrides
  };
}

function makeImport(id: string, sourceName: string, appliedAt: string): AppliedGedcomImport {
  return {
    id,
    sourceName,
    checksum: `checksum-${id}`,
    appliedAt,
    summary: { individuals: 0, families: 0, sources: 0, media: 0, notes: 0, sourceReferences: 0, urls: 0, ancestryApids: 0 },
    recordCount: 0,
    peopleImported: 0,
    sourcesImported: 0,
    rawRecordCount: 0,
    backupId: `backup-${id}`
  };
}

function makeRawRecord(importId: string, type: string, xref: string, raw: string): RawGedcomRecord {
  return {
    id: `raw-${importId}-${type}-${xref}`,
    importId,
    xref,
    type,
    checksum: `checksum-${importId}-${xref}`,
    raw
  };
}

function makeWorkspace(overrides: Partial<WorkspaceData>): WorkspaceData {
  return {
    version: "0.17.0",
    archiveName: "Test Archive",
    people: [],
    cases: [],
    sources: [],
    dnaMatches: [],
    aiRuns: [],
    imports: [],
    rawRecords: [],
    backups: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("GEDCOM relationship repair", () => {
  it("rewrites family xrefs into person links, preserves curation, and counts links once", () => {
    const workspace = makeWorkspace({
      people: [
        makePerson("@I1@", "John Smith", { relatives: ["@F1@"], published: true, privacy: "public" }),
        makePerson("@I2@", "Jane Smith", { relatives: ["@I1@"] })
      ],
      imports: [makeImport("import-a", "smith.ged", "2026-01-01T00:00:00.000Z")],
      rawRecords: [
        makeRawRecord("import-a", "INDI", "@I1@", "0 @I1@ INDI\n1 NAME John /Smith/\n1 FAMS @F1@"),
        makeRawRecord("import-a", "INDI", "@I2@", "0 @I2@ INDI\n1 NAME Jane /Smith/\n1 FAMS @F1@"),
        makeRawRecord("import-a", "FAM", "@F1@", "0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@")
      ]
    });

    const { workspace: repaired, result } = repairGedcomRelationshipLinksInWorkspace(workspace);
    const john = repaired.people.find((person) => person.id === "@I1@");

    expect(john?.relatives).toEqual(["@I2@"]);
    expect(john).toMatchObject({ published: true, privacy: "public" });
    expect(result).toEqual({
      rawRecordCount: 3,
      importedPeopleChecked: 2,
      updatedPeople: 1,
      relationshipCount: 1
    });
  });

  it("does not merge relationships across imports that reuse the same xrefs", () => {
    const workspace = makeWorkspace({
      people: [
        makePerson("@I1@", "Mary Jones", { relatives: ["@I5@"] }),
        makePerson("@I2@", "Jane Smith", { relatives: ["@I1@"] }),
        makePerson("@I5@", "Sam Jones", { relatives: ["@I1@"] })
      ],
      imports: [makeImport("import-a", "smith.ged", "2026-01-01T00:00:00.000Z"), makeImport("import-b", "jones.ged", "2026-02-01T00:00:00.000Z")],
      rawRecords: [
        makeRawRecord("import-a", "INDI", "@I1@", "0 @I1@ INDI\n1 NAME John /Smith/\n1 FAMS @F1@"),
        makeRawRecord("import-a", "INDI", "@I2@", "0 @I2@ INDI\n1 NAME Jane /Smith/\n1 FAMS @F1@"),
        makeRawRecord("import-a", "FAM", "@F1@", "0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@"),
        makeRawRecord("import-b", "INDI", "@I1@", "0 @I1@ INDI\n1 NAME Mary /Jones/\n1 FAMS @F1@"),
        makeRawRecord("import-b", "INDI", "@I5@", "0 @I5@ INDI\n1 NAME Sam /Jones/\n1 FAMC @F1@"),
        makeRawRecord("import-b", "FAM", "@F1@", "0 @F1@ FAM\n1 WIFE @I1@\n1 CHIL @I5@")
      ]
    });

    const { workspace: repaired, result } = repairGedcomRelationshipLinksInWorkspace(workspace);
    const mary = repaired.people.find((person) => person.id === "@I1@");

    expect(mary?.relatives).toEqual(["@I5@"]);
    expect(mary?.relatives).not.toContain("@I2@");
    expect(result.updatedPeople).toBe(0);
  });

  it("uses the newest import when a corrected version of the same file supersedes an older one", () => {
    const workspace = makeWorkspace({
      people: [
        makePerson("@I1@", "John Smith", { relatives: ["@I9@"] }),
        makePerson("@I9@", "Wrong Child", { relatives: ["@I1@"] })
      ],
      imports: [makeImport("import-v1", "smith.ged", "2026-01-01T00:00:00.000Z"), makeImport("import-v2", "smith.ged", "2026-02-01T00:00:00.000Z")],
      rawRecords: [
        makeRawRecord("import-v1", "INDI", "@I1@", "0 @I1@ INDI\n1 NAME John /Smith/\n1 FAMS @F1@"),
        makeRawRecord("import-v1", "INDI", "@I9@", "0 @I9@ INDI\n1 NAME Wrong /Child/\n1 FAMC @F1@"),
        makeRawRecord("import-v1", "FAM", "@F1@", "0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I9@"),
        makeRawRecord("import-v2", "INDI", "@I1@", "0 @I1@ INDI\n1 NAME John /Smith/\n1 FAMS @F1@"),
        makeRawRecord("import-v2", "FAM", "@F1@", "0 @F1@ FAM\n1 HUSB @I1@")
      ]
    });

    const { workspace: repaired, result } = repairGedcomRelationshipLinksInWorkspace(workspace);
    const john = repaired.people.find((person) => person.id === "@I1@");

    expect(john?.relatives).toEqual([]);
    expect(result.updatedPeople).toBe(1);
  });

  it("returns zero counters and leaves the workspace untouched without raw GEDCOM records", () => {
    const workspace = makeWorkspace({ people: [makePerson("@I1@", "John Smith", { relatives: ["@I2@"] })] });

    const { workspace: repaired, result } = repairGedcomRelationshipLinksInWorkspace(workspace);

    expect(repaired).toBe(workspace);
    expect(result).toEqual({
      rawRecordCount: 0,
      importedPeopleChecked: 0,
      updatedPeople: 0,
      relationshipCount: 0
    });
  });
});
