import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabasePools, query } from "@/lib/db";
import { buildCaseLinkOptions, buildPersonLinkOptions, searchSourcesPage, type SourceSearchFilters } from "@/lib/source-search";
import { listCaseLinkOptions, listPersonLinkOptions, searchSourcesPageFromDb } from "@/lib/store/source-queries";
import { createCase, readWorkspace, saveSourceDocument, writeWorkspace, type WorkspaceData } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

let storeOptions: { databaseUrl: string; archiveId: string };

beforeEach(() => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-sq-${randomUUID()}` };
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = $1", [storeOptions.archiveId], { databaseUrl });
});

afterAll(async () => {
  await closeDatabasePools();
});

async function seededWorkspace(): Promise<WorkspaceData> {
  const workspace = await readWorkspace(storeOptions);
  const person = workspace.people[0];
  const researchCase = await createCase(
    { id: "case-sq-test", title: "Zajíčková line", question: "Where did the Kutná Hora branch settle?" },
    storeOptions
  );

  await saveSourceDocument(
    {
      id: "src-sq-linked-person",
      title: "Přehled parish register",
      sourceType: "Church record",
      repository: "Diocesan archive",
      linkedPersonId: person.id,
      transcript: "Baptismal entry — 100% legible, includes witness_names in the margin.",
      privacy: "public",
      confidence: 0.9
    },
    storeOptions
  );
  await saveSourceDocument(
    {
      id: "src-sq-linked-case",
      title: "Passenger manifest",
      sourceType: "Immigration record",
      linkedCaseId: researchCase.id,
      notes: "Departure port unclear; compare against the Bremen index.",
      privacy: "private",
      confidence: 0.55
    },
    storeOptions
  );
  await saveSourceDocument(
    {
      id: "src-sq-unlinked",
      title: "Unindexed newspaper clipping",
      sourceType: "Newspaper",
      privacy: "sensitive",
      confidence: 0.3
    },
    storeOptions
  );

  return readWorkspace(storeOptions);
}

describeIfDatabase("SQL source search", () => {
  it("matches the in-memory implementation across filters, queries, stats, and types", async () => {
    const workspace = await seededWorkspace();

    const scenarios: SourceSearchFilters[] = [
      {},
      { query: "prehled" },
      { query: "Přehled" },
      { query: "bremen index" },
      { query: "elizabeth" },
      { query: "zajickova line" },
      { query: "no-such-source" },
      { privacy: "sensitive" },
      { sourceType: "Church record" },
      { linkStatus: "linked" },
      { linkStatus: "unlinked" },
      { linkStatus: "person" },
      { linkStatus: "case" },
      { sort: "title" },
      { sort: "confidence" },
      { query: "record", linkStatus: "linked", sort: "title" }
    ];

    for (const filters of scenarios) {
      const expected = searchSourcesPage(workspace.sources, workspace.people, workspace.cases, filters, { page: 1, pageSize: 50 });
      const actual = await searchSourcesPageFromDb(filters, { page: 1, pageSize: 50 }, storeOptions);

      expect(actual.stats, JSON.stringify(filters)).toEqual(expected.stats);
      expect(actual.types, JSON.stringify(filters)).toEqual(expected.types);
      expect(actual.total, JSON.stringify(filters)).toBe(expected.total);
      expect(actual.items.map((item) => item.id), JSON.stringify(filters)).toEqual(expected.items.map((item) => item.id));
    }
  });

  it("resolves linked person names and case titles and bounds previews", async () => {
    const workspace = await seededWorkspace();
    const person = workspace.people[0];

    const result = await searchSourcesPageFromDb({ query: "manifest" }, { page: 1, pageSize: 10 }, storeOptions);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "src-sq-linked-case",
      linkedCaseId: "case-sq-test",
      linkedCaseTitle: "Zajíčková line",
      notesPreview: "Departure port unclear; compare against the Bremen index."
    });

    const personLinked = await searchSourcesPageFromDb({ query: "parish" }, { page: 1, pageSize: 10 }, storeOptions);
    expect(personLinked.items[0]).toMatchObject({
      id: "src-sq-linked-person",
      linkedPersonId: person.id,
      linkedPersonName: person.displayName
    });
    expect(personLinked.items[0].transcriptPreview).toContain("Baptismal entry");
  });

  it("searches by linked person name and linked case title", async () => {
    const workspace = await seededWorkspace();
    const firstName = workspace.people[0].displayName.split(" ")[0];

    const byPersonName = await searchSourcesPageFromDb({ query: firstName.toLowerCase() }, { page: 1, pageSize: 50 }, storeOptions);
    expect(byPersonName.items.map((item) => item.id)).toContain("src-sq-linked-person");

    const byCaseTitle = await searchSourcesPageFromDb({ query: "zajickova" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(byCaseTitle.items.map((item) => item.id)).toContain("src-sq-linked-case");
  });

  it("treats ILIKE wildcards as literals", async () => {
    await seededWorkspace();

    const percent = await searchSourcesPageFromDb({ query: "100%" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(percent.items.map((item) => item.id)).toEqual(["src-sq-linked-person"]);

    const underscore = await searchSourcesPageFromDb({ query: "witness_names" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(underscore.items.map((item) => item.id)).toEqual(["src-sq-linked-person"]);

    const noMatch = await searchSourcesPageFromDb({ query: "witness_names_x" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(noMatch.items).toHaveLength(0);
  });

  it("breaks title-sort ties by load order even when created_at disagrees", async () => {
    // writeWorkspace assigns sort_order by array index independent of each
    // source's createdAt, decorrelating the two — the case where a wrong
    // tie-break chain diverges from the stable in-memory sort.
    const workspace = await seededWorkspace();
    const tieTitle = "Zzz identical tie title";
    const decorrelated = {
      ...workspace,
      sources: [
        { ...workspace.sources[0], id: "src-tie-early-slot", title: tieTitle, createdAt: "2026-01-01T00:00:00.000Z" },
        { ...workspace.sources[0], id: "src-tie-late-slot", title: tieTitle, createdAt: "2026-06-01T00:00:00.000Z" },
        ...workspace.sources.slice(1)
      ]
    };
    await writeWorkspace(decorrelated, storeOptions);
    const reread = await readWorkspace(storeOptions);

    const expected = searchSourcesPage(reread.sources, reread.people, reread.cases, { sort: "title" }, { page: 1, pageSize: 50 });
    const actual = await searchSourcesPageFromDb({ sort: "title" }, { page: 1, pageSize: 50 }, storeOptions);

    expect(actual.items.map((item) => item.id)).toEqual(expected.items.map((item) => item.id));
    expect(actual.items.map((item) => item.id)).toContain("src-tie-early-slot");
  });

  it("clamps pagination like the in-memory implementation", async () => {
    const workspace = await seededWorkspace();

    const expected = searchSourcesPage(workspace.sources, workspace.people, workspace.cases, {}, { page: 99, pageSize: 2 });
    const actual = await searchSourcesPageFromDb({}, { page: 99, pageSize: 2 }, storeOptions);

    expect(actual.page).toBe(expected.page);
    expect(actual.items.map((item) => item.id)).toEqual(expected.items.map((item) => item.id));
    expect(actual.start).toBe(expected.start);
    expect(actual.end).toBe(expected.end);
  });
});

describeIfDatabase("source link options", () => {
  it("matches the in-memory person and case link options", async () => {
    const workspace = await seededWorkspace();

    const expectedPeople = buildPersonLinkOptions(workspace.people, workspace.sources);
    const actualPeople = await listPersonLinkOptions(storeOptions);
    expect(actualPeople).toEqual(expectedPeople);

    const expectedCases = buildCaseLinkOptions(workspace.cases);
    const actualCases = await listCaseLinkOptions(storeOptions);
    expect(actualCases).toEqual(expectedCases);
  });
});
