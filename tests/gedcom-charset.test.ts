import { describe, expect, it } from "vitest";
import { decodeGedcomBuffer } from "@/lib/gedcom/charset";
import { extractPeople, parseGedcom } from "@/lib/gedcom/parser";

const accentedGedcom = "0 HEAD\n1 CHAR UNICODE\n0 @I1@ INDI\n1 NAME José /Müller/\n0 TRLR";

describe("GEDCOM charset decoding", () => {
  it("decodes UTF-16LE files with a BOM and preserves non-ASCII names", () => {
    const decoded = decodeGedcomBuffer(utf16leBytes(accentedGedcom));

    expect(decoded.charset).toBe("utf-16le");
    expect(decoded.warnings).toEqual([]);
    expect(displayNames(decoded.content)).toEqual(["José Müller"]);
  });

  it("decodes UTF-16BE files with a BOM", () => {
    const decoded = decodeGedcomBuffer(utf16beBytes(accentedGedcom));

    expect(decoded.charset).toBe("utf-16be");
    expect(displayNames(decoded.content)).toEqual(["José Müller"]);
  });

  it("decodes UTF-8 files with a BOM", () => {
    const decoded = decodeGedcomBuffer(Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from(accentedGedcom, "utf8")]));

    expect(decoded.charset).toBe("utf-8");
    expect(displayNames(decoded.content)).toEqual(["José Müller"]);
  });

  it("decodes CHAR ANSI files as windows-1252, including bytes that differ from latin1", () => {
    const head = Buffer.from("0 HEAD\n1 CHAR ANSI\n0 @I1@ INDI\n1 NAME René O", "latin1");
    const tail = Buffer.from("Brien /Sørensen/\n0 TRLR", "latin1");
    const decoded = decodeGedcomBuffer(Uint8Array.from([...head, 0x92, ...tail]));

    expect(decoded.charset).toBe("windows-1252");
    expect(decoded.warnings).toEqual([]);
    expect(displayNames(decoded.content)).toEqual(["René O’Brien Sørensen"]);
  });

  it("decodes CHAR ANSEL files best-effort and warns that support is approximate", () => {
    const decoded = decodeGedcomBuffer(Uint8Array.from(Buffer.from("0 HEAD\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME Test /Person/\n0 TRLR", "latin1")));

    expect(decoded.charset).toBe("ansel");
    expect(decoded.warnings).toHaveLength(1);
    expect(decoded.warnings[0]).toMatch(/ANSEL/);
    expect(decoded.warnings[0]).toMatch(/approximately/);
    expect(displayNames(decoded.content)).toEqual(["Test Person"]);
  });

  it("defaults to lenient UTF-8 when no BOM or legacy CHAR declaration is present", () => {
    const decoded = decodeGedcomBuffer(Uint8Array.from(Buffer.from("0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME José /Müller/\n0 TRLR", "utf8")));

    expect(decoded.charset).toBe("utf-8");
    expect(decoded.warnings).toEqual([]);
    expect(displayNames(decoded.content)).toEqual(["José Müller"]);
  });
});

function displayNames(content: string): string[] {
  return extractPeople(parseGedcom(content).records).map((person) => person.displayName);
}

function utf16leBytes(text: string): Uint8Array {
  return Uint8Array.from([0xff, 0xfe, ...Buffer.from(text, "utf16le")]);
}

function utf16beBytes(text: string): Uint8Array {
  const swapped = Buffer.from(text, "utf16le");
  swapped.swap16();
  return Uint8Array.from([0xfe, 0xff, ...swapped]);
}
