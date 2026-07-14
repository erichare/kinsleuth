import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabasePools, query } from "@/lib/db";
import { searchDnaMatchesPage, type DnaMatchFilters } from "@/lib/dna-search";
import { createDnaHypothesesForMatches, listCaseOptions, searchDnaMatchesPageFromDb } from "@/lib/store/dna-queries";
import {
  createWorkspaceDnaHypotheses,
  readWorkspace,
  saveDnaMatch,
  saveDnaMatches,
  scoreWorkspaceDnaMatches,
  type WorkspaceData
} from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

let storeOptions: { databaseUrl: string; archiveId: string };

beforeEach(() => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-dq-${randomUUID()}` };
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = $1", [storeOptions.archiveId], { databaseUrl });
});

afterAll(async () => {
  await closeDatabasePools();
});

async function seededWorkspace(): Promise<WorkspaceData> {
  await readWorkspace(storeOptions);

  await saveDnaMatches(
    [
      {
        // Accented text, ILIKE wildcard characters in notes, and decimal cM
        // values whose SQL rendering ("86.00") must be trimmed to match the
        // JS haystack ("86").
        id: "dna-dq-bellandi",
        displayName: "Mira Bellàndi",
        totalCm: 86,
        longestSegmentCm: 12.7,
        sharedDnaPercent: 1.15,
        predictedRelationship: "likely 3C",
        side: "maternal",
        treeStatus: "partial",
        surnames: ["Bellàndi", "Hartwell"],
        places: ["Ceraluna Alta"],
        sharedMatches: ["M. March"],
        notes: "Tree is 73% legible; margin holds a harbor_marks column.",
        ancestryUrl: "https://www.ancestry.com/discoveryui-matches/example",
        triageStatus: "needs_review"
      },
      {
        // Empty text[] columns (array_length returns NULL), an unknown side,
        // and notes holding only a non-breaking space — JS trim() strips it,
        // so the notes bonus must not fire even though Postgres's ASCII-only
        // \s class considers NBSP a non-whitespace character.
        id: "dna-dq-bare",
        displayName: "Bare Match",
        totalCm: 62.35,
        side: "unknown",
        treeStatus: "unknown",
        surnames: [],
        places: [],
        sharedMatches: [],
        notes: "\u00A0",
        triageStatus: "ignored"
      },
      {
        // Scores exactly 75: the high/medium helpfulness bucket boundary.
        id: "dna-dq-boundary-high",
        displayName: "Boundary High",
        totalCm: 90,
        side: "paternal",
        treeStatus: "public",
        surnames: ["Alpha", "Beta", "Gamma", "Delta"],
        places: ["Ceraluna Alta", "Northstar Cove"],
        sharedMatches: ["S. One"],
        notes: "",
        triageStatus: "triaged"
      },
      {
        // Scores exactly 45: the medium/low helpfulness bucket boundary.
        id: "dna-dq-boundary-medium",
        displayName: "Boundary Medium",
        totalCm: 100,
        side: "unknown",
        treeStatus: "partial",
        surnames: [],
        places: ["Lantern Bay"],
        sharedMatches: [],
        notes: "Just one place.",
        triageStatus: "needs_review"
      }
    ],
    storeOptions
  );

  // Identical twins saved separately: the second save is prepended, so load
  // order (sort_order) disagrees with id order — the case where a wrong SQL
  // tie-break diverges from the stable in-memory sort.
  const twin = {
    displayName: "Zeta Tie Break Twin",
    totalCm: 120,
    side: "maternal" as const,
    treeStatus: "private" as const,
    surnames: [],
    places: [],
    sharedMatches: [],
    notes: "",
    triageStatus: "triaged" as const
  };
  await saveDnaMatch({ ...twin, id: "dna-tie-aaa" }, storeOptions);
  await saveDnaMatch({ ...twin, id: "dna-tie-zzz" }, storeOptions);

  return readWorkspace(storeOptions);
}

describeIfDatabase("SQL DNA match search", () => {
  it("matches the in-memory implementation across filters, queries, sorts, and stats", async () => {
    const workspace = await seededWorkspace();
    const scored = scoreWorkspaceDnaMatches(workspace);

    const scenarios: DnaMatchFilters[] = [
      {},
      { query: "bellandi" },
      { query: "Bellàndi" },
      { query: "86" },
      { query: "86.00" },
      { query: "12.7" },
      { query: "62.35" },
      { query: "ceraluna alta maternal" },
      { query: "ancestry.com" },
      { query: "no-such-match" },
      { status: "high_priority" },
      { status: "needs_review" },
      { side: "maternal" },
      { side: "unknown" },
      { treeStatus: "partial" },
      { helpfulness: "high" },
      { helpfulness: "medium" },
      { helpfulness: "low" },
      { sort: "cm" },
      { sort: "name" },
      { query: "a", sort: "cm" },
      { status: "needs_review", helpfulness: "medium", sort: "name" }
    ];

    for (const filters of scenarios) {
      const expected = searchDnaMatchesPage(scored, filters, { page: 1, pageSize: 50 });
      const actual = await searchDnaMatchesPageFromDb(filters, { page: 1, pageSize: 50 }, storeOptions);

      expect(actual.stats, JSON.stringify(filters)).toEqual(expected.stats);
      expect(actual.total, JSON.stringify(filters)).toBe(expected.total);
      expect(actual.pageCount, JSON.stringify(filters)).toBe(expected.pageCount);
      // Deep equality covers field mapping, ordering, and the SQL-computed
      // helpfulness score against lib/dna.ts scoreDnaMatch.
      expect(actual.items, JSON.stringify(filters)).toEqual(expected.items);
    }
  });

  it("scores the bucket boundaries exactly like scoreDnaMatch", async () => {
    const workspace = await seededWorkspace();
    const scoreById = new Map(scoreWorkspaceDnaMatches(workspace).map((match) => [match.id, match.helpfulnessScore]));
    expect(scoreById.get("dna-dq-boundary-high")).toBe(75);
    expect(scoreById.get("dna-dq-boundary-medium")).toBe(45);

    const high = await searchDnaMatchesPageFromDb({ helpfulness: "high" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(high.items.map((item) => item.id)).toContain("dna-dq-boundary-high");

    const medium = await searchDnaMatchesPageFromDb({ helpfulness: "medium" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(medium.items.map((item) => item.id)).toContain("dna-dq-boundary-medium");
    expect(medium.items.map((item) => item.id)).not.toContain("dna-dq-boundary-high");
  });

  it("treats ILIKE wildcards as literals", async () => {
    await seededWorkspace();

    const percent = await searchDnaMatchesPageFromDb({ query: "73%" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(percent.items.map((item) => item.id)).toEqual(["dna-dq-bellandi"]);

    const underscore = await searchDnaMatchesPageFromDb({ query: "harbor_marks" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(underscore.items.map((item) => item.id)).toEqual(["dna-dq-bellandi"]);

    const noMatch = await searchDnaMatchesPageFromDb({ query: "harbor_marks_x" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(noMatch.items).toHaveLength(0);
  });

  it("breaks ties by load order even when id order disagrees", async () => {
    const workspace = await seededWorkspace();
    const scored = scoreWorkspaceDnaMatches(workspace);

    for (const sort of ["helpfulness", "cm", "name"] as const) {
      const expected = searchDnaMatchesPage(scored, { sort }, { page: 1, pageSize: 50 });
      const actual = await searchDnaMatchesPageFromDb({ sort }, { page: 1, pageSize: 50 }, storeOptions);

      const ids = actual.items.map((item) => item.id);
      expect(ids, sort).toEqual(expected.items.map((item) => item.id));
      // dna-tie-zzz was saved last, so it is prepended ahead of dna-tie-aaa.
      expect(ids.indexOf("dna-tie-zzz"), sort).toBeLessThan(ids.indexOf("dna-tie-aaa"));
    }
  });

  it("clamps pagination like the in-memory implementation", async () => {
    const workspace = await seededWorkspace();
    const scored = scoreWorkspaceDnaMatches(workspace);

    const midPage = await searchDnaMatchesPageFromDb({}, { page: 2, pageSize: 3 }, storeOptions);
    const expectedMidPage = searchDnaMatchesPage(scored, {}, { page: 2, pageSize: 3 });
    expect(midPage.items).toEqual(expectedMidPage.items);
    expect(midPage.start).toBe(expectedMidPage.start);
    expect(midPage.end).toBe(expectedMidPage.end);

    const beyondEnd = await searchDnaMatchesPageFromDb({}, { page: 99, pageSize: 2 }, storeOptions);
    const expectedBeyondEnd = searchDnaMatchesPage(scored, {}, { page: 99, pageSize: 2 });
    expect(beyondEnd.page).toBe(expectedBeyondEnd.page);
    expect(beyondEnd.items).toEqual(expectedBeyondEnd.items);

    const oversized = await searchDnaMatchesPageFromDb({}, { page: 1, pageSize: 9_999 }, storeOptions);
    expect(oversized.pageSize).toBe(250);
  });
});

describeIfDatabase("DNA hypotheses and case options", () => {
  it("matches the in-memory hypotheses for a page of matches", async () => {
    const workspace = await seededWorkspace();

    const expected = createWorkspaceDnaHypotheses(workspace);
    const actual = await createDnaHypothesesForMatches(workspace.dnaMatches, storeOptions);

    expect(actual).toEqual(expected);
    await expect(createDnaHypothesesForMatches([], storeOptions)).resolves.toEqual([]);
  });

  it("lists case options in workspace order", async () => {
    const workspace = await seededWorkspace();

    const options = await listCaseOptions(storeOptions);

    expect(options).toEqual(workspace.cases.map(({ id, title }) => ({ id, title })));
    expect(options.length).toBeGreaterThan(0);
  });
});
