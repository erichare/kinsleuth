import { createHash } from "node:crypto";

import {
  findChild,
  findChildren,
  flattenRaw,
  parseGedcom,
  textWithContinuations,
  type GedcomNode
} from "../gedcom/parser";

export type NormalizedGedcomEntityType = "family" | "fact" | "relationship" | "citation" | "media";

export type NormalizedGedcomEntity = {
  entityType: NormalizedGedcomEntityType;
  externalId: string;
  ownerExternalId?: string;
  value: Record<string, unknown>;
  raw: string;
};

const factTags = new Set(["BIRT", "DEAT", "BURI", "CHR", "CENS", "MARR", "DIV", "RESI", "EVEN", "OCCU"]);
const supportedNestedTags = new Set([
  "SOUR", "DEST", "DATE", "TIME", "SUBM", "FILE", "COPR", "GEDC", "VERS", "FORM", "CHAR", "LANG",
  "NAME", "SEX", "FAMS", "FAMC", "HUSB", "WIFE", "CHIL", "PLAC", "TYPE", "PAGE", "DATA", "TEXT",
  "NOTE", "CONT", "CONC", "OBJE", "TITL", "ABBR", "REPO", "WWW", "_APID", "_FSFTID", "_UID", "RIN",
  "REFN", "_KS_PRIVACY", "_KS_PUBLISHED", "_KS_LIVING", ...factTags
]);

export type UnsupportedGedcomTagSummary = {
  total: number;
  tags: Array<{ tag: string; count: number }>;
  truncated: boolean;
};

export type RetainedGedcomExtensionHashOptions = {
  /** Root-owned subtrees normalized as separate entities must not be counted twice. */
  excludeRootChildTags?: readonly string[];
};

/**
 * Produces provider-neutral, typed snapshot entities without discarding the
 * original GEDCOM fragment. These records are review/audit material; binary
 * media remains governed by the restricted-media ingestion gate.
 */
export function normalizeGedcomSnapshotEntities(content: string): NormalizedGedcomEntity[] {
  const { records } = parseGedcom(content);
  const entities: NormalizedGedcomEntity[] = [];
  const mediaOwners = new Map<string, Set<string>>();

  for (const record of records) {
    if (record.type !== "INDI" || !record.xref) continue;
    const personExternalId = record.xref;
    const factExternalIds = buildFactExternalIds(
      personExternalId,
      record.root.children.filter((node) => factTags.has(node.tag))
    );
    let inlineMediaOrdinal = 0;

    for (const node of record.root.children) {
      if (factTags.has(node.tag)) {
        const factExternalId = factExternalIds.get(node)!;
        const citations = findChildren(node, "SOUR");
        entities.push({
          entityType: "fact",
          externalId: factExternalId,
          ownerExternalId: personExternalId,
          value: {
            personExternalId,
            type: node.tag,
            date: findChild(node, "DATE")?.value ?? null,
            place: findChild(node, "PLAC")?.value ?? null,
            value: node.tag === "EVEN" ? findChild(node, "TYPE")?.value ?? null : node.value ?? null,
            citationExternalIds: citations.map((_source, index) =>
              citationExternalId(factExternalId, index)
            ),
            privacy: "private"
          },
          raw: flattenRaw(node).join("\n")
        });
        citations.forEach((source, index) => {
          entities.push(normalizeCitation(personExternalId, factExternalId, source, index));
        });
        continue;
      }

      if (node.tag === "SOUR") {
        entities.push(normalizeCitation(personExternalId, undefined, node, indexOfSibling(record.root, node, "SOUR")));
        continue;
      }

      if (node.tag === "OBJE") {
        if (isPointer(node.value)) {
          const owners = mediaOwners.get(node.value) ?? new Set<string>();
          owners.add(personExternalId);
          mediaOwners.set(node.value, owners);
        } else {
          inlineMediaOrdinal += 1;
          entities.push(normalizeMediaNode(
            `${personExternalId}:media:${inlineMediaOrdinal}`,
            node,
            [personExternalId]
          ));
        }
      }
    }
  }

  for (const record of records) {
    if (record.type === "FAM") {
      entities.push(...normalizeFamily(record.xref ?? `family:${entities.length + 1}`, record.root));
    }
    if (record.type === "OBJE") {
      const externalId = record.xref ?? `media:${entities.length + 1}`;
      entities.push(normalizeMediaNode(externalId, record.root, [...(mediaOwners.get(externalId) ?? [])]));
    }
  }

  return entities;
}

