import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DemoCaseResearchBrief } from "@/components/demo-case-research-brief";
import { demoCases } from "@/lib/demo-data";
import type { ResearchCase } from "@/lib/models";

const researchCase: ResearchCase = {
  id: "case-readonly-brief",
  title: "The changed-name register",
  question: "Did the same fictional person use both surnames?",
  status: "active",
  focus: "A bounded name-change mystery",
  privacy: "private",
  evidence: [
    {
      id: "evidence-register",
      title: "Fictional register",
      type: "Local register",
      summary: "Two names share one household entry.",
      confidence: 0.7
    }
  ],
  hypotheses: [
    {
      id: "hypothesis-same-person",
      statement: "The two names describe the same fictional person.",
      confidence: 0.64,
      status: "weakened",
      decisions: [
        {
          id: "decision-weakened",
          requestId: "request-weakened",
          fromStatus: "open",
          toStatus: "weakened",
          statement: "The two names describe the same fictional person.",
          reason: "A second household used the earlier surname in the same year.",
          contextRefs: [],
          actorId: "demo-researcher",
          actorName: "Demo Researcher",
          createdAt: "2026-06-02T09:30:00.000Z"
        }
      ]
    }
  ],
  tasks: [
    {
      id: "task-register-search",
      title: "Search both surname variants",
      status: "done",
      guidance: "Keep same-name households separate until dates and relatives align.",
      targetHypothesisId: "hypothesis-same-person",
      outcomes: [
        {
          id: "outcome-earlier",
          requestId: "request-earlier",
          type: "inconclusive",
          note: "Earlier result that should not be presented as the latest result.",
          actorId: "demo-researcher",
          actorName: "Demo Researcher",
          createdAt: "2026-06-02T10:00:00.000Z"
        },
        {
          id: "outcome-latest",
          requestId: "request-latest",
          type: "found",
          note: "The latest bounded search found both surnames beside the same fictional witness.",
          searchScope: {
            repository: "Fictional Harbor Archive",
            collection: "Household register",
            place: "Northstar Cove, Nova Scotia",
            dateRange: "1906–1908",
            query: "Mercer, March, and damaged M surname entries"
          },
          actorId: "demo-researcher",
          actorName: "Demo Researcher",
          createdAt: "2026-06-03T11:45:00.000Z"
        }
      ]
    }
  ]
};

describe("DemoCaseResearchBrief", () => {
  it("renders saved reasoning, guidance, and only the latest scoped result", () => {
    const html = renderToStaticMarkup(createElement(DemoCaseResearchBrief, { researchCase }));

    expect(html).toContain("Read-only research brief");
    expect(html).toContain("The two names describe the same fictional person.");
    expect(html).toContain("64% confidence");
    expect(html).toContain("Latest decision · open to weakened");
    expect(html).toContain("A second household used the earlier surname in the same year.");
    expect(html).toContain("Keep same-name households separate until dates and relatives align.");
    expect(html).toContain("Latest result · found");
    expect(html).toContain("The latest bounded search found both surnames beside the same fictional witness.");
    expect(html).not.toContain("Earlier result that should not be presented as the latest result.");
    expect(html).toContain("Fictional Harbor Archive");
    expect(html).toContain("Household register");
    expect(html).toContain("1906–1908");
    expect(html).not.toMatch(/<button|<form|<input|<select|<textarea/i);
  });

  it("preserves a rejected Lantern Bay sign candidate as an inconclusive result", () => {
    const harborCase = demoCases.find((candidate) => candidate.id === "case-harbor-photograph");
    const task = harborCase?.tasks.find((candidate) => candidate.id === "task-photo-lantern-signs");
    const outcome = task?.outcomes?.at(-1);

    expect(outcome).toMatchObject({ type: "inconclusive" });
    expect(outcome?.note).toContain("Harbor Star Outfitters");
    expect(outcome?.note).toContain("do not match");
    expect(task?.contextRefs).toContainEqual({
      type: "evidence",
      id: "ev-fictional-lantern-harbor-directory"
    });
  });
});
