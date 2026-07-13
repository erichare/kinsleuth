import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction, type DatabaseOptions } from "./db";
import { createDnaConnectionHypothesis, scoreDnaMatch } from "./dna";
import { demoCases, demoDnaMatches, demoPeople } from "./demo-data";
import { prepareGedcomImport, type PreparedGedcomImport } from "./gedcom/apply";
import { buildFamilyRelationshipMap, parseGedcom } from "./gedcom/parser";
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
const bulkInsertBatchSize = 2_000;
// Full pre-import snapshots are large; retain only the most recent ones.
const retainedBackupCount = 10;

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
      const seed = createSeedWorkspace();
      await persistWorkspace(client, archiveId, seed);
      return seed;
    }

    return loadWorkspace(client, archiveId);
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

// Runs a read-transform-write cycle inside ONE transaction with the archive
// row locked, so concurrent mutations serialize instead of losing updates
// (writeWorkspace persists the whole workspace, so an unlocked read-modify-write
// would silently drop whichever concurrent write commits first).
async function mutateWorkspace<T>(
  options: WorkspaceStoreOptions,
  transform: (workspace: WorkspaceData) => {
    workspace: WorkspaceData;
    result: T;
    afterPersist?: (client: PoolClient) => Promise<void>;
  }
): Promise<T> {
  const archiveId = getArchiveId(options);

  return withTransaction(options, async (client) => {
    const archive = await client.query<{ id: string }>("SELECT id FROM archives WHERE id = $1 FOR UPDATE", [archiveId]);
    const workspace = archive.rowCount === 0 ? createSeedWorkspace() : await loadWorkspace(client, archiveId);
    const { workspace: next, result, afterPersist } = transform(workspace);
    await persistWorkspace(client, archiveId, normalizeWorkspaceData({ ...next, updatedAt: new Date().toISOString() }));
    if (afterPersist) {
      await afterPersist(client);
    }
    return result;
  });
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

  return mutateWorkspace(options, (workspace) => ({
    workspace: { ...workspace, cases: [created, ...workspace.cases.filter((item) => item.id !== created.id)] },
    result: created
  }));
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

  return mutateWorkspace(options, (workspace) => {
    const researchCase = workspace.cases.find((item) => item.id === caseId);
    if (!researchCase) {
      throw new Error("case not found");
    }

    const updatedCase: ResearchCase = {
      ...researchCase,
      tasks: [task, ...researchCase.tasks.filter((item) => item.id !== task.id)]
    };

    return {
      workspace: {
        ...workspace,
        cases: workspace.cases.map((item) => (item.id === caseId ? updatedCase : item))
      },
      result: { case: updatedCase, task }
    };
  });
}

