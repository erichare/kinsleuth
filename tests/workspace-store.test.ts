import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabasePools, query } from "@/lib/db";
import type { DnaMatch } from "@/lib/models";
import { addCaseTask, createCase, deleteDnaMatch, linkDnaMatchToCase, readWorkspace, saveAIAnalysisRun, saveDnaMatch, saveDnaMatches, saveSourceDocument, updateArchiveBranding, updateCaseTask, updateDnaMatch, updatePersonCuration } from "@/lib/workspace-store";

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

describeIfDatabase("workspace store", () => {
  it("seeds a Postgres archive when storage is empty", async () => {
    const workspace = await readWorkspace(storeOptions);

    expect(workspace.people.length).toBeGreaterThan(0);
    expect(workspace.cases.length).toBeGreaterThan(0);
    expect(workspace.archiveName).toBe("Riemer - Zajicek Archive");
  });

  it("persists created cases", async () => {
    const created = await createCase(
      {
        title: "Test case",
        question: "Where does this match connect?",
        focus: "DNA cluster",
        hypotheses: [
          {
            id: "hyp-test",
            statement: "The connection is maternal.",
            confidence: 0.5,
            status: "open"
          }
        ]
      },
      storeOptions
    );
    const workspace = await readWorkspace(storeOptions);

    expect(created.id).toMatch(/^case-/);
    expect(workspace.cases[0]).toMatchObject({
      id: created.id,
      title: "Test case",
      privacy: "private"
    });
  });

  it("adds tasks to existing cases", async () => {
    const createdCase = await createCase(
      {
        id: "case-task-test",
        title: "Task test",
        question: "What should happen next?",
        focus: "Follow-up"
      },
      storeOptions
    );

    const result = await addCaseTask(createdCase.id, { title: "Check the parish register" }, storeOptions);
    const workspace = await readWorkspace(storeOptions);

    expect(result.task).toMatchObject({
      title: "Check the parish register",
      status: "todo"
    });
    expect(workspace.cases.find((item) => item.id === createdCase.id)?.tasks[0]).toMatchObject({
      id: result.task.id,
      title: "Check the parish register"
    });
  });

  it("updates existing case task status", async () => {
    const createdCase = await createCase(
      {
        id: "case-task-update",
        title: "Task update test",
        question: "Can a task move?",
        focus: "Follow-up"
      },
      storeOptions
    );
    const createdTask = await addCaseTask(createdCase.id, { id: "task-update-target", title: "Review the census" }, storeOptions);

    const result = await updateCaseTask(createdCase.id, createdTask.task.id, { status: "done" }, storeOptions);
    const workspace = await readWorkspace(storeOptions);

    expect(result.task).toMatchObject({
      id: "task-update-target",
      status: "done"
    });
    expect(workspace.cases.find((item) => item.id === createdCase.id)?.tasks[0]).toMatchObject({
      id: "task-update-target",
      status: "done"
    });
  });

  it("persists compact AI analysis runs", async () => {
    const run = await saveAIAnalysisRun(
      {
        id: "ai-test-run",
        question: "What should I investigate next?",
        answer: "Recommendation: Check the strongest DNA lead.",
        status: "configuration_required",
        evidenceUsed: ["3 people", "2 cases"],
        uncertainty: ["No external AI call was made."],
        anomalyCount: 2,
        suggestions: [
          {
            id: "sugg-test",
            type: "task",
            title: "Check the strongest DNA lead",
            summary: "Review against primary evidence.",
            contextRefs: ["case-riemer-chicago"],
            confidence: 0.7
          }
        ],
        contextReferences: [
          {
            id: "case-riemer-chicago",
            type: "case",
            label: "Riemer immigration to Chicago"
          }
        ],
        linkedCaseId: "case-riemer-chicago",
        createdAt: "2026-07-09T12:00:00.000Z"
      },
      storeOptions
    );
    const workspace = await readWorkspace(storeOptions);

    expect(run.id).toBe("ai-test-run");
    expect(workspace.aiRuns[0]).toMatchObject({
      id: "ai-test-run",
      question: "What should I investigate next?",
      anomalyCount: 2,
      suggestions: expect.arrayContaining([expect.objectContaining({ id: "sugg-test" })]),
      linkedCaseId: "case-riemer-chicago"
    });
  });

  it("saves DNA matches with computed scores and hypotheses", async () => {
    const match: DnaMatch = {
      id: "dna-test-store",
      displayName: "Storage Test",
      totalCm: 214,
      predictedRelationship: "likely 2C",
      side: "maternal",
      treeStatus: "partial",
      surnames: ["Riemer", "Fletcher"],
      places: ["Chicago"],
      sharedMatches: ["J. Fletcher"],
      notes: "Partial tree with useful overlap.",
      triageStatus: "needs_review"
    };

    const result = await saveDnaMatch(match, storeOptions);
    const workspace = await readWorkspace(storeOptions);

    expect(result.helpfulnessScore).toBeGreaterThan(50);
    expect(result.hypothesis.matchId).toBe(match.id);
    expect(workspace.dnaMatches[0]).toMatchObject({
      id: match.id,
      displayName: "Storage Test"
    });
  });

  it("saves DNA matches in bulk with high-priority scoring", async () => {
    const results = await saveDnaMatches(
      [
        {
          id: "dna-bulk-strong",
          displayName: "Bulk Strong",
          totalCm: 312,
          predictedRelationship: "likely 2C",
          side: "maternal",
          treeStatus: "public",
          surnames: ["Riemer", "Zajicek"],
          places: ["Chicago", "Limerick"],
          sharedMatches: ["J. Fletcher", "A. Zajicek"],
          notes: "Public tree with surname and place overlap.",
          triageStatus: "needs_review"
        }
      ],
      storeOptions
    );
    const workspace = await readWorkspace(storeOptions);

    expect(results[0].helpfulnessScore).toBeGreaterThanOrEqual(75);
    expect(results[0].match.triageStatus).toBe("high_priority");
    expect(workspace.dnaMatches[0]).toMatchObject({
      id: "dna-bulk-strong",
      triageStatus: "high_priority"
    });
  });

  it("updates and deletes DNA matches", async () => {
    await saveDnaMatch(
      {
        id: "dna-update-delete",
        displayName: "Queue Cleanup",
        totalCm: 94,
        predictedRelationship: "likely 3C",
        side: "unknown",
        treeStatus: "unknown",
        surnames: [],
        places: [],
        sharedMatches: [],
        notes: "",
        triageStatus: "needs_review"
      },
      storeOptions
    );

    const updated = await updateDnaMatch(
      "dna-update-delete",
      {
        side: "paternal",
        treeStatus: "private",
        triageStatus: "ignored",
        notes: "Not actionable without a visible tree."
      },
      storeOptions
    );
    let workspace = await readWorkspace(storeOptions);

    expect(updated.match).toMatchObject({
      id: "dna-update-delete",
      side: "paternal",
      treeStatus: "private",
      triageStatus: "ignored",
      notes: "Not actionable without a visible tree."
    });
    expect(workspace.dnaMatches.find((match) => match.id === "dna-update-delete")).toMatchObject({
      triageStatus: "ignored"
    });

    await deleteDnaMatch("dna-update-delete", storeOptions);
    workspace = await readWorkspace(storeOptions);
    expect(workspace.dnaMatches.some((match) => match.id === "dna-update-delete")).toBe(false);
  });

  it("links DNA matches to cases as upserted evidence", async () => {
    const createdCase = await createCase(
      {
        id: "case-dna-link",
        title: "DNA link test",
        question: "Where does this match belong?",
        focus: "DNA cluster"
      },
      storeOptions
    );
    await saveDnaMatch(
      {
        id: "dna-link-target",
        displayName: "Evidence Match",
        totalCm: 238,
        predictedRelationship: "likely 2C1R",
        side: "maternal",
        treeStatus: "partial",
        surnames: ["Riemer", "Fletcher"],
        places: ["Chicago"],
        sharedMatches: ["A. Zajicek"],
        notes: "Useful match.",
        triageStatus: "high_priority"
      },
      storeOptions
    );

    const first = await linkDnaMatchToCase(
      createdCase.id,
      "dna-link-target",
      {
        title: "Evidence Match DNA",
        summary: "First evidence summary.",
        confidence: 0.81
      },
      storeOptions
    );
    const second = await linkDnaMatchToCase(
      createdCase.id,
      "dna-link-target",
      {
        title: "Evidence Match DNA updated",
        summary: "Updated evidence summary.",
        confidence: 0.84
      },
      storeOptions
    );
    const workspace = await readWorkspace(storeOptions);
    const updatedCase = workspace.cases.find((item) => item.id === createdCase.id);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.evidence).toMatchObject({
      id: first.evidence.id,
      title: "Evidence Match DNA updated",
      linkedDnaMatchId: "dna-link-target",
      confidence: 0.84
    });
    expect(updatedCase?.evidence.filter((item) => item.linkedDnaMatchId === "dna-link-target")).toHaveLength(1);
  });

  it("persists source documents with links and transcripts", async () => {
    const source = await saveSourceDocument(
      {
        title: "Parish register scan",
        sourceType: "Church record",
        fileName: "parish-register.pdf",
        storageKey: "uploads/sources/parish-register.pdf",
        linkedPersonId: "p-elizabeth-riemer",
        transcript: "Baptism entry transcript.",
        privacy: "private",
        confidence: 0.74
      },
      storeOptions
    );
    const workspace = await readWorkspace(storeOptions);

    expect(source.id).toMatch(/^src-/);
    expect(workspace.sources[0]).toMatchObject({
      id: source.id,
      title: "Parish register scan",
      linkedPersonId: "p-elizabeth-riemer",
      transcript: "Baptism entry transcript."
    });
  });

  it("keeps archives isolated when ids repeat across archives", async () => {
    // Regression: ids repeat across archives by design (GEDCOM xrefs, fixed
    // demo-seed ids such as p-elizabeth-riemer). With global primary keys the
    // second archive's seed failed with a duplicate-key error on people_pkey.
    const otherOptions = { ...storeOptions, archiveId: `test-${randomUUID()}` };

    try {
      const first = await readWorkspace(storeOptions);
      const second = await readWorkspace(otherOptions);

      expect(first.people.some((person) => person.id === "p-elizabeth-riemer")).toBe(true);
      expect(second.people.some((person) => person.id === "p-elizabeth-riemer")).toBe(true);

      await updateArchiveBranding({ name: "Renamed Test Archive", tagline: "Second archive only" }, otherOptions);
      await createCase(
        {
          id: "case-isolated",
          title: "Isolated case",
          question: "Does this stay in one archive?"
        },
        otherOptions
      );

      const renamed = await readWorkspace(otherOptions);
      const untouched = await readWorkspace(storeOptions);

      expect(renamed.archiveName).toBe("Renamed Test Archive");
      expect(renamed.cases.some((item) => item.id === "case-isolated")).toBe(true);
      expect(untouched.archiveName).toBe("Riemer - Zajicek Archive");
      expect(untouched.cases.some((item) => item.id === "case-isolated")).toBe(false);
      expect(untouched.people.some((person) => person.id === "p-elizabeth-riemer")).toBe(true);
    } finally {
      await query("DELETE FROM archives WHERE id = $1", [otherOptions.archiveId], { databaseUrl });
    }
  });

  it("updates person curation settings", async () => {
    const updated = await updatePersonCuration(
      "p-mary-zajicek",
      {
        published: true,
        privacy: "public",
        livingStatus: "deceased"
      },
      storeOptions
    );
    const workspace = await readWorkspace(storeOptions);

    expect(updated).toMatchObject({
      id: "p-mary-zajicek",
      published: true,
      privacy: "public",
      livingStatus: "deceased"
    });
    expect(workspace.people.find((person) => person.id === "p-mary-zajicek")).toMatchObject({
      published: true,
      privacy: "public"
    });
  });
});
