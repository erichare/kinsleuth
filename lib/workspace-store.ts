import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction, type DatabaseOptions } from "./db";
import { createDnaConnectionHypothesis, scoreDnaMatch } from "./dna";
import { demoCases, demoDnaMatches, demoPeople } from "./demo-data";
import { prepareGedcomImport, type PreparedGedcomImport } from "./gedcom/apply";
import { buildFamilyRelationshipMap, parseGedcom } from "./gedcom/parser";
import {
  deleteDnaMatchRows,
  insertBackupRow,
  insertRawRecordRows,
  normalizeConfidence,
  prependCaseTaskSortOrder,
  prependSortOrder,
  prependSortOrderRange,
  pruneAiRunRows,
  pruneBackupRows,
  replaceCaseChildren,
  replacePersonFacts,
  updatePeopleRelatives,
  updatePersonCurationRow,
  updateTaskRow,
  upsertAiRunRow,
  upsertBackupRowPreservingSnapshot,
  upsertCaseRow,
  upsertDnaHypothesisRow,
  upsertDnaMatchRow,
  upsertEvidenceRow,
  upsertImportSnapshotRow,
  upsertPeopleRows,
  upsertSourceRows,
  upsertTaskRow
} from "./store/rows";
import type {
  AIAnalysisRun,
  AIAnalysisStatus,
  AIContextReference,
  AIStagedSuggestion,
  AppliedGedcomImport,
  DnaConnectionHypothesis,
  DnaMatch,
  PersonFact,
  PersonSummary,
  PrivacyLevel,
  RawGedcomRecord,
  ResearchCase,
  SourceDocument,
  WorkspaceBackup
} from "./models";

export type ScoredDnaMatch = DnaMatch & { helpfulnessScore: number };

export type WorkspaceData = {
  version: "0.17.0";
  archiveName: string;
  archiveTagline: string;
  people: PersonSummary[];
  cases: ResearchCase[];
  sources: SourceDocument[];
  dnaMatches: DnaMatch[];
  aiRuns: AIAnalysisRun[];
  imports: AppliedGedcomImport[];
  rawRecords: RawGedcomRecord[];
  backups: WorkspaceBackup[];
  updatedAt: string;
};

export type WorkspaceStoreOptions = DatabaseOptions & {
  archiveId?: string;
};

const defaultArchiveId = "archive-default";
// Full pre-import snapshots are large; retain only the most recent ones.
const retainedBackupCount = 10;
const retainedAiRunCount = 25;

export function getArchiveId(options: WorkspaceStoreOptions = {}): string {
  return options.archiveId ?? process.env.KINSLEUTH_ARCHIVE_ID ?? defaultArchiveId;
}

export function createSeedWorkspace(now = new Date()): WorkspaceData {
  return {
    version: "0.17.0",
    archiveName: "Riemer - Zajicek Archive",
    archiveTagline: "Family history. Openly shared.",
    people: demoPeople,
    cases: demoCases,
    sources: [
      {
        id: "src-synthetic-chicago-birth",
        title: "Synthetic Chicago birth register",
        sourceType: "Vital record",
        repository: "Synthetic Cook County archive",
        citationDate: "12 Apr 1884",
        linkedPersonId: "p-elizabeth-riemer",
        transcript: "Synthetic extract documenting Elizabeth Katherine Riemer's birth in Chicago.",
        notes: "Seed source used for beta workflow demonstration.",
        privacy: "public",
        confidence: 0.92,
        createdAt: now.toISOString()
      }
    ],
    dnaMatches: demoDnaMatches,
    aiRuns: [],
    imports: [],
    rawRecords: [],
    backups: [],
    updatedAt: now.toISOString()
  };
}

export async function readWorkspace(options: WorkspaceStoreOptions = {}): Promise<WorkspaceData> {
  const archiveId = getArchiveId(options);

  return withTransaction(options, async (client) => {
    const archive = await client.query<{ id: string }>("SELECT id FROM archives WHERE id = $1", [archiveId]);
    if (archive.rowCount === 0) {
      if (await claimAndSeedArchive(client, archiveId)) {
        return loadWorkspace(client, archiveId);
      }
      // Another transaction is seeding; wait for its commit, then read it.
      await client.query("SELECT id FROM archives WHERE id = $1 FOR SHARE", [archiveId]);
    }

    return loadWorkspace(client, archiveId);
  });
}

// Guarantees the archive exists (seeding the demo workspace on first touch)
// without loading it. Scoped SQL readers use this instead of readWorkspace so
// first-visit behavior stays identical while hot paths skip the full load.
export async function ensureWorkspaceSeeded(options: WorkspaceStoreOptions = {}): Promise<void> {
  const archiveId = getArchiveId(options);

  await withTransaction(options, async (client) => {
    const archive = await client.query<{ id: string }>("SELECT id FROM archives WHERE id = $1", [archiveId]);
    if (archive.rowCount === 0 && !(await claimAndSeedArchive(client, archiveId))) {
      // Another transaction is seeding; wait for its commit before returning.
      await client.query("SELECT id FROM archives WHERE id = $1 FOR SHARE", [archiveId]);
    }
  });
}

export async function writeWorkspace(workspace: WorkspaceData, options: WorkspaceStoreOptions = {}): Promise<WorkspaceData> {
  const archiveId = getArchiveId(options);
  const next = normalizeWorkspaceData({
    ...workspace,
    updatedAt: new Date().toISOString()
  });

  await withTransaction(options, async (client) => {
    await persistWorkspace(client, archiveId, next);
  });

  return next;
}

// Runs a row-level mutation inside ONE transaction. The UPDATE on the archive
// row both takes the lock that serializes concurrent mutations (the same
// guarantee the old SELECT ... FOR UPDATE gave the whole-workspace writer) and
// bumps the workspace timestamp. A missing archive is seeded first, preserving
// first-touch demo seeding.
async function withArchiveMutation<T>(
  options: WorkspaceStoreOptions,
  action: (client: PoolClient, archiveId: string) => Promise<T>
): Promise<T> {
  const archiveId = getArchiveId(options);

  return withTransaction(options, async (client) => {
    const locked = await client.query("UPDATE archives SET updated_at = now() WHERE id = $1 RETURNING id", [archiveId]);
    if (locked.rowCount === 0) {
      const seeded = await claimAndSeedArchive(client, archiveId);
      if (!seeded) {
        // Another transaction is seeding this archive right now; block on its
        // row lock so we mutate the seeded workspace instead of racing it.
        await client.query("UPDATE archives SET updated_at = now() WHERE id = $1", [archiveId]);
      }
    }
    return action(client, archiveId);
  });
}

