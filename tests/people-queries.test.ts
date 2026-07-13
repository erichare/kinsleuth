import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabasePools, query } from "@/lib/db";
import { searchPeoplePage, type PeopleSearchFilters } from "@/lib/people-search";
import {
  getPublicPersonBySlug,
  listPublicPeople,
  readArchiveBranding,
  searchPeoplePageFromDb
} from "@/lib/store/people-queries";
import { applyGedcomImport, readWorkspace, updatePersonCuration } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

let storeOptions: { databaseUrl: string; archiveId: string };

beforeEach(() => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-pq-${randomUUID()}` };
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = $1", [storeOptions.archiveId], { databaseUrl });
});

afterAll(async () => {
  await closeDatabasePools();
});

const accentedGedcom = [
  "0 HEAD",
  "1 CHAR UTF-8",
  "0 @I1@ INDI",
  "1 NAME Ludmila /Zajíček/",
  "1 SEX F",
  "1 BIRT",
  "2 DATE 3 MAY 1861",
  "2 PLAC Kutná Hora, Bohemia",
  "1 DEAT",
  "2 DATE 1934",
  "1 NOTE Emigrated with 100% of her siblings_records intact.",
  "0 @I2@ INDI",
  "1 NAME Friedrich /Müller/",
  "1 SEX M",
  "1 BIRT",
  "2 DATE 12 APR 1884",
  "2 PLAC Hamburg, Germany",
  "1 OCCU Shipwright",
  "0 @I3@ INDI",
  "1 NAME Plain /Smith/",
  "1 BIRT",
  "2 DATE 1901",
  "0 TRLR"
].join("\n");

async function seededWorkspace() {
  await readWorkspace(storeOptions);
  await applyGedcomImport({ sourceName: "accented.ged", content: accentedGedcom }, storeOptions);
  await updatePersonCuration("@I1@", { published: true, privacy: "public", livingStatus: "deceased" }, storeOptions);
  await updatePersonCuration("@I2@", { privacy: "sensitive", livingStatus: "living" }, storeOptions);
  return readWorkspace(storeOptions);
}

describeIfDatabase("SQL people search", () => {
  it("matches the in-memory implementation across filters, queries, and stats", async () => {
    const workspace = await seededWorkspace();

    const scenarios: PeopleSearchFilters[] = [
      {},
      { query: "zajicek" },
      { query: "Zajíček" },
      { query: "kutna hora" },
      { query: "shipwright" },
      { query: "ludmila bohemia" },
      { query: "no-such-person-anywhere" },
      { publication: "published" },
      { publication: "unpublished" },
      { privacy: "sensitive" },
      { livingStatus: "living" },
      { query: "1884", livingStatus: "living" },
      { sort: "facts" }
    ];

    for (const filters of scenarios) {
      const expected = searchPeoplePage(workspace.people, filters, { page: 1, pageSize: 50 });
      const actual = await searchPeoplePageFromDb(filters, { page: 1, pageSize: 50 }, storeOptions);

      expect(actual.stats, JSON.stringify(filters)).toEqual(expected.stats);
      expect(actual.total, JSON.stringify(filters)).toBe(expected.total);
      expect(actual.pageCount, JSON.stringify(filters)).toBe(expected.pageCount);
      if ((filters.sort ?? "name") === "name" || (filters.sort ?? "name") === "facts") {
        expect(actual.items.map((item) => item.id), JSON.stringify(filters)).toEqual(expected.items.map((item) => item.id));
      } else {
        expect(new Set(actual.items.map((item) => item.id)), JSON.stringify(filters)).toEqual(
          new Set(expected.items.map((item) => item.id))
        );
      }
    }
  });

  it("returns full list items including fact counts", async () => {
    await seededWorkspace();

    const result = await searchPeoplePageFromDb({ query: "ludmila zajicek" }, { page: 1, pageSize: 10 }, storeOptions);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "@I1@",
      displayName: "Ludmila Zajíček",
      surname: "Zajíček",
      birthDate: "3 MAY 1861",
      birthPlace: "Kutná Hora, Bohemia",
      livingStatus: "deceased",
      privacy: "public",
      published: true,
      factCount: 2
    });
  });

  it("sorts by extracted year for birth and death sorts with missing dates last", async () => {
    await seededWorkspace();

    const result = await searchPeoplePageFromDb({ sort: "birth" }, { page: 1, pageSize: 100 }, storeOptions);
    const imported = result.items.filter((item) => item.id.startsWith("@I"));

    expect(imported.map((item) => item.id)).toEqual(["@I1@", "@I2@", "@I3@"]);
  });

  it("treats ILIKE wildcards in queries as literal text", async () => {
    await seededWorkspace();

    const percent = await searchPeoplePageFromDb({ query: "100%" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(percent.items.map((item) => item.id)).toEqual(["@I1@"]);

    const underscore = await searchPeoplePageFromDb({ query: "siblings_records" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(underscore.items.map((item) => item.id)).toEqual(["@I1@"]);

    const noMatch = await searchPeoplePageFromDb({ query: "s_blings" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(noMatch.items).toHaveLength(0);
  });

  it("clamps pagination like the in-memory implementation", async () => {
    const workspace = await seededWorkspace();

    const beyondEnd = await searchPeoplePageFromDb({}, { page: 99, pageSize: 2 }, storeOptions);
    const expected = searchPeoplePage(workspace.people, {}, { page: 99, pageSize: 2 });

    expect(beyondEnd.page).toBe(expected.page);
    expect(beyondEnd.items.map((item) => item.id)).toEqual(expected.items.map((item) => item.id));
    expect(beyondEnd.start).toBe(expected.start);
    expect(beyondEnd.end).toBe(expected.end);

    const oversized = await searchPeoplePageFromDb({}, { page: 1, pageSize: 9_999 }, storeOptions);
    expect(oversized.pageSize).toBe(500);
  });
});

describeIfDatabase("public people queries", () => {
  it("lists publishable people with facts for the public page", async () => {
    await seededWorkspace();

    const candidates = await listPublicPeople(storeOptions);

    // The demo seed also contains publishable people; the import adds @I1@.
    expect(candidates.map((person) => person.id)).toContain("@I1@");
    expect(candidates.map((person) => person.id)).not.toContain("@I2@");
    for (const person of candidates) {
      expect(person.published).toBe(true);
      expect(person.livingStatus).toBe("deceased");
      expect(person.privacy).toBe("public");
    }
    const ludmila = candidates.find((person) => person.id === "@I1@");
    expect(ludmila?.facts.length).toBeGreaterThan(0);
  });

  it("loads a published person by slug with published relatives only", async () => {
    const workspace = await seededWorkspace();
    const ludmila = workspace.people.find((person) => person.id === "@I1@");

    const loaded = await getPublicPersonBySlug(ludmila!.slug, storeOptions);

    expect(loaded?.person.id).toBe("@I1@");
    expect(loaded?.person.facts.length).toBeGreaterThan(0);
    expect(loaded?.publishedRelatives).toEqual([]);

    await expect(getPublicPersonBySlug("no-such-slug", storeOptions)).resolves.toBeUndefined();
  });

  it("reads archive branding without loading the workspace", async () => {
    await seededWorkspace();

    const branding = await readArchiveBranding(storeOptions);

    expect(branding).toEqual({ name: "Riemer - Zajicek Archive", tagline: "Family history. Openly shared." });
  });
});
