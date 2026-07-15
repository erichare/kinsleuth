import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { decodeGedcomBuffer } from "../gedcom/charset";
import { isGedcomFileName } from "../gedcom/upload-policy";

export type SourcePackageProvider =
  | "ancestry_export"
  | "family_tree_maker"
  | "rootsmagic"
  | "gedcom"
  | "generic_gedcom";

export type SourcePackageLimits = {
  maximumEntries: number;
  maximumExpandedBytes: number;
  maximumCompressionRatio: number;
};

export type SourcePackageInput = {
  fileName: string;
  bytes: Uint8Array;
  provider: SourcePackageProvider;
  limits?: Partial<SourcePackageLimits>;
};

export type InspectedPackageMedia = {
  gedcomPath: string;
  normalizedPath: string;
  archivePath: string;
  content: Buffer;
};

export type QuarantinedPackageFile = {
  content: Buffer;
};

export type MissingPackageMedia = {
  gedcomPath: string;
  normalizedPath: string;
};

export type AmbiguousPackageMedia = MissingPackageMedia & {
  archivePaths: string[];
};

export type InspectedSourcePackage = {
  sha256: string;
  gedcom: {
    fileName: string;
    content: string;
    charset: string;
  };
  media: InspectedPackageMedia[];
  quarantineFiles: QuarantinedPackageFile[];
  missingMedia: MissingPackageMedia[];
  ambiguousMedia: AmbiguousPackageMedia[];
  warnings: string[];
};

const defaultLimits: SourcePackageLimits = {
  maximumEntries: 10_000,
  maximumExpandedBytes: 128 * 1024 * 1024,
  maximumCompressionRatio: 100
};

const providers = new Set<SourcePackageProvider>([
  "ancestry_export",
  "family_tree_maker",
  "rootsmagic",
  "gedcom",
  "generic_gedcom"
]);

const executableExtensions = new Set([
  ".app",
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".dmg",
  ".exe",
  ".jar",
  ".msi",
  ".ps1",
  ".scr"
]);

const machExecutableMagic = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]);

type ZipEntry = {
  path: string;
  nameBytes: Buffer;
  flags: number;
  compressionMethod: number;
  checksum: number;
  compressedSize: number;
  expandedSize: number;
  localHeaderOffset: number;
  directory: boolean;
  content?: Buffer;
};

