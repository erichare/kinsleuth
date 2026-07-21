import { demoFamilyTree } from "./demo-family-tree";
import { findChild, findChildren, parseGedcom, type GedcomRecord } from "./gedcom/parser";
import type { AppliedGedcomImport, PersonSummary, RawGedcomRecord } from "./models";

// A normalized GEDCOM FAM structure. `partnerIds` always contains every known
// partner; `husbandId`/`wifeId` are set only when the source recorded explicit
// HUSB/WIFE roles (the fictional demo tree, for example, records partners
// without roles).
export type FamilyEdge = {
  id: string;
  husbandId?: string;
  wifeId?: string;
  partnerIds: readonly string[];
  childIds: readonly string[];
};

// The xref -> local person id mapping for one applied import, scoped to the
// integration connection that produced it. Integration-applied imports store
// generated local person ids on people while their raw FAM records still
// point at provider xrefs; translating through this mapping joins the two.
// Legacy GEDCOM imports need no mapping because their person ids ARE the
// xrefs (see lib/gedcom/parser.ts extractPeople).
export type ImportPersonXrefMapping = {
  // The integration connection id. Colliding xrefs from different
  // connections must never cross-translate, so edges are deduplicated within
  // this scope instead of globally.
  scopeId: string;
  personIdByXref: ReadonlyMap<string, string>;
};

export type PersonXrefMappingsByImportId = ReadonlyMap<string, ImportPersonXrefMapping>;

export const fallbackRelationshipLabel = "Linked relative";

// Derives the relative's relationship to the viewed person from family edges.
// Half- and step-relationships intentionally collapse into the base label.
export function deriveRelationshipLabel(
  subjectId: string,
  relative: Pick<PersonSummary, "id" | "sex">,
  families: readonly FamilyEdge[]
): string {
  for (const family of families) {
    const subjectIsPartner = family.partnerIds.includes(subjectId);
    const relativeIsPartner = family.partnerIds.includes(relative.id);
    const subjectIsChild = family.childIds.includes(subjectId);
    const relativeIsChild = family.childIds.includes(relative.id);

    if (subjectIsPartner && relativeIsPartner) return spouseLabel(relative.id, family);
    if (subjectIsPartner && relativeIsChild) return genderedRelationshipLabel(relative.sex, "Son", "Daughter", "Child");
    if (subjectIsChild && relativeIsPartner) return genderedRelationshipLabel(relative.sex, "Father", "Mother", "Parent");
    if (subjectIsChild && relativeIsChild) return genderedRelationshipLabel(relative.sex, "Brother", "Sister", "Sibling");
  }
  return fallbackRelationshipLabel;
}

export function genderedRelationshipLabel(
  sex: PersonSummary["sex"],
  male: string,
  female: string,
  unknown: string
): string {
  return sex === "M" ? male : sex === "F" ? female : unknown;
}

// Extracts family edges from parsed GEDCOM records. Only well-formed
// @pointer@ references count; free-text HUSB/WIFE/CHIL values are ignored.
export function familyEdgesFromGedcomRecords(records: readonly GedcomRecord[]): FamilyEdge[] {
  return records
    .filter((record) => record.type === "FAM")
    .flatMap((record, index) => {
      const husbandId = pointerValue(findChild(record.root, "HUSB")?.value);
      const wifeId = pointerValue(findChild(record.root, "WIFE")?.value);
      const childIds = [...new Set(
        findChildren(record.root, "CHIL").flatMap((node) => {
          const child = pointerValue(node.value);
          return child ? [child] : [];
        })
      )];
      const partnerIds = [husbandId, wifeId].filter((id): id is string => Boolean(id));
      if (partnerIds.length === 0 && childIds.length === 0) return [];

      return [{
        id: record.xref ?? `family-record-${index}`,
        husbandId,
        wifeId,
        partnerIds,
        childIds
      }];
    });
}

