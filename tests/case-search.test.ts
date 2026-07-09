import { describe, expect, it } from "vitest";
import type { ResearchCase } from "@/lib/models";
import { caseEvidenceQueue, filterCases, searchCasesPage } from "@/lib/case-search";

const cases: ResearchCase[] = [
  researchCase({
    id: "case-fletcher",
    title: "Fletcher DNA connection",
    question: "How does Fletcher connect to the Riemer line?",
    status: "active",
    focus: "DNA + Chicago",
    evidence: [
      {
        id: "ev-dna",
        title: "Fletcher shared cM",
        type: "DNA",
        summary: "238 cM with shared matches.",
        confidence: 0.72,
        linkedDnaMatchId: "dna-fletcher"
      }
    ]
  }),
  researchCase({
    id: "case-zajicek",
    title: "Zajicek birthplace",
    question: "Which Bohemian parish is correct?",
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
    expect(filterCases(cases, { query: "riemer chicago" }).map((item) => item.id)).toEqual(["case-fletcher"]);
    expect(filterCases(cases, { query: "dna-fletcher" }).map((item) => item.id)).toEqual(["case-fletcher"]);
  });

  it("filters by status, privacy, and evidence state", () => {
    expect(filterCases(cases, { status: "planning" }).map((item) => item.id)).toEqual(["case-zajicek"]);
    expect(filterCases(cases, { privacy: "sensitive" }).map((item) => item.id)).toEqual(["case-zajicek"]);
    expect(filterCases(cases, { evidence: "dna" }).map((item) => item.id)).toEqual(["case-fletcher"]);
    expect(filterCases(cases, { evidence: "no_evidence" }).map((item) => item.id)).toEqual(["case-empty"]);
    expect(filterCases(cases, { evidence: "low_confidence" }).map((item) => item.id)).toEqual(["case-zajicek"]);
  });

  it("returns paged slim rows and overall case stats", () => {
    const result = searchCasesPage(cases, { sort: "status" }, { page: 1, pageSize: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: "case-fletcher",
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
