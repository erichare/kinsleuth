import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabasePools, query } from "@/lib/db";
import type { DnaMatch } from "@/lib/models";
import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";
import {
  addCaseTask,
  createCase,
  deleteDnaMatch,
  linkDnaMatchToCase,
  readWorkspace,
  recordCaseTaskOutcome,
  saveAIAnalysisRun,
  saveDnaMatch,
  saveDnaMatches,
  saveSourceDocument,
  updateArchiveBranding,
  updateDnaMatch,
  updatePersonCuration
} from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

let storeOptions: { databaseUrl: string; archiveId: string };

beforeAll(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id LIKE 'test-%'", [], { databaseUrl });
});

beforeEach(async () => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-${randomUUID()}` };
  await provisionTestArchive(storeOptions);
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = $1", [storeOptions.archiveId], { databaseUrl });
});

afterAll(async () => {
  await closeDatabasePools();
});

describeIfDatabase("workspace store", () => {
  it("rechecks disabled hosted mutations at the canonical store boundary", async () => {
    const match: DnaMatch = {
      id: "dna-disabled-boundary",
      displayName: "Disabled boundary",
      totalCm: 88,
      side: "unknown",
      treeStatus: "unknown",
      surnames: [],
      places: [],
      sharedMatches: [],
      notes: "",
      triageStatus: "needs_review"
    };
    const researchCase = await createCase({
      id: "case-disabled-dna",
      title: "Disabled DNA",
      question: "Should no DNA mutation cross the boundary?"
    }, storeOptions);
    await updatePersonCuration("p-amalia-bellandi", { published: false }, storeOptions);

    const hostedEnvironment = {
      KINRESOLVE_DEPLOYMENT_MODE: "hosted",
      KINRESOLVE_DATASET_MODE: "demo",
      KINRESOLVE_DNA_ENABLED: "false",
      KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
      KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
      KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
      KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
      KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
      KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
    } as const;
    for (const [name, value] of Object.entries(hostedEnvironment)) vi.stubEnv(name, value);

    try {
      await expect(saveDnaMatch(match, storeOptions)).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
      await expect(saveDnaMatches([match], storeOptions)).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
      await expect(updateDnaMatch(match.id, { notes: "bypass" }, storeOptions)).rejects.toMatchObject({
        code: "CAPABILITY_DISABLED"
      });
      await expect(deleteDnaMatch(match.id, storeOptions)).rejects.toMatchObject({
        code: "CAPABILITY_DISABLED"
      });
      await expect(linkDnaMatchToCase(researchCase.id, match.id, {}, storeOptions)).rejects.toMatchObject({
        code: "CAPABILITY_DISABLED"
      });
      await expect(updatePersonCuration("p-amalia-bellandi", { published: true }, storeOptions)).rejects.toMatchObject({
        code: "CAPABILITY_DISABLED"
      });
      await expect(saveSourceDocument({
        title: "Forbidden binary",
        fileName: "record.pdf",
        storageKey: "uploads/record.pdf",
        mimeType: "application/pdf",
        size: 100
      }, storeOptions)).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });

      await expect(updatePersonCuration(
        "p-amalia-bellandi",
        { published: false, privacy: "sensitive" },
        storeOptions
      )).resolves.toMatchObject({ published: false, privacy: "sensitive" });
      await expect(saveSourceDocument({
        title: "Transcript-only source",
        transcript: "No binary content retained."
      }, storeOptions)).resolves.toMatchObject({ title: "Transcript-only source", fileName: undefined });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reads an explicitly provisioned Postgres demo archive", async () => {
    const workspace = await readWorkspace(storeOptions);

    expect(workspace.people.length).toBeGreaterThan(0);
    expect(workspace.cases.length).toBeGreaterThan(0);
    expect(workspace.archiveName).toBe("Hartwell–Mercer Family Archive");
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

  it("records an outcome when completing an existing case task", async () => {
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

    const result = await recordCaseTaskOutcome(
      createdCase.id,
      createdTask.task.id,
      {
        requestId: randomUUID(),
        expectedTaskUpdatedAt: createdTask.task.updatedAt!,
        outcome: "found",
        note: "The census entry named the expected household.",
        actorId: "test-researcher",
        actorName: "Test Researcher"
      },
      storeOptions
    );
    const workspace = await readWorkspace(storeOptions);

    expect(result.task).toMatchObject({
      id: "task-update-target",
      status: "done",
      outcomes: [
        expect.objectContaining({
          type: "found",
          note: "The census entry named the expected household."
        })
      ]
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
            contextRefs: ["case-mercer-march-identity"],
            confidence: 0.7
          }
        ],
        contextReferences: [
          {
            id: "case-mercer-march-identity",
            type: "case",
            label: "The Mercer-March identity"
          }
        ],
        linkedCaseId: "case-mercer-march-identity",
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
      linkedCaseId: "case-mercer-march-identity"
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
      surnames: ["Hartwell", "Mercer"],
      places: ["Lantern Bay"],
      sharedMatches: ["M. March"],
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
          surnames: ["Hartwell", "Bellandi"],
          places: ["Lantern Bay", "Ceraluna Alta"],
          sharedMatches: ["M. March", "A. Bellandi"],
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
        totalCm: 86,
        predictedRelationship: "likely 3C",
        side: "maternal",
        treeStatus: "partial",
        surnames: ["Hartwell", "Mercer"],
        places: ["Lantern Bay"],
        sharedMatches: ["A. Bellandi"],
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
        linkedPersonId: "p-nora-hartwell",
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
      linkedPersonId: "p-nora-hartwell",
      transcript: "Baptism entry transcript."
    });
  });

  it("keeps archives isolated when ids repeat across archives", async () => {
    // Regression: ids repeat across archives by design (GEDCOM xrefs, fixed
    // fixed fictional-demo ids such as p-nora-hartwell). With global primary keys the
    // second archive's seed failed with a duplicate-key error on people_pkey.
    const otherOptions = { ...storeOptions, archiveId: `test-${randomUUID()}` };

    try {
      await provisionTestArchive(otherOptions);
      const first = await readWorkspace(storeOptions);
      const second = await readWorkspace(otherOptions);

      expect(first.people.some((person) => person.id === "p-nora-hartwell")).toBe(true);
      expect(second.people.some((person) => person.id === "p-nora-hartwell")).toBe(true);

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
      expect(untouched.archiveName).toBe("Hartwell–Mercer Family Archive");
      expect(untouched.cases.some((item) => item.id === "case-isolated")).toBe(false);
      expect(untouched.people.some((person) => person.id === "p-nora-hartwell")).toBe(true);
    } finally {
      await query("DELETE FROM archives WHERE id = $1", [otherOptions.archiveId], { databaseUrl });
    }
  });

  it("updates person curation settings", async () => {
    const updated = await updatePersonCuration(
      "p-amalia-bellandi",
      {
        published: true,
        privacy: "public",
        livingStatus: "deceased"
      },
      storeOptions
    );
    const workspace = await readWorkspace(storeOptions);

    expect(updated).toMatchObject({
      id: "p-amalia-bellandi",
      published: true,
      privacy: "public",
      livingStatus: "deceased"
    });
    expect(workspace.people.find((person) => person.id === "p-amalia-bellandi")).toMatchObject({
      published: true,
      privacy: "public"
    });
  });
});
