import { describe, expect, it } from "vitest";
import { parseCsvRows, splitCsvLine, splitCsvRecords } from "@/lib/csv";

describe("CSV helpers", () => {
  it("splits quoted commas and escaped quotes", () => {
    expect(splitCsvLine('"J. Fletcher","Chicago, Illinois","said ""hello"""')).toEqual([
      "J. Fletcher",
      "Chicago, Illinois",
      'said "hello"'
    ]);
  });

  it("parses rows by header", () => {
    const rows = parseCsvRows('name,total_cm,places\n"J. Fletcher",238,"Chicago, Limerick"');

    expect(rows).toEqual([
      {
        name: "J. Fletcher",
        total_cm: "238",
        places: "Chicago, Limerick"
      }
    ]);
  });

  it("keeps quoted newlines inside one record", () => {
    expect(splitCsvRecords('name,notes\n"J. Fletcher","line one\nline two"\n"M. Riemer","done"')).toHaveLength(3);
    expect(parseCsvRows('name,notes\n"J. Fletcher","line one\nline two"')[0]).toEqual({
      name: "J. Fletcher",
      notes: "line one\nline two"
    });
  });

  it("parses empty quoted fields as empty strings", () => {
    expect(splitCsvLine('a,"",b')).toEqual(["a", "", "b"]);
    expect(splitCsvLine('"",""')).toEqual(["", ""]);
    expect(splitCsvLine('"a""b",""')).toEqual(['a"b', ""]);
  });
});
