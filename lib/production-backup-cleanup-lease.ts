import { databaseIdentityPattern } from "./database-attestation.ts";

const runNumberPattern = /^[1-9][0-9]{0,19}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const fenceIdPattern = /^fence-backup-[1-9][0-9]{0,19}-[1-9][0-9]{0,19}$/;

const leaseKeys = [
  "schemaVersion",
  "sourceRunId",
  "sourceRunAttempt",
  "sourceHeadSha",
  "releaseCommit",
  "fenceId",
  "databaseIdentity"
] as const;

export type ProductionBackupCleanupLease = {
  schemaVersion: 1;
  sourceRunId: string;
  sourceRunAttempt: string;
  sourceHeadSha: string;
  releaseCommit: string;
  fenceId: string;
  databaseIdentity: string;
};

export type ProductionBackupCleanupLeaseSourceExpectations = Pick<
  ProductionBackupCleanupLease,
  "sourceRunId" | "sourceRunAttempt" | "sourceHeadSha"
>;

export type ProductionBackupCleanupLeaseExpectations = Omit<
  ProductionBackupCleanupLease,
  "schemaVersion"
>;

export function createProductionBackupCleanupLease(
  input: ProductionBackupCleanupLeaseExpectations
): ProductionBackupCleanupLease {
  return validateProductionBackupCleanupLease({ schemaVersion: 1, ...input }, input);
}

export function validateProductionBackupCleanupLease(
  value: unknown,
  expected?: ProductionBackupCleanupLeaseExpectations
): ProductionBackupCleanupLease {
  const lease = object(value);
  exactKeys(lease);
  if (lease.schemaVersion !== 1) {
    throw new Error("The production backup cleanup lease schema is invalid.");
  }

  const sourceRunId = pattern(lease.sourceRunId, runNumberPattern, "source run ID");
  const sourceRunAttempt = pattern(
    lease.sourceRunAttempt,
    runNumberPattern,
    "source run attempt"
  );
  const validated: ProductionBackupCleanupLease = {
    schemaVersion: 1,
    sourceRunId,
    sourceRunAttempt,
    sourceHeadSha: pattern(lease.sourceHeadSha, commitPattern, "source head SHA"),
    releaseCommit: pattern(lease.releaseCommit, commitPattern, "release commit"),
    fenceId: pattern(lease.fenceId, fenceIdPattern, "fence ID"),
    databaseIdentity: pattern(
      lease.databaseIdentity,
      databaseIdentityPattern,
      "database identity"
    )
  };

  if (validated.fenceId !== expectedFenceId(sourceRunId, sourceRunAttempt)) {
    throw new Error("The production backup cleanup lease fence is not attempt-bound.");
  }

  if (expected) {
    for (const key of leaseKeys.slice(1) as Array<keyof ProductionBackupCleanupLeaseExpectations>) {
      if (validated[key] !== expected[key]) {
        throw new Error("The production backup cleanup lease does not match protected configuration.");
      }
    }
  }
  return validated;
}

export function validateProductionBackupCleanupLeaseSource(
  value: unknown,
  expected: ProductionBackupCleanupLeaseSourceExpectations
): ProductionBackupCleanupLease {
  const lease = validateProductionBackupCleanupLease(value);
  if (
    lease.sourceRunId !== pattern(expected.sourceRunId, runNumberPattern, "expected source run ID")
    || lease.sourceRunAttempt !== pattern(
      expected.sourceRunAttempt,
      runNumberPattern,
      "expected source run attempt"
    )
    || lease.sourceHeadSha !== pattern(
      expected.sourceHeadSha,
      commitPattern,
      "expected source head SHA"
    )
  ) {
    throw new Error("The production backup cleanup lease is not bound to the failed source run.");
  }
  return lease;
}

function expectedFenceId(runId: string, runAttempt: string): string {
  return `fence-backup-${runId}-${runAttempt}`;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The production backup cleanup lease must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>): void {
  const actual = Object.keys(value).sort();
  const expected = [...leaseKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("The production backup cleanup lease fields are invalid.");
  }
}

function pattern(value: unknown, expected: RegExp, label: string): string {
  if (typeof value !== "string" || !expected.test(value)) {
    throw new Error(`The production backup cleanup lease ${label} is invalid.`);
  }
  return value;
}