// An UPDATE on a missing row takes no lock, so two first-touch mutations could
// both decide to seed and the later one would wipe the earlier one's committed
// write. Claiming the id with an insert makes exactly one transaction the
// seeder; everyone else serializes on the claimed row.
async function claimAndSeedArchive(client: PoolClient, archiveId: string): Promise<boolean> {
  const claimed = await client.query(
    "INSERT INTO archives (id, name, tagline, slug, updated_at) VALUES ($1, '', '', $1, now()) ON CONFLICT (id) DO NOTHING RETURNING id",
    [archiveId]
  );
  if (claimed.rowCount === 0) {
    return false;
  }
  await persistWorkspace(client, archiveId, createSeedWorkspace());
  return true;
}

async function loadCaseData(client: PoolClient, archiveId: string, caseId: string): Promise<ResearchCase | undefined> {
  const caseResult = await client.query("SELECT * FROM research_cases WHERE archive_id = $1 AND id = $2", [archiveId, caseId]);
  const row = caseResult.rows[0];
  if (!row) {
    return undefined;
  }

  const [hypothesesResult, evidenceResult, tasksResult] = [
    await client.query("SELECT * FROM hypotheses WHERE archive_id = $1 AND case_id = $2 ORDER BY sort_order ASC, id ASC", [archiveId, caseId]),
    await client.query("SELECT * FROM evidence_items WHERE archive_id = $1 AND case_id = $2 ORDER BY sort_order ASC, id ASC", [archiveId, caseId]),
    await client.query("SELECT * FROM tasks WHERE archive_id = $1 AND case_id = $2 ORDER BY sort_order ASC, id ASC", [archiveId, caseId])
  ];

  return {
    id: row.id,
    title: row.title,
    question: row.question,
    status: row.status,
    focus: row.focus ?? "",
    privacy: row.privacy,
    hypotheses: hypothesesResult.rows.map(mapHypothesis).map(({ caseId: _caseId, ...hypothesis }) => hypothesis),
    evidence: evidenceResult.rows.map(mapEvidence).map(({ caseId: _caseId, ...evidence }) => evidence),
    tasks: tasksResult.rows.map(mapTask).map(({ caseId: _caseId, ...task }) => task)
  };
}

// DNA hypothesis generation only reads surname/place/name columns, so the
// facts arrays stay empty here instead of loading every person_facts row.
async function loadPeopleForHypotheses(client: PoolClient, archiveId: string): Promise<PersonSummary[]> {
  const result = await client.query("SELECT * FROM people WHERE archive_id = $1 ORDER BY sort_order ASC, display_name ASC", [archiveId]);
  return result.rows.map((row) => mapPersonRow(row, []));
}

async function loadPersonWithFacts(client: PoolClient, archiveId: string, personId: string): Promise<PersonSummary | undefined> {
  const personResult = await client.query("SELECT * FROM people WHERE archive_id = $1 AND id = $2", [archiveId, personId]);
  const row = personResult.rows[0];
  if (!row) {
    return undefined;
  }

  const factsResult = await client.query(
    "SELECT * FROM person_facts WHERE archive_id = $1 AND person_id = $2 ORDER BY sort_order ASC, id ASC",
    [archiveId, personId]
  );
  return mapPersonRow(row, factsResult.rows.map(mapPersonFact).map(({ personId: _personId, ...fact }) => fact));
}

async function loadDnaMatchById(client: PoolClient, archiveId: string, matchId: string): Promise<DnaMatch | undefined> {
  const result = await client.query("SELECT * FROM dna_matches WHERE archive_id = $1 AND id = $2", [archiveId, matchId]);
  return result.rows[0] ? mapDnaMatch(result.rows[0]) : undefined;
}

export type ArchiveBranding = {
  name: string;
  tagline: string;
};

export async function updateArchiveBranding(input: ArchiveBranding, options: WorkspaceStoreOptions = {}): Promise<ArchiveBranding> {
  const archiveId = getArchiveId(options);
  const name = input.name.trim();
  const tagline = input.tagline.trim();

  if (!name) {
    throw new Error("archive name is required");
  }

  return withTransaction(options, async (client) => {
    const existing = await client.query<{ id: string }>("SELECT id FROM archives WHERE id = $1 FOR UPDATE", [archiveId]);

    if (existing.rowCount === 0) {
      const seed = createSeedWorkspace();
      await persistWorkspace(client, archiveId, { ...seed, archiveName: name, archiveTagline: tagline });
      return { name, tagline };
    }

    await client.query("UPDATE archives SET name = $2, tagline = $3, updated_at = now() WHERE id = $1", [archiveId, name, tagline]);
    return { name, tagline };
  });
}

export async function createCase(input: Partial<ResearchCase>, options: WorkspaceStoreOptions = {}): Promise<ResearchCase> {
  if (!input.title?.trim() || !input.question?.trim()) {
    throw new Error("title and question are required");
  }

  const created: ResearchCase = {
    id: input.id ?? `case-${randomUUID()}`,
    title: input.title.trim(),
    question: input.question.trim(),
    status: input.status ?? "active",
    privacy: input.privacy ?? "private",
    focus: input.focus ?? "",
    hypotheses: (input.hypotheses ?? []).map((hypothesis) => ({
      id: hypothesis.id ?? `hyp-${randomUUID()}`,
      statement: hypothesis.statement,
      confidence: hypothesis.confidence,
      status: hypothesis.status
    })),
    evidence: (input.evidence ?? []).map((evidence) => ({
      id: evidence.id ?? `ev-${randomUUID()}`,
      title: evidence.title,
      type: evidence.type,
      summary: evidence.summary,
      confidence: evidence.confidence,
      linkedPersonId: evidence.linkedPersonId,
      linkedDnaMatchId: evidence.linkedDnaMatchId
    })),
    tasks: input.tasks ?? []
  };

  return withArchiveMutation(options, async (client, archiveId) => {
    const sortOrder = await prependSortOrder(client, "research_cases", archiveId);
    await upsertCaseRow(client, archiveId, created, sortOrder);
    await replaceCaseChildren(client, archiveId, created);
    return created;
  });
}

