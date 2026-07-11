export function parseCsvRows(input: string): Record<string, string>[] {
  const lines = splitCsvRecords(input).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export function splitCsvRecords(input: string): string[] {
  const records: string[] = [];
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let current = "";
  let quoted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"' && next === '"') {
      current += char + next;
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (char === "\n" && !quoted) {
      records.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    records.push(current);
  }

  return records;
}

export function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    // A doubled quote is only an escaped quote inside a quoted field;
    // outside one, `""` is an empty quoted field and must toggle state twice.
    if (quoted && char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}
