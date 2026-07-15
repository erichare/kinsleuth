import { describe, expect, it } from "vitest";

import {
  createProductionBackupCleanupLease,
  validateProductionBackupCleanupLease,
  validateProductionBackupCleanupLeaseSource
} from "@/lib/production-backup-cleanup-lease";

const expectations = {
  sourceRunId: "123456",
  sourceRunAttempt: "2",
  sourceHeadSha: "a".repeat(40),
  releaseCommit: "b".repeat(40),
  fenceId: "fence-backup-123456-2",
  databaseIdentity: "c".repeat(64)
};

describe("production backup cleanup lease", () => {
  it("creates an exact attempt-bound immutable lease", () => {
    const lease = createProductionBackupCleanupLease(expectations);
    expect(lease).toEqual({ schemaVersion: 1, ...expectations });
    expect(validateProductionBackupCleanupLease(lease, expectations)).toEqual(lease);
    expect(validateProductionBackupCleanupLeaseSource(lease, {
      sourceRunId: expectations.sourceRunId,
      sourceRunAttempt: expectations.sourceRunAttempt,
      sourceHeadSha: expectations.sourceHeadSha
    })).toEqual(lease);
  });

  it.each([
    ["extra field", (value: Record<string, unknown>) => { value.extra = true; }],
    ["run", (value: Record<string, unknown>) => { value.sourceRunId = "0"; }],
    ["attempt", (value: Record<string, unknown>) => { value.sourceRunAttempt = "0"; }],
    ["source head", (value: Record<string, unknown>) => { value.sourceHeadSha = "A".repeat(40); }],
    ["release", (value: Record<string, unknown>) => { value.releaseCommit = "short"; }],
    ["database", (value: Record<string, unknown>) => { value.databaseIdentity = "bad"; }],
    ["derived fence", (value: Record<string, unknown>) => { value.fenceId = "fence-backup-123456-3"; }]
  ])("rejects an invalid %s", (_label, mutate) => {
    const value: Record<string, unknown> = {
      schemaVersion: 1,
      ...expectations
    };
    mutate(value);
    expect(() => validateProductionBackupCleanupLease(value)).toThrow();
  });

  it("rejects a lease from a different source attempt", () => {
    const lease = createProductionBackupCleanupLease(expectations);
    expect(() => validateProductionBackupCleanupLeaseSource(lease, {
      sourceRunId: expectations.sourceRunId,
      sourceRunAttempt: "3",
      sourceHeadSha: expectations.sourceHeadSha
    })).toThrow(/failed source run/i);
  });
});
