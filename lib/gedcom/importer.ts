import { parseGedcom } from "./parser";
import type { ImportSummary } from "../models";

export type ImportSnapshot = {
  id: string;
  sourceName: string;
  checksum: string;
  summary: ImportSummary;
  records: Array<{
    xref?: string;
    type: string;
    checksum: string;
    raw: string;
  }>;
};

export type ImportDiff = {
  added: number;
  changed: number;
  deleted: number;
  unchanged: number;
  omittedRecords?: number;
  records: Array<{
    xref?: string;
    type: string;
    status: "added" | "changed" | "deleted" | "unchanged";
  }>;
};

export function createImportSnapshot(sourceName: string, content: string): ImportSnapshot {
  const parsed = parseGedcom(content);

  return {
    id: `import-${stableHash(`${sourceName}:${content}`).slice(0, 12)}`,
    sourceName,
    checksum: stableHash(content),
    summary: parsed.summary,
    records: parsed.records.map((record) => ({
      xref: record.xref,
      type: record.type,
      checksum: stableHash(record.raw),
      raw: record.raw
    }))
  };
}

export function diffImportSnapshots(previous: ImportSnapshot, next: ImportSnapshot): ImportDiff {
  const previousKeys = buildRecordKeys(previous.records);
  const nextKeys = buildRecordKeys(next.records);
  const previousByKey = new Map(previous.records.map((record, index) => [previousKeys[index], record]));
  const nextKeySet = new Set(nextKeys);
  const records: ImportDiff["records"] = [];

  for (const [index, nextRecord] of next.records.entries()) {
    const previousRecord = previousByKey.get(nextKeys[index]);
    if (!previousRecord) {
      records.push({ xref: nextRecord.xref, type: nextRecord.type, status: "added" });
    } else if (previousRecord.checksum !== nextRecord.checksum) {
      records.push({ xref: nextRecord.xref, type: nextRecord.type, status: "changed" });
    } else {
      records.push({ xref: nextRecord.xref, type: nextRecord.type, status: "unchanged" });
    }
  }

  for (const [index, previousRecord] of previous.records.entries()) {
    if (!nextKeySet.has(previousKeys[index])) {
      records.push({ xref: previousRecord.xref, type: previousRecord.type, status: "deleted" });
    }
  }

  return {
    added: records.filter((record) => record.status === "added").length,
    changed: records.filter((record) => record.status === "changed").length,
    deleted: records.filter((record) => record.status === "deleted").length,
    unchanged: records.filter((record) => record.status === "unchanged").length,
    records
  };
}

function buildRecordKeys(records: ImportSnapshot["records"]): string[] {
  // Records without an xref (HEAD, TRLR, stray notes) and duplicated xrefs must not collapse into a
  // single map entry, so each repeated base key gets a stable occurrence suffix in document order.
  const occurrences = new Map<string, number>();

  return records.map((record) => {
    const baseKey = record.xref ?? `${record.type}:no-xref`;
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    return occurrence === 0 ? baseKey : `${baseKey}#${occurrence}`;
  });
}

export function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
