import type { DnaMatch, DnaSide, DnaTreeStatus } from "./models";

export type DnaCsvImportResult = {
  matches: DnaMatch[];
  skipped: DnaCsvSkippedRow[];
};

export type DnaCsvSkippedRow = {
  rowNumber: number;
  reason: string;
  row: Record<string, string>;
};

type HeaderAlias =
  | "displayName"
  | "totalCm"
  | "longestSegmentCm"
  | "predictedRelationship"
  | "side"
  | "treeStatus"
  | "surnames"
  | "places"
  | "sharedMatches"
  | "notes"
  | "ancestryUrl";

const aliases: Record<HeaderAlias, string[]> = {
  displayName: ["matchname", "displayname", "name", "username", "user", "testtaker", "match"],
  totalCm: ["sharedcm", "totalcm", "totalsharedcm", "centimorgans", "cm", "sharedcentimorgans", "shareddna"],
  longestSegmentCm: ["longestsegment", "longestsegmentcm", "longestcm", "largestsegment", "largestsegmentcm"],
  predictedRelationship: ["predictedrelationship", "relationship", "possible range", "possiblerange", "estimatedrelationship"],
  side: ["side", "parentside", "maternalpaternal", "parent", "group"],
  treeStatus: ["treestatus", "tree", "familytree", "linkedtree", "matchtree", "treeavailability"],
  surnames: ["surnames", "ancestorsurnames", "sharedsurnames", "names", "lastnames"],
  places: ["places", "birthplaces", "ancestorplaces", "locations", "sharedplaces"],
  sharedMatches: ["sharedmatches", "sharedmatch", "matchesincommon", "commonmatches", "icw"],
  notes: ["notes", "note", "comments", "comment", "researchnotes"],
  ancestryUrl: ["ancestryurl", "url", "profileurl", "matchurl", "link"]
};

export function mapDnaCsvRows(rows: Record<string, string>[]): DnaCsvImportResult {
  const matches: DnaMatch[] = [];
  const skipped: DnaCsvSkippedRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const displayName = pick(row, aliases.displayName).trim();
    const totalCm = parseDnaNumber(pick(row, aliases.totalCm));

    if (!displayName) {
      skipped.push({ rowNumber, reason: "missing match name", row });
      return;
    }

    if (!Number.isFinite(totalCm) || totalCm <= 0) {
      skipped.push({ rowNumber, reason: "missing numeric shared cM", row });
      return;
    }

    matches.push({
      id: createDnaMatchId(displayName, totalCm, index),
      displayName,
      totalCm,
      longestSegmentCm: optionalDnaNumber(pick(row, aliases.longestSegmentCm)),
      predictedRelationship: pick(row, aliases.predictedRelationship) || undefined,
      side: parseSide(pick(row, aliases.side)),
      treeStatus: parseTreeStatus(pick(row, aliases.treeStatus)),
      surnames: splitList(pick(row, aliases.surnames)),
      places: splitList(pick(row, aliases.places)),
      sharedMatches: splitList(pick(row, aliases.sharedMatches)),
      notes: pick(row, aliases.notes),
      ancestryUrl: pick(row, aliases.ancestryUrl) || undefined,
      triageStatus: "needs_review"
    });
  });

  return { matches, skipped };
}

function pick(row: Record<string, string>, keys: string[]): string {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
  for (const key of keys) {
    const value = normalized.get(normalizeHeader(key));
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function parseDnaNumber(value: string): number {
  const cleaned = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return cleaned ? Number(cleaned[0]) : Number.NaN;
}

function optionalDnaNumber(value: string): number | undefined {
  const parsed = parseDnaNumber(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSide(value: string): DnaSide {
  const normalized = normalizeHeader(value);
  if (normalized.includes("maternal") || normalized.includes("mother") || normalized.includes("mom")) return "maternal";
  if (normalized.includes("paternal") || normalized.includes("father") || normalized.includes("dad")) return "paternal";
  if (normalized.includes("both")) return "both";
  return "unknown";
}

function parseTreeStatus(value: string): DnaTreeStatus {
  const normalized = normalizeHeader(value);
  if (!normalized) return "unknown";
  if (normalized.includes("unknown")) return "unknown";
  if (normalized.includes("private")) return "private";
  // "Unlinked tree" must be checked before "linked": the tree exists but is
  // not attached to the match, so it is browsable yet unverified.
  if (normalized.includes("unlinked") || normalized.includes("partial")) return "partial";
  if (normalized.includes("none") || normalized.includes("notree") || normalized.startsWith("no")) return "none";
  if (normalized.includes("public") || normalized.includes("linked") || normalized.includes("tree")) return "public";
  return "unknown";
}

function splitList(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createDnaMatchId(displayName: string, totalCm: number, index: number): string {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "match";
  return `dna-${slug}-${Math.round(totalCm * 10)}-${index + 1}`;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
