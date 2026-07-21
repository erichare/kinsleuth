import { describe, expect, it } from "vitest";

import { parseGedcom } from "@/lib/gedcom/parser";
import type { PersonSummary } from "@/lib/models";
import {
  demoFamilyTreeEdges,
  deriveRelationshipLabel,
  fallbackRelationshipLabel,
  familyEdgesFromGedcomRecords,
  familyEdgesFromRawRecords,
  workspaceFamilyEdges,
  type FamilyEdge,
  type PersonXrefMappingsByImportId
} from "@/lib/person-relationships";

// All fixture people are invented for the fictional Hartwell–Mercer demo
// style; none resemble real people.
const sexes = ["M", "F", "U", undefined] as const;

function relative(id: string, sex?: PersonSummary["sex"]): Pick<PersonSummary, "id" | "sex"> {
  return { id, sex };
}

function family(overrides: Partial<FamilyEdge>): FamilyEdge {
  return {
    id: "family-fixture",
    partnerIds: [],
    childIds: [],
    ...overrides
  };
}

describe("deriveRelationshipLabel", () => {
  // Family edge members are workspace person ids, never GEDCOM xrefs: the
  // integration apply path generates local ids that look nothing like
  // "@I1@". The fixtures use generated-style ids to keep the two id spaces
  // distinct (regression coverage for the xref/local-id join bug).
  const coupleWithChild = family({
    husbandId: "person-01hf-father",
    wifeId: "person-01hf-mother",
    partnerIds: ["person-01hf-father", "person-01hf-mother"],
    childIds: ["person-01hf-child", "person-01hf-sibling"]
  });

  it("labels parents by sex for every sex value", () => {
    const expected = { M: "Father", F: "Mother", U: "Parent", undefined: "Parent" } as const;
    for (const sex of sexes) {
      expect(
        deriveRelationshipLabel("person-01hf-child", relative("person-01hf-father", sex), [coupleWithChild]),
        `parent sex ${String(sex)}`
      ).toBe(expected[String(sex) as keyof typeof expected]);
    }
  });

  it("labels children by sex for every sex value", () => {
    const expected = { M: "Son", F: "Daughter", U: "Child", undefined: "Child" } as const;
    for (const sex of sexes) {
      expect(
        deriveRelationshipLabel("person-01hf-father", relative("person-01hf-child", sex), [coupleWithChild]),
        `child sex ${String(sex)}`
      ).toBe(expected[String(sex) as keyof typeof expected]);
    }
  });

  it("labels siblings by sex for every sex value", () => {
    const expected = { M: "Brother", F: "Sister", U: "Sibling", undefined: "Sibling" } as const;
    for (const sex of sexes) {
      expect(
        deriveRelationshipLabel("person-01hf-child", relative("person-01hf-sibling", sex), [coupleWithChild]),
        `sibling sex ${String(sex)}`
      ).toBe(expected[String(sex) as keyof typeof expected]);
    }
  });

  it("labels spouses from the recorded HUSB and WIFE roles, not sex", () => {
    for (const sex of sexes) {
      expect(deriveRelationshipLabel("person-01hf-mother", relative("person-01hf-father", sex), [coupleWithChild])).toBe("Husband");
      expect(deriveRelationshipLabel("person-01hf-father", relative("person-01hf-mother", sex), [coupleWithChild])).toBe("Wife");
    }
  });

  it("labels role-less partners as the neutral Spouse for every sex value", () => {
    const roleless = family({ partnerIds: ["p-nora-hartwell", "p-samuel-mercer"], childIds: ["p-clara-mercer"] });
    for (const sex of sexes) {
      expect(
        deriveRelationshipLabel("p-nora-hartwell", relative("p-samuel-mercer", sex), [roleless]),
        `spouse sex ${String(sex)}`
      ).toBe("Spouse");
    }
  });

  it("falls back to Linked relative when the pair shares no family", () => {
    expect(deriveRelationshipLabel("person-01hf-child", relative("person-unrelated", "M"), [coupleWithChild])).toBe(fallbackRelationshipLabel);
    expect(deriveRelationshipLabel("person-01hf-child", relative("person-01hf-father", "M"), [])).toBe(fallbackRelationshipLabel);
    expect(fallbackRelationshipLabel).toBe("Linked relative");
  });

  it("falls back when the subject and relative sit in unrelated families", () => {
    const other = family({
      id: "family-other",
      partnerIds: ["person-other-father", "person-other-mother"],
      childIds: ["person-other-child"]
    });
    expect(
      deriveRelationshipLabel("person-01hf-child", relative("person-other-child"), [coupleWithChild, other])
    ).toBe(fallbackRelationshipLabel);
  });

  it("uses the first matching family when several connect the pair", () => {
    const asSpouses = family({
      id: "family-first",
      partnerIds: ["person-01hf-father", "person-01hf-mother"],
      childIds: ["person-01hf-child"]
    });
    const asSiblings = family({
      id: "family-second",
      partnerIds: ["person-grandfather", "person-grandmother"],
      childIds: ["person-01hf-father", "person-01hf-mother"]
    });
    expect(deriveRelationshipLabel("person-01hf-father", relative("person-01hf-mother", "F"), [asSpouses, asSiblings])).toBe("Spouse");
    expect(deriveRelationshipLabel("person-01hf-father", relative("person-01hf-mother", "F"), [asSiblings, asSpouses])).toBe("Sister");
  });
});

