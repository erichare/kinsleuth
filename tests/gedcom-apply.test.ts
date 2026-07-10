import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabasePools, query } from "@/lib/db";
import { applyGedcomImport, readWorkspace, repairGedcomRelationshipLinks, updatePersonCuration } from "@/lib/workspace-store";
import { prepareGedcomImport } from "@/lib/gedcom/apply";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

let storeOptions: { databaseUrl: string; archiveId: string };

beforeAll(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id LIKE 'test-%'", [], { databaseUrl });
});

beforeEach(() => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-${randomUUID()}` };
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = $1", [storeOptions.archiveId], { databaseUrl });
});

afterAll(async () => {
  await closeDatabasePools();
});

describe("GEDCOM prepare", () => {
  it("prepares people, sources, and raw records from GEDCOM content", () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const prepared = prepareGedcomImport("synthetic-family.ged", content, new Date("2026-01-01T00:00:00.000Z"));
    const elizabeth = prepared.people.find((person) => person.id === "@I1@");

    expect(prepared.people).toHaveLength(3);
    expect(elizabeth?.relatives).toContain("@I2@");
    expect(elizabeth?.relatives).not.toContain("@F1@");
    expect(prepared.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Synthetic Chicago birth register",
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

    expect(result.import.peopleImported).toBe(3);
    expect(workspace.imports[0]).toMatchObject({
      id: result.import.id,
      backupId: result.backup.id
    });
    expect(workspace.people.map((person) => person.id)).toEqual(expect.arrayContaining(["@I1@", "@I2@", "@I3@"]));
    expect(workspace.people.find((person) => person.id === "@I1@")?.relatives).toContain("@I2@");
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
    const repairedElizabeth = repairedWorkspace.people.find((person) => person.id === "@I1@");

    expect(workspace.rawRecords.length).toBeGreaterThan(0);
    expect(result.updatedPeople).toBeGreaterThan(0);
    expect(repairedElizabeth?.relatives).toContain("@I2@");
    expect(repairedElizabeth?.relatives).not.toContain("@F1@");
    expect(repairedElizabeth).toMatchObject({ published: true, privacy: "public", livingStatus: "deceased" });
  });
});
