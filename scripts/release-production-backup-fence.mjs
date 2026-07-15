#!/usr/bin/env node
import {
  releaseReleaseFence,
  ReleaseFenceError,
  validateReleaseFenceIdentity
} from "../lib/release-fence.ts";
import {
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "../lib/database-attestation.ts";
import {
  closeDatabasePools,
  getPool,
  isDatabaseTransportVerified
} from "../lib/db.ts";

const databaseUrl = process.env.RELEASE_FENCE_DATABASE_URL?.trim();
const expectedDatabaseIdentity = process.env.EXPECTED_DATABASE_IDENTITY?.trim();
if (!databaseUrl || !expectedDatabaseIdentity || process.argv.length !== 2) {
  console.error(
    "RELEASE_FENCE_DATABASE_URL and EXPECTED_DATABASE_IDENTITY are required; this command accepts no arguments."
  );
  process.exit(2);
}
if (!isDatabaseTransportVerified(databaseUrl)) {
  console.error("RELEASE_FENCE_DATABASE_URL must use a verified TLS transport for remote databases.");
  process.exit(2);
}

let identity;
try {
  identity = validateReleaseFenceIdentity({
    fenceId: process.env.RELEASE_FENCE_ID ?? "",
    releaseCommitSha: process.env.RELEASE_COMMIT ?? ""
  });
} catch {
  console.error("The configured production backup fence identity is invalid.");
  process.exit(2);
}

process.env.DATABASE_AUTO_MIGRATE = "false";
const options = { databaseUrl };

try {
  const databaseIdentity = await readDatabaseIdentity(getPool(options));
  validateConfiguredDatabaseIdentity(expectedDatabaseIdentity, databaseIdentity);
  try {
    const result = await releaseReleaseFence(identity, options);
    process.stdout.write(`${JSON.stringify({ found: true, ...result })}\n`);
  } catch (error) {
    if (error instanceof ReleaseFenceError && error.code === "NOT_FOUND") {
      process.stdout.write(`${JSON.stringify({ found: false, transition: "not-found" })}\n`);
    } else {
      throw error;
    }
  }
} catch (error) {
  if (error instanceof ReleaseFenceError) {
    console.error(`Production backup fence cleanup failed (${error.code}).`);
  } else {
    console.error("Production backup fence cleanup failed.");
  }
  process.exitCode = 1;
} finally {
  try {
    await closeDatabasePools();
  } catch {
    console.error("Production backup fence cleanup database shutdown failed.");
    process.exitCode = 1;
  }
}
