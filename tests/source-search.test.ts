import { describe, expect, it } from "vitest";
import type { PersonSummary, ResearchCase, SourceDocument } from "@/lib/models";
import { buildPersonLinkOptions, filterSources, searchSourcesPage } from "@/lib/source-search";

const people: PersonSummary[] = [
  person({ id: "p-riemer", displayName: "Elizabeth Riemer", birthDate: "1884", birthPlace: "Chicago", published: true, privacy: "public" }),
  person({ id: "p-zajicek", displayName: "Anna Zajicek", birthPlace: "Bohemia" })
];

const cases: ResearchCase[] = [
  {
    id: "case-dna",
    title: "Fletcher DNA connection",
    question: "Where does Fletcher connect?",
    status: "active",
    focus: "DNA + Chicago",
    privacy: "private",
    hypotheses: [],
    evidence: [],
    tasks: []
  }
];

const sources: SourceDocument[] = [
  source({
    id: "src-birth",
    title: "Chicago birth register",
    sourceType: "Vital record",
    repository: "Cook County",
    linkedPersonId: "p-riemer",
    transcript: "Birth entry for Elizabeth Riemer in Chicago.",
    privacy: "public",
    confidence: 0.9
  }),
  source({
    id: "src-dna-note",
    title: "Fletcher shared match note",
    sourceType: "Research note",
    linkedCaseId: "case-dna",
    notes: "Shared matches point toward the maternal Riemer line.",
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
    expect(filterSources(sources, { query: "elizabeth chicago" }, lookup()).map((source) => source.id)).toEqual(["src-birth"]);
    expect(filterSources(sources, { query: "fletcher maternal" }, lookup()).map((source) => source.id)).toEqual(["src-dna-note"]);
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
    expect(result.items[0]).toEqual(expect.objectContaining({ linkedPersonName: "Elizabeth Riemer" }));
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
        id: "p-riemer",
        detail: "1884 · Chicago"
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