export async function addCaseTask(
  caseId: string,
  input: { id?: string; title?: string; status?: ResearchCase["tasks"][number]["status"] },
  options: WorkspaceStoreOptions = {}
): Promise<{ case: ResearchCase; task: ResearchCase["tasks"][number] }> {
  if (!input.title?.trim()) {
    throw new Error("task title is required");
  }

  const task: ResearchCase["tasks"][number] = {
    id: input.id ?? `task-${randomUUID()}`,
    title: input.title.trim(),
    status: input.status ?? "todo"
  };

  return withArchiveMutation(options, async (client, archiveId) => {
    const researchCase = await loadCaseData(client, archiveId, caseId);
    if (!researchCase) {
      throw new Error("case not found");
    }

    const sortOrder = await prependCaseTaskSortOrder(client, archiveId, caseId);
    await upsertTaskRow(client, archiveId, caseId, task, sortOrder);

    const updatedCase: ResearchCase = {
      ...researchCase,
      tasks: [task, ...researchCase.tasks.filter((item) => item.id !== task.id)]
    };
    return { case: updatedCase, task };
  });
}

export async function updateCaseTask(
  caseId: string,
  taskId: string,
  input: { title?: string; status?: ResearchCase["tasks"][number]["status"] },
  options: WorkspaceStoreOptions = {}
): Promise<{ case: ResearchCase; task: ResearchCase["tasks"][number] }> {
  return withArchiveMutation(options, async (client, archiveId) => {
    const researchCase = await loadCaseData(client, archiveId, caseId);
    if (!researchCase) {
      throw new Error("case not found");
    }

    const currentTask = researchCase.tasks.find((task) => task.id === taskId);
    if (!currentTask) {
      throw new Error("task not found");
    }

    const task: ResearchCase["tasks"][number] = {
      ...currentTask,
      title: input.title?.trim() || currentTask.title,
      status: input.status ?? currentTask.status
    };
    await updateTaskRow(client, archiveId, caseId, task);

    const updatedCase: ResearchCase = {
      ...researchCase,
      tasks: researchCase.tasks.map((item) => (item.id === taskId ? task : item))
    };
    return { case: updatedCase, task };
  });
}

export async function saveAIAnalysisRun(
  input: Omit<AIAnalysisRun, "id" | "createdAt"> & Partial<Pick<AIAnalysisRun, "id" | "createdAt" | "completedAt">>,
  options: WorkspaceStoreOptions = {}
): Promise<AIAnalysisRun> {
  if (!input.question.trim()) {
    throw new Error("analysis question is required");
  }

  const run: AIAnalysisRun = normalizeAIAnalysisRun({
    ...input,
    id: input.id ?? `ai-${randomUUID()}`,
    question: input.question.trim(),
    evidenceUsed: input.evidenceUsed ?? [],
    uncertainty: input.uncertainty ?? [],
    suggestions: input.suggestions ?? [],
    contextReferences: input.contextReferences ?? [],
    createdAt: input.createdAt ?? new Date().toISOString(),
    completedAt: input.completedAt ?? new Date().toISOString()
  });

  return withArchiveMutation(options, async (client, archiveId) => {
    const sortOrder = await prependSortOrder(client, "ai_runs", archiveId);
    await upsertAiRunRow(client, archiveId, run, sortOrder);
    await pruneAiRunRows(client, archiveId, retainedAiRunCount);
    return run;
  });
}

export async function saveDnaMatch(match: DnaMatch, options: WorkspaceStoreOptions = {}): Promise<{
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
}> {
  const normalized = normalizeDnaMatch(match);
  const helpfulnessScore = scoreDnaMatch(normalized);
  const triaged = autoPrioritizeDnaMatch(normalized, helpfulnessScore);

  return withArchiveMutation(options, async (client, archiveId) => {
    const people = await loadPeopleForHypotheses(client, archiveId);
    const sortOrder = await prependSortOrder(client, "dna_matches", archiveId);
    await upsertDnaMatchRow(client, archiveId, triaged, sortOrder);
    const hypothesis = createDnaConnectionHypothesis(triaged, people);
    await upsertDnaHypothesisRow(client, archiveId, triaged.id, hypothesis);

    return {
      helpfulnessScore,
      hypothesis,
      match: { ...triaged, helpfulnessScore }
    };
  });
}

export async function saveDnaMatches(matches: DnaMatch[], options: WorkspaceStoreOptions = {}): Promise<Array<{
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
}>> {
  return withArchiveMutation(options, async (client, archiveId) => {
    const people = await loadPeopleForHypotheses(client, archiveId);
    const results = matches.map((match) => {
      const normalized = normalizeDnaMatch(match);
      const helpfulnessScore = scoreDnaMatch(normalized);
      const triaged = autoPrioritizeDnaMatch(normalized, helpfulnessScore);

      return {
        helpfulnessScore,
        hypothesis: createDnaConnectionHypothesis(triaged, people),
        match: { ...triaged, helpfulnessScore }
      };
    });

    const startSortOrder = await prependSortOrderRange(client, "dna_matches", archiveId, results.length);
    for (const [index, result] of results.entries()) {
      await upsertDnaMatchRow(client, archiveId, removeDnaScore(result.match), startSortOrder + index);
      await upsertDnaHypothesisRow(client, archiveId, result.match.id, result.hypothesis);
    }

    return results;
  });
}

export async function updateDnaMatch(matchId: string, input: Partial<DnaMatch>, options: WorkspaceStoreOptions = {}): Promise<{
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
}> {
  return withArchiveMutation(options, async (client, archiveId) => {
    const current = await loadDnaMatchById(client, archiveId, matchId);
    if (!current) {
      throw new Error("DNA match not found");
    }

    const updated = normalizeDnaMatch({
      ...current,
      ...input,
      id: current.id,
      displayName: input.displayName ?? current.displayName,
      totalCm: input.totalCm ?? current.totalCm
    });
    const helpfulnessScore = scoreDnaMatch(updated);

    // No sort order: an in-place edit keeps the match's position in the queue.
    await upsertDnaMatchRow(client, archiveId, updated);
    const people = await loadPeopleForHypotheses(client, archiveId);
    const hypothesis = createDnaConnectionHypothesis(updated, people);
    await upsertDnaHypothesisRow(client, archiveId, updated.id, hypothesis);

    return {
      helpfulnessScore,
      hypothesis,
      match: { ...updated, helpfulnessScore }
    };
  });
}

export async function deleteDnaMatch(matchId: string, options: WorkspaceStoreOptions = {}): Promise<{ deleted: string }> {
  return withArchiveMutation(options, async (client, archiveId) => {
    const deleted = await deleteDnaMatchRows(client, archiveId, matchId);
    if (deleted === 0) {
      throw new Error("DNA match not found");
    }
    return { deleted: matchId };
  });
}

