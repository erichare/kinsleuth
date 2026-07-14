import { describe, expect, it } from "vitest";
import { parseCsvRows, splitCsvLine, splitCsvRecords } from "@/lib/csv";

describe("CSV helpers", () => {
  it("splits quoted commas and escaped quotes", () => {
    expect(splitCsvLine('"J. Mercer","Lantern Bay, Wisconsin","said ""hello"""')).toEqual([
      "J. Mercer",
      "Lantern Bay, Wisconsin",
      'said "hello"'
    ]);
  });

  it("parses rows by header", () => {
    const rows = parseCsvRows('name,total_cm,places\n"J. Mercer",86,"Lantern Bay, Northstar Cove"');

    expect(rows).toEqual([
      {
        name: "J. Mercer",
        total_cm: "86",
        places: "Lantern Bay, Northstar Cove"
      }
    ]);
  });

  it("keeps quoted newlines inside one record", () => {
    expect(splitCsvRecords('name,notes\n"J. Mercer","line one\nline two"\n"N. Hartwell","done"')).toHaveLength(3);
    expect(parseCsvRows('name,notes\n"J. Mercer","line one\nline two"')[0]).toEqual({
      name: "J. Mercer",
      notes: "line one\nline two"
    });
  });

  it("parses empty quoted fields as empty strings", () => {
    expect(splitCsvLine('a,"",b')).toEqual(["a", "", "b"]);
    expect(splitCsvLine('"",""')).toEqual(["", ""]);
    expect(splitCsvLine('"a""b",""')).toEqual(['a"b', ""]);
  });
});
