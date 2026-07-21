import { describe, expect, it } from "vitest";

import {
  hashRetainedGedcomExtensions,
  normalizeGedcomSnapshotEntities,
  summarizeUnsupportedGedcomTags
} from "@/lib/integrations/gedcom-normalization";

describe("provider-neutral GEDCOM entity normalization", () => {
  it("retains typed families, relationships, facts, citations, and restricted media links", () => {
    const entities = normalizeGedcomSnapshotEntities([
      "0 HEAD",
      "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
      "0 @I1@ INDI",
      "1 NAME Ada /Northwood/",
      "1 BIRT",
      "2 DATE 4 MAY 1888",
      "2 PLAC Lantern Bay, Wisconsin",
      "2 SOUR @S1@",
      "3 PAGE register 8, entry 14",
      "1 OBJE @M1@",
      "0 @I2@ INDI",
      "1 NAME Rowan /Vale/",
      "0 @I3@ INDI",
      "1 NAME Mira /Northwood/",
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 WIFE @I2@",
      "1 CHIL @I3@",
      "0 @S1@ SOUR",
      "1 TITL Synthetic Lantern Bay register",
      "0 @M1@ OBJE",
      "1 FILE records/lantern-bay-register.jpg",
      "2 FORM image/jpeg",
      "2 TITL Synthetic register image",
      "0 TRLR"
    ].join("\n"));

    expect(entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: "fact",
        value: expect.objectContaining({
          personExternalId: "@I1@",
          type: "BIRT",
          date: "4 MAY 1888",
          place: "Lantern Bay, Wisconsin"
        })
      }),
      expect.objectContaining({
        entityType: "citation",
        value: expect.objectContaining({
          personExternalId: "@I1@",
          sourceExternalId: "@S1@",
          page: "register 8, entry 14"
        })
      }),
      expect.objectContaining({
        entityType: "family",
        externalId: "@F1@",
        value: expect.objectContaining({ parents: ["@I1@", "@I2@"], children: ["@I3@"] })
      }),
      expect.objectContaining({
        entityType: "relationship",
        value: { type: "spouse", fromPersonExternalId: "@I1@", toPersonExternalId: "@I2@", familyExternalId: "@F1@" }
      }),
      expect.objectContaining({
        entityType: "relationship",
        value: { type: "parent_child", fromPersonExternalId: "@I1@", toPersonExternalId: "@I3@", familyExternalId: "@F1@" }
      }),
      expect.objectContaining({
        entityType: "media",
        externalId: "@M1@",
        value: expect.objectContaining({
          file: "records/lantern-bay-register.jpg",
          privacy: "private",
          license: "third_party_restricted",
          publicEligible: false,
          aiEligible: false
        })
      })
    ]));
    expect(entities.filter((entity) => entity.entityType !== "relationship")
      .every((entity) => entity.raw.length > 0)).toBe(true);
    expect(entities.filter((entity) => entity.entityType === "relationship")
      .every((entity) => entity.raw === "")).toBe(true);
  });

  it("retains a large family raw record once instead of copying it to every derived relationship", () => {
    const children = 1_000;
    const gedcom = [
      "0 HEAD",
      "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
      "0 @I1@ INDI",
      "1 NAME Avery /Northwood/",
      "0 @I2@ INDI",
      "1 NAME Rowan /Vale/",
      ...Array.from({ length: children }, (_, index) => [
        `0 @C${index + 1}@ INDI`,
        `1 NAME Synthetic${index + 1} /Northwood/`
      ]).flat(),
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 WIFE @I2@",
      ...Array.from({ length: children }, (_, index) => `1 CHIL @C${index + 1}@`),
      "0 TRLR"
    ].join("\n");

    const entities = normalizeGedcomSnapshotEntities(gedcom);
    const family = entities.find((entity) => entity.entityType === "family")!;
    const relationships = entities.filter((entity) => entity.entityType === "relationship");

    expect(relationships).toHaveLength(children * 2 + 1);
    expect(family.raw.length).toBeGreaterThan(10_000);
    expect(relationships.reduce((total, entity) => total + entity.raw.length, 0)).toBe(0);
  });

  it("collapses a child linked to one family twice into one membership and one edge per parent", () => {
    const entities = normalizeGedcomSnapshotEntities([
      "0 HEAD",
      "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
      "0 @I1@ INDI",
      "1 NAME Avery /Northwood/",
      "0 @I2@ INDI",
      "1 NAME Rowan /Vale/",
      "0 @I3@ INDI",
      "1 NAME Mira /Northwood/",
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 WIFE @I2@",
      "1 CHIL @I3@",
      "2 _FREL Natural",
      "2 _MREL Natural",
      "1 CHIL @I3@",
      "2 _FREL Adopted",
      "2 _MREL Adopted",
      "0 TRLR"
    ].join("\n"));

    const family = entities.find((entity) => entity.entityType === "family")!;
    expect(family.value).toMatchObject({ parents: ["@I1@", "@I2@"], children: ["@I3@"] });
    // The complete FAM record, including both CHIL fragments, is still
    // retained verbatim as review evidence.
    expect(family.raw).toContain("_FREL Adopted");

    const relationships = entities.filter((entity) => entity.entityType === "relationship");
    expect(relationships).toHaveLength(3);
    expect(new Set(relationships.map((entity) => entity.externalId)).size).toBe(3);
  });

  it("omits self-referential edges when one pointer fills both parent slots", () => {
    const entities = normalizeGedcomSnapshotEntities([
      "0 HEAD",
      "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
      "0 @I1@ INDI",
      "1 NAME Avery /Northwood/",
      "0 @I3@ INDI",
      "1 NAME Mira /Northwood/",
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 WIFE @I1@",
      "1 CHIL @I3@",
      "0 TRLR"
    ].join("\n"));

    const family = entities.find((entity) => entity.entityType === "family")!;
    expect(family.value).toMatchObject({ parents: ["@I1@"], children: ["@I3@"] });

    const relationships = entities.filter((entity) => entity.entityType === "relationship");
    expect(relationships).toHaveLength(1);
    expect(relationships[0].value).toMatchObject({
      type: "parent_child",
      fromPersonExternalId: "@I1@",
      toPersonExternalId: "@I3@"
    });
  });

  it("keeps unchanged fact identities stable across insertion and record reordering", () => {
    const before = normalizeGedcomSnapshotEntities([
      "0 HEAD",
      "0 @I1@ INDI",
      "1 NAME Avery /Northwood/",
      "1 CENS",
      "2 DATE 1900",
      "2 PLAC Lantern Bay, Wisconsin",
      "1 CENS",
      "2 DATE 1910",
      "2 PLAC Lantern Bay, Wisconsin",
      "1 RESI",
      "2 DATE 1912",
      "2 PLAC Silver Pine, Wisconsin",
      "0 TRLR"
    ].join("\n"));
    const after = normalizeGedcomSnapshotEntities([
      "0 HEAD",
      "0 @I1@ INDI",
      "1 NAME Avery /Northwood/",
      "1 RESI",
      "2 DATE 1912",
      "2 PLAC Silver Pine, Wisconsin",
      "1 CENS",
      "2 DATE 1910",
      "2 PLAC Lantern Bay, Wisconsin",
      "1 OCCU clerk",
      "1 CENS",
      "2 DATE 1905",
      "2 PLAC Lantern Bay, Wisconsin",
      "1 CENS",
      "2 DATE 1900",
      "2 PLAC Lantern Bay, Wisconsin",
      "0 TRLR"
    ].join("\n"));
    const factIdentities = (entities: ReturnType<typeof normalizeGedcomSnapshotEntities>) =>
      new Map(entities
        .filter((entity) => entity.entityType === "fact")
        .map((entity) => [`${entity.value.type}:${entity.value.date}`, entity.externalId]));
    const beforeFacts = factIdentities(before);
    const afterFacts = factIdentities(after);

    expect(afterFacts.get("CENS:1900")).toBe(beforeFacts.get("CENS:1900"));
    expect(afterFacts.get("CENS:1910")).toBe(beforeFacts.get("CENS:1910"));
    expect(afterFacts.get("RESI:1912")).toBe(beforeFacts.get("RESI:1912"));
    expect(new Set(afterFacts.values()).size).toBe(afterFacts.size);
  });

  it("deterministically distinguishes repeated facts with the same type and core values", () => {
    const gedcom = (pages: string[]) => [
      "0 HEAD",
      "0 @I1@ INDI",
      "1 NAME Avery /Northwood/",
      ...pages.flatMap((page) => [
        "1 CENS",
        "2 DATE 1900",
        "2 PLAC Lantern Bay, Wisconsin",
        "2 SOUR @S1@",
        `3 PAGE ${page}`
      ]),
      "0 @S1@ SOUR",
      "1 TITL Synthetic Lantern Bay census",
      "0 TRLR"
    ].join("\n");
    const factIdentities = (content: string) => new Map(
      normalizeGedcomSnapshotEntities(content)
        .filter((entity) => entity.entityType === "fact")
        .map((entity) => [entity.raw.includes("sheet A") ? "sheet A" : "sheet B", entity.externalId])
    );

    const before = factIdentities(gedcom(["sheet A", "sheet B"]));
    const reordered = factIdentities(gedcom(["sheet B", "sheet A"]));

    expect(reordered).toEqual(before);
    expect(new Set(before.values()).size).toBe(2);
  });

  it("reports unknown nested tags without retaining their private values", () => {
    const report = summarizeUnsupportedGedcomTags([
      "0 HEAD",
      "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
      "0 @I1@ INDI",
      "1 NAME Ada /Northwood/",
      "1 _PRIVATE_LEDGER never include this value in reports",
      "1 _PRIVATE_LEDGER another private value",
      "1 _SECOND_UNKNOWN private value",
      "0 TRLR"
    ].join("\n"), 1);

    expect(report).toEqual({
      total: 3,
      tags: [{ tag: "_PRIVATE_LEDGER", count: 2 }],
      truncated: true
    });
    expect(JSON.stringify(report)).not.toContain("never include this value");
    expect(JSON.stringify(report)).not.toContain("another private value");
  });

  it("hashes retained extension semantics without exposing values or hashing line formatting", () => {
    const first = hashRetainedGedcomExtensions([
      "0 @I1@ INDI",
      "1 NAME Ada /Northwood/",
      "1 _PRIVATE_LEDGER sealed alpha",
      "2 DATE 1901"
    ].join("\n"));
    const formattingOnly = hashRetainedGedcomExtensions([
      "0   @I1@   INDI",
      "1   NAME Ada /Northwood/",
      "1   _PRIVATE_LEDGER sealed alpha",
      "2   DATE 1901"
    ].join("\n"));
    const changed = hashRetainedGedcomExtensions([
      "0 @I1@ INDI",
      "1 NAME Ada /Northwood/",
      "1 _PRIVATE_LEDGER sealed beta",
      "2 DATE 1901"
    ].join("\n"));

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(formattingOnly).toBe(first);
    expect(changed).not.toBe(first);
    expect(first).not.toContain("sealed alpha");
    expect(hashRetainedGedcomExtensions("0 @I1@ INDI\n1 NAME Ada /Northwood/")).toBeUndefined();
  });
});
