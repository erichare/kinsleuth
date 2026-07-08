import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDnaConnectionHypothesis, scoreDnaMatch } from "./dna";
import { demoCases, demoDnaMatches, demoPeople } from "./demo-data";
import type { DnaConnectionHypothesis, DnaMatch, PersonSummary, ResearchCase, SourceDocument } from "./models";

export type ScoredDnaMatch = DnaMatch & { helpfulnessScore: number };

export type WorkspaceData = {
  version: "0.6.0";
  archiveName: string;
  people: PersonSummary[];
  cases: ResearchCase[];
  sources: SourceDocument[];
  dnaMatches: DnaMatch[];
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
    version: "0.6.0",
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
  if (!match.displayName?.trim() || !Number.isFinite(match.totalCm)) {
    throw new Error("displayName and numeric totalCm are required");
  }

  const workspace = await readWorkspace(options);
  const normalized: DnaMatch = {
    ...match,
    id: match.id || `dna-${randomUUID()}`,
    displayName: match.displayName.trim(),
    surnames: match.surnames ?? [],
    places: match.places ?? [],
    sharedMatches: match.sharedMatches ?? [],
    notes: match.notes ?? "",
    side: match.side ?? "unknown",
    treeStatus: match.treeStatus ?? "unknown",
    triageStatus: match.triageStatus ?? "needs_review"
  };
  const helpfulnessScore = scoreDnaMatch(normalized);
  const hypothesis = createDnaConnectionHypothesis(normalized, workspace.people);

  await writeWorkspace({ ...workspace, dnaMatches: [normalized, ...workspace.dnaMatches.filter((item) => item.id !== normalized.id)] }, options);

  return {
    helpfulnessScore,
    hypothesis,
    match: { ...normalized, helpfulnessScore }
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
    version: "0.6.0",
    archiveName: value.archiveName || "Riemer - Zajicek Archive",
    people: Array.isArray(value.people) ? value.people : [],
    cases: Array.isArray(value.cases) ? value.cases : [],
    sources: Array.isArray(value.sources) ? value.sources : [],
    dnaMatches: Array.isArray(value.dnaMatches) ? value.dnaMatches : [],
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
