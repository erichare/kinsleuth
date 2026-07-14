import { describe, expect, it } from "vitest";
import type { ResearchCase } from "@/lib/models";
import { caseEvidenceQueue, filterCases, searchCasesPage } from "@/lib/case-search";

const cases: ResearchCase[] = [
  researchCase({
    id: "case-mercer",
    title: "Mercer DNA connection",
    question: "How does Mercer connect to the Hartwell line?",
    status: "active",
    focus: "DNA + Lantern Bay",
    evidence: [
      {
        id: "ev-dna",
        title: "Mercer shared cM",
        type: "DNA",
        summary: "86 cM with shared matches.",
        confidence: 0.72,
        linkedDnaMatchId: "dna-march"
      }
    ]
  }),
  researchCase({
    id: "case-bellandi",
    title: "Bellandi birthplace",
    question: "Which Ceraluna Alta parish is correct?",
    status: "planning",
    privacy: "sensitive",
    focus: "Parish records",
    evidence: [
      {
        id: "ev-parish",
        title: "Parish clue",
        type: "Source",
        summary: "Unverified parish note.",
        confidence: 0.35
      }
    ]
  }),
  researchCase({
    id: "case-empty",
    title: "Unstarted obituary case",
    question: "Which obituary belongs to this person?",
    status: "paused",
    focus: "Newspapers"
  })
];

describe("case search", () => {
  it("searches cases across questions, focus, evidence, and linked DNA ids", () => {
    expect(filterCases(cases, { query: "hartwell lantern" }).map((item) => item.id)).toEqual(["case-mercer"]);
    expect(filterCases(cases, { query: "dna-march" }).map((item) => item.id)).toEqual(["case-mercer"]);
  });

  it("searches the private research memory stored on assignments and hypotheses", () => {
    const memoryCase = researchCase({
      id: "case-memory",
      title: "Remembered searches",
      question: "What have we already tried?",
      hypotheses: [
        {
          id: "hyp-memory",
          statement: "The probate file names the missing parent.",
          confidence: 0.4,
          status: "weakened",
          decisions: [
            {
              id: "decision-memory",
              requestId: "request-decision-memory",
              fromStatus: "open",
              toStatus: "weakened",
              statement: "The probate file names the missing parent.",
              reason: "The Lantern Bay packet names a different household.",
              contextRefs: [],
              actorId: "user-memory",
              actorName: "Researcher",
              createdAt: "2026-07-13T20:00:00.000Z"
            }
          ],
          updatedAt: "2026-07-13T20:00:00.000Z"
        }
      ] as ResearchCase["hypotheses"],
      tasks: [
        {
          id: "task-memory",
          title: "Search probate packets",
          status: "done",
          origin: "manual",
          priority: "normal",
          workFingerprint: "search probate packets",
          guidance: "Check the guardianship index before browsing packets.",
          contextRefs: [],
          outcomes: [
            {
              id: "outcome-memory",
              requestId: "request-outcome-memory",
              type: "not_found",
              note: "Searched Lantern Bay probate packets from 1910 through 1924.",
              searchScope: { repository: "Lantern Bay archive", collection: "Probate packets", dateRange: "1910-1924" },
              actorId: "user-memory",
              actorName: "Researcher",
              createdAt: "2026-07-13T20:05:00.000Z"
            }
          ],
          createdAt: "2026-07-13T19:00:00.000Z",
          completedAt: "2026-07-13T20:05:00.000Z",
          updatedAt: "2026-07-13T20:05:00.000Z"
        }
      ] as ResearchCase["tasks"]
    });

    expect(filterCases([memoryCase], { query: "guardianship index" }).map((item) => item.id)).toEqual(["case-memory"]);
    expect(filterCases([memoryCase], { query: "1910 1924" }).map((item) => item.id)).toEqual(["case-memory"]);
    expect(filterCases([memoryCase], { query: "different household" }).map((item) => item.id)).toEqual(["case-memory"]);
  });

  it("filters by status, privacy, and evidence state", () => {
    expect(filterCases(cases, { status: "planning" }).map((item) => item.id)).toEqual(["case-bellandi"]);
    expect(filterCases(cases, { privacy: "sensitive" }).map((item) => item.id)).toEqual(["case-bellandi"]);
    expect(filterCases(cases, { evidence: "dna" }).map((item) => item.id)).toEqual(["case-mercer"]);
    expect(filterCases(cases, { evidence: "no_evidence" }).map((item) => item.id)).toEqual(["case-empty"]);
    expect(filterCases(cases, { evidence: "low_confidence" }).map((item) => item.id)).toEqual(["case-bellandi"]);
  });

  it("returns paged slim rows and overall case stats", () => {
    const result = searchCasesPage(cases, { sort: "status" }, { page: 1, pageSize: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: "case-mercer",
        evidenceCount: 1,
        dnaEvidenceCount: 1
      })
    );
    expect(result.stats).toEqual({
      total: 3,
      active: 1,
      planning: 1,
      resolved: 0,
      evidenceItems: 2,
      dnaEvidence: 1,
      lowConfidenceEvidence: 1
    });
  });

  it("prioritizes DNA-linked and low-confidence evidence in the review queue", () => {
    expect(caseEvidenceQueue(cases).map((item) => item.id)).toEqual(["ev-dna", "ev-parish"]);
  });
});

function researchCase(input: Partial<ResearchCase> & Pick<ResearchCase, "id" | "title" | "question">): ResearchCase {
  return {
    status: "active",
    focus: "",
    privacy: "private",
    hypotheses: [],
    evidence: [],
    tasks: [],
    ...input
  };
}
