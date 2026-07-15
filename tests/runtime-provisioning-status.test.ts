import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { provisionArchive } from "@/lib/archive-provisioning";
import { closeDatabasePools, query } from "@/lib/db";
import { getRuntimeStatus } from "@/lib/runtime-status";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const originalEnvironment = { ...process.env };

let archiveId = "";

beforeEach(() => {
  if (!databaseUrl) return;
  archiveId = `runtime-status-${randomUUID()}`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.KINSLEUTH_ARCHIVE_ID = archiveId;
  process.env.KINRESOLVE_DEPLOYMENT_MODE = "hosted";
  process.env.KINRESOLVE_DATASET_MODE = "pilot";
});

afterEach(async () => {
  if (databaseUrl && archiveId) {
    await query("DELETE FROM archives WHERE id = $1", [archiveId], { databaseUrl });
  }
  process.env = { ...originalEnvironment };
});

afterAll(async () => {
  await closeDatabasePools();
});

describeIfDatabase("runtime archive provisioning status", () => {
  it("keeps database connectivity separate from a missing archive", async () => {
    const status = await getRuntimeStatus();

    expect(status.database).toMatchObject({
      configured: true,
      connected: true,
      provisioned: false,
      datasetMode: null,
      expectedDatasetMode: "pilot",
      datasetModeMatches: false
    });
    expect(status.database.error).toMatch(/not provisioned/i);
  });

  it("reports a persisted/configured mode mismatch without rewriting the archive", async () => {
    await provisionArchive("demo", { databaseUrl: databaseUrl!, archiveId });

    const status = await getRuntimeStatus();

    expect(status.database).toMatchObject({
      connected: true,
      provisioned: true,
      datasetMode: "demo",
      expectedDatasetMode: "pilot",
      datasetModeMatches: false,
      demoFixtureVersion: 1
    });
    expect(status.database.error).toMatch(/does not match/i);
  });

  it("reports a matching explicitly provisioned pilot archive", async () => {
    await provisionArchive("pilot", { databaseUrl: databaseUrl!, archiveId });

    const status = await getRuntimeStatus();

    expect(status.database).toMatchObject({
      connected: true,
      provisioned: true,
      datasetMode: "pilot",
      expectedDatasetMode: "pilot",
      datasetModeMatches: true,
      demoFixtureVersion: null
    });
    expect(status.database.error).toBeUndefined();
  });
});
