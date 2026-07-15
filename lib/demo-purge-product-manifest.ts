import type { Pool, PoolClient } from "pg";

import {
  demoPurgeProductManifestSha256,
  demoPurgeProductTables,
  type DemoPurgeTableManifest
} from "./demo-purge.ts";
import { canonicalJson, sha256Utf8 } from "./recovery-evidence-operations.ts";

export async function readDemoPurgeProductManifests(
  poolOrClient: Pool | PoolClient,
  archiveId: string
): Promise<DemoPurgeTableManifest[]> {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(archiveId)) {
    throw new Error("The demo purge database archive identity is invalid.");
  }
  const manifests: DemoPurgeTableManifest[] = [];
  for (const name of demoPurgeProductTables) {
    const result = await poolOrClient.query<{ row_data: string }>(
      `SELECT pg_catalog.to_jsonb(row_record)::text AS row_data
       FROM public.${quoteIdentifier(name)} AS row_record
       WHERE archive_id = $1`,
      [archiveId]
    );
    if (result.rows.length > 100_000) {
      throw new Error("A demo purge product table exceeds the supported inventory size.");
    }
    const rows = result.rows.map((row) => {
      if (typeof row.row_data !== "string") {
        throw new Error("A demo purge product row could not be canonicalized.");
      }
      return row.row_data;
    }).sort(compareUtf8);
    manifests.push({
      name,
      rowCount: rows.length,
      manifestSha256: sha256Utf8(`${canonicalJson(rows)}\n`)
    });
  }
  // Exercise the same strict table classification before returning data used
  // by either backup authorization or destructive execution.
  demoPurgeProductManifestSha256(manifests);
  return manifests;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