export async function linkDnaMatchToCase(
  caseId: string,
  matchId: string,
  input: { title?: string; summary?: string; confidence?: number } = {},
  options: WorkspaceStoreOptions = {}
): Promise<{
  case: ResearchCase;
  evidence: ResearchCase["evidence"][number];
  match: ScoredDnaMatch;
  created: boolean;
}> {
  return withArchiveMutation(options, async (client, archiveId) => {
    const researchCase = await loadCaseData(client, archiveId, caseId);
    if (!researchCase) {
      throw new Error("Case not found");
    }

    const match = await loadDnaMatchById(client, archiveId, matchId);
    if (!match) {
      throw new Error("DNA match not found");
    }

    const helpfulnessScore = scoreDnaMatch(match);
    const existingEvidence = researchCase.evidence.find((item) => item.linkedDnaMatchId === matchId);
    const evidence: ResearchCase["evidence"][number] = {
      id: existingEvidence?.id ?? `ev-dna-${match.id.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${randomUUID().slice(0, 8)}`,
      title: input.title?.trim() || `${match.displayName} DNA match`,
      type: "DNA",
      summary: input.summary?.trim() || createDnaEvidenceSummary(match, helpfulnessScore),
      confidence: normalizeConfidence(input.confidence ?? Math.max(0.25, Math.min(0.95, helpfulnessScore / 100))),
      linkedDnaMatchId: match.id
    };

    // On conflict the writer keeps the row's existing sort_order, so the
    // prepend value only applies when the evidence is genuinely new.
    const sortOrder = existingEvidence ? 0 : await prependEvidenceSortOrder(client, archiveId, caseId);
    await upsertEvidenceRow(client, archiveId, caseId, evidence, sortOrder);

    const updatedCase: ResearchCase = {
      ...researchCase,
      evidence: existingEvidence
        ? researchCase.evidence.map((item) => (item.id === existingEvidence.id ? evidence : item))
        : [evidence, ...researchCase.evidence]
    };

    return {
      case: updatedCase,
      evidence,
      match: { ...match, helpfulnessScore },
      created: !existingEvidence
    };
  });
}

async function prependEvidenceSortOrder(client: PoolClient, archiveId: string, caseId: string): Promise<number> {
  const result = await client.query<{ next: number }>(
    "SELECT COALESCE(MIN(sort_order), 0) - 1 AS next FROM evidence_items WHERE archive_id = $1 AND case_id = $2",
    [archiveId, caseId]
  );
  return result.rows[0].next;
}

export async function saveSourceDocument(input: Partial<SourceDocument>, options: WorkspaceStoreOptions = {}): Promise<SourceDocument> {
  if (!input.title?.trim()) {
    throw new Error("title is required");
  }

  const created: SourceDocument = {
    id: input.id ?? `src-${randomUUID()}`,
    title: input.title.trim(),
    sourceType: input.sourceType?.trim() || "Document",
    importId: input.importId,
    rawRecordId: input.rawRecordId,
    fileName: input.fileName,
    storageKey: input.storageKey,
    mimeType: input.mimeType,
    size: input.size,
    repository: input.repository,
    url: input.url,
    ancestryApid: input.ancestryApid,
    citationDate: input.citationDate,
    linkedPersonId: input.linkedPersonId,
    linkedCaseId: input.linkedCaseId,
    transcript: input.transcript,
    notes: input.notes,
    privacy: input.privacy ?? "private",
    confidence: input.confidence ?? 0.5,
    createdAt: input.createdAt ?? new Date().toISOString()
  };

  return withArchiveMutation(options, async (client, archiveId) => {
    const sortOrder = await prependSortOrder(client, "sources", archiveId);
    await upsertSourceRows(client, archiveId, [created], sortOrder);
    return created;
  });
}

export async function updatePersonCuration(
  personId: string,
  input: { published?: boolean; privacy?: PrivacyLevel; livingStatus?: PersonSummary["livingStatus"] },
  options: WorkspaceStoreOptions = {}
): Promise<PersonSummary> {
  return withArchiveMutation(options, async (client, archiveId) => {
    const person = await loadPersonWithFacts(client, archiveId, personId);
    if (!person) {
      throw new Error("person not found");
    }

    const updated: PersonSummary = {
      ...person,
      published: input.published ?? person.published,
      privacy: input.privacy ?? person.privacy,
      livingStatus: input.livingStatus ?? person.livingStatus
    };
    await updatePersonCurationRow(client, archiveId, personId, {
      published: updated.published,
      privacy: updated.privacy,
      livingStatus: updated.livingStatus
    });

    return updated;
  });
}

export async function applyGedcomImport(
  input: { sourceName: string; content: string },
  options: WorkspaceStoreOptions = {}
): Promise<{
  import: AppliedGedcomImport;
  backup: WorkspaceBackup;
  peopleImported: number;
  sourcesImported: number;
  rawRecordCount: number;
}> {
  if (!input.sourceName?.trim() || !input.content?.trim()) {
    throw new Error("sourceName and content are required");
  }

  return applyPreparedGedcomImport(prepareGedcomImport(input.sourceName.trim(), input.content), options);
}

export async function applyPreparedGedcomImport(
  prepared: PreparedGedcomImport,
  options: WorkspaceStoreOptions = {}
): Promise<{
  import: AppliedGedcomImport;
  backup: WorkspaceBackup;
  peopleImported: number;
  sourcesImported: number;
  rawRecordCount: number;
}> {
  return withArchiveMutation(options, async (client, archiveId) => {
    // The full pre-import workspace is still loaded once here: it becomes the
    // restorable backup snapshot. The writes below stay scoped to the tables
    // the import actually touches — cases, DNA matches, and AI runs are not
    // rewritten anymore.
    const workspace = await loadWorkspace(client, archiveId);
    const backup = createWorkspaceBackup(workspace, `Before applying ${prepared.snapshot.sourceName}`);
    const appliedImport: AppliedGedcomImport = {
      ...prepared.appliedImport,
      backupId: backup.id
    };

    // mergeImportedPeople returns the merged imports first, then untouched
    // existing people; only the imported slice needs to be written.
    const mergedPeople = mergeImportedPeople(workspace.people, prepared.people);
    const mergedImported = mergedPeople.slice(0, prepared.people.length);
    const peopleStart = await prependSortOrderRange(client, "people", archiveId, mergedImported.length);
    await upsertPeopleRows(client, archiveId, mergedImported, peopleStart);
    await replacePersonFacts(client, archiveId, mergedImported);

    const sourcesStart = await prependSortOrderRange(client, "sources", archiveId, prepared.sources.length);
    await upsertSourceRows(client, archiveId, prepared.sources, sourcesStart);

    // Re-importing a file replaces exactly that import's raw records.
    const rawStart = await prependSortOrderRange(client, "raw_records", archiveId, prepared.rawRecords.length);
    await client.query("DELETE FROM raw_records WHERE archive_id = $1 AND import_id = $2", [archiveId, prepared.snapshot.id]);
    await insertRawRecordRows(client, archiveId, prepared.rawRecords, rawStart);

    const importSort = await prependSortOrder(client, "import_snapshots", archiveId);
    await upsertImportSnapshotRow(client, archiveId, appliedImport, importSort);

    const backupSort = await prependSortOrder(client, "workspace_backups", archiveId);
    await insertBackupRow(client, archiveId, backup, JSON.stringify(workspace), backupSort);
    await pruneBackupRows(client, archiveId, retainedBackupCount);

    // The people list changed, so the derived per-match hypotheses are stale.
    for (const match of workspace.dnaMatches) {
      await upsertDnaHypothesisRow(client, archiveId, match.id, createDnaConnectionHypothesis(match, mergedPeople));
    }

    return {
      import: appliedImport,
      backup,
      peopleImported: prepared.people.length,
      sourcesImported: prepared.sources.length,
      rawRecordCount: prepared.rawRecords.length
    };
  });
}