describe("familyEdgesFromGedcomRecords", () => {
  it("extracts HUSB, WIFE, and deduplicated CHIL pointers from FAM records", () => {
    const parsed = parseGedcom([
      "0 @I1@ INDI",
      "1 NAME Elias /Hartwell/",
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 WIFE @I2@",
      "1 CHIL @I3@",
      "1 CHIL @I3@",
      "1 CHIL @I4@"
    ].join("\n"));

    expect(familyEdgesFromGedcomRecords(parsed.records)).toEqual([{
      id: "@F1@",
      husbandId: "@I1@",
      wifeId: "@I2@",
      partnerIds: ["@I1@", "@I2@"],
      childIds: ["@I3@", "@I4@"]
    }]);
  });

  it("ignores free-text values that are not GEDCOM pointers", () => {
    const parsed = parseGedcom([
      "0 @F1@ FAM",
      "1 HUSB Elias Hartwell",
      "1 WIFE @I2@",
      "1 CHIL unknown child"
    ].join("\n"));

    expect(familyEdgesFromGedcomRecords(parsed.records)).toEqual([{
      id: "@F1@",
      husbandId: undefined,
      wifeId: "@I2@",
      partnerIds: ["@I2@"],
      childIds: []
    }]);
  });

  it("skips FAM records without a single resolvable member", () => {
    const parsed = parseGedcom(["0 @F1@ FAM", "1 MARR", "2 DATE 12 Jun 1909"].join("\n"));
    expect(familyEdgesFromGedcomRecords(parsed.records)).toEqual([]);
  });

  it("handles a single-parent family", () => {
    const parsed = parseGedcom(["0 @F2@ FAM", "1 WIFE @I2@", "1 CHIL @I3@"].join("\n"));
    expect(familyEdgesFromGedcomRecords(parsed.records)).toEqual([{
      id: "@F2@",
      husbandId: undefined,
      wifeId: "@I2@",
      partnerIds: ["@I2@"],
      childIds: ["@I3@"]
    }]);
  });
});

