import { createHash } from "node:crypto";

// Workspace import ids for integration-applied refreshes are deterministic on
// the connection and the staged artifact content, so re-processing the same
// artifact upserts the same import snapshot instead of accumulating
// duplicates. The read side (see readPersonXrefMappingsByImportId in
// lib/workspace-store.ts) recomputes the same id from the immutable
// integration_snapshots rows to attribute each applied import back to its
// connection without storing a second linkage column.
const integrationImportIdPrefix = "import-integration-";

export function integrationImportId(connectionId: string, artifactSha256: string): string {
  const digest = createHash("sha256").update(`${connectionId}:${artifactSha256}`).digest("hex");
  return `${integrationImportIdPrefix}${digest.slice(0, 20)}`;
}

// Legacy GEDCOM imports use `import-<hash>` ids (see lib/gedcom/apply.ts);
// only integration refreshes carry this prefix.
export function isIntegrationImportId(importId: string): boolean {
  return importId.startsWith(integrationImportIdPrefix);
}
