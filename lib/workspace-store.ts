import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDnaConnectionHypothesis, scoreDnaMatch } from "./dna";
import { demoCases, demoDnaMatches, demoPeople } from "./demo-data";
import { prepareGedcomImport } from "./gedcom/apply";
import type { AppliedGedcomImport, DnaConnectionHypothesis, DnaMatch, PersonSummary, PrivacyLevel, RawGedcomRecord, ResearchCase, SourceDocument, WorkspaceBackup } from "./models";

export type ScoredDnaMatch = DnaMatch & { helpfulnessScore: number };

export type WorkspaceData = {
  version: "0.13.0";
  archiveName: string;
  people: PersonSummary[];
  cases: ResearchCase[];
  sources: SourceDocument[];
  dnaMatches: DnaMatch[];
  imports: AppliedGedcomImport[];
  rawRecords: RawGedcomRecord[];
  backups: WorkspaceBackup[];
  updatedAt: string;
};

export type WorkspaceStoreOptions = {
  storagePath?: string;
};

const defaultStoragePath = path.join(/*turbopackIgnore: true*/ process.cwd(), "storage", "workspace.json");

let writeQueue = Promise.resolve();

export function getWorkspacePath(options: WorkspaceStoreOptions = {}): string {
  return options.storagePath ?? process.env.KINSLEUTH_WORKSPACE_PATH ?? defaultStoragePath;
}

export function createSeedWorkspace(now = new Date()): WorkspaceData {
  return {
    version: "0.13.0",
    archiveName: "Riemer - Zajicek Archive",
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
    imports: [],
    rawRecords: [],
    backups: [],
    updatedAt: now.toISOString()
  };
}

export async function readWorkspace(options: WorkspaceStoreOptions = {}): Promise<WorkspaceData> {
  const storagePath = getWorkspacePath(options);

  try {
    const raw = await readFile(storagePath, "utf8");
    return normalizeWorkspaceData(JSON.parse(raw));
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }

    const seed = createSeedWorkspace();
    await writeWorkspace(seed, options);
    return seed;
  }
}

