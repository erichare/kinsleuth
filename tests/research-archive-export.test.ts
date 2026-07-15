import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { sanitizeWorkspace } from "@/lib/research-archive-export";
import { createDemoWorkspace } from "@/lib/workspace-store";

const source = readFileSync(
  path.join(process.cwd(), "lib", "research-archive-export.ts"),
  "utf8"
);

describe("research archive export", () => {
  it("removes storage locators and provider errors while retaining owner research", () => {
    const marker = "PRIVATE_STORAGE_KEY_OR_PROVIDER_ERROR";
    const workspace = createDemoWorkspace(new Date("2026-07-15T12:00:00.000Z"));
    workspace.sources[0]!.storageKey = marker;
    workspace.aiRuns.push({
      id: "run-private",
      question: "What should I investigate?",
      answer: "Review the cited evidence.",
      status: "provider_error",
      evidenceUsed: [],
      uncertainty: [],
      anomalyCount: 0,
      suggestions: [],
      contextReferences: [],
      error: marker,
      createdAt: "2026-07-15T12:00:00.000Z"
    });
    workspace.backups.push({
      id: "backup-private",
      createdAt: "2026-07-15T12:00:00.000Z",
      reason: "before import",
      storageKey: marker,
      peopleCount: 1,
      sourcesCount: 1,
      casesCount: 1,
      dnaMatchCount: 0,
      importCount: 0,
      rawRecordCount: 0
    });

    const sanitized = sanitizeWorkspace(workspace);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain("storageKey");
    expect(sanitized.people).toEqual(workspace.people);
    expect(sanitized.cases).toEqual(workspace.cases);
    expect(sanitized.sources[0]).toMatchObject({ title: workspace.sources[0]!.title });
    expect(sanitized.aiRuns.at(-1)).not.toHaveProperty("error");
  });

  it("reads every export relation from one repeatable-read snapshot and omits provider locators", () => {
    expect(source).toContain("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(source).toContain('await client.query("COMMIT")');
    expect(source).toContain('await client.query("ROLLBACK")');
    expect(source).not.toContain("remote_account_id");
    expect(source).not.toContain("remote_tree_id");
    expect(source).not.toContain("object_key AS");
    expect(source).not.toContain("storage_key AS");
  });
});
