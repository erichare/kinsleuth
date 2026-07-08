import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DnaMatch } from "@/lib/models";
import { createCase, readWorkspace, saveDnaMatch, saveSourceDocument } from "@/lib/workspace-store";

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
});
