#!/usr/bin/env node
import { verifyMigrationHistory } from "../lib/migration-history.ts";

try {
  const report = await verifyMigrationHistory({ repositoryRoot: process.cwd() });
  console.log(
    `Verified ${report.migrationFiles.length} immutable migration(s) and ${report.releaseAnchors.length} release anchor(s).`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