export type GedcomRelationshipRepairResult = {
  rawRecordCount: number;
  importedPeopleChecked: number;
  updatedPeople: number;
  relationshipCount: number;
};

export async function repairGedcomRelationshipLinks(options: WorkspaceStoreOptions = {}): Promise<GedcomRelationshipRepairResult> {
  const archiveId = getArchiveId(options);

  return withTransaction(options, async (client) => {
    // Lock the archive row so the read-transform-write below cannot interleave
    // with another repair and clobber a concurrent workspace write.
    const archive = await client.query<{ id: string }>("SELECT id FROM archives WHERE id = $1 FOR UPDATE", [archiveId]);
    if (archive.rowCount === 0) {
      return { rawRecordCount: 0, importedPeopleChecked: 0, updatedPeople: 0, relationshipCount: 0 };
    }

    const workspace = await loadWorkspace(client, archiveId);
    const { workspace: repairedWorkspace, result } = repairGedcomRelationshipLinksInWorkspace(workspace);

    if (result.updatedPeople > 0) {
      // repairGedcomRelationshipLinksInWorkspace returns the same object
      // reference for people it did not change, so reference inequality
      // identifies exactly the rows that need their relatives rewritten.
      const changed = repairedWorkspace.people.filter((person, index) => person !== workspace.people[index]);
      await updatePeopleRelatives(
        client,
        archiveId,
        changed.map((person) => ({ id: person.id, relatives: person.relatives }))
      );
      await client.query("UPDATE archives SET updated_at = now() WHERE id = $1", [archiveId]);
    }

    return result;
  });
}

export function repairGedcomRelationshipLinksInWorkspace(workspace: WorkspaceData): { workspace: WorkspaceData; result: GedcomRelationshipRepairResult } {
  const gedcomRecords = workspace.rawRecords.filter((record) => record.type === "INDI" || record.type === "FAM");
  if (gedcomRecords.length === 0) {
    return {
      workspace,
      result: {
        rawRecordCount: 0,
        importedPeopleChecked: 0,
        updatedPeople: 0,
        relationshipCount: 0
      }
    };
  }

  const relativesByPersonId = buildRepairedRelativesByPersonId(workspace, gedcomRecords);
  const linkPairs = new Set<string>();
  let updatedPeople = 0;

  const people = workspace.people.map((person) => {
    const relatives = relativesByPersonId.get(person.id);
    if (!relatives) {
      return person;
    }

    for (const relativeId of relatives) {
      linkPairs.add(person.id < relativeId ? `${person.id}|${relativeId}` : `${relativeId}|${person.id}`);
    }

    if (sameStringArray(person.relatives, relatives)) {
      return person;
    }

    updatedPeople += 1;
    return {
      ...person,
      relatives
    };
  });

  return {
    workspace: {
      ...workspace,
      people
    },
    result: {
      rawRecordCount: gedcomRecords.length,
      importedPeopleChecked: relativesByPersonId.size,
      updatedPeople,
      relationshipCount: linkPairs.size
    }
  };
}

function buildRepairedRelativesByPersonId(workspace: WorkspaceData, gedcomRecords: RawGedcomRecord[]): Map<string, string[]> {
  // GEDCOM xrefs are only unique within a single file, so each import must be
  // parsed in isolation. Imports are replayed oldest-first so the newest import
  // containing a person's xref owns their relationships, matching the
  // last-write-wins merge that applyGedcomImport uses for people.
  const appliedAtByImportId = new Map(workspace.imports.map((item) => [item.id, item.appliedAt]));
  const recordsByImportId = groupBy(gedcomRecords, (record) => record.importId);
  const orderedImportIds = Array.from(recordsByImportId.keys()).sort((left, right) =>
    (appliedAtByImportId.get(left) ?? "").localeCompare(appliedAtByImportId.get(right) ?? "")
  );

  const relativesByPersonId = new Map<string, string[]>();
  for (const importId of orderedImportIds) {
    const records = recordsByImportId.get(importId) ?? [];
    const parsed = parseGedcom(records.map((record) => record.raw).join("\n"));
    const relationshipMap = buildFamilyRelationshipMap(parsed.records);

    for (const record of parsed.records) {
      if (record.type === "INDI" && record.xref) {
        relativesByPersonId.set(record.xref, relationshipMap.get(record.xref) ?? []);
      }
    }
  }

  return relativesByPersonId;
}

export function scoreWorkspaceDnaMatches(workspace: Pick<WorkspaceData, "dnaMatches">): ScoredDnaMatch[] {
  return workspace.dnaMatches.map((match) => ({
    ...match,
    helpfulnessScore: scoreDnaMatch(match)
  }));
}

export function createWorkspaceDnaHypotheses(workspace: Pick<WorkspaceData, "people" | "dnaMatches">): DnaConnectionHypothesis[] {
  return workspace.dnaMatches.map((match) => createDnaConnectionHypothesis(match, workspace.people));
}

