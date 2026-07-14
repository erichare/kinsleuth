#!/usr/bin/env node
import { validateReleaseUpgradeDatabase } from "../lib/test-database-contract.ts";

try {
  validateReleaseUpgradeDatabase({
    releaseDatabaseUrl: process.env.TEST_RELEASE_UPGRADE_DATABASE_URL,
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    databaseUrl: process.env.DATABASE_URL
  });
  console.log("Release-upgrade database contract verified.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
