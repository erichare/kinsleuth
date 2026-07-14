import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabasePools, query } from "@/lib/db";
import type { DnaMatch } from "@/lib/models";
import {
  addCaseTask,
  applyGedcomImport,
  createCase,
  deleteDnaMatch,
  readWorkspace,
  saveAIAnalysisRun,
  saveDnaMatch,
  saveSourceDocument,
  updateCaseTask,
  updatePersonCuration
} from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

let storeOptions: { databaseUrl: string; archiveId: string };

beforeEach(() => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-row-${randomUUID()}` };
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = $1", [storeOptions.archiveId], { databaseUrl });
});

afterAll(async () => {
  await closeDatabasePools();
});

// xmin is Postgres's row-version system column: it changes whenever a row is
// rewritten. Row-level persistence means a mutation must leave unrelated rows'
// xmin untouched — under delete-all/insert-all every row changed on every write.
const stableTables = ["people", "person_facts", "sources", "dna_matches", "research_cases", "raw_records"] as const;

async function captureRowVersions(archiveId: string, table: (typeof stableTables)[number]): Promise<Map<string, string>> {
  const result = await query<{ id: string; xmin: string }>(
    `SELECT id, xmin::text AS xmin FROM ${table} WHERE archive_id = $1`,
    [archiveId],
    { databaseUrl: databaseUrl! }
  );
  return new Map(result.rows.map((row) => [row.id, row.xmin]));
}

function expectSameVersions(before: Map<string, string>, after: Map<string, string>, except: string[] = []): void {
  const exceptions = new Set(except);
  expect(after.size).toBe(before.size);
  for (const [id, xmin] of before) {
    if (exceptions.has(id)) continue;
    expect(after.get(id), `row ${id} should not have been rewritten`).toBe(xmin);
  }
}

function testDnaMatch(overrides: Partial<DnaMatch> = {}): DnaMatch {
  return {
    id: `match-${randomUUID()}`,
    displayName: "Row Level Tester",
    totalCm: 128,
    side: "unknown",
    treeStatus: "private",
    surnames: ["Hartwell"],
    places: ["Lantern Bay"],
    sharedMatches: [],
    notes: "",
    triageStatus: "needs_review",
    ...overrides
  };
}

const smallGedcom = [
  "0 HEAD",
  "1 CHAR UTF-8",
  "0 @I1@ INDI",
  "1 NAME Import /Rowtest/",
  "1 BIRT",
  "2 DATE 1900",
  "0 TRLR"
].join("\n");

describeIfDatabase("row-level workspace persistence", () => {
  it("does not rewrite people, sources, or DNA rows when case tasks change", async () => {
    await readWorkspace(storeOptions);
    const created = await createCase({ title: "Task stability", question: "Do writes stay scoped?" }, storeOptions);

    const peopleBefore = await captureRowVersions(storeOptions.archiveId, "people");
    const factsBefore = await captureRowVersions(storeOptions.archiveId, "person_facts");
    const sourcesBefore = await captureRowVersions(storeOptions.archiveId, "sources");
    const dnaBefore = await captureRowVersions(storeOptions.archiveId, "dna_matches");

    const added = await addCaseTask(created.id, { title: "Check the census" }, storeOptions);
    await updateCaseTask(
      created.id,
      added.task.id,
      { status: "doing", expectedUpdatedAt: added.task.updatedAt! },
      storeOptions
    );

    expectSameVersions(peopleBefore, await captureRowVersions(storeOptions.archiveId, "people"));
    expectSameVersions(factsBefore, await captureRowVersions(storeOptions.archiveId, "person_facts"));
    expectSameVersions(sourcesBefore, await captureRowVersions(storeOptions.archiveId, "sources"));
    expectSameVersions(dnaBefore, await captureRowVersions(storeOptions.archiveId, "dna_matches"));
  });

  it("does not rewrite unrelated tables when an AI run is saved", async () => {
    await readWorkspace(storeOptions);
    const peopleBefore = await captureRowVersions(storeOptions.archiveId, "people");
    const casesBefore = await captureRowVersions(storeOptions.archiveId, "research_cases");
    const rawBefore = await captureRowVersions(storeOptions.archiveId, "raw_records");

    await saveAIAnalysisRun(
      {
        question: "Scoped write check?",
        answer: "Yes.",
        status: "ready",
        evidenceUsed: [],
        uncertainty: [],
        anomalyCount: 0,
        suggestions: [],
        contextReferences: []
      },
      storeOptions
    );

    expectSameVersions(peopleBefore, await captureRowVersions(storeOptions.archiveId, "people"));
    expectSameVersions(casesBefore, await captureRowVersions(storeOptions.archiveId, "research_cases"));
    expectSameVersions(rawBefore, await captureRowVersions(storeOptions.archiveId, "raw_records"));
  });

  it("touches only the curated person when curation changes", async () => {
    const workspace = await readWorkspace(storeOptions);
    const target = workspace.people[0];
    const peopleBefore = await captureRowVersions(storeOptions.archiveId, "people");

    const updated = await updatePersonCuration(target.id, { privacy: "sensitive" }, storeOptions);

    expect(updated.privacy).toBe("sensitive");
    expect(updated.facts.length).toBe(target.facts.length);
    expectSameVersions(peopleBefore, await captureRowVersions(storeOptions.archiveId, "people"), [target.id]);
  });

  it("keeps newest-first ordering for prepended entities", async () => {
    await readWorkspace(storeOptions);
    const first = await createCase({ title: "First case", question: "One?" }, storeOptions);
    const second = await createCase({ title: "Second case", question: "Two?" }, storeOptions);

    const firstTask = await addCaseTask(second.id, { title: "First task" }, storeOptions);
    const secondTask = await addCaseTask(second.id, { title: "Second task" }, storeOptions);

    await saveSourceDocument({ title: "Older source" }, storeOptions);
    await saveSourceDocument({ title: "Newer source" }, storeOptions);

    const workspace = await readWorkspace(storeOptions);
    const caseIds = workspace.cases.map((item) => item.id);
    expect(caseIds.indexOf(second.id)).toBeLessThan(caseIds.indexOf(first.id));

    const taskIds = workspace.cases.find((item) => item.id === second.id)!.tasks.map((task) => task.id);
    expect(taskIds.indexOf(secondTask.task.id)).toBeLessThan(taskIds.indexOf(firstTask.task.id));

    const sourceTitles = workspace.sources.map((source) => source.title);
    expect(sourceTitles.indexOf("Newer source")).toBeLessThan(sourceTitles.indexOf("Older source"));
  });

  it("caps AI run history at 25 without rewriting other tables", async () => {
    await readWorkspace(storeOptions);

    for (let index = 0; index < 27; index += 1) {
      await saveAIAnalysisRun(
        {
          id: `ai-cap-${index}`,
          question: `Run ${index}?`,
          answer: "ok",
          status: "ready",
          evidenceUsed: [],
          uncertainty: [],
          anomalyCount: 0,
          suggestions: [],
          contextReferences: []
        },
        storeOptions
      );
    }

    const workspace = await readWorkspace(storeOptions);
    expect(workspace.aiRuns).toHaveLength(25);
    expect(workspace.aiRuns[0].id).toBe("ai-cap-26");
    expect(workspace.aiRuns.map((run) => run.id)).not.toContain("ai-cap-0");
  });

  it("removes the derived hypothesis row when a DNA match is deleted", async () => {
    await readWorkspace(storeOptions);
    const match = testDnaMatch();
    await saveDnaMatch(match, storeOptions);

    const hypothesisRows = await query(
      "SELECT id FROM dna_hypotheses WHERE archive_id = $1 AND dna_match_id = $2",
      [storeOptions.archiveId, match.id],
      { databaseUrl: databaseUrl! }
    );
    expect(hypothesisRows.rows).toHaveLength(1);

    await deleteDnaMatch(match.id, storeOptions);

    const afterDelete = await query(
      "SELECT id FROM dna_hypotheses WHERE archive_id = $1 AND dna_match_id = $2",
      [storeOptions.archiveId, match.id],
      { databaseUrl: databaseUrl! }
    );
    expect(afterDelete.rows).toHaveLength(0);
  });

  it("scopes GEDCOM apply writes to import-related tables and stores a real backup snapshot", async () => {
    await readWorkspace(storeOptions);
    const casesBefore = await captureRowVersions(storeOptions.archiveId, "research_cases");
    const dnaBefore = await captureRowVersions(storeOptions.archiveId, "dna_matches");

    const applied = await applyGedcomImport({ sourceName: "row-test.ged", content: smallGedcom }, storeOptions);

    expectSameVersions(casesBefore, await captureRowVersions(storeOptions.archiveId, "research_cases"));
    expectSameVersions(dnaBefore, await captureRowVersions(storeOptions.archiveId, "dna_matches"));

    const backup = await query<{ snapshot: { people?: unknown[] } }>(
      "SELECT snapshot FROM workspace_backups WHERE archive_id = $1 AND id = $2",
      [storeOptions.archiveId, applied.backup.id],
      { databaseUrl: databaseUrl! }
    );
    expect(Array.isArray(backup.rows[0].snapshot.people)).toBe(true);
    expect(backup.rows[0].snapshot.people!.length).toBeGreaterThan(0);

    const workspace = await readWorkspace(storeOptions);
    expect(workspace.people.some((person) => person.displayName === "Import Rowtest")).toBe(true);
    expect(workspace.imports[0].id).toBe(applied.import.id);
  });

  it("preserves curation flags and avoids duplicates on re-import", async () => {
    await readWorkspace(storeOptions);
    await applyGedcomImport({ sourceName: "row-test.ged", content: smallGedcom }, storeOptions);
    await updatePersonCuration("@I1@", { privacy: "public", livingStatus: "deceased" }, storeOptions);

    await applyGedcomImport({ sourceName: "row-test.ged", content: smallGedcom }, storeOptions);

    const workspace = await readWorkspace(storeOptions);
    const imported = workspace.people.filter((person) => person.id === "@I1@");
    expect(imported).toHaveLength(1);
    expect(imported[0].privacy).toBe("public");
    expect(imported[0].livingStatus).toBe("deceased");

    const rawRecords = await query<{ count: string }>(
      "SELECT count(*)::text AS count FROM raw_records WHERE archive_id = $1 AND xref = '@I1@'",
      [storeOptions.archiveId],
      { databaseUrl: databaseUrl! }
    );
    expect(Number(rawRecords.rows[0].count)).toBe(1);
  });
});