async function loadWorkspace(client: PoolClient, archiveId: string): Promise<WorkspaceData> {
  const archiveResult = await client.query<{ name: string; tagline: string; updated_at: Date }>("SELECT name, tagline, updated_at FROM archives WHERE id = $1", [archiveId]);
  const archive = archiveResult.rows[0];
  if (!archive) {
    throw new Error("archive not found");
  }

  const peopleResult = await client.query("SELECT * FROM people WHERE archive_id = $1 ORDER BY sort_order ASC, display_name ASC", [archiveId]);
  const factsResult = await client.query("SELECT * FROM person_facts WHERE archive_id = $1 ORDER BY sort_order ASC, id ASC", [archiveId]);
  const casesResult = await client.query("SELECT * FROM research_cases WHERE archive_id = $1 ORDER BY sort_order ASC, title ASC", [archiveId]);
  const hypothesesResult = await client.query("SELECT * FROM hypotheses WHERE archive_id = $1 ORDER BY sort_order ASC, id ASC", [archiveId]);
  const evidenceResult = await client.query("SELECT * FROM evidence_items WHERE archive_id = $1 ORDER BY sort_order ASC, id ASC", [archiveId]);
  const tasksResult = await client.query("SELECT * FROM tasks WHERE archive_id = $1 ORDER BY sort_order ASC, id ASC", [archiveId]);
  const sourcesResult = await client.query("SELECT * FROM sources WHERE archive_id = $1 ORDER BY sort_order ASC, created_at DESC, title ASC", [archiveId]);
  const dnaMatchesResult = await client.query("SELECT * FROM dna_matches WHERE archive_id = $1 ORDER BY sort_order ASC, display_name ASC", [archiveId]);
  const aiRunsResult = await client.query("SELECT * FROM ai_runs WHERE archive_id = $1 ORDER BY sort_order ASC, created_at DESC", [archiveId]);
  const importsResult = await client.query("SELECT * FROM import_snapshots WHERE archive_id = $1 ORDER BY sort_order ASC, applied_at DESC", [archiveId]);
  const rawRecordsResult = await client.query("SELECT * FROM raw_records WHERE archive_id = $1 ORDER BY sort_order ASC, id ASC", [archiveId]);
  const backupsResult = await client.query("SELECT * FROM workspace_backups WHERE archive_id = $1 ORDER BY sort_order ASC, created_at DESC", [archiveId]);

  const factsByPerson = groupBy(factsResult.rows.map(mapPersonFact), (fact) => fact.personId);
  const hypothesesByCase = groupBy(hypothesesResult.rows.map(mapHypothesis), (hypothesis) => hypothesis.caseId);
  const evidenceByCase = groupBy(evidenceResult.rows.map(mapEvidence), (evidence) => evidence.caseId);
  const tasksByCase = groupBy(tasksResult.rows.map(mapTask), (task) => task.caseId);

  return normalizeWorkspaceData({
    archiveName: archive.name,
    archiveTagline: archive.tagline,
    people: peopleResult.rows.map((row) =>
      mapPersonRow(
        row,
        (factsByPerson.get(row.id) ?? []).map(({ personId: _personId, ...fact }) => {
          void _personId;
          return fact;
        })
      )
    ),
    cases: casesResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      question: row.question,
      status: row.status,
      focus: row.focus ?? "",
      privacy: row.privacy,
      hypotheses: (hypothesesByCase.get(row.id) ?? []).map(({ caseId: _caseId, ...hypothesis }) => {
        void _caseId;
        return hypothesis;
      }),
      evidence: (evidenceByCase.get(row.id) ?? []).map(({ caseId: _caseId, ...evidence }) => {
        void _caseId;
        return evidence;
      }),
      tasks: (tasksByCase.get(row.id) ?? []).map(({ caseId: _caseId, ...task }) => {
        void _caseId;
        return task;
      })
    })),
    sources: sourcesResult.rows.map(mapSourceDocument),
    dnaMatches: dnaMatchesResult.rows.map(mapDnaMatch),
    aiRuns: aiRunsResult.rows.map(mapAIAnalysisRun),
    imports: importsResult.rows.map(mapAppliedImport),
    rawRecords: rawRecordsResult.rows.map(mapRawRecord),
    backups: backupsResult.rows.map(mapWorkspaceBackup),
    updatedAt: archive.updated_at.toISOString()
  });
}

async function persistWorkspace(client: PoolClient, archiveId: string, workspace: WorkspaceData): Promise<void> {
  const normalized = normalizeWorkspaceData(workspace);

  await client.query(
    `INSERT INTO archives (id, name, tagline, slug, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tagline = EXCLUDED.tagline, updated_at = EXCLUDED.updated_at`,
    [archiveId, normalized.archiveName, normalized.archiveTagline, slugifyArchive(`${normalized.archiveName}-${archiveId}`), normalized.updatedAt]
  );

  await client.query("DELETE FROM ai_runs WHERE archive_id = $1", [archiveId]);
  await client.query("DELETE FROM dna_hypotheses WHERE archive_id = $1", [archiveId]);
  await client.query("DELETE FROM dna_matches WHERE archive_id = $1", [archiveId]);
  await client.query("DELETE FROM tasks WHERE archive_id = $1", [archiveId]);
  await client.query("DELETE FROM evidence_items WHERE archive_id = $1", [archiveId]);
  await client.query("DELETE FROM hypotheses WHERE archive_id = $1", [archiveId]);
  await client.query("DELETE FROM research_cases WHERE archive_id = $1", [archiveId]);
  await client.query("DELETE FROM sources WHERE archive_id = $1", [archiveId]);
  await client.query("DELETE FROM raw_records WHERE archive_id = $1", [archiveId]);
  await client.query("DELETE FROM import_snapshots WHERE archive_id = $1", [archiveId]);
  // Backups are upserted (not wholesale rewritten) so the snapshot column,
  // written once at backup time, survives full-workspace persists.
  await client.query("DELETE FROM workspace_backups WHERE archive_id = $1 AND NOT (id = ANY($2))", [
    archiveId,
    normalized.backups.map((backup) => backup.id)
  ]);
  await client.query("DELETE FROM person_facts WHERE archive_id = $1", [archiveId]);
  await client.query("DELETE FROM people WHERE archive_id = $1", [archiveId]);

  await upsertPeopleRows(client, archiveId, normalized.people, 0);
  await replacePersonFacts(client, archiveId, normalized.people);
  await upsertSourceRows(client, archiveId, normalized.sources, 0);

  for (const [index, researchCase] of normalized.cases.entries()) {
    await upsertCaseRow(client, archiveId, researchCase, index);
    await replaceCaseChildren(client, archiveId, researchCase);
  }

  for (const [index, match] of normalized.dnaMatches.entries()) {
    await upsertDnaMatchRow(client, archiveId, match, index);
    await upsertDnaHypothesisRow(client, archiveId, match.id, createDnaConnectionHypothesis(match, normalized.people));
  }

  for (const [index, run] of normalized.aiRuns.entries()) {
    await upsertAiRunRow(client, archiveId, run, index);
  }

  for (const [index, item] of normalized.imports.entries()) {
    await upsertImportSnapshotRow(client, archiveId, item, index);
  }

  await insertRawRecordRows(client, archiveId, normalized.rawRecords, 0);

  for (const [index, backup] of normalized.backups.entries()) {
    await upsertBackupRowPreservingSnapshot(client, archiveId, backup, index);
  }
}

