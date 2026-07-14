#!/usr/bin/env node
import { validateTestDatabase } from "../lib/test-database-contract.ts";

try {
  validateTestDatabase({
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    databaseUrl: process.env.DATABASE_URL
  });
  console.log("Complete database test contract verified.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
