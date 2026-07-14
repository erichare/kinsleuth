import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  caseEvidenceQueue,
  searchCasesPage,
  type CaseSearchFilters,
  type EvidenceQueueItem
} from "@/lib/case-search";
import { closeDatabasePools, query } from "@/lib/db";
import { caseEvidenceQueueFromDb, searchCasesPageFromDb } from "@/lib/store/case-queries";
import { createCase, readWorkspace, type WorkspaceData } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

let storeOptions: { databaseUrl: string; archiveId: string };

beforeEach(() => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-cq-${randomUUID()}` };
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

  await createCase(
    {
      id: "case-cq-dna",
      title: "Bellàndi Moonwake DNA cluster",
      question: "Which Hartwell branch does the 86 cM match connect through?",
      focus: "DNA + Northstar Cove cluster",
      status: "active",
      privacy: "private",
      hypotheses: [{ id: "hyp-cq-1", statement: "Connects through the maternal Mercer line", confidence: 0.45, status: "open" }],
      evidence: [
        {
          id: "ev-cq-dna",
          title: "Shared match cluster",
          type: "DNA",
          summary: "Cluster overlaps 73% with the Northstar Cove signal_keepers list.",
          confidence: 0.8,
          linkedDnaMatchId: "dna-cq-match"
        },
        { id: "ev-cq-weak", title: "Unsourced tree hint", type: "Tree", summary: "A member tree places her in Lantern Bay.", confidence: 0.3 }
      ],
      tasks: [
        { id: "task-cq-open", title: "Request segment data", status: "todo" },
        { id: "task-cq-done", title: "Chart the cluster centroid", status: "done" }
      ]
    },
    storeOptions
  );
  await createCase(
    {
      id: "case-cq-empty",
      title: "Ceraluna Alta parish gap",
      question: "Where are the missing 1850s registers?",
      status: "planning",
      privacy: "sensitive",
      tasks: [{ id: "task-cq-doing", title: "Email diocesan archive", status: "doing" }]
    },
    storeOptions
  );
  await createCase(
    {
      id: "case-cq-paused",
      title: "Broad Street boarding house",
      question: "Who ran the boarding house in 1926?",
      status: "paused",
      privacy: "public",
      evidence: [{ id: "ev-cq-mid", title: "Harbor roster row", type: "Roster", summary: "Lists a signal keeper with a matching surname.", confidence: 0.55 }]
    },
    storeOptions
  );
  await createCase(
    {
      id: "case-cq-resolved",
      title: "Album photograph identification",
      question: "Is the 1911 portrait Josie?",
      status: "resolved",
      privacy: "private",
      evidence: [{ id: "ev-cq-strong", title: "Studio mark", type: "Photo", summary: "The studio only operated 1908-1914.", confidence: 0.9 }]
    },
    storeOptions
  );

  return readWorkspace(storeOptions);
}

// createCase prepends, so the LATER creation gets the LOWER sort_order and
// leads the workspace load order — while ids sort the other way around. Any
// tie-break that falls back to id instead of load order diverges here.
async function seededTieWorkspace(): Promise<WorkspaceData> {
  const workspace = await seededWorkspace();

  await createCase(
    {
      id: "case-tie-a",
      title: "Identical tie title",
      question: "First created, later in load order",
      status: "active",
      evidence: [{ id: "ev-tie-solo", title: "Tie evidence A", type: "Note", summary: "Same confidence as the others.", confidence: 0.6 }]
    },
    storeOptions
  );
  await createCase(
    {
      id: "case-tie-z",
      title: "Identical tie title",
      question: "Second created, earlier in load order",
      status: "active",
      evidence: [
        { id: "ev-order-z", title: "Tie evidence Z first", type: "Note", summary: "Array order beats id order.", confidence: 0.6 },
        { id: "ev-order-a", title: "Tie evidence A second", type: "Note", summary: "Array order beats id order.", confidence: 0.6 }
      ]
    },
    storeOptions
  );

  expect(workspace).toBeDefined();
  return readWorkspace(storeOptions);
}

function toQueueProjection(item: EvidenceQueueItem) {
  return {
    id: item.id,
    caseId: item.caseId,
    caseTitle: item.caseTitle,
    title: item.title,
    type: item.type,
    summary: item.summary,
    confidence: item.confidence,
    linkedDnaMatchId: item.linkedDnaMatchId
  };
}

describeIfDatabase("SQL case search", () => {
  it("matches the in-memory implementation across filters, queries, sorts, and stats", async () => {
    const workspace = await seededWorkspace();

    const scenarios: CaseSearchFilters[] = [
      {},
      { query: "bellandi moonwake" },
      { query: "Bellàndi Moonwake" },
      { query: "ceraluna alta" },
      { query: "northstar cluster" },
      { query: "boarding 1926" },
      { query: "mercer" },
      { query: "segment" },
      { query: "dna-cq-match" },
      { query: "no-such-case-anywhere" },
      { status: "active" },
      { status: "paused" },
      { status: "resolved" },
      { privacy: "sensitive" },
      { evidence: "dna" },
      { evidence: "no_evidence" },
      { evidence: "low_confidence" },
      { sort: "title" },
      { sort: "evidence" },
      { query: "the", status: "active", sort: "evidence" },
      { evidence: "low_confidence", sort: "title" }
    ];

    for (const filters of scenarios) {
      const expected = searchCasesPage(workspace.cases, filters, { page: 1, pageSize: 50 });
      const actual = await searchCasesPageFromDb(filters, { page: 1, pageSize: 50 }, storeOptions);

      expect(actual.stats, JSON.stringify(filters)).toEqual(expected.stats);
      expect(actual.total, JSON.stringify(filters)).toBe(expected.total);
      expect(actual.pageCount, JSON.stringify(filters)).toBe(expected.pageCount);
      expect(actual.items, JSON.stringify(filters)).toEqual(expected.items);
    }
  });

  it("returns full list items including child counts and weakest confidence", async () => {
    await seededWorkspace();

    const result = await searchCasesPageFromDb({ query: "bellandi moonwake cluster" }, { page: 1, pageSize: 10 }, storeOptions);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: "case-cq-dna",
      title: "Bellàndi Moonwake DNA cluster",
      question: "Which Hartwell branch does the 86 cM match connect through?",
      status: "active",
      privacy: "private",
      focus: "DNA + Northstar Cove cluster",
      hypothesisCount: 1,
      evidenceCount: 2,
      dnaEvidenceCount: 1,
      taskCount: 2,
      openTaskCount: 1,
      weakestEvidenceConfidence: 0.3
    });

    const noEvidence = await searchCasesPageFromDb({ query: "missing 1850s registers" }, { page: 1, pageSize: 10 }, storeOptions);
    expect(noEvidence.items[0].weakestEvidenceConfidence).toBeUndefined();
  });

  it("treats ILIKE wildcards as literals", async () => {
    const workspace = await seededWorkspace();

    for (const searchQuery of ["73%", "signal_keepers", "signal_keepersx"]) {
      const expected = searchCasesPage(workspace.cases, { query: searchQuery }, { page: 1, pageSize: 50 });
      const actual = await searchCasesPageFromDb({ query: searchQuery }, { page: 1, pageSize: 50 }, storeOptions);
      expect(actual.items.map((item) => item.id), searchQuery).toEqual(expected.items.map((item) => item.id));
    }

    const percent = await searchCasesPageFromDb({ query: "73%" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(percent.items.map((item) => item.id)).toEqual(["case-cq-dna"]);

    const noMatch = await searchCasesPageFromDb({ query: "signalxkeepers" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(noMatch.items).toHaveLength(0);
  });

  it("breaks sort ties by load order even when id order disagrees", async () => {
    const workspace = await seededTieWorkspace();

    for (const sort of ["status", "title", "evidence"] as const) {
      const expected = searchCasesPage(workspace.cases, { sort }, { page: 1, pageSize: 50 });
      const actual = await searchCasesPageFromDb({ sort }, { page: 1, pageSize: 50 }, storeOptions);

      expect(actual.items.map((item) => item.id), sort).toEqual(expected.items.map((item) => item.id));
    }

    const byTitle = await searchCasesPageFromDb({ query: "identical tie" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(byTitle.items.map((item) => item.id)).toEqual(["case-tie-z", "case-tie-a"]);
  });

  it("clamps pagination like the in-memory implementation", async () => {
    const workspace = await seededWorkspace();

    const expected = searchCasesPage(workspace.cases, {}, { page: 99, pageSize: 2 });
    const actual = await searchCasesPageFromDb({}, { page: 99, pageSize: 2 }, storeOptions);

    expect(actual.page).toBe(expected.page);
    expect(actual.items).toEqual(expected.items);
    expect(actual.start).toBe(expected.start);
    expect(actual.end).toBe(expected.end);

    const oversized = await searchCasesPageFromDb({}, { page: 1, pageSize: 9_999 }, storeOptions);
    expect(oversized.pageSize).toBe(500);
  });
});

describeIfDatabase("SQL case evidence queue", () => {
  it("matches the in-memory queue order, fields, and limit", async () => {
    const workspace = await seededWorkspace();

    const expected = caseEvidenceQueue(workspace.cases, 50);
    const actual = await caseEvidenceQueueFromDb(storeOptions, 50);

    expect(actual.map(toQueueProjection)).toEqual(expected.map(toQueueProjection));
    expect(actual[0].linkedDnaMatchId).toBeDefined();

    const limited = await caseEvidenceQueueFromDb(storeOptions, 2);
    expect(limited.map((item) => item.id)).toEqual(expected.slice(0, 2).map((item) => item.id));
  });

  it("breaks confidence and case-title ties by flatten order, not id order", async () => {
    const workspace = await seededTieWorkspace();

    const expected = caseEvidenceQueue(workspace.cases, 50);
    const actual = await caseEvidenceQueueFromDb(storeOptions, 50);

    expect(actual.map(toQueueProjection)).toEqual(expected.map(toQueueProjection));

    // Same confidence, same (identical) case title: case-tie-z leads the load
    // order despite its id, and its evidence stays in array order.
    const tieIds = actual.filter((item) => item.confidence === 0.6).map((item) => item.id);
    expect(tieIds).toEqual(["ev-order-z", "ev-order-a", "ev-tie-solo"]);
  });
});
