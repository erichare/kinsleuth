import type { ImportSummary, PersonFact, PersonSummary } from "../models";

export type GedcomLine = {
  number: number;
  level: number;
  xref?: string;
  tag: string;
  value?: string;
  raw: string;
};

export type GedcomNode = GedcomLine & {
  children: GedcomNode[];
};

export type GedcomRecord = {
  xref?: string;
  type: string;
  raw: string;
  root: GedcomNode;
};

export type ParsedGedcom = {
  records: GedcomRecord[];
  summary: ImportSummary;
};

const eventTags = new Set(["BIRT", "DEAT", "BURI", "CHR", "CENS", "MARR", "DIV", "RESI", "EVEN", "OCCU"]);

export function parseGedcomLine(raw: string, index: number): GedcomLine {
  // Level, xref, and tag delimiters tolerate repeated whitespace (lenient reader behavior), but per
  // GEDCOM 5.5.1 the tag is separated from its value by exactly one delimiter character; any further
  // whitespace is part of the value (significant for CONC/CONT continuations).
  const match = raw.match(/^[ \t]*(\d+)(?:[ \t]+(@[^@]+@))?[ \t]+([A-Za-z0-9_]+)(?:[ \t](.*))?$/);
  if (!match) {
    const excerpt = raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
    throw new Error(`Invalid GEDCOM line ${index + 1}: ${excerpt}`);
  }

  return {
    number: index + 1,
    level: Number(match[1]),
    xref: match[2],
    tag: match[3],
    value: match[4],
    raw
  };
}

