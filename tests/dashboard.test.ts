import { describe, expect, it } from "vitest";
import { buildDashboardSummary } from "@/lib/dashboard";
import { createSeedWorkspace } from "@/lib/workspace-store";

describe("dashboard summary", () => {
  it("derives dashboard metrics and bounded queues from workspace data", () => {
    const workspace = createSeedWorkspace(new Date("2026-07-08T12:00:00.000Z"));
    const summary = buildDashboardSummary(workspace, { caseLimit: 1, dnaLimit: 1, actionLimit: 2 });

    expect(summary.metrics.people).toBe(workspace.people.length);
    expect(summary.metrics.sourceDocuments).toBe(workspace.sources.length);
    expect(summary.metrics.dnaMatches).toBe(workspace.dnaMatches.length);
    expect(summary.caseRows).toHaveLength(1);
    expect(summary.dnaLeads).toHaveLength(1);
    expect(summary.dnaLeads[0].helpfulnessScore).toBeGreaterThan(0);
    expect(summary.actions.length).toBeLessThanOrEqual(2);
  });

  it("omits disabled DNA and publication work from the hosted summary", () => {
    const workspace = createSeedWorkspace(new Date("2026-07-08T12:00:00.000Z"));
    const summary = buildDashboardSummary(workspace, {
      dnaEnabled: false,
      publicPublishingEnabled: false
    });

    expect(summary.metrics.dnaMatches).toBe(0);
    expect(summary.metrics.triagedDnaMatches).toBe(0);
    expect(summary.metrics.highPriorityDnaMatches).toBe(0);
    expect(summary.dnaLeads).toEqual([]);
    expect(summary.actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "/app/dna" })
    ]));
    expect(summary.actions.some((action) => action.id.startsWith("publishing-"))).toBe(false);
  });
});
