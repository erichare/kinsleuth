#!/usr/bin/env node
import nextEnvironment from "@next/env";
import { Pool } from "pg";
import { validateTestDatabase } from "../lib/test-database-contract.ts";
import { getDatabaseConnectionString } from "../lib/connection-string.ts";
import { runPendingMigrations } from "../lib/migrations.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let pool;
try {
  validateTestDatabase({
    testDatabaseUrl,
    databaseUrl: process.env.DATABASE_URL
  });
  pool = new Pool({ connectionString: getDatabaseConnectionString(testDatabaseUrl), max: 2 });
  const result = await runPendingMigrations(pool);
  console.log(
    result.applied.length > 0
      ? `Complete database test contract verified; applied ${result.applied.length} migration(s).`
      : "Complete database test contract verified; schema is current."
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool?.end();
}