function mapPersonRow(row: Record<string, unknown>, facts: PersonFact[]): PersonSummary {
  const person = row as {
    id: string;
    slug: string;
    display_name: string;
    given_name: string | null;
    surname: string | null;
    sex: PersonSummary["sex"] | null;
    birth_date: string | null;
    birth_place: string | null;
    death_date: string | null;
    death_place: string | null;
    living_status: PersonSummary["livingStatus"];
    privacy: PrivacyLevel;
    published: boolean;
    relatives: string[] | null;
    notes: string | null;
  };

  return {
    id: person.id,
    slug: person.slug,
    displayName: person.display_name,
    givenName: person.given_name ?? undefined,
    surname: person.surname ?? undefined,
    birthDate: person.birth_date ?? undefined,
    birthPlace: person.birth_place ?? undefined,
    deathDate: person.death_date ?? undefined,
    deathPlace: person.death_place ?? undefined,
    sex: person.sex ?? undefined,
    livingStatus: person.living_status,
    privacy: person.privacy,
    published: person.published,
    facts,
    relatives: person.relatives ?? [],
    notes: person.notes ?? undefined
  };
}

function mapPersonFact(row: Record<string, unknown>): PersonFact & { personId: string } {
  return {
    personId: String(row.person_id),
    id: String(row.id),
    type: String(row.fact_type),
    date: optionalString(row.date_text),
    place: optionalString(row.place_text),
    value: optionalString(row.value_text),
    source: optionalString(row.source_text),
    confidence: Number(row.confidence ?? 0.5),
    privacy: row.privacy ? (String(row.privacy) as PrivacyLevel) : undefined
  };
}

function mapHypothesis(row: Record<string, unknown>): ResearchCase["hypotheses"][number] & { caseId: string } {
  return {
    caseId: String(row.case_id),
    id: String(row.id),
    statement: String(row.statement),
    confidence: Number(row.confidence ?? 0.5),
    status: row.status as ResearchCase["hypotheses"][number]["status"]
  };
}

function mapEvidence(row: Record<string, unknown>): ResearchCase["evidence"][number] & { caseId: string } {
  return {
    caseId: String(row.case_id),
    id: String(row.id),
    title: String(row.title),
    type: String(row.evidence_type),
    summary: String(row.summary),
    confidence: Number(row.confidence ?? 0.5),
    linkedPersonId: optionalString(row.linked_person_id),
    linkedDnaMatchId: optionalString(row.linked_dna_match_id)
  };
}

function mapTask(row: Record<string, unknown>): ResearchCase["tasks"][number] & { caseId: string } {
  return {
    caseId: String(row.case_id),
    id: String(row.id),
    title: String(row.title),
    status: row.status as ResearchCase["tasks"][number]["status"]
  };
}

function mapSourceDocument(row: Record<string, unknown>): SourceDocument {
  return {
    id: String(row.id),
    title: String(row.title),
    sourceType: String(row.source_type),
    importId: optionalString(row.import_id),
    rawRecordId: optionalString(row.raw_record_id),
    fileName: optionalString(row.file_name),
    storageKey: optionalString(row.storage_key),
    mimeType: optionalString(row.mime_type),
    size: row.size_bytes === null || row.size_bytes === undefined ? undefined : Number(row.size_bytes),
    repository: optionalString(row.repository),
    url: optionalString(row.url),
    ancestryApid: optionalString(row.ancestry_apid),
    citationDate: optionalString(row.citation_date),
    linkedPersonId: optionalString(row.linked_person_id),
    linkedCaseId: optionalString(row.linked_case_id),
    transcript: optionalString(row.transcript),
    notes: optionalString(row.notes),
    privacy: row.privacy as PrivacyLevel,
    confidence: Number(row.confidence ?? 0.5),
    createdAt: toIsoString(row.created_at)
  };
}

function mapDnaMatch(row: Record<string, unknown>): DnaMatch {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    totalCm: Number(row.total_cm),
    longestSegmentCm: row.longest_segment_cm === null || row.longest_segment_cm === undefined ? undefined : Number(row.longest_segment_cm),
    sharedDnaPercent: row.shared_dna_percent === null || row.shared_dna_percent === undefined ? undefined : Number(row.shared_dna_percent),
    predictedRelationship: optionalString(row.predicted_relationship),
    side: row.side as DnaMatch["side"],
    treeStatus: row.tree_status as DnaMatch["treeStatus"],
    surnames: toStringArray(row.surnames),
    places: toStringArray(row.places),
    sharedMatches: toStringArray(row.shared_matches),
    notes: String(row.notes ?? ""),
    ancestryUrl: optionalString(row.ancestry_url),
    triageStatus: row.triage_status as DnaMatch["triageStatus"]
  };
}

function mapAIAnalysisRun(row: Record<string, unknown>): AIAnalysisRun {
  const status = row.status as AIAnalysisStatus;
  return normalizeAIAnalysisRun({
    id: String(row.id),
    question: String(row.question),
    answer: String(row.answer),
    status,
    evidenceUsed: toJsonArray<string>(row.evidence),
    uncertainty: toJsonArray<string>(row.uncertainty),
    anomalyCount: Number(row.anomaly_count ?? 0),
    suggestions: toJsonArray<AIStagedSuggestion>(row.suggestions),
    contextReferences: toJsonArray<AIContextReference>(row.context_references),
    provider: optionalString(row.provider),
    model: optionalString(row.model),
    providerStatus: row.provider_status as AIAnalysisRun["providerStatus"],
    promptPreview: optionalString(row.prompt_redacted),
    error: optionalString(row.error),
    linkedCaseId: optionalString(row.linked_case_id),
    createdAt: toIsoString(row.created_at),
    completedAt: row.completed_at ? toIsoString(row.completed_at) : undefined
  });
}

function mapAppliedImport(row: Record<string, unknown>): AppliedGedcomImport {
  return {
    id: String(row.id),
    sourceName: String(row.source_name),
    checksum: String(row.checksum),
    appliedAt: toIsoString(row.applied_at),
    summary: row.summary as AppliedGedcomImport["summary"],
    recordCount: Number(row.record_count ?? 0),
    peopleImported: Number(row.people_imported ?? 0),
    sourcesImported: Number(row.sources_imported ?? 0),
    rawRecordCount: Number(row.raw_record_count ?? 0),
    backupId: String(row.backup_id ?? "")
  };
}

