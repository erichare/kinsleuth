export type DecodedGedcom = {
  content: string;
  charset: string;
  warnings: string[];
};

const charsetSniffLimitBytes = 8192;
const anselWarning =
  "This GEDCOM declares the ANSEL character set, which KinSleuth only approximately supports. Accented and special characters may be inaccurate; re-export the file as UTF-8 for exact results.";

/**
 * Decodes raw GEDCOM upload bytes using the file's byte-order mark or declared CHAR value.
 * Falls back to lenient UTF-8 when no better signal exists.
 */
export function decodeGedcomBuffer(input: ArrayBuffer | Uint8Array): DecodedGedcom {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { content: decodeBytes(bytes, "utf-16le"), charset: "utf-16le", warnings: [] };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { content: decodeBytes(bytes, "utf-16be"), charset: "utf-16be", warnings: [] };
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { content: decodeBytes(bytes, "utf-8"), charset: "utf-8", warnings: [] };
  }

  const declaredCharset = sniffDeclaredCharset(bytes);
  if (declaredCharset === "ANSI" || declaredCharset === "CP1252" || declaredCharset === "WINDOWS-1252") {
    return { content: decodeBytes(bytes, "windows-1252"), charset: "windows-1252", warnings: [] };
  }
  if (declaredCharset === "ANSEL") {
    return { content: decodeBytes(bytes, "latin1"), charset: "ansel", warnings: [anselWarning] };
  }

  return { content: decodeBytes(bytes, "utf-8"), charset: "utf-8", warnings: [] };
}

function sniffDeclaredCharset(bytes: Uint8Array): string | undefined {
  const preview = decodeBytes(bytes.subarray(0, charsetSniffLimitBytes), "latin1");
  return preview.match(/^[ \t]*1[ \t]+CHAR[ \t]+([^\r\n]+)/im)?.[1]?.trim().toUpperCase();
}

function decodeBytes(bytes: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding, { fatal: false }).decode(bytes);
}
