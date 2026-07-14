import { describe, expect, it } from "vitest";
import type { PersonSummary } from "@/lib/models";
import { filterPeople, paginateItems, searchPeoplePage } from "@/lib/people-search";

const people: PersonSummary[] = [
  person({
    id: "p-nora-hartwell",
    displayName: "Nora Elise Hartwell",
    surname: "Hartwell",
    birthDate: "1889",
    birthPlace: "Lantern Bay, Wisconsin",
    privacy: "public",
    published: true,
    livingStatus: "deceased"
  }),
  person({
    id: "p-amalia-bellandi",
    displayName: "Amalia Rose Bellandi",
    surname: "Bellandi",
    birthDate: "1861",
    birthPlace: "Ceraluna Alta, Italy",
    privacy: "private",
    published: false,
    livingStatus: "unknown",
    notes: "Family story mentions Ceraluna Alta."
  }),
  person({
    id: "p-living",
    displayName: "Zara Hartwell",
    surname: "Hartwell",
    privacy: "sensitive",
    published: false,
    livingStatus: "living"
  })
];

describe("people search", () => {
  it("searches across names, places, dates, and notes", () => {
    expect(filterPeople(people, { query: "hartwell lantern" }).map((item) => item.id)).toEqual(["p-nora-hartwell"]);
    expect(filterPeople(people, { query: "ceraluna alta" }).map((item) => item.id)).toEqual(["p-amalia-bellandi"]);
  });

  it("filters publication, privacy, and living status", () => {
    expect(filterPeople(people, { publication: "published" }).map((item) => item.id)).toEqual(["p-nora-hartwell"]);
    expect(filterPeople(people, { privacy: "sensitive" }).map((item) => item.id)).toEqual(["p-living"]);
    expect(filterPeople(people, { livingStatus: "living" }).map((item) => item.id)).toEqual(["p-living"]);
  });

  it("paginates with clamped page bounds", () => {
    const result = paginateItems(people, { page: 3, pageSize: 2 });

    expect(result.page).toBe(2);
    expect(result.pageCount).toBe(2);
    expect(result.start).toBe(3);
    expect(result.end).toBe(3);
    expect(result.items).toHaveLength(1);
  });

  it("returns slim paged people rows and workspace stats", () => {
    const result = searchPeoplePage(people, { query: "hartwell", sort: "name" }, { page: 1, pageSize: 1 });

    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "p-nora-hartwell",
        factCount: 0
      })
    ]);
    expect(result.items[0]).not.toHaveProperty("facts");
    expect(result.stats).toEqual({
      total: 3,
      published: 1,
      protectedCount: 2,
      living: 1
    });
  });
});

function person(input: Partial<PersonSummary> & Pick<PersonSummary, "id" | "displayName">): PersonSummary {
  return {
    slug: input.id,
    givenName: "",
    surname: "",
    birthDate: "",
    birthPlace: "",
    deathDate: "",
    deathPlace: "",
    sex: "U",
    livingStatus: "unknown",
    privacy: "private",
    published: false,
    facts: [],
    relatives: [],
    ...input
  };
}
