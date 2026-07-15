export const MAX_SYNC_CHANGE_SEARCH_PROJECTION_BYTES = 4_096;

export type SyncChangeSearchProjectionInput = {
  entityType: string;
  externalId?: string | null;
  localEntityId?: string | null;
  classification: string;
  resolutionPayload?: Record<string, unknown>;
};

const MAX_SEARCH_FIELD_CODE_UNITS = 512;
const valueSides = ["incoming", "local", "base"] as const;
const searchableFields: Readonly<Record<string, readonly string[]>> = {
  person: ["displayName", "givenName", "surname"],
  source: ["title", "sourceType", "repository"],
  fact: ["type", "date", "place"],
  citation: ["page", "dataDate"],
  media: ["title"],
  relationship: ["type"],
  family: []
};

/**
 * Builds an internal, data-minimizing search projection for a review row.
 * Free-form notes, transcripts, record text, URLs, paths, and raw GEDCOM are
 * deliberately excluded. The projection is bounded before database storage.
 */
export function syncChangeSearchProjection(
  input: SyncChangeSearchProjectionInput
): string {
  const fields = searchableFields[input.entityType] ?? [];
  const values = isRecord(input.resolutionPayload?.values) ? input.resolutionPayload.values : undefined;
  const labels: string[] = [];
  const seen = new Set<string>();
  addLabels(labels, seen, [input.entityType, input.externalId, input.localEntityId, input.classification]);
  if (values) {
    for (const side of valueSides) {
      const value = isRecord(values[side]) ? values[side] : undefined;
      if (!value) continue;
      addLabels(labels, seen, fields.map((field) => value[field]));
    }
  }
  return truncateUtf8(labels.join("\n"), MAX_SYNC_CHANGE_SEARCH_PROJECTION_BYTES);
}

function addLabels(labels: string[], seen: Set<string>, values: unknown[]): void {
  for (const value of values) {
    const label = normalizedLabel(value);
    if (!label) continue;
    const deduplicationKey = label.toLocaleLowerCase("en-US");
    if (seen.has(deduplicationKey)) continue;
    seen.add(deduplicationKey);
    labels.push(label);
  }
}

function normalizedLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const bounded = value.slice(0, MAX_SEARCH_FIELD_CODE_UNITS);
  const normalized = bounded
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
