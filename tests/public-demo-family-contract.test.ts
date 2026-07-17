import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { demoPeople } from "@/lib/demo-data";
import { readPublicFamilyProjection } from "@/lib/public-family";
import { createDemoWorkspace } from "@/lib/workspace-store";

describe("curated Hartwell-Mercer public family", () => {
  it("publishes all 16 unique deceased fictional profiles and only public facts", () => {
    expect(demoPeople).toHaveLength(16);
    expect(new Set(demoPeople.map((person) => person.id)).size).toBe(16);
    expect(new Set(demoPeople.map((person) => person.slug)).size).toBe(16);
    const factIds = demoPeople.flatMap((person) => person.facts.map((fact) => fact.id));
    expect(new Set(factIds).size).toBe(factIds.length);

    for (const person of demoPeople) {
      expect(person, person.displayName).toMatchObject({
        livingStatus: "deceased",
        privacy: "public",
        published: true
      });
      expect(person.facts.length, `${person.displayName} public facts`).toBeGreaterThan(0);
      expect(person.facts.every((fact) => fact.privacy === "public"), person.displayName).toBe(true);
    }
  });

  it("projects every public person exactly once into a typed, connected four-generation tree", async () => {
    const family = await readPublicFamilyProjection();
    const publicPersonIds = new Set(family.people.map((person) => person.id));
    const treePersonIds = family.tree.generations.flatMap((generation) =>
      generation.members.map((member) => member.personId)
    );

    expect(family.tree.generations).toHaveLength(4);
    expect(family.tree.families).toHaveLength(7);
    expect(treePersonIds).toHaveLength(family.people.length);
    expect(new Set(treePersonIds)).toEqual(publicPersonIds);

    for (const familyUnit of family.tree.families) {
      expect(familyUnit.partnerIds).toHaveLength(2);
      expect(new Set(familyUnit.partnerIds).size).toBe(2);
      expect(familyUnit.childIds.length).toBeGreaterThan(0);
      expect(new Set(familyUnit.childIds).size).toBe(familyUnit.childIds.length);
      for (const personId of [...familyUnit.partnerIds, ...familyUnit.childIds]) {
        expect(publicPersonIds.has(personId), `${familyUnit.id} references ${personId}`).toBe(true);
      }
    }
  });

  it("projects all seven citations without exposing private workspace fields", async () => {
    const workspace = createDemoWorkspace(new Date("2026-07-16T00:00:00.000Z"));
    expect(workspace.sources).toHaveLength(7);

    const projection = await source("lib/public-family.ts");
    expect(projection).toMatch(/export type PublicFamilyProjection/);
    expect(projection).toMatch(/export (?:async )?function readPublicFamilyProjection/);
    expect(projection).toMatch(/people/);
    expect(projection).toMatch(/citations/);
    expect(projection).toMatch(/canPublishPerson/);
    expect(projection).toMatch(/publicFactFilter/);
    expect(projection).not.toMatch(/\b(?:cases|dnaMatches|imports|backups|aiRuns|rawRecords|notes|transcript)\b/);
  });

  it("serves the family landing from the public-only projection", async () => {
    const familyPage = await source("app/family/page.tsx");

    expect(familyPage).toMatch(/readPublicFamilyProjection/);
    expect(familyPage).not.toMatch(/readWorkspace/);
    expect(familyPage).toMatch(/Public family archive/i);
    expect(familyPage).toMatch(/fictional/i);
    expect(familyPage).toMatch(/published profiles/i);
    expect(familyPage).toMatch(/PublicFamilyTree/);
    expect(familyPage).toMatch(/complete four-generation tree/i);
  });
});

async function source(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
