import { describe, expect, it } from "vitest";

import {
  combineRecoveryStateDigest,
  isRecoveryIdentitySentinel,
  recoveryNamespacePrefix,
  summarizeRecoveryObjectManifest,
  validateSupabaseRecoveryPoint
} from "@/lib/recovery-evidence-operations";

describe("recovery evidence operations", () => {
  it("builds stable, content-bound summaries for both private namespaces", () => {
    const entries = [
      { pathname: "archives/pilot/z", contentType: "text/plain", size: 2, sha256: "b".repeat(64) },
      { pathname: "archives/pilot/a", contentType: "application/octet-stream", size: 3, sha256: "a".repeat(64) }
    ];
    const left = summarizeRecoveryObjectManifest("archive-private", entries);
    const right = summarizeRecoveryObjectManifest("archive-private", [...entries].reverse());
    expect(left).toEqual(right);
    expect(left).toMatchObject({ name: "archive-private", objectCount: 2, totalBytes: 5 });
    expect(left.manifestSha256).toMatch(/^[a-f0-9]{64}$/);

    const digest = combineRecoveryStateDigest({
      databaseManifestSha256: "c".repeat(64),
      objectNamespaces: [
        left,
        summarizeRecoveryObjectManifest("legacy-gedcom", [])
      ]
    });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses exact archive-bound prefixes and excludes identity sentinels", () => {
    expect(recoveryNamespacePrefix("pilot-01", "archive-private")).toBe("archives/pilot-01/");
    expect(recoveryNamespacePrefix("pilot-01", "legacy-gedcom")).toBe("gedcom-imports/pilot-01/");
    const identity = "a".repeat(64);
    expect(isRecoveryIdentitySentinel(
      "pilot-01",
      `archives/pilot-01/release-readiness/${identity}`,
      identity
    )).toBe(true);
    expect(isRecoveryIdentitySentinel("pilot-01", "archives/pilot-01/evidence/a", identity)).toBe(false);
    expect(() => isRecoveryIdentitySentinel(
      "pilot-01",
      `archives/pilot-01/release-readiness/${"b".repeat(64)}`,
      identity
    )).toThrow(/unexpected reserved readiness object/i);
  });

  it("accepts only a fresh completed Supabase backup or PITR point", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    expect(validateSupabaseRecoveryPoint({
      pitr_enabled: false,
      backups: [{ status: "COMPLETED", inserted_at: "2026-07-15T10:00:00.000Z" }]
    }, now)).toEqual({
      provider: "supabase",
      status: "available",
      createdAt: "2026-07-15T10:00:00.000Z"
    });
    expect(() => validateSupabaseRecoveryPoint({
      pitr_enabled: false,
      backups: [{ status: "COMPLETED", inserted_at: "2026-07-14T11:59:59.000Z" }]
    }, now)).toThrow(/last 24 hours/i);
  });

  it("rejects duplicate or malformed object manifest entries", () => {
    const entry = {
      pathname: "archives/pilot/a",
      contentType: "text/plain",
      size: 1,
      sha256: "a".repeat(64)
    };
    expect(() => summarizeRecoveryObjectManifest("archive-private", [entry, entry])).toThrow(/duplicated/i);
    expect(() => combineRecoveryStateDigest({
      databaseManifestSha256: "a".repeat(64),
      objectNamespaces: [summarizeRecoveryObjectManifest("archive-private", [])]
    })).toThrow(/both object namespaces/i);
  });
});