describe("familyEdgesFromRawRecords", () => {
  const olderImportFamily = {
    id: "raw-1",
    importId: "import-older",
    xref: "@F1@",
    type: "FAM",
    checksum: "checksum-1",
    raw: ["0 @F1@ FAM", "1 HUSB @I1@", "1 WIFE @I2@", "1 CHIL @I3@"].join("\n")
  };
  const newerImportFamily = {
    id: "raw-2",
    importId: "import-newer",
    xref: "@F1@",
    type: "FAM",
    checksum: "checksum-2",
    raw: ["0 @F1@ FAM", "1 HUSB @I1@", "1 WIFE @I2@", "1 CHIL @I3@", "1 CHIL @I4@"].join("\n")
  };
  const imports = [
    { id: "import-newer", appliedAt: "2026-07-18T00:00:00.000Z" },
    { id: "import-older", appliedAt: "2026-07-01T00:00:00.000Z" }
  ];

  it("lets the newest import own a colliding family xref", () => {
    // Deliberately pass the raw rows newest-first to prove ordering comes
    // from the imports' appliedAt, not from row order.
    const edges = familyEdgesFromRawRecords([newerImportFamily, olderImportFamily], imports);
    expect(edges).toEqual([{
      id: "@F1@",
      husbandId: "@I1@",
      wifeId: "@I2@",
      partnerIds: ["@I1@", "@I2@"],
      childIds: ["@I3@", "@I4@"]
    }]);
  });

  it("ignores non-FAM raw records and returns nothing for empty workspaces", () => {
    const individual = { ...olderImportFamily, id: "raw-3", xref: "@I1@", type: "INDI", raw: "0 @I1@ INDI" };
    expect(familyEdgesFromRawRecords([individual], imports)).toEqual([]);
    expect(familyEdgesFromRawRecords([], [])).toEqual([]);
  });

  it("translates member xrefs to the import's generated local person ids", () => {
    const integrationImports = [{ id: "import-integration-aaaa", appliedAt: "2026-07-18T00:00:00.000Z" }];
    const rawRecord = { ...olderImportFamily, importId: "import-integration-aaaa" };
    const mappings: PersonXrefMappingsByImportId = new Map([[
      "import-integration-aaaa",
      {
        scopeId: "conn-1",
        personIdByXref: new Map([
          ["@I1@", "person-local-husband"],
          ["@I2@", "person-local-wife"],
          ["@I3@", "person-local-child"]
        ])
      }
    ]]);

    expect(familyEdgesFromRawRecords([rawRecord], integrationImports, mappings)).toEqual([{
      id: "conn-1:@F1@",
      husbandId: "person-local-husband",
      wifeId: "person-local-wife",
      partnerIds: ["person-local-husband", "person-local-wife"],
      childIds: ["person-local-child"]
    }]);
  });

  it("keeps unmapped member xrefs so skipped people simply match nothing", () => {
    const integrationImports = [{ id: "import-integration-aaaa", appliedAt: "2026-07-18T00:00:00.000Z" }];
    const rawRecord = { ...olderImportFamily, importId: "import-integration-aaaa" };
    const mappings: PersonXrefMappingsByImportId = new Map([[
      "import-integration-aaaa",
      { scopeId: "conn-1", personIdByXref: new Map([["@I1@", "person-local-husband"]]) }
    ]]);

    expect(familyEdgesFromRawRecords([rawRecord], integrationImports, mappings)).toEqual([{
      id: "conn-1:@F1@",
      husbandId: "person-local-husband",
      wifeId: "@I2@",
      partnerIds: ["person-local-husband", "@I2@"],
      childIds: ["@I3@"]
    }]);
  });

  it("keeps colliding family xrefs from different connections apart", () => {
    const integrationImports = [
      { id: "import-integration-aaaa", appliedAt: "2026-07-01T00:00:00.000Z" },
      { id: "import-integration-bbbb", appliedAt: "2026-07-18T00:00:00.000Z" }
    ];
    const rawRecordsAcrossConnections = [
      { ...olderImportFamily, importId: "import-integration-aaaa" },
      { ...olderImportFamily, id: "raw-9", importId: "import-integration-bbbb" }
    ];
    const mappings: PersonXrefMappingsByImportId = new Map([
      ["import-integration-aaaa", { scopeId: "conn-1", personIdByXref: new Map([["@I1@", "person-conn1-husband"]]) }],
      ["import-integration-bbbb", { scopeId: "conn-2", personIdByXref: new Map([["@I1@", "person-conn2-husband"]]) }]
    ]);

    const edges = familyEdgesFromRawRecords(rawRecordsAcrossConnections, integrationImports, mappings);
    expect(edges.map((edge) => [edge.id, edge.husbandId])).toEqual([
      ["conn-1:@F1@", "person-conn1-husband"],
      ["conn-2:@F1@", "person-conn2-husband"]
    ]);
  });

  it("lets the newest refresh of one connection own a family xref", () => {
    const sharedMapping = {
      scopeId: "conn-1",
      personIdByXref: new Map([
        ["@I1@", "person-local-husband"],
        ["@I2@", "person-local-wife"],
        ["@I3@", "person-local-child"],
        ["@I4@", "person-local-second-child"]
      ])
    };
    const integrationImports = [
      { id: "import-integration-aaaa", appliedAt: "2026-07-01T00:00:00.000Z" },
      { id: "import-integration-bbbb", appliedAt: "2026-07-18T00:00:00.000Z" }
    ];
    const refreshedRawRecords = [
      { ...newerImportFamily, importId: "import-integration-bbbb" },
      { ...olderImportFamily, importId: "import-integration-aaaa" }
    ];
    const mappings: PersonXrefMappingsByImportId = new Map([
      ["import-integration-aaaa", sharedMapping],
      ["import-integration-bbbb", sharedMapping]
    ]);

    expect(familyEdgesFromRawRecords(refreshedRawRecords, integrationImports, mappings)).toEqual([{
      id: "conn-1:@F1@",
      husbandId: "person-local-husband",
      wifeId: "person-local-wife",
      partnerIds: ["person-local-husband", "person-local-wife"],
      childIds: ["person-local-child", "person-local-second-child"]
    }]);
  });
});