// Rebuilds family edges from the workspace's stored raw GEDCOM records.
// GEDCOM xrefs are only unique within one file, so each import is parsed in
// isolation and replayed oldest-first: the newest import containing a family
// xref owns that family's structure, matching the last-write-wins merge the
// importer applies to people (see buildRepairedRelativesByPersonId in
// lib/workspace-store.ts). Integration-applied imports additionally translate
// FAM member xrefs to the generated local person ids through their
// connection's mapping (see readPersonXrefMappingsByImportId in
// lib/workspace-store.ts); imports without a mapping keep raw xrefs, which
// already ARE the person ids on the legacy import path.
export function familyEdgesFromRawRecords(
  rawRecords: readonly RawGedcomRecord[],
  imports: readonly Pick<AppliedGedcomImport, "id" | "appliedAt">[],
  xrefMappings?: PersonXrefMappingsByImportId
): FamilyEdge[] {
  const familyRecords = rawRecords.filter((record) => record.type === "FAM");
  if (familyRecords.length === 0) return [];

  const appliedAtByImportId = new Map(imports.map((item) => [item.id, item.appliedAt]));
  const recordsByImportId = new Map<string, RawGedcomRecord[]>();
  for (const record of familyRecords) {
    recordsByImportId.set(record.importId, [...(recordsByImportId.get(record.importId) ?? []), record]);
  }
  const orderedImportIds = [...recordsByImportId.keys()].sort((left, right) =>
    (appliedAtByImportId.get(left) ?? "").localeCompare(appliedAtByImportId.get(right) ?? "")
  );

  // Last-write-wins is scoped: legacy imports share the unscoped family xref
  // key (re-importing a file lineage replaces its families), while mapped
  // imports key per connection so identical xrefs from unrelated connections
  // never clobber each other.
  const edgesByScopedFamilyId = new Map<string, FamilyEdge>();
  for (const importId of orderedImportIds) {
    const records = recordsByImportId.get(importId) ?? [];
    const parsed = parseGedcom(records.map((record) => record.raw).join("\n"));
    const mapping = xrefMappings?.get(importId);
    for (const edge of familyEdgesFromGedcomRecords(parsed.records)) {
      const translated = mapping ? translateFamilyEdge(edge, mapping) : edge;
      const scopedFamilyId = mapping ? `${mapping.scopeId}\u0000${edge.id}` : edge.id;
      edgesByScopedFamilyId.set(scopedFamilyId, translated);
    }
  }

  return [...edgesByScopedFamilyId.values()];
}

// Translates one FAM edge's member xrefs to local person ids. Members the
// connection never mapped (for example an individual whose incoming change
// was skipped at review) keep their xref: it matches no workspace person,
// which is the same behavior an unresolved pointer has today.
function translateFamilyEdge(edge: FamilyEdge, mapping: ImportPersonXrefMapping): FamilyEdge {
  const translate = (xref: string): string => mapping.personIdByXref.get(xref) ?? xref;
  return {
    // Namespace the edge id by connection so families from different
    // connections that reuse the same FAM xref stay distinct for consumers
    // that deduplicate by id (see dedupeFamilies in lib/person-mini-tree.ts).
    id: `${mapping.scopeId}:${edge.id}`,
    husbandId: edge.husbandId === undefined ? undefined : translate(edge.husbandId),
    wifeId: edge.wifeId === undefined ? undefined : translate(edge.wifeId),
    partnerIds: [...new Set(edge.partnerIds.map(translate))],
    childIds: [...new Set(edge.childIds.map(translate))]
  };
}

// The fictional demo workspace stores no raw GEDCOM records; its family
// structure lives in the hand-built demo tree. Demo partners carry no
// HUSB/WIFE roles, so demo spouses label as the neutral "Spouse".
export const demoFamilyTreeEdges: readonly FamilyEdge[] = demoFamilyTree.families.map((family) => ({
  id: family.id,
  partnerIds: family.partnerIds,
  childIds: family.childIds
}));

// Family edges for a private workspace: imported GEDCOM FAM structures first,
// then the fictional demo edges. Demo person ids (p-*) never collide with
// GEDCOM xrefs (@...@) or generated local ids, so appending them
// unconditionally is safe and keeps demo archives labeled without a
// dataset-mode branch. Both collections are optional because callers may hold
// partial workspace projections. Callers with integration-applied imports
// must pass the xref mappings so edge members resolve to local person ids.
export function workspaceFamilyEdges(
  workspace: {
    rawRecords?: readonly RawGedcomRecord[];
    imports?: readonly Pick<AppliedGedcomImport, "id" | "appliedAt">[];
  },
  xrefMappings?: PersonXrefMappingsByImportId
): FamilyEdge[] {
  return [
    ...familyEdgesFromRawRecords(workspace.rawRecords ?? [], workspace.imports ?? [], xrefMappings),
    ...demoFamilyTreeEdges
  ];
}

function spouseLabel(relativeId: string, family: FamilyEdge): string {
  if (relativeId === family.husbandId) return "Husband";
  if (relativeId === family.wifeId) return "Wife";
  return "Spouse";
}

function pointerValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.startsWith("@") && trimmed.endsWith("@") && trimmed.length > 2 ? trimmed : undefined;
}
