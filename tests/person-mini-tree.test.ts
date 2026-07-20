import { describe, expect, it } from "vitest";

import { demoPeople } from "@/lib/demo-data";
import { buildFamilyTreeLayout } from "@/lib/family-tree";
import type { PersonSummary } from "@/lib/models";
import { buildPersonMiniTree, lifespanLabel } from "@/lib/person-mini-tree";
import { demoFamilyTreeEdges, type FamilyEdge } from "@/lib/person-relationships";

// Every fixture below is synthetic Hartwell–Mercer style fictional data.
function person(id: string, overrides: Partial<PersonSummary> = {}): PersonSummary {
  return {
    id,
    slug: id.replace(/@/g, "").toLowerCase(),
    displayName: `Fictional ${id.replace(/@/g, "")}`,
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
    const loner = person("@I1@");
    expect(buildPersonMiniTree(loner, [loner], [])).toBeUndefined();
    expect(buildPersonMiniTree(loner, [loner], demoFamilyTreeEdges)).toBeUndefined();
  });

  it("returns undefined when the person is missing from the people list", () => {
    expect(buildPersonMiniTree(person("@I1@"), [person("@I2@")], [])).toBeUndefined();
  });

  it("returns undefined when every referenced relative is unknown", () => {
    const subject = person("@I1@");
    const edges: FamilyEdge[] = [{
      id: "@F1@",
      husbandId: "@I8@",
      wifeId: "@I9@",
      partnerIds: ["@I8@", "@I9@"],
      childIds: ["@I1@"]
    }];
    expect(buildPersonMiniTree(subject, [subject], edges)).toBeUndefined();
  });

  it("shows a single known parent without a connector", () => {
    const subject = person("@I1@");
    const mother = person("@I2@", { sex: "F" });
    const edges: FamilyEdge[] = [{
      id: "@F1@",
      wifeId: "@I2@",
      partnerIds: ["@I2@"],
      childIds: ["@I1@"]
    }];
    const miniTree = buildPersonMiniTree(subject, [subject, mother], edges);

    expect(miniTree?.tree.generations.map((generation) => generation.id)).toEqual(["parents", "focus"]);
    expect(miniTree?.tree.families).toEqual([]);
    expect(() => buildFamilyTreeLayout(miniTree!.tree)).not.toThrow();
  });

  it("keeps spouses beside the person and children below, dropping empty rows", () => {
    const subject = person("@I1@", { sex: "M" });
    const spouse = person("@I2@", { sex: "F" });
    const child = person("@I3@");
    const edges: FamilyEdge[] = [{
      id: "@F1@",
      husbandId: "@I1@",
      wifeId: "@I2@",
      partnerIds: ["@I1@", "@I2@"],
      childIds: ["@I3@"]
    }];
    const miniTree = buildPersonMiniTree(subject, [subject, spouse, child], edges);

    expect(miniTree?.tree.generations.map((generation) => generation.id)).toEqual(["focus", "children"]);
    expect(miniTree?.tree.generations[0]?.members.map((member) => member.personId)).toEqual(["@I1@", "@I2@"]);
    expect(miniTree?.tree.families).toEqual([{
      id: "@F1@",
      partnerIds: ["@I1@", "@I2@"],
      childIds: ["@I3@"]
    }]);
    expect(() => buildFamilyTreeLayout(miniTree!.tree)).not.toThrow();
  });

  it("orders parents husband-first from the recorded roles", () => {
    const subject = person("@I3@");
    const father = person("@I1@", { sex: "M" });
    const mother = person("@I2@", { sex: "F" });
    const edges: FamilyEdge[] = [{
      id: "@F1@",
      husbandId: "@I1@",
      wifeId: "@I2@",
      partnerIds: ["@I1@", "@I2@"],
      childIds: ["@I3@"]
    }];
    const miniTree = buildPersonMiniTree(subject, [subject, mother, father], edges);
    const parentsRow = miniTree?.tree.generations.find((generation) => generation.id === "parents");

    expect(parentsRow?.members.map((member) => member.personId)).toEqual(["@I1@", "@I2@"]);
  });

  it("places every person exactly once even with contradictory edges", () => {
    const subject = person("@I1@");
    const other = person("@I2@");
    const contradictory: FamilyEdge[] = [
      { id: "@F1@", partnerIds: ["@I1@", "@I2@"], childIds: [] },
      { id: "@F2@", partnerIds: [], childIds: ["@I1@", "@I2@"] }
    ];
    const miniTree = buildPersonMiniTree(subject, [subject, other], contradictory);
    const placements = miniTree?.tree.generations.flatMap((generation) =>
      generation.members.map((member) => member.personId)
    );

    expect(placements).toEqual(["@I1@", "@I2@"]);
    expect(() => buildFamilyTreeLayout(miniTree!.tree)).not.toThrow();
  });

  it("summarizes lifespans with years, Living, and unknown markers", () => {
    expect(lifespanLabel({ birthDate: "12 Jun 1884", deathDate: "1951" })).toBe("1884–1951");
    expect(lifespanLabel({ birthDate: "1901", livingStatus: "living" })).toBe("1901–Living");
    expect(lifespanLabel({})).toBe("?–?");
    expect(lifespanLabel({ deathDate: "Abt 1922" })).toBe("?–1922");
  });
});