export async function updateCaseTask(
  caseId: string,
  taskId: string,
  input: { title?: string; status?: ResearchCase["tasks"][number]["status"] },
  options: WorkspaceStoreOptions = {}
): Promise<{ case: ResearchCase; task: ResearchCase["tasks"][number] }> {
  return mutateWorkspace(options, (workspace) => {
    const researchCase = workspace.cases.find((item) => item.id === caseId);
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
    const updatedCase: ResearchCase = {
      ...researchCase,
      tasks: researchCase.tasks.map((item) => (item.id === taskId ? task : item))
    };

    return {
      workspace: {
        ...workspace,
        cases: workspace.cases.map((item) => (item.id === caseId ? updatedCase : item))
      },
      result: { case: updatedCase, task }
    };
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

  return mutateWorkspace(options, (workspace) => ({
    workspace: {
      ...workspace,
      aiRuns: [run, ...workspace.aiRuns.filter((item) => item.id !== run.id)].slice(0, 25)
    },
    result: run
  }));
}

export async function saveDnaMatch(match: DnaMatch, options: WorkspaceStoreOptions = {}): Promise<{
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
}> {
  const normalized = normalizeDnaMatch(match);
  const helpfulnessScore = scoreDnaMatch(normalized);
  const triaged = autoPrioritizeDnaMatch(normalized, helpfulnessScore);

  return mutateWorkspace(options, (workspace) => ({
    workspace: { ...workspace, dnaMatches: [triaged, ...workspace.dnaMatches.filter((item) => item.id !== triaged.id)] },
    result: {
      helpfulnessScore,
      hypothesis: createDnaConnectionHypothesis(triaged, workspace.people),
      match: { ...triaged, helpfulnessScore }
    }
  }));
}

export async function saveDnaMatches(matches: DnaMatch[], options: WorkspaceStoreOptions = {}): Promise<Array<{
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
}>> {
  return mutateWorkspace(options, (workspace) => {
    const results = matches.map((match) => {
      const normalized = normalizeDnaMatch(match);
      const helpfulnessScore = scoreDnaMatch(normalized);
      const triaged = autoPrioritizeDnaMatch(normalized, helpfulnessScore);

      return {
        helpfulnessScore,
        hypothesis: createDnaConnectionHypothesis(triaged, workspace.people),
        match: { ...triaged, helpfulnessScore }
      };
    });
    const importedIds = new Set(results.map((result) => result.match.id));

    return {
      workspace: {
        ...workspace,
        dnaMatches: [
          ...results.map((result) => removeDnaScore(result.match)),
          ...workspace.dnaMatches.filter((item) => !importedIds.has(item.id))
        ]
      },
      result: results
    };
  });
}

export async function updateDnaMatch(matchId: string, input: Partial<DnaMatch>, options: WorkspaceStoreOptions = {}): Promise<{
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
}> {
  return mutateWorkspace(options, (workspace) => {
    const current = workspace.dnaMatches.find((match) => match.id === matchId);
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

    return {
      workspace: {
        ...workspace,
        dnaMatches: workspace.dnaMatches.map((match) => (match.id === matchId ? updated : match))
      },
      result: {
        helpfulnessScore,
        hypothesis: createDnaConnectionHypothesis(updated, workspace.people),
        match: { ...updated, helpfulnessScore }
      }
    };
  });
}

export async function deleteDnaMatch(matchId: string, options: WorkspaceStoreOptions = {}): Promise<{ deleted: string }> {
  return mutateWorkspace(options, (workspace) => {
    const exists = workspace.dnaMatches.some((match) => match.id === matchId);
    if (!exists) {
      throw new Error("DNA match not found");
    }

    return {
      workspace: {
        ...workspace,
        dnaMatches: workspace.dnaMatches.filter((match) => match.id !== matchId)
      },
      result: { deleted: matchId }
    };
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
  return mutateWorkspace(options, (workspace) => {
    const researchCase = workspace.cases.find((item) => item.id === caseId);
    if (!researchCase) {
      throw new Error("Case not found");
    }

    const match = workspace.dnaMatches.find((item) => item.id === matchId);
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
    const updatedCase: ResearchCase = {
      ...researchCase,
      evidence: existingEvidence
        ? researchCase.evidence.map((item) => (item.id === existingEvidence.id ? evidence : item))
        : [evidence, ...researchCase.evidence]
    };

    return {
      workspace: {
        ...workspace,
        cases: workspace.cases.map((item) => (item.id === caseId ? updatedCase : item))
      },
      result: {
        case: updatedCase,
        evidence,
        match: { ...match, helpfulnessScore },
        created: !existingEvidence
      }
    };
  });
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

  return mutateWorkspace(options, (workspace) => ({
    workspace: { ...workspace, sources: [created, ...workspace.sources.filter((item) => item.id !== created.id)] },
    result: created
  }));
}

export async function updatePersonCuration(
  personId: string,
  input: { published?: boolean; privacy?: PrivacyLevel; livingStatus?: PersonSummary["livingStatus"] },
  options: WorkspaceStoreOptions = {}
): Promise<PersonSummary> {
  return mutateWorkspace(options, (workspace) => {
    const person = workspace.people.find((item) => item.id === personId);
    if (!person) {
      throw new Error("person not found");
    }

    const updated: PersonSummary = {
      ...person,
      published: input.published ?? person.published,
      privacy: input.privacy ?? person.privacy,
      livingStatus: input.livingStatus ?? person.livingStatus
    };

    return {
      workspace: {
        ...workspace,
        people: workspace.people.map((item) => (item.id === personId ? updated : item))
      },
      result: updated
    };
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
  const archiveId = getArchiveId(options);

  return mutateWorkspace(options, (workspace) => {
    const backup = createWorkspaceBackup(workspace, `Before applying ${prepared.snapshot.sourceName}`);
    const importedPeople = mergeImportedPeople(workspace.people, prepared.people);
    const importedSources = mergeById(workspace.sources, prepared.sources);
    const rawRecords = [
      ...prepared.rawRecords,
      ...workspace.rawRecords.filter((record) => record.importId !== prepared.snapshot.id)
    ];
    const appliedImport: AppliedGedcomImport = {
      ...prepared.appliedImport,
      backupId: backup.id
    };

    return {
      workspace: {
        ...workspace,
        people: importedPeople,
        sources: importedSources,
        rawRecords,
        imports: [appliedImport, ...workspace.imports.filter((item) => item.id !== appliedImport.id)],
        backups: [backup, ...workspace.backups.filter((item) => item.id !== backup.id)].slice(0, retainedBackupCount)
      },
      result: {
        import: appliedImport,
        backup,
        peopleImported: prepared.people.length,
        sourcesImported: prepared.sources.length,
        rawRecordCount: prepared.rawRecords.length
      },
      // Store the pre-import workspace as the backup payload after the upsert
      // above creates the row; persistWorkspace never overwrites snapshots.
      afterPersist: async (client) => {
        await client.query("UPDATE workspace_backups SET snapshot = $3::jsonb WHERE archive_id = $1 AND id = $2", [
          archiveId,
          backup.id,
          JSON.stringify(workspace)
        ]);
      }
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
      await persistWorkspace(client, archiveId, normalizeWorkspaceData({ ...repairedWorkspace, updatedAt: new Date().toISOString() }));
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
    people: peopleResult.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      givenName: row.given_name ?? undefined,
      surname: row.surname ?? undefined,
      birthDate: row.birth_date ?? undefined,
      birthPlace: row.birth_place ?? undefined,
      deathDate: row.death_date ?? undefined,
      deathPlace: row.death_place ?? undefined,
      sex: row.sex ?? undefined,
      livingStatus: row.living_status,
      privacy: row.privacy,
      published: row.published,
      facts: (factsByPerson.get(row.id) ?? []).map(({ personId: _personId, ...fact }) => {
        void _personId;
        return fact;
      }),
      relatives: row.relatives ?? [],
      notes: row.notes ?? undefined
    })),
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

  await insertPeopleAndFacts(client, archiveId, normalized.people);
  await insertSources(client, archiveId, normalized.sources);

  for (const [index, researchCase] of normalized.cases.entries()) {
    await client.query(
      `INSERT INTO research_cases (id, archive_id, title, question, status, focus, privacy, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [researchCase.id, archiveId, researchCase.title, researchCase.question, researchCase.status, researchCase.focus, researchCase.privacy, index]
    );

    for (const [hypothesisIndex, hypothesis] of researchCase.hypotheses.entries()) {
      await client.query(
        `INSERT INTO hypotheses (id, archive_id, case_id, statement, confidence, status, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [hypothesis.id, archiveId, researchCase.id, hypothesis.statement, normalizeConfidence(hypothesis.confidence), hypothesis.status, hypothesisIndex]
      );
    }

    for (const [evidenceIndex, evidence] of researchCase.evidence.entries()) {
      await client.query(
        `INSERT INTO evidence_items (
          id, archive_id, case_id, title, evidence_type, summary, confidence, linked_person_id, linked_dna_match_id, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          evidence.id,
          archiveId,
          researchCase.id,
          evidence.title,
          evidence.type,
          evidence.summary,
          normalizeConfidence(evidence.confidence),
          evidence.linkedPersonId,
          evidence.linkedDnaMatchId,
          evidenceIndex
        ]
      );
    }

    for (const [taskIndex, task] of researchCase.tasks.entries()) {
      await client.query(
        "INSERT INTO tasks (id, archive_id, case_id, title, status, sort_order) VALUES ($1, $2, $3, $4, $5, $6)",
        [task.id, archiveId, researchCase.id, task.title, task.status, taskIndex]
      );
    }
  }

  for (const [index, match] of normalized.dnaMatches.entries()) {
    await client.query(
      `INSERT INTO dna_matches (
        id, archive_id, display_name, total_cm, longest_segment_cm, shared_dna_percent,
        predicted_relationship, side, tree_status, surnames, places, shared_matches, notes,
        ancestry_url, triage_status, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        match.id,
        archiveId,
        match.displayName,
        match.totalCm,
        match.longestSegmentCm,
        match.sharedDnaPercent,
        match.predictedRelationship,
        match.side,
        match.treeStatus,
        match.surnames,
        match.places,
        match.sharedMatches,
        match.notes,
        match.ancestryUrl,
        match.triageStatus,
        index
      ]
    );

    const hypothesis = createDnaConnectionHypothesis(match, normalized.people);
    await client.query(
      `INSERT INTO dna_hypotheses (
        id, archive_id, dna_match_id, likely_branch, likely_generation, geography,
        candidate_common_ancestors, confidence, explanation, evidence, uncertainty
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
      [
        `hyp-${match.id}`,
        archiveId,
        match.id,
        hypothesis.likelyBranch,
        hypothesis.likelyGeneration,
        hypothesis.geography,
        hypothesis.candidateCommonAncestors,
        normalizeConfidence(hypothesis.confidence),
        hypothesis.explanation,
        JSON.stringify(hypothesis.evidence),
        JSON.stringify(hypothesis.uncertainty)
      ]
    );
  }

  for (const [index, run] of normalized.aiRuns.entries()) {
    await client.query(
      `INSERT INTO ai_runs (
        id, archive_id, run_type, provider, model, question, answer, status, provider_status,
        evidence, uncertainty, suggestions, context_references, result, anomaly_count, linked_case_id,
        prompt_redacted, error, created_at, completed_at, sort_order
      ) VALUES (
        $1, $2, 'analysis', $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
        $13::jsonb, $14, $15, $16, $17, $18, $19, $20
      )`,
      [
        run.id,
        archiveId,
        run.provider ?? "local",
        run.model ?? "local",
        run.question,
        run.answer,
        run.status,
        run.providerStatus ?? (run.status === "ready" ? "completed" : run.status === "provider_error" ? "failed" : "not_configured"),
        JSON.stringify(run.evidenceUsed),
        JSON.stringify(run.uncertainty),
        JSON.stringify(run.suggestions),
        JSON.stringify(run.contextReferences),
        JSON.stringify({ answer: run.answer, status: run.status }),
        run.anomalyCount,
        run.linkedCaseId,
        run.promptPreview ?? "",
        run.error,
        run.createdAt,
        run.completedAt,
        index
      ]
    );
  }

  for (const [index, item] of normalized.imports.entries()) {
    await client.query(
      `INSERT INTO import_snapshots (
        id, archive_id, source_name, checksum, summary, record_count, people_imported,
        sources_imported, raw_record_count, backup_id, applied_at, sort_order
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)`,
      [
        item.id,
        archiveId,
        item.sourceName,
        item.checksum,
        JSON.stringify(item.summary),
        item.recordCount,
        item.peopleImported,
        item.sourcesImported,
        item.rawRecordCount,
        item.backupId,
        item.appliedAt,
        index
      ]
    );
  }

  await insertRawRecords(client, archiveId, normalized.rawRecords);

  for (const [index, backup] of normalized.backups.entries()) {
    await client.query(
      `INSERT INTO workspace_backups (
        id, archive_id, created_at, reason, storage_key, people_count, sources_count,
        cases_count, dna_match_count, import_count, raw_record_count, snapshot, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '{}'::jsonb, $12)
      ON CONFLICT (archive_id, id) DO UPDATE SET
        reason = EXCLUDED.reason,
        storage_key = EXCLUDED.storage_key,
        people_count = EXCLUDED.people_count,
        sources_count = EXCLUDED.sources_count,
        cases_count = EXCLUDED.cases_count,
        dna_match_count = EXCLUDED.dna_match_count,
        import_count = EXCLUDED.import_count,
        raw_record_count = EXCLUDED.raw_record_count,
        sort_order = EXCLUDED.sort_order`,
      [
        backup.id,
        archiveId,
        backup.createdAt,
        backup.reason,
        backup.storageKey,
        backup.peopleCount,
        backup.sourcesCount,
        backup.casesCount,
        backup.dnaMatchCount,
        backup.importCount,
        backup.rawRecordCount,
        index
      ]
    );
  }
}

async function insertPeopleAndFacts(client: PoolClient, archiveId: string, people: PersonSummary[]): Promise<void> {
  const personRows = people.map((person, sortOrder) => ({
    id: person.id,
    slug: person.slug,
    display_name: person.displayName,
    given_name: person.givenName,
    surname: person.surname,
    sex: person.sex,
    birth_date: person.birthDate,
    birth_place: person.birthPlace,
    death_date: person.deathDate,
    death_place: person.deathPlace,
    living_status: person.livingStatus,
    privacy: person.privacy,
    published: person.published,
    relatives: person.relatives,
    notes: person.notes,
    sort_order: sortOrder
  }));

  await insertJsonBatches(personRows, async (rows) => {
    await client.query(
      `INSERT INTO people (
        id, archive_id, slug, display_name, given_name, surname, sex, birth_date, birth_place,
        death_date, death_place, living_status, privacy, published, relatives, notes, confidence, sort_order
      )
      SELECT row.id, $1::text, row.slug, row.display_name, row.given_name, row.surname, row.sex,
        row.birth_date, row.birth_place, row.death_date, row.death_place, row.living_status,
        row.privacy, row.published, row.relatives, row.notes, 0.5, row.sort_order
      FROM jsonb_to_recordset($2::jsonb) AS row(
        id text, slug text, display_name text, given_name text, surname text, sex text,
        birth_date text, birth_place text, death_date text, death_place text, living_status text,
        privacy text, published boolean, relatives text[], notes text, sort_order integer
      )`,
      [archiveId, JSON.stringify(rows)]
    );
  });

  const factRows = people.flatMap((person) => person.facts.map((fact, sortOrder) => ({
    id: fact.id,
    person_id: person.id,
    fact_type: fact.type,
    date_text: fact.date,
    place_text: fact.place,
    value_text: fact.value,
    source_text: fact.source,
    privacy: fact.privacy,
    confidence: normalizeConfidence(fact.confidence),
    sort_order: sortOrder
  })));

  await insertJsonBatches(factRows, async (rows) => {
    await client.query(
      `INSERT INTO person_facts (
        id, archive_id, person_id, fact_type, date_text, place_text, value_text, source_text, privacy, confidence, sort_order
      )
      SELECT row.id, $1::text, row.person_id, row.fact_type, row.date_text, row.place_text,
        row.value_text, row.source_text, row.privacy, row.confidence, row.sort_order
      FROM jsonb_to_recordset($2::jsonb) AS row(
        id text, person_id text, fact_type text, date_text text, place_text text, value_text text,
        source_text text, privacy text, confidence numeric, sort_order integer
      )`,
      [archiveId, JSON.stringify(rows)]
    );
  });
}

async function insertSources(client: PoolClient, archiveId: string, sources: SourceDocument[]): Promise<void> {
  const sourceRows = sources.map((source, sortOrder) => ({
    id: source.id,
    title: source.title,
    source_type: source.sourceType,
    import_id: source.importId,
    raw_record_id: source.rawRecordId,
    file_name: source.fileName,
    storage_key: source.storageKey,
    mime_type: source.mimeType,
    size_bytes: source.size,
    repository: source.repository,
    url: source.url,
    ancestry_apid: source.ancestryApid,
    citation_date: source.citationDate,
    linked_person_id: source.linkedPersonId,
    linked_case_id: source.linkedCaseId,
    transcript: source.transcript,
    notes: source.notes,
    privacy: source.privacy,
    confidence: normalizeConfidence(source.confidence),
    created_at: source.createdAt,
    sort_order: sortOrder
  }));

  await insertJsonBatches(sourceRows, async (rows) => {
    await client.query(
      `INSERT INTO sources (
        id, archive_id, title, source_type, import_id, raw_record_id, file_name, storage_key,
        mime_type, size_bytes, repository, url, ancestry_apid, citation_date, linked_person_id,
        linked_case_id, transcript, notes, privacy, confidence, created_at, sort_order
      )
      SELECT row.id, $1::text, row.title, row.source_type, row.import_id, row.raw_record_id,
        row.file_name, row.storage_key, row.mime_type, row.size_bytes, row.repository, row.url,
        row.ancestry_apid, row.citation_date, row.linked_person_id, row.linked_case_id,
        row.transcript, row.notes, row.privacy, row.confidence, row.created_at, row.sort_order
      FROM jsonb_to_recordset($2::jsonb) AS row(
        id text, title text, source_type text, import_id text, raw_record_id text, file_name text,
        storage_key text, mime_type text, size_bytes bigint, repository text, url text,
        ancestry_apid text, citation_date text, linked_person_id text, linked_case_id text,
        transcript text, notes text, privacy text, confidence numeric, created_at timestamptz, sort_order integer
      )`,
      [archiveId, JSON.stringify(rows)]
    );
  });
}

async function insertRawRecords(client: PoolClient, archiveId: string, records: RawGedcomRecord[]): Promise<void> {
  const recordRows = records.map((record, sortOrder) => ({
    id: record.id,
    import_id: record.importId,
    xref: record.xref,
    record_type: record.type,
    raw_text: record.raw,
    checksum: record.checksum,
    sort_order: sortOrder
  }));

  await insertJsonBatches(recordRows, async (rows) => {
    await client.query(
      `INSERT INTO raw_records (id, archive_id, import_id, xref, record_type, raw_text, checksum, sort_order)
      SELECT row.id, $1::text, row.import_id, row.xref, row.record_type, row.raw_text, row.checksum, row.sort_order
      FROM jsonb_to_recordset($2::jsonb) AS row(
        id text, import_id text, xref text, record_type text, raw_text text, checksum text, sort_order integer
      )`,
      [archiveId, JSON.stringify(rows)]
    );
  });
}

async function insertJsonBatches<T>(rows: T[], insert: (batch: T[]) => Promise<void>): Promise<void> {
  for (let index = 0; index < rows.length; index += bulkInsertBatchSize) {
    await insert(rows.slice(index, index + bulkInsertBatchSize));
  }
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

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
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

function mergeById<T extends { id: string }>(existing: T[], imported: T[]): T[] {
  const importedIds = new Set(imported.map((item) => item.id));
  return [...imported, ...existing.filter((item) => !importedIds.has(item.id))];
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
