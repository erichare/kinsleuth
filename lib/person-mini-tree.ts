import type { FamilyTreeDefinition, FamilyTreeGeneration, FamilyUnit } from "./family-tree";
import type { PersonSummary } from "./models";
import type { FamilyEdge } from "./person-relationships";

export type PersonMiniTreePerson = {
  id: string;
  displayName: string;
  lifespan: string;
  birthPlace?: string;
};

export type PersonMiniTree = {
  focusPersonId: string;
  tree: FamilyTreeDefinition;
  people: PersonMiniTreePerson[];
};

const nodeColumnSpan = 2;

type MiniTreeRow = {
  id: string;
  label: string;
  memberIds: string[];
};

// Builds an hourglass tree centered on the viewed person: up to two
// generations up (parents, grandparents), spouses beside the person, and one
// generation down (children). Returns undefined when the family edges place
// no relative around the person, so callers can skip the section entirely.
export function buildPersonMiniTree(
  person: PersonSummary,
  people: readonly PersonSummary[],
  families: readonly FamilyEdge[]
): PersonMiniTree | undefined {
  const peopleById = new Map(people.map((candidate) => [candidate.id, candidate]));
  if (!peopleById.has(person.id)) return undefined;

  const parentFamilies = families.filter((family) => family.childIds.includes(person.id));
  const spouseFamilies = families.filter((family) => family.partnerIds.includes(person.id));

  const parents = uniqueKnownIds(
    parentFamilies.flatMap((family) => orderedPartnerIds(family)),
    peopleById
  );
  const grandparents = uniqueKnownIds(
    parents.flatMap((parentId) =>
      families
        .filter((family) => family.childIds.includes(parentId))
        .flatMap((family) => orderedPartnerIds(family))
    ),
    peopleById
  );
  const spouses = uniqueKnownIds(
    spouseFamilies.flatMap((family) => orderedPartnerIds(family).filter((id) => id !== person.id)),
    peopleById
  );
  const children = uniqueKnownIds(
    spouseFamilies.flatMap((family) => family.childIds),
    peopleById
  );

  // A person can appear in only one generation of the layout. Assign the
  // focus row first, then parents, grandparents, and children; the first
  // placement wins if imported data is contradictory.
  const generationById = new Map<string, string>();
  const claim = (rowId: string, ids: readonly string[]): string[] =>
    ids.filter((id) => {
      if (generationById.has(id)) return false;
      generationById.set(id, rowId);
      return true;
    });

  const focusRow: MiniTreeRow = {
    id: "focus",
    label: spouses.length > 0 ? "This person and spouses" : "This person",
    memberIds: claim("focus", [person.id, ...spouses])
  };
  const parentsRow: MiniTreeRow = { id: "parents", label: "Parents", memberIds: claim("parents", parents) };
  const grandparentsRow: MiniTreeRow = {
    id: "grandparents",
    label: "Grandparents",
    memberIds: claim("grandparents", grandparents)
  };
  const childrenRow: MiniTreeRow = { id: "children", label: "Children", memberIds: claim("children", children) };

  if (generationById.size <= 1) return undefined;

  const rows = [grandparentsRow, parentsRow, focusRow, childrenRow].filter((row) => row.memberIds.length > 0);
  const rowIndexById = new Map(rows.map((row, index) => [row.id, index]));
  const widestRow = Math.max(...rows.map((row) => row.memberIds.length));
  const columnCount = widestRow * nodeColumnSpan;

  const generations: FamilyTreeGeneration[] = rows.map((row) => ({
    id: row.id,
    label: row.label,
    members: row.memberIds.map((personId, index) => ({
      personId,
      column: widestRow - row.memberIds.length + index * nodeColumnSpan
    }))
  }));

  const connectorFamilies: FamilyUnit[] = [
    ...connectableFamilies(
      parents.flatMap((parentId) => families.filter((family) => family.childIds.includes(parentId))),
      "grandparents",
      "parents",
      generationById,
      rowIndexById
    ),
    ...connectableFamilies(parentFamilies, "parents", "focus", generationById, rowIndexById),
    ...connectableFamilies(spouseFamilies, "focus", "children", generationById, rowIndexById)
  ];

  const placedIds = rows.flatMap((row) => row.memberIds);

  return {
    focusPersonId: person.id,
    tree: {
      columnCount,
      nodeColumnSpan,
      generations,
      families: dedupeFamilies(connectorFamilies)
    },
    people: placedIds.map((id) => {
      const summary = peopleById.get(id);
      if (!summary) throw new Error(`Mini tree placed unknown person ${id}.`);
      return {
        id: summary.id,
        displayName: summary.displayName,
        lifespan: lifespanLabel(summary),
        birthPlace: summary.birthPlace
      };
    })
  };
}

export function lifespanLabel(person: Partial<Pick<PersonSummary, "birthDate" | "deathDate" | "livingStatus">>): string {
  const birth = yearOf(person.birthDate) ?? "?";
  const death = yearOf(person.deathDate) ?? (person.livingStatus === "living" ? "Living" : "?");
  return `${birth}–${death}`;
}

// The layout engine (lib/family-tree.ts) requires each connector family to
// have exactly two partners placed in one generation and at least one child
// placed in the immediately following generation. Families that do not meet
// the invariants (single known parent, unplaced children) still contribute
// nodes, just no connecting lines.
function connectableFamilies(
  candidates: readonly FamilyEdge[],
  partnerRowId: string,
  childRowId: string,
  generationById: ReadonlyMap<string, string>,
  rowIndexById: ReadonlyMap<string, number>
): FamilyUnit[] {
  const partnerRowIndex = rowIndexById.get(partnerRowId);
  const childRowIndex = rowIndexById.get(childRowId);
  if (partnerRowIndex === undefined || childRowIndex === undefined || childRowIndex !== partnerRowIndex + 1) {
    return [];
  }

  return candidates.flatMap((family) => {
    const partners = orderedPartnerIds(family).filter((id) => generationById.get(id) === partnerRowId);
    if (partners.length !== 2) return [];
    const childIds = family.childIds.filter((id) => generationById.get(id) === childRowId);
    if (childIds.length === 0) return [];
    return [{
      id: family.id,
      partnerIds: [partners[0], partners[1]] as [string, string],
      childIds
    }];
  });
}

function dedupeFamilies(families: readonly FamilyUnit[]): FamilyUnit[] {
  const byId = new Map<string, FamilyUnit>();
  for (const family of families) {
    if (!byId.has(family.id)) byId.set(family.id, family);
  }
  return [...byId.values()];
}

function orderedPartnerIds(family: FamilyEdge): string[] {
  const roleOrdered = [family.husbandId, family.wifeId].filter((id): id is string => Boolean(id));
  return [...new Set([...roleOrdered, ...family.partnerIds])];
}

function uniqueKnownIds(ids: readonly string[], peopleById: ReadonlyMap<string, PersonSummary>): string[] {
  return [...new Set(ids)].filter((id) => peopleById.has(id));
}

function yearOf(date?: string): string | undefined {
  return date?.match(/\b\d{4}\b/)?.[0];
}