function mapRawRecord(row: Record<string, unknown>): RawGedcomRecord {
  return {
    id: String(row.id),
    importId: String(row.import_id),
    xref: optionalString(row.xref),
    type: String(row.record_type),
    checksum: String(row.checksum),
    raw: String(row.raw_text)
  };
}

function mapWorkspaceBackup(row: Record<string, unknown>): WorkspaceBackup {
  return {
    id: String(row.id),
    createdAt: toIsoString(row.created_at),
    reason: String(row.reason),
    storageKey: String(row.storage_key),
    peopleCount: Number(row.people_count ?? 0),
    sourcesCount: Number(row.sources_count ?? 0),
    casesCount: Number(row.cases_count ?? 0),
    dnaMatchCount: Number(row.dna_match_count ?? 0),
    importCount: Number(row.import_count ?? 0),
    rawRecordCount: Number(row.raw_record_count ?? 0)
  };
}

function normalizeWorkspaceData(value: Partial<WorkspaceData>): WorkspaceData {
  return {
    version: "0.17.0",
    archiveName: value.archiveName || "Riemer - Zajicek Archive",
    archiveTagline: value.archiveTagline ?? "",
    people: Array.isArray(value.people) ? value.people : [],
    cases: Array.isArray(value.cases) ? value.cases : [],
    sources: Array.isArray(value.sources) ? value.sources : [],
    dnaMatches: Array.isArray(value.dnaMatches) ? value.dnaMatches : [],
    aiRuns: Array.isArray(value.aiRuns) ? value.aiRuns.map(normalizeAIAnalysisRun) : [],
    imports: Array.isArray(value.imports) ? value.imports : [],
    rawRecords: Array.isArray(value.rawRecords) ? value.rawRecords : [],
    backups: Array.isArray(value.backups) ? value.backups : [],
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

function normalizeAIAnalysisRun(run: AIAnalysisRun): AIAnalysisRun {
  return {
    ...run,
    status: run.status,
    evidenceUsed: run.evidenceUsed ?? [],
    uncertainty: run.uncertainty ?? [],
    anomalyCount: run.anomalyCount ?? 0,
    suggestions: run.suggestions ?? [],
    contextReferences: run.contextReferences ?? [],
    createdAt: run.createdAt ?? new Date().toISOString()
  };
}

function createWorkspaceBackup(workspace: WorkspaceData, reason: string): WorkspaceBackup {
  const createdAt = new Date().toISOString();
  const id = `backup-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;

  return {
    id,
    createdAt,
    reason,
    storageKey: `postgres://workspace_backups/${id}`,
    peopleCount: workspace.people.length,
    sourcesCount: workspace.sources.length,
    casesCount: workspace.cases.length,
    dnaMatchCount: workspace.dnaMatches.length,
    importCount: workspace.imports.length,
    rawRecordCount: workspace.rawRecords.length
  };
}

function createDnaEvidenceSummary(match: DnaMatch, helpfulnessScore: number): string {
  const parts = [
    `${match.totalCm} cM`,
    match.predictedRelationship,
    match.side !== "unknown" ? `${match.side} side` : undefined,
    match.treeStatus !== "unknown" ? `${match.treeStatus} tree` : undefined,
    match.surnames.length ? `surnames: ${match.surnames.slice(0, 5).join(", ")}` : undefined,
    match.places.length ? `places: ${match.places.slice(0, 5).join(", ")}` : undefined,
    `${helpfulnessScore}/100 helpfulness`
  ].filter(Boolean);

  return parts.join("; ");
}

function normalizeDnaMatch(match: DnaMatch): DnaMatch {
  if (!match.displayName?.trim() || !Number.isFinite(match.totalCm)) {
    throw new Error("displayName and numeric totalCm are required");
  }

  return {
    ...match,
    id: match.id || `dna-${randomUUID()}`,
    displayName: match.displayName.trim(),
    totalCm: Number(match.totalCm),
    longestSegmentCm: match.longestSegmentCm !== undefined && Number.isFinite(match.longestSegmentCm) ? match.longestSegmentCm : undefined,
    surnames: match.surnames ?? [],
    places: match.places ?? [],
    sharedMatches: match.sharedMatches ?? [],
    notes: match.notes ?? "",
    side: match.side ?? "unknown",
    treeStatus: match.treeStatus ?? "unknown",
    triageStatus: match.triageStatus ?? "needs_review"
  };
}

function autoPrioritizeDnaMatch(match: DnaMatch, helpfulnessScore: number): DnaMatch {
  return {
    ...match,
    triageStatus: match.triageStatus === "needs_review" && helpfulnessScore >= 75 ? "high_priority" : match.triageStatus
  };
}

function removeDnaScore(match: ScoredDnaMatch): DnaMatch {
  const { helpfulnessScore: _helpfulnessScore, ...dnaMatch } = match;
  void _helpfulnessScore;
  return dnaMatch;
}

function mergeImportedPeople(existing: PersonSummary[], imported: PersonSummary[]): PersonSummary[] {
  const existingById = new Map(existing.map((person) => [person.id, person]));
  const importedIds = new Set(imported.map((person) => person.id));
  const mergedImported = imported.map((person) => {
    const current = existingById.get(person.id);
    // GEDCOM xrefs are only unique within one file, so an id collision can be
    // a different person from an unrelated import. Only carry curation flags
    // forward when the incoming record plausibly is the same person —
    // otherwise inheriting published/privacy could expose a living stranger.
    return current && isSameImportedPerson(current, person)
      ? {
          ...person,
          privacy: current.privacy,
          published: current.published,
          livingStatus: current.livingStatus
        }
      : person;
  });
  return [...mergedImported, ...existing.filter((person) => !importedIds.has(person.id))];
}

function isSameImportedPerson(existing: PersonSummary, imported: PersonSummary): boolean {
  const existingName = normalizePersonName(existing.displayName);
  const importedName = normalizePersonName(imported.displayName);
  if (!existingName || !importedName || existingName !== importedName) {
    return false;
  }

  if (existing.birthDate && imported.birthDate && existing.birthDate.trim() !== imported.birthDate.trim()) {
    return false;
  }

  return true;
}

function normalizePersonName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function groupBy<T, K>(items: T[], keyForItem: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function toJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function slugifyArchive(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "archive";
}
