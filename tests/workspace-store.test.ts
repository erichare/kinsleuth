import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DnaMatch } from "@/lib/models";
import { createCase, deleteDnaMatch, linkDnaMatchToCase, readWorkspace, saveDnaMatch, saveDnaMatches, saveSourceDocument, updateDnaMatch, updatePersonCuration } from "@/lib/workspace-store";

let tempDir: string;
let storagePath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "kinsleuth-store-"));
  storagePath = path.join(tempDir, "workspace.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("workspace store", () => {
  it("seeds a workspace file when storage is empty", async () => {
    const workspace = await readWorkspace({ storagePath });
    const raw = JSON.parse(await readFile(storagePath, "utf8"));

    expect(workspace.people.length).toBeGreaterThan(0);
    expect(workspace.cases.length).toBeGreaterThan(0);
    expect(raw.archiveName).toBe("Riemer - Zajicek Archive");
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
      { storagePath }
    );
    const workspace = await readWorkspace({ storagePath });

    expect(created.id).toMatch(/^case-/);
    expect(workspace.cases[0]).toMatchObject({
      id: created.id,
      title: "Test case",
      privacy: "private"
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

    const result = await saveDnaMatch(match, { storagePath });
    const workspace = await readWorkspace({ storagePath });

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
      { storagePath }
    );
    const workspace = await readWorkspace({ storagePath });

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
      { storagePath }
    );

    const updated = await updateDnaMatch(
      "dna-update-delete",
      {
        side: "paternal",
        treeStatus: "private",
        triageStatus: "ignored",
        notes: "Not actionable without a visible tree."
      },
      { storagePath }
    );
    let workspace = await readWorkspace({ storagePath });

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

    await deleteDnaMatch("dna-update-delete", { storagePath });
    workspace = await readWorkspace({ storagePath });
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
      { storagePath }
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
      { storagePath }
    );

    const first = await linkDnaMatchToCase(
      createdCase.id,
      "dna-link-target",
      {
        title: "Evidence Match DNA",
        summary: "First evidence summary.",
        confidence: 0.81
      },
      { storagePath }
    );
    const second = await linkDnaMatchToCase(
      createdCase.id,
      "dna-link-target",
      {
        title: "Evidence Match DNA updated",
        summary: "Updated evidence summary.",
        confidence: 0.84
      },
      { storagePath }
    );
    const workspace = await readWorkspace({ storagePath });
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
      { storagePath }
    );
    const workspace = await readWorkspace({ storagePath });

    expect(source.id).toMatch(/^src-/);
    expect(workspace.sources[0]).toMatchObject({
      id: source.id,
      title: "Parish register scan",
      linkedPersonId: "p-elizabeth-riemer",
      transcript: "Baptism entry transcript."
    });
  });

  it("updates person curation settings", async () => {
    const updated = await updatePersonCuration(
      "p-mary-zajicek",
      {
        published: true,
        privacy: "public",
        livingStatus: "deceased"
      },
      { storagePath }
    );
    const workspace = await readWorkspace({ storagePath });

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