function buildFactExternalIds(personExternalId: string, facts: GedcomNode[]): Map<GedcomNode, string> {
  const occurrences = new Map<string, number>();
  const externalIds = new Map<GedcomNode, string>();
  for (const fact of facts) {
    const fingerprint = createHash("sha256")
      .update(canonicalFactIdentity(fact))
      .digest("hex")
      .slice(0, 24);
    const identity = `${personExternalId}:fact:${fact.tag}:${fingerprint}`;
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    externalIds.set(fact, `${identity}:${occurrence}`);
  }
  return externalIds;
}

function canonicalFactIdentity(node: GedcomNode): string {
  const children = node.children.map(canonicalFactIdentity).sort();
  return JSON.stringify({
    tag: node.tag,
    xref: node.xref ?? null,
    value: normalizeFactIdentityText(node.value),
    children
  });
}

function normalizeFactIdentityText(value: string | undefined): string | null {
  return value?.normalize("NFKC").trim().replace(/\s+/g, " ") || null;
}

/** Bounded, data-minimizing report of nested tags the canonical model does not interpret. */
export function summarizeUnsupportedGedcomTags(content: string, limit = 50): UnsupportedGedcomTagSummary {
  const counts = new Map<string, number>();
  for (const record of parseGedcom(content).records) {
    for (const child of record.root.children) collectUnsupportedTags(child, counts);
  }
  const all = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, count]) => ({ tag, count }));
  return {
    total: all.reduce((sum, entry) => sum + entry.count, 0),
    tags: all.slice(0, Math.max(0, limit)),
    truncated: all.length > limit
  };
}

/**
 * Returns an opaque semantic digest for GEDCOM extension subtrees that Kin
 * Resolve retains but does not interpret. Formatting-only changes to GEDCOM
 * line prefixes do not affect the digest, and private extension values never
 * leave this function.
 */
export function hashRetainedGedcomExtensions(
  raw: string,
  options: RetainedGedcomExtensionHashOptions = {}
): string | undefined {
  const excludedRootTags = new Set(
    (options.excludeRootChildTags ?? []).map((tag) => tag.toUpperCase())
  );
  const extensions: RetainedGedcomExtensionNode[] = [];
  for (const record of parseGedcom(raw).records) {
    for (const child of record.root.children) {
      if (excludedRootTags.has(child.tag.toUpperCase())) continue;
      collectRetainedExtensionNodes(child, extensions);
    }
  }
  if (extensions.length === 0) return undefined;
  return createHash("sha256").update(JSON.stringify(extensions)).digest("hex");
}

type RetainedGedcomExtensionNode = {
  tag: string;
  xref: string | null;
  value: string | null;
  children: RetainedGedcomExtensionNode[];
};

function collectRetainedExtensionNodes(
  node: GedcomNode,
  extensions: RetainedGedcomExtensionNode[]
): void {
  if (!supportedNestedTags.has(node.tag.toUpperCase())) {
    extensions.push(canonicalRetainedExtensionNode(node));
    return;
  }
  for (const child of node.children) collectRetainedExtensionNodes(child, extensions);
}

function canonicalRetainedExtensionNode(node: GedcomNode): RetainedGedcomExtensionNode {
  return {
    tag: node.tag.toUpperCase(),
    xref: node.xref ?? null,
    value: node.value ?? null,
    children: node.children.map(canonicalRetainedExtensionNode)
  };
}

