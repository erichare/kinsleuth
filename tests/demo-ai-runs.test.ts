import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  createDemoAiRuns,
  demoAiRuns,
  isDemoSeededAnalysisRun,
  projectDemoSeededAnalysisRun
} from "@/lib/demo-ai-runs";
import { mapAIAnalysisRun } from "@/lib/store/mappers";
import { upsertAiRunRow } from "@/lib/store/rows";
import { createDemoWorkspace } from "@/lib/workspace-store";

describe("fictional demo seeded AI analyses", () => {
  it("seeds four deterministic, non-provider analyses across the highlighted mysteries", () => {
    const runs = createDemoAiRuns();
    const referencedPeople = runs.flatMap((run) =>
      run.contextReferences
        .filter((reference) => reference.type === "person")
        .map((reference) => reference.id)
    );

    expect(runs).toHaveLength(4);
    expect(new Set(referencedPeople)).toEqual(new Set([
      "p-samuel-mercer",
      "p-amalia-bellandi",
      "p-clara-mercer",
      "p-nora-hartwell"
    ]));
    expect(new Set(runs.map((run) => run.linkedCaseId))).toEqual(new Set([
      "case-mercer-march-identity",
      "case-bellandi-ceraluna-alta",
      "case-harbor-photograph",
      "case-blue-tin"
    ]));

    for (const run of runs) {
      expect(run.status).toBe("ready");
      expect(run.providerStatus).toBe("not_configured");
      expect(run.provider).toBeUndefined();
      expect(run.model).toBeUndefined();
      expect(run.evidenceUsed.length).toBeGreaterThanOrEqual(4);
      expect(run.uncertainty.length).toBeGreaterThanOrEqual(3);
      expect(run.contextReferences.some((reference) => reference.type === "evidence")).toBe(true);
      expect(run.createdAt).toBe(run.completedAt);
      expect(isDemoSeededAnalysisRun(run)).toBe(true);
    }
  });

  it("returns isolated copies and fails closed for an altered or arbitrary saved answer", () => {
    const first = createDemoAiRuns();
    const second = createDemoAiRuns();

    first[0]!.evidenceUsed.push("MUTATED_EVIDENCE");
    first[0]!.suggestions[0]!.contextRefs.push("MUTATED_CONTEXT");

    expect(second[0]!.evidenceUsed).not.toContain("MUTATED_EVIDENCE");
    expect(second[0]!.suggestions[0]!.contextRefs).not.toContain("MUTATED_CONTEXT");
    expect(demoAiRuns[0]!.evidenceUsed).not.toContain("MUTATED_EVIDENCE");
    expect(isDemoSeededAnalysisRun(first[0]!)).toBe(false);
    expect(isDemoSeededAnalysisRun({
      ...second[0]!,
      answer: "An arbitrary saved answer using a fixture ID."
    })).toBe(false);
    expect(isDemoSeededAnalysisRun({
      ...second[0]!,
      provider: "unexpected-provider"
    })).toBe(false);
  });

  it("includes fresh seeded analyses in each demo workspace", () => {
    const first = createDemoWorkspace(new Date("2026-07-18T12:00:00.000Z"));
    const second = createDemoWorkspace(new Date("2026-07-18T12:00:00.000Z"));

    expect(first.aiRuns.map((run) => run.id)).toEqual(demoAiRuns.map((run) => run.id));
    first.aiRuns[0]!.uncertainty.push("MUTATED_WORKSPACE");
    expect(second.aiRuns[0]!.uncertainty).not.toContain("MUTATED_WORKSPACE");
  });

  it("recognizes the row writer's local/local normalization and projects it back to clean fixture data", async () => {
    const run = createDemoAiRuns()[0]!;
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await upsertAiRunRow({ query } as unknown as PoolClient, "archive-demo", run, 0);
    const values = query.mock.calls[0]?.[1] as unknown[] | undefined;
    if (!values) throw new Error("AI row writer did not provide persistence values");

    const mapped = mapAIAnalysisRun({
      id: values[0],
      provider: values[2],
      model: values[3],
      question: values[4],
      answer: values[5],
      status: values[6],
      provider_status: values[7],
      evidence: values[8],
      uncertainty: values[9],
      suggestions: values[10],
      context_references: values[11],
      anomaly_count: values[13],
      linked_case_id: values[14],
      prompt_redacted: values[15],
      error: values[16],
      created_at: values[17],
      completed_at: values[18]
    });
    const projected = projectDemoSeededAnalysisRun(mapped);

    expect(mapped).toMatchObject({ provider: "local", model: "local" });
    expect(isDemoSeededAnalysisRun(mapped)).toBe(true);
    expect(projected).toEqual(run);
    expect(projected?.provider).toBeUndefined();
    expect(projected?.model).toBeUndefined();
  });
});