export function parseGedcom(content: string): ParsedGedcom {
  const lines = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, index }) => parseGedcomLine(line, index));

  const roots: GedcomNode[] = [];
  const stack: GedcomNode[] = [];

  for (const line of lines) {
    const node: GedcomNode = { ...line, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  const records = roots.map((root) => ({
    xref: root.xref,
    type: root.tag,
    raw: flattenRaw(root).join("\n"),
    root
  }));

  return {
    records,
    summary: summarizeGedcom(records)
  };
}

export function flattenRaw(node: GedcomNode): string[] {
  return [node.raw, ...node.children.flatMap(flattenRaw)];
}

export function findChild(node: GedcomNode, tag: string): GedcomNode | undefined {
  return node.children.find((child) => child.tag === tag);
}

export function findChildren(node: GedcomNode, tag: string): GedcomNode[] {
  return node.children.filter((child) => child.tag === tag);
}

export function textWithContinuations(node?: GedcomNode): string | undefined {
  if (!node) {
    return undefined;
  }

  let text = node.value ?? "";
  for (const child of node.children) {
    if (child.tag === "CONC") {
      text += child.value ?? "";
    }
    if (child.tag === "CONT") {
      text += `\n${child.value ?? ""}`;
    }
  }

  // Whitespace inside CONC/CONT continuations is significant, so only trim to test for emptiness.
  return text.trim() ? text : undefined;
}

export function summarizeGedcom(records: GedcomRecord[]): ImportSummary {
  const summary: ImportSummary = {
    individuals: 0,
    families: 0,
    sources: 0,
    media: 0,
    notes: 0,
    sourceReferences: 0,
    urls: 0,
    ancestryApids: 0
  };

  let minYear: number | undefined;
  let maxYear: number | undefined;

  for (const record of records) {
    if (record.type === "INDI") summary.individuals += 1;
    if (record.type === "FAM") summary.families += 1;
    if (record.type === "SOUR") summary.sources += 1;
    if (record.type === "OBJE") summary.media += 1;

    walk(record.root, (node) => {
      if (node.tag === "NOTE") summary.notes += 1;
      if (node.tag === "SOUR") summary.sourceReferences += 1;
      if (node.tag === "WWW") summary.urls += 1;
      if (node.tag === "_APID") summary.ancestryApids += 1;
      if (node.tag === "DATE" && node.value) {
        const match = node.value.match(/(\d{4})/);
        if (match) {
          const year = Number(match[1]);
          minYear = minYear === undefined ? year : Math.min(minYear, year);
          maxYear = maxYear === undefined ? year : Math.max(maxYear, year);
        }
      }
    });
  }

  if (minYear !== undefined && maxYear !== undefined) {
    summary.dateRange = {
      minYear,
      maxYear
    };
  }

  return summary;
}

export function extractPeople(records: GedcomRecord[]): PersonSummary[] {
  const relativesByPersonId = buildFamilyRelationshipMap(records);

  return records
    .filter((record) => record.type === "INDI")
    .map((record) => {
      const name = textWithContinuations(findChild(record.root, "NAME")) ?? "Unknown person";
      const surname = name.match(/\/([^/]+)\//)?.[1];
      const givenName = name.replace(/\/[^/]+\//, "").trim() || undefined;
      const facts = extractFacts(record.root);
      const birth = facts.find((fact) => fact.type === "BIRT");
      const death = facts.find((fact) => fact.type === "DEAT");

      return {
        id: record.xref ?? name,
        slug: slugify(`${name}-${record.xref ?? ""}`),
        displayName: name.replace(/\//g, "").replace(/\s+/g, " ").trim(),
        givenName,
        surname,
        birthDate: birth?.date,
        birthPlace: birth?.place,
        deathDate: death?.date,
        deathPlace: death?.place,
        sex: findChild(record.root, "SEX")?.value as "M" | "F" | "U" | undefined,
        livingStatus: death ? "deceased" : "unknown",
        privacy: "private",
        published: false,
        facts,
        relatives: record.xref ? (relativesByPersonId.get(record.xref) ?? []) : [],
        notes: findChildren(record.root, "NOTE").map(textWithContinuations).filter(Boolean).join("\n\n")
      };
    });
}

export function buildFamilyRelationshipMap(records: GedcomRecord[]): Map<string, string[]> {
  const relationships = new Map<string, Set<string>>();

  for (const record of records) {
    if (record.type !== "FAM") {
      continue;
    }

    const parents = [findChild(record.root, "HUSB")?.value, findChild(record.root, "WIFE")?.value].filter(isGedcomPointer);
    const children = findChildren(record.root, "CHIL").map((node) => node.value).filter(isGedcomPointer);

    for (const parent of parents) {
      for (const otherParent of parents) {
        addRelationship(relationships, parent, otherParent);
      }
      for (const child of children) {
        addRelationship(relationships, parent, child);
      }
    }

    for (const child of children) {
      for (const parent of parents) {
        addRelationship(relationships, child, parent);
      }
      for (const sibling of children) {
        addRelationship(relationships, child, sibling);
      }
    }
  }

  return new Map(Array.from(relationships.entries()).map(([personId, relatives]) => [personId, Array.from(relatives)]));
}

export function extractFacts(root: GedcomNode): PersonFact[] {
  const facts: PersonFact[] = [];

  for (const node of root.children) {
    if (!eventTags.has(node.tag)) {
      continue;
    }

    const date = findChild(node, "DATE")?.value;
    const place = findChild(node, "PLAC")?.value;
    const source = findChild(node, "SOUR")?.value ?? findChild(findChild(node, "SOUR") ?? node, "_APID")?.value;

    facts.push({
      id: `${root.xref ?? root.value}-${node.number}`,
      type: node.tag,
      date,
      place,
      value: node.tag === "EVEN" ? findChild(node, "TYPE")?.value : node.value,
      source,
      confidence: source ? 0.8 : 0.45,
      privacy: "private"
    });
  }

  return facts;
}

export function walk(node: GedcomNode, visitor: (node: GedcomNode) => void): void {
  visitor(node);
  for (const child of node.children) {
    walk(child, visitor);
  }
}

function addRelationship(relationships: Map<string, Set<string>>, personId: string, relativeId: string): void {
  if (personId === relativeId) {
    return;
  }

  const relatives = relationships.get(personId) ?? new Set<string>();
  relatives.add(relativeId);
  relationships.set(personId, relatives);
}

function isGedcomPointer(value: string | undefined): value is string {
  return Boolean(value?.startsWith("@") && value.endsWith("@"));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