export async function inspectSourcePackage(input: SourcePackageInput): Promise<InspectedSourcePackage> {
  validateInput(input);
  const bytes = Buffer.from(input.bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const limits = normalizeLimits(input.limits);

  if (isGedcomFileName(input.fileName)) {
    if (isExecutable(input.fileName, bytes)) {
      throw new Error("Executable content is not permitted in source packages");
    }
    const decoded = decodeGedcomBuffer(bytes);
    const mediaReport = matchMediaReferences(decoded.content, input.fileName, []);
    return {
      sha256,
      gedcom: { fileName: input.fileName, content: decoded.content, charset: decoded.charset },
      quarantineFiles: [],
      ...mediaReport,
      warnings: [...decoded.warnings, ...mediaReport.warnings]
    };
  }

  if (!/\.zip$/i.test(input.fileName)) {
    throw new Error("Source packages must be a GEDCOM or ZIP file");
  }

  const entries = readZip(bytes, limits);
  const gedcomEntries = entries.filter((entry) => !entry.directory && isGedcomFileName(entry.path));
  if (gedcomEntries.length !== 1) {
    throw new Error("A source package must contain exactly one GEDCOM file");
  }

  for (const entry of entries) {
    if (!entry.directory && entry.content && isExecutable(entry.path, entry.content)) {
      throw new Error(`Executable content is not permitted in source packages: ${entry.path}`);
    }
  }

  const gedcomEntry = gedcomEntries[0];
  const decoded = decodeGedcomBuffer(gedcomEntry.content!);
  const mediaReport = matchMediaReferences(decoded.content, gedcomEntry.path, entries);
  const quarantineFiles = entries
    .filter((entry) => !entry.directory && !isGedcomFileName(entry.path) && entry.content)
    .map((entry) => ({ content: Buffer.from(entry.content!) }));

  return {
    sha256,
    gedcom: {
      fileName: gedcomEntry.path,
      content: decoded.content,
      charset: decoded.charset
    },
    quarantineFiles,
    ...mediaReport,
    warnings: [...decoded.warnings, ...mediaReport.warnings]
  };
}

function validateInput(input: SourcePackageInput): void {
  if (!input || typeof input.fileName !== "string" || !input.fileName.trim()) {
    throw new Error("Source package filename is required");
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) {
    throw new Error("Source package content is required");
  }
  if (!providers.has(input.provider)) {
    throw new Error("Unsupported source-package provider");
  }
}

function normalizeLimits(overrides: Partial<SourcePackageLimits> | undefined): SourcePackageLimits {
  const limits = { ...defaultLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid source-package limit: ${name}`);
    }
  }
  return limits;
}

function readZip(archive: Buffer, limits: SourcePackageLimits): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDisk = archive.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("Multi-disk ZIP source packages are not supported");
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 source packages are not supported");
  }
  if (entryCount > limits.maximumEntries) {
    throw new Error("ZIP archive limit exceeded: too many entries");
  }
  if (centralOffset + centralSize > eocdOffset || centralOffset < 0) {
    throw new Error("Invalid ZIP central directory");
  }

  const entries: ZipEntry[] = [];
  const paths = new Set<string>();
  let offset = centralOffset;
  let totalExpandedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    requireRange(archive, offset, 46, "ZIP central directory entry");
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory entry");
    }

    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const checksum = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const expandedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const diskStart = archive.readUInt16LE(offset + 34);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    requireRange(archive, offset, entryLength, "ZIP central directory entry");

    if (nameLength === 0) {
      throw new Error("Unsafe empty ZIP entry path");
    }
    if ((flags & 0x0001) !== 0) {
      throw new Error("Encrypted ZIP source packages are not supported");
    }
    if (diskStart !== 0) {
      throw new Error("Multi-disk ZIP source packages are not supported");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error(`ZIP compression method ${compressionMethod} is not supported`);
    }
    if (isSymbolicLink(externalAttributes)) {
      throw new Error("Symbolic links are not permitted in source packages");
    }

    const nameBytes = archive.subarray(offset + 46, offset + 46 + nameLength);
    const decodedName = decodeZipName(nameBytes, flags);
    const path = normalizeArchivePath(decodedName);
    const directory = path.endsWith("/");
    if (directory && (compressedSize !== 0 || expandedSize !== 0 || checksum !== 0)) {
      throw new Error(`ZIP directory entries cannot contain file data: ${path}`);
    }
    const pathKey = path.toLocaleLowerCase("en-US");
    if (paths.has(pathKey)) {
      throw new Error(`Duplicate ZIP entry path is not permitted: ${path}`);
    }
    paths.add(pathKey);

    totalExpandedBytes += expandedSize;
    if (!Number.isSafeInteger(totalExpandedBytes) || totalExpandedBytes > limits.maximumExpandedBytes) {
      throw new Error("ZIP archive limit exceeded: expanded content is too large");
    }

    const compressionRatio = expandedSize === 0 ? 0 : expandedSize / Math.max(1, compressedSize);
    if (compressionRatio > limits.maximumCompressionRatio) {
      throw new Error(`ZIP compression ratio exceeds the archive limit: ${path}`);
    }

    entries.push({
      path,
      nameBytes: Buffer.from(nameBytes),
      flags,
      compressionMethod,
      checksum,
      compressedSize,
      expandedSize,
      localHeaderOffset,
      directory
    });
    offset += entryLength;
  }

  if (offset !== centralOffset + centralSize) {
    throw new Error("Invalid ZIP central directory size");
  }

  for (const entry of entries) {
    if (!entry.directory) {
      entry.content = extractZipEntry(archive, entry, centralOffset, limits.maximumExpandedBytes);
    }
  }

  return entries;
}

function extractZipEntry(archive: Buffer, entry: ZipEntry, centralOffset: number, maximumExpandedBytes: number): Buffer {
  requireRange(archive, entry.localHeaderOffset, 30, "ZIP local entry");
  if (entry.localHeaderOffset >= centralOffset || archive.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
    throw new Error("Invalid ZIP local entry");
  }

  const localFlags = archive.readUInt16LE(entry.localHeaderOffset + 6);
  const localMethod = archive.readUInt16LE(entry.localHeaderOffset + 8);
  const localNameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
  const localNameOffset = entry.localHeaderOffset + 30;
  requireRange(archive, localNameOffset, localNameLength + localExtraLength, "ZIP local entry name");

  const localName = archive.subarray(localNameOffset, localNameOffset + localNameLength);
  if (localFlags !== entry.flags || localMethod !== entry.compressionMethod || !localName.equals(entry.nameBytes)) {
    throw new Error("ZIP local entry does not match its central directory record");
  }

  const contentOffset = localNameOffset + localNameLength + localExtraLength;
  requireRange(archive, contentOffset, entry.compressedSize, "ZIP entry content");
  if (contentOffset + entry.compressedSize > centralOffset) {
    throw new Error("ZIP entry overlaps its central directory");
  }
  const compressed = archive.subarray(contentOffset, contentOffset + entry.compressedSize);
  let content: Buffer;

  try {
    content = entry.compressionMethod === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: maximumExpandedBytes });
  } catch {
    throw new Error(`ZIP entry could not be safely expanded: ${entry.path}`);
  }

  if (content.length !== entry.expandedSize) {
    throw new Error(`ZIP entry size does not match its directory record: ${entry.path}`);
  }
  if (crc32(content) !== entry.checksum) {
    throw new Error(`ZIP entry checksum is invalid: ${entry.path}`);
  }
  return content;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  if (archive.length < 22) {
    throw new Error("Invalid ZIP source package");
  }

  const earliest = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= earliest; offset -= 1) {
    if (archive.readUInt32LE(offset) !== 0x06054b50) {
      continue;
    }
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) {
      return offset;
    }
  }
  throw new Error("Invalid ZIP source package");
}

function normalizeArchivePath(input: string): string {
  if (!input || input.includes("\0") || /^[\\/]/.test(input) || /^[a-zA-Z]:/.test(input)) {
    throw new Error(`Unsafe ZIP entry path: ${input || "(empty)"}`);
  }

  const withForwardSlashes = input.replace(/\\/g, "/");
  const isDirectory = withForwardSlashes.endsWith("/");
  const segments = withForwardSlashes.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`ZIP path traversal is not permitted: ${input}`);
  }

  const normalized = segments.filter((segment) => segment && segment !== ".").join("/");
  if (!normalized) {
    throw new Error(`Unsafe ZIP entry path: ${input}`);
  }
  return isDirectory ? `${normalized}/` : normalized;
}

function decodeZipName(bytes: Uint8Array, flags: number): string {
  return new TextDecoder((flags & 0x0800) !== 0 ? "utf-8" : "latin1", { fatal: false }).decode(bytes);
}

function isSymbolicLink(externalAttributes: number): boolean {
  const unixMode = externalAttributes >>> 16;
  return (unixMode & 0o170000) === 0o120000;
}

function isExecutable(path: string, content: Buffer): boolean {
  const extension = path.match(/(\.[^./]+)$/)?.[1]?.toLowerCase();
  if (extension && executableExtensions.has(extension)) {
    return true;
  }
  if (content.length >= 2 && content[0] === 0x4d && content[1] === 0x5a) {
    return true;
  }
  if (content.length >= 4 && content.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    return true;
  }
  if (content.length >= 4) {
    const magic = content.readUInt32BE(0);
    return machExecutableMagic.has(magic);
  }
  return false;
}

function matchMediaReferences(content: string, gedcomPath: string, entries: ZipEntry[]) {
  const warnings: string[] = [];
  const media: InspectedPackageMedia[] = [];
  const missingMedia: MissingPackageMedia[] = [];
  const ambiguousMedia: AmbiguousPackageMedia[] = [];
  const mediaReferences = extractMediaReferences(content);
  const gedcomDirectory = gedcomPath.includes("/") ? gedcomPath.slice(0, gedcomPath.lastIndexOf("/")) : "";
  const files = entries.filter((entry) => !entry.directory && !isGedcomFileName(entry.path) && entry.content);

  for (const reference of mediaReferences) {
    const normalizedPath = normalizeMediaReference(reference);
    const matches = findMediaMatches(normalizedPath, gedcomDirectory, files);

    if (matches.length === 1) {
      media.push({
        gedcomPath: reference,
        normalizedPath,
        archivePath: matches[0].path,
        content: Buffer.from(matches[0].content!)
      });
      continue;
    }

    if (matches.length > 1) {
      ambiguousMedia.push({
        gedcomPath: reference,
        normalizedPath,
        archivePaths: matches.map((entry) => entry.path)
      });
      warnings.push(`Media reference is ambiguous and was not imported: ${reference}`);
      continue;
    }

    missingMedia.push({ gedcomPath: reference, normalizedPath });
    warnings.push(`Referenced media is missing from the source package: ${reference}`);
  }

  return { media, missingMedia, ambiguousMedia, warnings };
}

function extractMediaReferences(content: string): string[] {
  const seen = new Set<string>();
  const references: string[] = [];

  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^\s*\d+\s+FILE\s+(.+?)\s*$/i);
    if (!match) {
      continue;
    }
    const reference = stripMatchingQuotes(match[1].trim());
    if (reference && !seen.has(reference)) {
      seen.add(reference);
      references.push(reference);
    }
  }
  return references;
}

function normalizeMediaReference(reference: string): string {
  let normalized = reference.trim().replace(/\\/g, "/");
  if (/^file:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^file:\/\/+?/i, "/");
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Retain the literal reference when malformed percent escapes appear.
    }
  }
  normalized = normalized.replace(/^[a-zA-Z]:/, "").replace(/^\/+/, "");

  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function findMediaMatches(normalizedReference: string, gedcomDirectory: string, files: ZipEntry[]): ZipEntry[] {
  if (!normalizedReference) {
    return [];
  }

  const exactCandidates = new Set([
    normalizedReference.toLocaleLowerCase("en-US"),
    `${gedcomDirectory ? `${gedcomDirectory}/` : ""}${normalizedReference}`.toLocaleLowerCase("en-US")
  ]);
  const exact = files.filter((entry) => exactCandidates.has(entry.path.toLocaleLowerCase("en-US")));
  if (exact.length > 0) {
    return exact;
  }

  const referenceSegments = normalizedReference.toLocaleLowerCase("en-US").split("/");
  for (let index = 0; index < referenceSegments.length; index += 1) {
    const suffix = referenceSegments.slice(index).join("/");
    const matches = files.filter((entry) => {
      const archivePath = entry.path.toLocaleLowerCase("en-US");
      return archivePath === suffix || archivePath.endsWith(`/${suffix}`);
    });
    if (matches.length > 0) {
      return matches;
    }
  }
  return [];
}

function stripMatchingQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function requireRange(buffer: Buffer, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`Invalid ${label}`);
  }
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
