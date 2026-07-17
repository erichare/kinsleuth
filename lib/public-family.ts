import { demoPeople } from "./demo-data";
import { demoFamilyTree } from "./demo-family-tree";
import { createDemoSources } from "./demo-sources";
import type { FamilyTreeDefinition } from "./family-tree";
import type { PersonFact } from "./models";
import { canPublishPerson, publicFactFilter } from "./privacy";

export type PublicFamilyPerson = {
  id: string;
  slug: string;
  displayName: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  facts: PersonFact[];
  relatives: string[];
};

export type PublicFamilyCitation = {
  id: string;
  title: string;
  sourceType: string;
  repository?: string;
  citationDate?: string;
  linkedPersonId?: string;
};

export type PublicFamilyProjection = {
  archiveName: string;
  archiveTagline: string;
  people: PublicFamilyPerson[];
  tree: FamilyTreeDefinition;
  citations: PublicFamilyCitation[];
};

export async function readPublicFamilyProjection(): Promise<PublicFamilyProjection> {
  const people = demoPeople
    .filter((person) => person.published && canPublishPerson(person))
    .map((person) => ({
      id: person.id,
      slug: person.slug,
      displayName: person.displayName,
      birthDate: person.birthDate,
      birthPlace: person.birthPlace,
      deathDate: person.deathDate,
      deathPlace: person.deathPlace,
      facts: person.facts.filter(publicFactFilter).map((fact) => ({ ...fact })),
      relatives: [...person.relatives]
    }));
  const citations = createDemoSources(new Date("2026-07-16T00:00:00.000Z")).map((source) => ({
    id: source.id,
    title: source.title,
    sourceType: source.sourceType,
    repository: source.repository,
    citationDate: source.citationDate,
    linkedPersonId: source.linkedPersonId
  }));
  const publicPersonIds = new Set(people.map((person) => person.id));

  return {
    archiveName: "Hartwell–Mercer Family Archive",
    archiveTagline: "A completely fictional family archive for exploring Kin Resolve.",
    people,
    tree: projectPublicTree(publicPersonIds),
    citations
  };
}

function projectPublicTree(publicPersonIds: ReadonlySet<string>): FamilyTreeDefinition {
  return {
    columnCount: demoFamilyTree.columnCount,
    nodeColumnSpan: demoFamilyTree.nodeColumnSpan,
    generations: demoFamilyTree.generations.map((generation) => ({
      id: generation.id,
      label: generation.label,
      members: generation.members.filter((member) => publicPersonIds.has(member.personId))
    })),
    families: demoFamilyTree.families.flatMap((family) => {
      const [firstPartnerId, secondPartnerId] = family.partnerIds;
      if (!publicPersonIds.has(firstPartnerId) || !publicPersonIds.has(secondPartnerId)) {
        return [];
      }
      const childIds = family.childIds.filter((childId) => publicPersonIds.has(childId));
      if (childIds.length === 0) return [];

      return [{
        id: family.id,
        partnerIds: [firstPartnerId, secondPartnerId] as [string, string],
        childIds
      }];
    })
  };
}
