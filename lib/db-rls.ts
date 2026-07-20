import type { DatabaseOptions } from "./db";

// Transaction-local settings that migration 020's row-level-security policies
// read through current_setting(..., true). They are applied with
// set_config(name, value, is_local => true) immediately after BEGIN, so they
// can never leak across pooled connections or outlive their transaction.
//
// This module deliberately has no runtime dependency on ./db: unit tests mock
// "@/lib/db" with narrow factories, and these pure helpers must keep working
// inside those tests.
export const rlsArchiveScopeGuc = "kinresolve.archive_id";
export const rlsMaintenanceModeGuc = "kinresolve.rls_mode";
export const rlsMaintenanceModeValue = "maintenance";

const transactionGucNamePattern = /^kinresolve\.[a-z_]{1,48}$/;

/**
 * Returns new options whose transaction(s) are pinned to one archive. The
 * archive-scoped mutation policies then admit INSERT/UPDATE/DELETE (and the
 * UPDATE-policy check behind SELECT ... FOR UPDATE/SHARE) only for rows of
 * that archive.
 */
export function withRlsArchiveScope<T extends DatabaseOptions>(options: T, archiveId: string): T {
  if (typeof archiveId !== "string" || !archiveId.trim()) {
    throw new Error("An archive id is required to scope row-level security.");
  }
  return {
    ...options,
    transactionGucs: { ...options.transactionGucs, [rlsArchiveScopeGuc]: archiveId }
  };
}

/**
 * Returns new options whose transaction(s) run in RLS maintenance mode. Only
 * cross-archive system work (purges, operator identity flows, provisioning
 * cleanup) may use this; request-scoped tenant work must use
 * withRlsArchiveScope instead.
 */
export function withRlsMaintenanceMode<T extends DatabaseOptions>(options: T): T {
  return {
    ...options,
    transactionGucs: { ...options.transactionGucs, [rlsMaintenanceModeGuc]: rlsMaintenanceModeValue }
  };
}

export function validateTransactionGucEntry(name: string, value: string): void {
  if (!transactionGucNamePattern.test(name)) {
    throw new Error("Transaction settings must use reviewed kinresolve.* configuration names.");
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error(`The transaction setting ${name} must be a short non-empty string.`);
  }
}