describe("workspaceFamilyEdges", () => {
  it("prepends imported edges to the fictional demo edges", () => {
    const rawRecords = [{
      id: "raw-1",
      importId: "import-1",
      xref: "@F1@",
      type: "FAM",
      checksum: "checksum-1",
      raw: ["0 @F1@ FAM", "1 HUSB @I1@", "1 WIFE @I2@", "1 CHIL @I3@"].join("\n")
    }];
    const edges = workspaceFamilyEdges({
      rawRecords,
      imports: [{ id: "import-1", appliedAt: "2026-07-01T00:00:00.000Z" }]
    });

    expect(edges[0]).toMatchObject({ id: "@F1@", husbandId: "@I1@" });
    expect(edges.slice(1)).toEqual(demoFamilyTreeEdges);
  });

  it("returns only the demo edges when nothing was imported", () => {
    expect(workspaceFamilyEdges({ rawRecords: [], imports: [] })).toEqual(demoFamilyTreeEdges);
  });

  it("passes xref mappings through so integration edges resolve to local ids", () => {
    const rawRecords = [{
      id: "raw-1",
      importId: "import-integration-aaaa",
      xref: "@F1@",
      type: "FAM",
      checksum: "checksum-1",
      raw: ["0 @F1@ FAM", "1 HUSB @I1@", "1 WIFE @I2@", "1 CHIL @I3@"].join("\n")
    }];
    const mappings: PersonXrefMappingsByImportId = new Map([[
      "import-integration-aaaa",
      {
        scopeId: "conn-1",
        personIdByXref: new Map([
          ["@I1@", "person-local-husband"],
          ["@I2@", "person-local-wife"],
          ["@I3@", "person-local-child"]
        ])
      }
    ]]);
    const edges = workspaceFamilyEdges({
      rawRecords,
      imports: [{ id: "import-integration-aaaa", appliedAt: "2026-07-01T00:00:00.000Z" }]
    }, mappings);

    expect(edges[0]).toEqual({
      id: "conn-1:@F1@",
      husbandId: "person-local-husband",
      wifeId: "person-local-wife",
      partnerIds: ["person-local-husband", "person-local-wife"],
      childIds: ["person-local-child"]
    });
    expect(edges.slice(1)).toEqual(demoFamilyTreeEdges);
  });
});
