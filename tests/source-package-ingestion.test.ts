import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { inspectSourcePackage } from "@/lib/integrations/source-package";

const syntheticGedcom = [
  "0 HEAD",
  "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
  "1 GEDC",
  "2 VERS 5.5.1",
  "0 @I1@ INDI",
  "1 NAME Eliza /Northwood/",
  "1 BIRT",
  "2 DATE 14 APR 1884",
  "0 TRLR"
].join("\n");

describe("source-package ingestion", () => {
  it("extracts the single GEDCOM from a direct Ancestry ZIP export", async () => {
    const bytes = makeZip([
      { name: "Northwood Family Tree.ged", content: syntheticGedcom },
      { name: "README.txt", content: "Synthetic export fixture only." }
    ]);

    const inspected = await inspectSourcePackage({
      fileName: "Northwood Family Tree.zip",
      bytes,
      provider: "ancestry_export"
    });

    expect(inspected.gedcom).toMatchObject({
      fileName: "Northwood Family Tree.ged",
      content: syntheticGedcom
    });
    expect(inspected.media).toEqual([]);
    expect(inspected.missingMedia).toEqual([]);
    expect(inspected.warnings).toEqual([]);
  });

  it("accepts a GEDCOM without wrapping it in a ZIP", async () => {
    const bytes = Buffer.from(syntheticGedcom, "utf8");

    const inspected = await inspectSourcePackage({
      fileName: "northwood.gedcom",
      bytes,
      provider: "generic_gedcom"
    });

    expect(inspected.gedcom.content).toBe(syntheticGedcom);
    expect(inspected.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("requires exactly one GEDCOM in an imported ZIP", async () => {
    const withoutGedcom = makeZip([{ name: "notes.txt", content: "No family tree is present." }]);
    const withTwoGedcoms = makeZip([
      { name: "northwood.ged", content: syntheticGedcom },
      { name: "second-tree.GEDCOM", content: syntheticGedcom.replace("@I1@", "@I2@") }
    ]);

    await expect(
      inspectSourcePackage({ fileName: "empty.zip", bytes: withoutGedcom, provider: "ancestry_export" })
    ).rejects.toThrow(/exactly one GEDCOM/i);
    await expect(
      inspectSourcePackage({ fileName: "two-trees.zip", bytes: withTwoGedcoms, provider: "family_tree_maker" })
    ).rejects.toThrow(/exactly one GEDCOM/i);
  });

  it.each(["../escaped.ged", "/tmp/escaped.ged", "C:\\Temp\\escaped.ged"])(
    "rejects unsafe ZIP entry path %s before extracting it",
    async (entryName) => {
      const bytes = makeZip([{ name: entryName, content: syntheticGedcom }]);

      await expect(
        inspectSourcePackage({ fileName: "unsafe.zip", bytes, provider: "ancestry_export" })
      ).rejects.toThrow(/unsafe|traversal/i);
    }
  );

  it("rejects a compressed archive whose expansion ratio exceeds the configured limit", async () => {
    const bytes = makeZip([
      { name: "northwood.ged", content: syntheticGedcom },
      { name: "media/repeated-ledger.txt", content: "A".repeat(32_768), compression: "deflate" }
    ]);

    await expect(
      inspectSourcePackage({
        fileName: "oversized.zip",
        bytes,
        provider: "family_tree_maker",
        limits: {
          maximumEntries: 20,
          maximumExpandedBytes: 64 * 1024,
          maximumCompressionRatio: 8
        }
      })
    ).rejects.toThrow(/compression ratio|zip bomb|archive limit/i);
  });

  it.each([
    { name: "media/viewer.exe", content: Buffer.from("MZ synthetic executable", "ascii") },
    { name: "media/portrait.jpg", content: Buffer.from("MZ disguised synthetic executable", "ascii") }
  ])("rejects unsupported executable content at $name", async (entry) => {
    const bytes = makeZip([
      { name: "northwood.ged", content: syntheticGedcom },
      entry
    ]);

    await expect(
      inspectSourcePackage({ fileName: "unsafe-media.zip", bytes, provider: "rootsmagic" })
    ).rejects.toThrow(/executable|not permitted/i);
  });

  it("normalizes desktop media paths and reports references missing from the package", async () => {
    const gedcomWithMedia = [
      syntheticGedcom.replace("0 TRLR", ""),
      "0 @M1@ OBJE",
      "1 FILE media\\portrait.jpg",
      "0 @M2@ OBJE",
      "1 FILE media\\missing-ledger.jpg",
      "0 TRLR"
    ].join("\n");
    const portrait = Buffer.from("synthetic portrait bytes", "utf8");
    const bytes = makeZip([
      { name: "export/northwood.ged", content: gedcomWithMedia },
      { name: "export/media/portrait.jpg", content: portrait }
    ]);

    const inspected = await inspectSourcePackage({
      fileName: "northwood-ftm.zip",
      bytes,
      provider: "family_tree_maker"
    });

    expect(inspected.media).toHaveLength(1);
    expect(inspected.media[0]).toMatchObject({
      gedcomPath: "media\\portrait.jpg",
      normalizedPath: "media/portrait.jpg",
      archivePath: "export/media/portrait.jpg"
    });
    expect(Buffer.from(inspected.media[0].content)).toEqual(portrait);
    expect(inspected.missingMedia).toEqual([
      {
        gedcomPath: "media\\missing-ledger.jpg",
        normalizedPath: "media/missing-ledger.jpg"
      }
    ]);
    expect(inspected.warnings.join(" ")).toMatch(/missing-ledger\.jpg/i);
  });

  it("uses the raw artifact SHA-256 as a stable duplicate fingerprint", async () => {
    const bytes = makeZip([{ name: "northwood.ged", content: syntheticGedcom }]);
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");

    const first = await inspectSourcePackage({ fileName: "first-name.zip", bytes, provider: "ancestry_export" });
    const duplicate = await inspectSourcePackage({ fileName: "renamed.zip", bytes, provider: "ancestry_export" });

    expect(first.sha256).toBe(expectedSha256);
    expect(duplicate.sha256).toBe(expectedSha256);
  });
});

type SyntheticZipEntry = {
  name: string;
  content: string | Uint8Array;
  compression?: "store" | "deflate";
};

function makeZip(entries: SyntheticZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.from(entry.content);
    const compressionMethod = entry.compression === "deflate" ? 8 : 0;
    const compressed = compressionMethod === 8 ? deflateRawSync(content) : content;
    const checksum = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(content: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
