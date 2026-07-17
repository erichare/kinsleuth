import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabasePools, query } from "@/lib/db";
import { applyGedcomImport, readWorkspace, repairGedcomRelationshipLinks, updatePersonCuration } from "@/lib/workspace-store";
import { prepareGedcomImport } from "@/lib/gedcom/apply";
import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const itLarge = process.env.RUN_LARGE_GEDCOM_TEST === "true" ? it : it.skip;

let storeOptions: { databaseUrl: string; archiveId: string };

async function deleteTestArchives(archivePredicate: string, values: string[]): Promise<void> {
  if (!databaseUrl) return;
  await query(`DELETE FROM person_facts WHERE archive_id ${archivePredicate}`, values, { databaseUrl });
  await query(`DELETE FROM archives WHERE id ${archivePredicate}`, values, { databaseUrl });
}

beforeAll(async () => {
  if (!databaseUrl) return;
  await deleteTestArchives("LIKE 'test-%'", []);
});

beforeEach(async () => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-${randomUUID()}` };
  await provisionTestArchive(storeOptions);
});

afterEach(async () => {
  if (!databaseUrl) return;
  await deleteTestArchives("= $1", [storeOptions.archiveId]);
}, 120_000);

afterAll(async () => {
  await closeDatabasePools();
}, 120_000);

describe("GEDCOM prepare", () => {
  it("prepares people, sources, and raw records from GEDCOM content", () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const prepared = prepareGedcomImport("synthetic-family.ged", content, new Date("2026-01-01T00:00:00.000Z"));
    const nora = prepared.people.find((person) => person.id === "@I1@");

    expect(prepared.people).toHaveLength(16);
    expect(nora?.relatives).toContain("@I2@");
    expect(nora?.relatives).not.toContain("@F1@");
    expect(prepared.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Fictional Lantern Bay civil register",
          sourceType: "GEDCOM source",
          importId: prepared.snapshot.id
        })
      ])
    );
    expect(prepared.rawRecords).toHaveLength(prepared.snapshot.records.length);
  });

});

describeIfDatabase("GEDCOM apply", () => {
  it("applies a GEDCOM into the workspace and writes a backup", async () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const result = await applyGedcomImport({ sourceName: "synthetic-family.ged", content }, storeOptions);
    const workspace = await readWorkspace(storeOptions);

    expect(result.import.peopleImported).toBe(16);
    expect(workspace.imports[0]).toMatchObject({
      id: result.import.id,
      backupId: result.backup.id
    });
    expect(workspace.people.map((person) => person.id)).toEqual(
      expect.arrayContaining([
        "@I1@",
        "@I2@",
        "@I3@",
        "@I4@",
        "@I5@",
        "@I6@",
        "@I7@",
        "@I8@",
        "@I9@",
        "@I10@",
        "@I11@",
        "@I12@",
        "@I13@",
        "@I14@",
        "@I15@",
        "@I16@"
      ])
    );
    expect(workspace.people.find((person) => person.id === "@I1@")?.relatives).toContain("@I2@");
    expect(workspace.people.find((person) => person.id === "@I4@")?.relatives).toEqual(
      expect.arrayContaining(["@I9@", "@I10@", "@I3@", "@I1@"])
    );
    expect(workspace.rawRecords).toHaveLength(result.rawRecordCount);
    expect(result.backup.storageKey).toContain("postgres://workspace_backups/");
  });

  it("preserves existing curation when an imported person is reapplied", async () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    await applyGedcomImport({ sourceName: "synthetic-family.ged", content }, storeOptions);
    await updatePersonCuration("@I1@", { published: true, privacy: "public", livingStatus: "deceased" }, storeOptions);
    await applyGedcomImport({ sourceName: "synthetic-family.ged", content }, storeOptions);
    const workspace = await readWorkspace(storeOptions);
    const person = workspace.people.find((item) => item.id === "@I1@");

    expect(person).toMatchObject({
      published: true,
      privacy: "public",
      livingStatus: "deceased"
    });
  });

  it("repairs relationship links from stored raw GEDCOM records", async () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    await applyGedcomImport({ sourceName: "synthetic-family.ged", content }, storeOptions);
    await updatePersonCuration("@I1@", { published: true, privacy: "public", livingStatus: "deceased" }, storeOptions);

    const workspace = await readWorkspace(storeOptions);
    await query("UPDATE people SET relatives = $1 WHERE archive_id = $2 AND id = $3", [["@F1@"], storeOptions.archiveId, "@I1@"], { databaseUrl: storeOptions.databaseUrl });

    const result = await repairGedcomRelationshipLinks(storeOptions);
    const repairedWorkspace = await readWorkspace(storeOptions);
    const repairedNora = repairedWorkspace.people.find((person) => person.id === "@I1@");

    expect(workspace.rawRecords.length).toBeGreaterThan(0);
    expect(result.updatedPeople).toBeGreaterThan(0);
    expect(repairedNora?.relatives).toContain("@I2@");
    expect(repairedNora?.relatives).not.toContain("@F1@");
    expect(repairedNora).toMatchObject({ published: true, privacy: "public", livingStatus: "deceased" });
  });

  itLarge("applies a GEDCOM larger than 10.5 MB with batched persistence", async () => {
    const personCount = 65_000;
    const note = "x".repeat(96);
    const content = Array.from({ length: personCount }, (_, index) => (
      `0 @I${index}@ INDI\n1 NAME Person ${index} /Loadtest/\n1 BIRT\n2 DATE 1 JAN ${1800 + (index % 200)}\n1 NOTE ${note}`
    )).join("\n");

    expect(Buffer.byteLength(content)).toBeGreaterThan(10.5 * 1024 * 1024);
    const result = await applyGedcomImport({ sourceName: "large-family.ged", content }, storeOptions);
    const counts = await query<{ people: string; raw_records: string }>(
      `SELECT
        (SELECT count(*) FROM people WHERE archive_id = $1 AND id LIKE '@I%') AS people,
        (SELECT count(*) FROM raw_records WHERE archive_id = $1) AS raw_records`,
      [storeOptions.archiveId],
      { databaseUrl: storeOptions.databaseUrl }
    );

    expect(result.peopleImported).toBe(personCount);
    expect(Number(counts.rows[0].people)).toBe(personCount);
    expect(Number(counts.rows[0].raw_records)).toBe(personCount);
  }, 120_000);
});
