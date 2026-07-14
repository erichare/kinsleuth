import type {
  AIAnalysisRun,
  AIAnalysisStatus,
  AIContextReference,
  AIStagedSuggestion,
  AppliedGedcomImport,
  DnaMatch,
  PersonFact,
  PersonSummary,
  PrivacyLevel,
  RawGedcomRecord,
  ResearchCase,
  SourceDocument,
  WorkspaceBackup
} from "../models";

// Row → domain mappers for the workspace tables. Each function converts one
// raw pg row into its domain shape; child mappers (facts, hypotheses,
// evidence, tasks) keep the parent id on the result so callers can group rows
// before stripping it.

export function mapPersonRow(row: Record<string, unknown>, facts: PersonFact[]): PersonSummary {
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

export function mapPersonFact(row: Record<string, unknown>): PersonFact & { personId: string } {
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

export function mapHypothesis(row: Record<string, unknown>): ResearchCase["hypotheses"][number] & { caseId: string } {
  return {
    caseId: String(row.case_id),
    id: String(row.id),
    statement: String(row.statement),
    confidence: Number(row.confidence ?? 0.5),
    status: row.status as ResearchCase["hypotheses"][number]["status"],
    decisions: toJsonArray(row.decisions),
    updatedAt: row.updated_at ? toIsoString(row.updated_at) : "1970-01-01T00:00:00.000Z"
  };
}

export function mapEvidence(row: Record<string, unknown>): ResearchCase["evidence"][number] & { caseId: string } {
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

export function mapTask(row: Record<string, unknown>): ResearchCase["tasks"][number] & { caseId: string } {
  const title = String(row.title);
  return {
    caseId: String(row.case_id),
    id: String(row.id),
    title,
    status: row.status as ResearchCase["tasks"][number]["status"],
    origin: row.origin === "guide" ? "guide" : "manual",
    priority: row.priority === "high" || row.priority === "low" ? row.priority : "normal",
    guideKey: optionalString(row.guide_key),
    workFingerprint: optionalString(row.work_fingerprint) ?? normalizeWorkFingerprint(title),
    guidance: String(row.guidance ?? ""),
    targetHypothesisId: optionalString(row.target_hypothesis_id),
    contextRefs: toJsonArray(row.context_refs),
    outcomes: toJsonArray(row.outcomes),
    createdAt: row.created_at ? toIsoString(row.created_at) : undefined,
    completedAt: row.completed_at ? toIsoString(row.completed_at) : undefined,
    updatedAt: row.updated_at ? toIsoString(row.updated_at) : row.created_at ? toIsoString(row.created_at) : "1970-01-01T00:00:00.000Z"
  };
}

export function mapSourceDocument(row: Record<string, unknown>): SourceDocument {
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

export function mapDnaMatch(row: Record<string, unknown>): DnaMatch {
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

export function mapAIAnalysisRun(row: Record<string, unknown>): AIAnalysisRun {
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

export function mapAppliedImport(row: Record<string, unknown>): AppliedGedcomImport {
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

export function mapRawRecord(row: Record<string, unknown>): RawGedcomRecord {
  return {
    id: String(row.id),
    importId: String(row.import_id),
    xref: optionalString(row.xref),
    type: String(row.record_type),
    checksum: String(row.checksum),
    raw: String(row.raw_text)
  };
}

export function mapWorkspaceBackup(row: Record<string, unknown>): WorkspaceBackup {
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

export function normalizeAIAnalysisRun(run: AIAnalysisRun): AIAnalysisRun {
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

function normalizeWorkFingerprint(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