export async function writeWorkspace(workspace: WorkspaceData, options: WorkspaceStoreOptions = {}): Promise<WorkspaceData> {
  const storagePath = getWorkspacePath(options);
  const next = normalizeWorkspaceData({
    ...workspace,
    updatedAt: new Date().toISOString()
  });

  writeQueue = writeQueue.then(async () => {
    await mkdir(path.dirname(storagePath), { recursive: true });
    await writeFile(storagePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  });

  await writeQueue;
  return next;
}

export async function createCase(input: Partial<ResearchCase>, options: WorkspaceStoreOptions = {}): Promise<ResearchCase> {
  if (!input.title?.trim() || !input.question?.trim()) {
    throw new Error("title and question are required");
  }

  const workspace = await readWorkspace(options);
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

  await writeWorkspace({ ...workspace, cases: [created, ...workspace.cases.filter((item) => item.id !== created.id)] }, options);
  return created;
}

export async function saveDnaMatch(match: DnaMatch, options: WorkspaceStoreOptions = {}): Promise<{
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
}> {
  const workspace = await readWorkspace(options);
  const normalized = normalizeDnaMatch(match);
  const helpfulnessScore = scoreDnaMatch(normalized);
  const triaged = autoPrioritizeDnaMatch(normalized, helpfulnessScore);
  const hypothesis = createDnaConnectionHypothesis(triaged, workspace.people);

  await writeWorkspace({ ...workspace, dnaMatches: [triaged, ...workspace.dnaMatches.filter((item) => item.id !== triaged.id)] }, options);

  return {
    helpfulnessScore,
    hypothesis,
    match: { ...triaged, helpfulnessScore }
  };
}

export async function saveDnaMatches(matches: DnaMatch[], options: WorkspaceStoreOptions = {}): Promise<Array<{
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
}>> {
  const workspace = await readWorkspace(options);
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

  await writeWorkspace(
    {
      ...workspace,
      dnaMatches: [
        ...results.map((result) => removeDnaScore(result.match)),
        ...workspace.dnaMatches.filter((item) => !importedIds.has(item.id))
      ]
    },
    options
  );

  return results;
}

export async function updateDnaMatch(matchId: string, input: Partial<DnaMatch>, options: WorkspaceStoreOptions = {}): Promise<{
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
}> {
  const workspace = await readWorkspace(options);
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
  const hypothesis = createDnaConnectionHypothesis(updated, workspace.people);

  await writeWorkspace(
    {
      ...workspace,
      dnaMatches: workspace.dnaMatches.map((match) => (match.id === matchId ? updated : match))
    },
    options
  );

  return {
    helpfulnessScore,
    hypothesis,
    match: { ...updated, helpfulnessScore }
  };
}

export async function deleteDnaMatch(matchId: string, options: WorkspaceStoreOptions = {}): Promise<{ deleted: string }> {
  const workspace = await readWorkspace(options);
  const exists = workspace.dnaMatches.some((match) => match.id === matchId);
  if (!exists) {
    throw new Error("DNA match not found");
  }

  await writeWorkspace(
    {
      ...workspace,
      dnaMatches: workspace.dnaMatches.filter((match) => match.id !== matchId)
    },
    options
  );

  return { deleted: matchId };
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
  const workspace = await readWorkspace(options);
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

  await writeWorkspace(
    {
      ...workspace,
      cases: workspace.cases.map((item) => (item.id === caseId ? updatedCase : item))
    },
    options
  );

  return {
    case: updatedCase,
    evidence,
    match: { ...match, helpfulnessScore },
    created: !existingEvidence
  };
}

export async function saveSourceDocument(input: Partial<SourceDocument>, options: WorkspaceStoreOptions = {}): Promise<SourceDocument> {
  if (!input.title?.trim()) {
    throw new Error("title is required");
  }

  const workspace = await readWorkspace(options);
  const created: SourceDocument = {
    id: input.id ?? `src-${randomUUID()}`,
    title: input.title.trim(),
    sourceType: input.sourceType?.trim() || "Document",
    fileName: input.fileName,
    storageKey: input.storageKey,
    mimeType: input.mimeType,
    size: input.size,
    repository: input.repository,
    citationDate: input.citationDate,
    linkedPersonId: input.linkedPersonId,
    linkedCaseId: input.linkedCaseId,
    transcript: input.transcript,
    notes: input.notes,
    privacy: input.privacy ?? "private",
    confidence: input.confidence ?? 0.5,
    createdAt: input.createdAt ?? new Date().toISOString()
  };

  await writeWorkspace({ ...workspace, sources: [created, ...workspace.sources.filter((item) => item.id !== created.id)] }, options);
  return created;
}

export async function updatePersonCuration(
  personId: string,
  input: { published?: boolean; privacy?: PrivacyLevel; livingStatus?: PersonSummary["livingStatus"] },
  options: WorkspaceStoreOptions = {}
): Promise<PersonSummary> {
  const workspace = await readWorkspace(options);
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

  await writeWorkspace(
    {
      ...workspace,
      people: workspace.people.map((item) => (item.id === personId ? updated : item))
    },
    options
  );
  return updated;
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

  const workspace = await readWorkspace(options);
  const prepared = prepareGedcomImport(input.sourceName.trim(), input.content);
  const backup = await writeWorkspaceBackup(workspace, `Before applying ${prepared.snapshot.sourceName}`, options);
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

  await writeWorkspace(
    {
      ...workspace,
      people: importedPeople,
      sources: importedSources,
      rawRecords,
      imports: [appliedImport, ...workspace.imports.filter((item) => item.id !== appliedImport.id)],
      backups: [backup, ...workspace.backups.filter((item) => item.id !== backup.id)]
    },
    options
  );

  return {
    import: appliedImport,
    backup,
    peopleImported: prepared.people.length,
    sourcesImported: prepared.sources.length,
    rawRecordCount: prepared.rawRecords.length
  };
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

function normalizeWorkspaceData(value: Partial<WorkspaceData>): WorkspaceData {
  return {
    version: "0.13.0",
    archiveName: value.archiveName || "Riemer - Zajicek Archive",
    people: Array.isArray(value.people) ? value.people : [],
    cases: Array.isArray(value.cases) ? value.cases : [],
    sources: Array.isArray(value.sources) ? value.sources : [],
    dnaMatches: Array.isArray(value.dnaMatches) ? value.dnaMatches : [],
    imports: Array.isArray(value.imports) ? value.imports : [],
    rawRecords: Array.isArray(value.rawRecords) ? value.rawRecords : [],
    backups: Array.isArray(value.backups) ? value.backups : [],
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

async function writeWorkspaceBackup(workspace: WorkspaceData, reason: string, options: WorkspaceStoreOptions): Promise<WorkspaceBackup> {
  const createdAt = new Date().toISOString();
  const id = `backup-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const backup: WorkspaceBackup = {
    id,
    createdAt,
    reason,
    storageKey: `backups/${id}.json`,
    peopleCount: workspace.people.length,
    sourcesCount: workspace.sources.length,
    casesCount: workspace.cases.length,
    dnaMatchCount: workspace.dnaMatches.length,
    importCount: workspace.imports.length,
    rawRecordCount: workspace.rawRecords.length
  };
  const storagePath = getWorkspacePath(options);
  const backupPath = path.join(path.dirname(storagePath), backup.storageKey);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
  return backup;
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
    return current
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

function mergeById<T extends { id: string }>(existing: T[], imported: T[]): T[] {
  const importedIds = new Set(imported.map((item) => item.id));
  return [...imported, ...existing.filter((item) => !importedIds.has(item.id))];
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