function collectUnsupportedTags(node: GedcomNode, counts: Map<string, number>): void {
  if (!supportedNestedTags.has(node.tag)) counts.set(node.tag, (counts.get(node.tag) ?? 0) + 1);
  for (const child of node.children) collectUnsupportedTags(child, counts);
}

function normalizeFamily(externalId: string, root: GedcomNode): NormalizedGedcomEntity[] {
  const parents = [findChild(root, "HUSB")?.value, findChild(root, "WIFE")?.value].filter(isPointer);
  const children = findChildren(root, "CHIL").map((node) => node.value).filter(isPointer);
  const raw = flattenRaw(root).join("\n");
  const family: NormalizedGedcomEntity = {
    entityType: "family",
    externalId,
    value: { parents, children },
    raw
  };
  const relationships: NormalizedGedcomEntity[] = [];

  if (parents.length === 2) {
    relationships.push(relationship(externalId, "spouse", parents[0], parents[1]));
  }
  for (const parent of parents) {
    for (const child of children) {
      relationships.push(relationship(externalId, "parent_child", parent, child));
    }
  }
  return [family, ...relationships];
}

function relationship(
  familyExternalId: string,
  type: "spouse" | "parent_child",
  fromPersonExternalId: string,
  toPersonExternalId: string
): NormalizedGedcomEntity {
  return {
    entityType: "relationship",
    externalId: `${familyExternalId}:relationship:${type}:${fromPersonExternalId}:${toPersonExternalId}`,
    ownerExternalId: familyExternalId,
    value: { type, fromPersonExternalId, toPersonExternalId, familyExternalId },
    // The owning family entity retains the complete FAM record once. Derived
    // edges already carry familyExternalId and must not duplicate that raw
    // fragment into every relationship and serialized snapshot value.
    raw: ""
  };
}

function normalizeCitation(
  personExternalId: string,
  factExternalId: string | undefined,
  node: GedcomNode,
  index: number
): NormalizedGedcomEntity {
  const externalId = citationExternalId(factExternalId ?? `${personExternalId}:person`, index);
  const data = findChild(node, "DATA");
  return {
    entityType: "citation",
    externalId,
    ownerExternalId: factExternalId ?? personExternalId,
    value: {
      personExternalId,
      factExternalId: factExternalId ?? null,
      sourceExternalId: isPointer(node.value) ? node.value : null,
      sourceText: isPointer(node.value) ? null : node.value ?? null,
      page: findChild(node, "PAGE")?.value ?? null,
      dataDate: findChild(data ?? node, "DATE")?.value ?? null,
      text: textWithContinuations(findChild(data ?? node, "TEXT")) ?? null,
      note: textWithContinuations(findChild(node, "NOTE")) ?? null,
      privacy: "private"
    },
    raw: flattenRaw(node).join("\n")
  };
}

function citationExternalId(ownerExternalId: string, index: number): string {
  return `${ownerExternalId}:citation:${index + 1}`;
}

function normalizeMediaNode(
  externalId: string,
  node: GedcomNode,
  linkedPersonExternalIds: string[]
): NormalizedGedcomEntity {
  const file = findChild(node, "FILE");
  return {
    entityType: "media",
    externalId,
    value: {
      file: file?.value ?? null,
      format: findChild(file ?? node, "FORM")?.value ?? null,
      title: textWithContinuations(findChild(file ?? node, "TITL"))
        ?? textWithContinuations(findChild(node, "TITL"))
        ?? null,
      linkedPersonExternalIds: [...new Set(linkedPersonExternalIds)].sort(),
      privacy: "private",
      license: "third_party_restricted",
      publicEligible: false,
      aiEligible: false
    },
    raw: flattenRaw(node).join("\n")
  };
}

function indexOfSibling(parent: GedcomNode, node: GedcomNode, tag: string): number {
  return parent.children.filter((candidate) => candidate.tag === tag).indexOf(node);
}

function isPointer(value: string | undefined): value is string {
  return Boolean(value && /^@[^@]+@$/.test(value));
}
