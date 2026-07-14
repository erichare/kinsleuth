import { describe, expect, it } from "vitest";
import type { PersonSummary, ResearchCase, SourceDocument } from "@/lib/models";
import { buildPersonLinkOptions, filterSources, searchSourcesPage } from "@/lib/source-search";

const people: PersonSummary[] = [
  person({ id: "p-hartwell", displayName: "Nora Hartwell", birthDate: "1889", birthPlace: "Lantern Bay", published: true, privacy: "public" }),
  person({ id: "p-bellandi", displayName: "Amalia Bellandi", birthPlace: "Ceraluna Alta" })
];

const cases: ResearchCase[] = [
  {
    id: "case-dna",
    title: "Mercer DNA connection",
    question: "Where does Mercer connect?",
    status: "active",
    focus: "DNA + Lantern Bay",
    privacy: "private",
    hypotheses: [],
    evidence: [],
    tasks: []
  }
];

const sources: SourceDocument[] = [
  source({
    id: "src-birth",
    title: "Lantern Bay birth register",
    sourceType: "Vital record",
    repository: "Lantern Bay archive",
    linkedPersonId: "p-hartwell",
    transcript: "Birth entry for Nora Hartwell in Lantern Bay.",
    privacy: "public",
    confidence: 0.9
  }),
  source({
    id: "src-dna-note",
    title: "Mercer shared match note",
    sourceType: "Research note",
    linkedCaseId: "case-dna",
    notes: "Shared matches point toward the maternal Hartwell line.",
    confidence: 0.55
  }),
  source({
    id: "src-unlinked",
    title: "Unsorted obituary clipping",
    sourceType: "Newspaper",
    repository: "Unknown",
    confidence: 0.35,
    privacy: "sensitive"
  })
];

describe("source search", () => {
  it("searches source metadata, transcripts, notes, and linked names", () => {
    expect(filterSources(sources, { query: "nora lantern" }, lookup()).map((source) => source.id)).toEqual(["src-birth"]);
    expect(filterSources(sources, { query: "mercer maternal" }, lookup()).map((source) => source.id)).toEqual(["src-dna-note"]);
  });

  it("filters by privacy, type, and link status", () => {
    expect(filterSources(sources, { privacy: "sensitive" }, lookup()).map((source) => source.id)).toEqual(["src-unlinked"]);
    expect(filterSources(sources, { sourceType: "Vital record" }, lookup()).map((source) => source.id)).toEqual(["src-birth"]);
    expect(filterSources(sources, { linkStatus: "unlinked" }, lookup()).map((source) => source.id)).toEqual(["src-unlinked"]);
  });

  it("returns slim paged rows, source stats, and source type options", () => {
    const result = searchSourcesPage(sources, people, cases, { sort: "title" }, { page: 1, pageSize: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).not.toHaveProperty("transcript");
    expect(result.items[0]).toEqual(expect.objectContaining({ linkedPersonName: "Nora Hartwell" }));
    expect(result.stats).toEqual({
      total: 3,
      linked: 2,
      unlinked: 1,
      publicCount: 1,
      protectedCount: 2,
      transcripts: 1
    });
    expect(result.types).toEqual(["Newspaper", "Research note", "Vital record"]);
  });

  it("builds bounded person link options with linked and published people first", () => {
    expect(buildPersonLinkOptions(people, sources, 1)).toEqual([
      expect.objectContaining({
        id: "p-hartwell",
        detail: "1889 · Lantern Bay"
      })
    ]);
  });
});

function lookup() {
  return {
    peopleById: new Map(people.map((item) => [item.id, item.displayName])),
    casesById: new Map(cases.map((item) => [item.id, item.title]))
  };
}

function person(input: Partial<PersonSummary> & Pick<PersonSummary, "id" | "displayName">): PersonSummary {
  return {
    slug: input.id,
    givenName: "",
    surname: "",
    sex: "U",
    livingStatus: "unknown",
    privacy: "private",
    published: false,
    facts: [],
    relatives: [],
    ...input
  };
}

function source(input: Partial<SourceDocument> & Pick<SourceDocument, "id" | "title">): SourceDocument {
  return {
    sourceType: "Document",
    privacy: "private",
    confidence: 0.5,
    createdAt: "2026-07-08T12:00:00.000Z",
    ...input
  };
}
