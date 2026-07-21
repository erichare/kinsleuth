import { describe, expect, it } from "vitest";

import { demoPeople } from "@/lib/demo-data";
import { buildFamilyTreeLayout } from "@/lib/family-tree";
import type { PersonSummary } from "@/lib/models";
import { buildPersonMiniTree, lifespanLabel } from "@/lib/person-mini-tree";
import { demoFamilyTreeEdges, type FamilyEdge } from "@/lib/person-relationships";

// Every fixture below is synthetic Hartwell–Mercer style fictional data.
// Synthetic ids use the generated local-id shape, NOT GEDCOM xrefs: family
// edges reference workspace person ids, and only the legacy import path
// happens to reuse xrefs as ids (regression coverage for the xref/local-id
// join bug).
function person(id: string, overrides: Partial<PersonSummary> = {}): PersonSummary {
  return {
    id,
    slug: id.toLowerCase(),
    displayName: `Fictional ${id}`,
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    facts: [],
    relatives: [],
    ...overrides
  };
}

function requiredDemoPerson(id: string): PersonSummary {
  const match = demoPeople.find((candidate) => candidate.id === id);
  if (!match) throw new Error(`Missing demo person ${id}`);
  return match;
}

describe("buildPersonMiniTree", () => {
  it("builds the hourglass for a fictional demo person with every generation", () => {
    const nora = requiredDemoPerson("p-nora-hartwell");
    const miniTree = buildPersonMiniTree(nora, demoPeople, demoFamilyTreeEdges);

    expect(miniTree).toBeDefined();
    expect(miniTree?.focusPersonId).toBe("p-nora-hartwell");
    expect(miniTree?.tree.generations.map((generation) => generation.id)).toEqual([
      "grandparents",
      "parents",
      "focus",
      "children"
    ]);

    const membersByGeneration = new Map(
      miniTree?.tree.generations.map((generation) => [
        generation.id,
        generation.members.map((member) => member.personId)
      ])
    );
    expect(membersByGeneration.get("grandparents")).toEqual([
      "p-orson-hartwell",
      "p-lydia-thorne",
      "p-luca-bellandi",
      "p-mira-solari"
    ]);
    expect(membersByGeneration.get("parents")).toEqual(["p-elias-hartwell", "p-amalia-bellandi"]);
    expect(membersByGeneration.get("focus")).toEqual(["p-nora-hartwell", "p-samuel-mercer"]);
    expect(membersByGeneration.get("children")).toEqual([
      "p-clara-mercer",
      "p-tobias-mercer",
      "p-iris-mercer",
      "p-peter-mercer"
    ]);
  });

  it("stops at two generations up and one generation down", () => {
    const nora = requiredDemoPerson("p-nora-hartwell");
    const miniTree = buildPersonMiniTree(nora, demoPeople, demoFamilyTreeEdges);
    const placed = miniTree?.people.map((entry) => entry.id) ?? [];

    // Great-grandparents of Nora's children and Nora's grandchild are out of scope.
    expect(placed).not.toContain("p-june-vale");
    expect(placed).not.toContain("p-henry-vale");
  });

  it("produces a layout-valid tree with connectors for every demo person", () => {
    for (const demoPerson of demoPeople) {
      const miniTree = buildPersonMiniTree(demoPerson, demoPeople, demoFamilyTreeEdges);
      expect(miniTree, demoPerson.displayName).toBeDefined();
      if (!miniTree) continue;
      const layout = buildFamilyTreeLayout(miniTree.tree);
      expect(layout.nodes.length, demoPerson.displayName).toBe(miniTree.people.length);
    }

    const noraTree = buildPersonMiniTree(requiredDemoPerson("p-nora-hartwell"), demoPeople, demoFamilyTreeEdges);
    expect(noraTree?.tree.families.map((family) => family.id)).toEqual([
      "family-orson-lydia",
      "family-luca-mira",
      "family-elias-amalia",
      "family-nora-samuel"
    ]);
  });

  it("returns undefined when the person has no relatives in the family edges", () => {
    const loner = person("person-subject");
    expect(buildPersonMiniTree(loner, [loner], [])).toBeUndefined();
    expect(buildPersonMiniTree(loner, [loner], demoFamilyTreeEdges)).toBeUndefined();
  });

  it("returns undefined when the person is missing from the people list", () => {
    expect(buildPersonMiniTree(person("person-subject"), [person("person-second")], [])).toBeUndefined();
  });

  it("returns undefined when every referenced relative is unknown", () => {
    const subject = person("person-subject");
    const edges: FamilyEdge[] = [{
      id: "family-conn:@F1@",
      husbandId: "person-unknown-a",
      wifeId: "person-unknown-b",
      partnerIds: ["person-unknown-a", "person-unknown-b"],
      childIds: ["person-subject"]
    }];
    expect(buildPersonMiniTree(subject, [subject], edges)).toBeUndefined();
  });

  it("shows a single known parent without a connector", () => {
    const subject = person("person-subject");
    const mother = person("person-second", { sex: "F" });
    const edges: FamilyEdge[] = [{
      id: "family-conn:@F1@",
      wifeId: "person-second",
      partnerIds: ["person-second"],
      childIds: ["person-subject"]
    }];
    const miniTree = buildPersonMiniTree(subject, [subject, mother], edges);

    expect(miniTree?.tree.generations.map((generation) => generation.id)).toEqual(["parents", "focus"]);
    expect(miniTree?.tree.families).toEqual([]);
    expect(() => buildFamilyTreeLayout(miniTree!.tree)).not.toThrow();
  });

  it("keeps spouses beside the person and children below, dropping empty rows", () => {
    const subject = person("person-subject", { sex: "M" });
    const spouse = person("person-second", { sex: "F" });
    const child = person("person-third");
    const edges: FamilyEdge[] = [{
      id: "family-conn:@F1@",
      husbandId: "person-subject",
      wifeId: "person-second",
      partnerIds: ["person-subject", "person-second"],
      childIds: ["person-third"]
    }];
    const miniTree = buildPersonMiniTree(subject, [subject, spouse, child], edges);

    expect(miniTree?.tree.generations.map((generation) => generation.id)).toEqual(["focus", "children"]);
    expect(miniTree?.tree.generations[0]?.members.map((member) => member.personId)).toEqual(["person-subject", "person-second"]);
    expect(miniTree?.tree.families).toEqual([{
      id: "family-conn:@F1@",
      partnerIds: ["person-subject", "person-second"],
      childIds: ["person-third"]
    }]);
    expect(() => buildFamilyTreeLayout(miniTree!.tree)).not.toThrow();
  });

  it("orders parents husband-first from the recorded roles", () => {
    const subject = person("person-third");
    const father = person("person-subject", { sex: "M" });
    const mother = person("person-second", { sex: "F" });
    const edges: FamilyEdge[] = [{
      id: "family-conn:@F1@",
      husbandId: "person-subject",
      wifeId: "person-second",
      partnerIds: ["person-subject", "person-second"],
      childIds: ["person-third"]
    }];
    const miniTree = buildPersonMiniTree(subject, [subject, mother, father], edges);
    const parentsRow = miniTree?.tree.generations.find((generation) => generation.id === "parents");

    expect(parentsRow?.members.map((member) => member.personId)).toEqual(["person-subject", "person-second"]);
  });

  it("places every person exactly once even with contradictory edges", () => {
    const subject = person("person-subject");
    const other = person("person-second");
    const contradictory: FamilyEdge[] = [
      { id: "family-conn:@F1@", partnerIds: ["person-subject", "person-second"], childIds: [] },
      { id: "family-conn:@F2@", partnerIds: [], childIds: ["person-subject", "person-second"] }
    ];
    const miniTree = buildPersonMiniTree(subject, [subject, other], contradictory);
    const placements = miniTree?.tree.generations.flatMap((generation) =>
      generation.members.map((member) => member.personId)
    );

    expect(placements).toEqual(["person-subject", "person-second"]);
    expect(() => buildFamilyTreeLayout(miniTree!.tree)).not.toThrow();
  });

  it("summarizes lifespans with years, Living, and unknown markers", () => {
    expect(lifespanLabel({ birthDate: "12 Jun 1884", deathDate: "1951" })).toBe("1884–1951");
    expect(lifespanLabel({ birthDate: "1901", livingStatus: "living" })).toBe("1901–Living");
    expect(lifespanLabel({})).toBe("?–?");
    expect(lifespanLabel({ deathDate: "Abt 1922" })).toBe("?–1922");
  });
});
