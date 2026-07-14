import type { PoolClient } from "pg";
import type {
  AIAnalysisRun,
  AppliedGedcomImport,
  DnaConnectionHypothesis,
  DnaMatch,
  PersonSummary,
  RawGedcomRecord,
  ResearchCase,
  SourceDocument,
  WorkspaceBackup
} from "../models";

// Row-level writers for the workspace tables. Every function writes exactly
// the rows it is given — callers own transactions, locking, and normalization
// of domain values (except confidence, which is clamped here because every
// confidence-bearing column shares the same 0..1 constraint).

const bulkInsertBatchSize = 2_000;

// Lists are newest-first and their order is persisted in sort_order. Prepends
// take COALESCE(MIN(sort_order), 0) - 1 (or a contiguous descending range for
// bulk prepends) so no existing row is ever renumbered; negative values are
// fine because only relative order matters.
const sortableTables = {
  research_cases: "research_cases",
  tasks: "tasks",
  sources: "sources",
  dna_matches: "dna_matches",
  ai_runs: "ai_runs",
  import_snapshots: "import_snapshots",
  raw_records: "raw_records",
  workspace_backups: "workspace_backups",
  people: "people",
  evidence_items: "evidence_items",
  hypotheses: "hypotheses"
} as const;

export type SortableTable = keyof typeof sortableTables;
type RowWriteMode = "upsert" | "insert";

export function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

export function normalizeWorkFingerprint(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export async function prependSortOrder(client: PoolClient, table: SortableTable, archiveId: string): Promise<number> {
  const result = await client.query<{ next: number }>(
    `SELECT COALESCE(MIN(sort_order), 0) - 1 AS next FROM ${sortableTables[table]} WHERE archive_id = $1`,
    [archiveId]
  );
  return result.rows[0].next;
}

// Returns the sort_order for the FIRST of `count` prepended items; item i gets
// start + i and the whole range sits below the current minimum.
export async function prependSortOrderRange(client: PoolClient, table: SortableTable, archiveId: string, count: number): Promise<number> {
  const result = await client.query<{ minimum: number }>(
    `SELECT COALESCE(MIN(sort_order), 0) AS minimum FROM ${sortableTables[table]} WHERE archive_id = $1`,
    [archiveId]
  );
  return result.rows[0].minimum - count;
}

export async function prependCaseTaskSortOrder(client: PoolClient, archiveId: string, caseId: string): Promise<number> {
  const result = await client.query<{ next: number }>(
    "SELECT COALESCE(MIN(sort_order), 0) - 1 AS next FROM tasks WHERE archive_id = $1 AND case_id = $2",
    [archiveId, caseId]
  );
  return result.rows[0].next;
}

export async function upsertCaseRow(
  client: PoolClient,
  archiveId: string,
  researchCase: ResearchCase,
  sortOrder: number,
  writeMode: RowWriteMode = "upsert"
): Promise<void> {
  const conflictClause = writeMode === "insert"
    ? ""
    : `ON CONFLICT (archive_id, id) DO UPDATE SET
       title = EXCLUDED.title, question = EXCLUDED.question, status = EXCLUDED.status,
       focus = EXCLUDED.focus, privacy = EXCLUDED.privacy, sort_order = EXCLUDED.sort_order`;
  await client.query(
    `INSERT INTO research_cases (id, archive_id, title, question, status, focus, privacy, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ${conflictClause}`,
    [researchCase.id, archiveId, researchCase.title, researchCase.question, researchCase.status, researchCase.focus, researchCase.privacy, sortOrder]
  );
}

// Replaces all children of one case; used when a case is created or replaced
// wholesale. Individual task/evidence mutations use the targeted writers below.
export async function replaceCaseChildren(
  client: PoolClient,
  archiveId: string,
  researchCase: ResearchCase,
  writeMode: RowWriteMode = "upsert"
): Promise<void> {
  if (writeMode === "upsert") {
    await client.query("DELETE FROM tasks WHERE archive_id = $1 AND case_id = $2", [archiveId, researchCase.id]);
    await client.query("DELETE FROM evidence_items WHERE archive_id = $1 AND case_id = $2", [archiveId, researchCase.id]);
    await client.query("DELETE FROM hypotheses WHERE archive_id = $1 AND case_id = $2", [archiveId, researchCase.id]);
  }

  for (const [index, hypothesis] of researchCase.hypotheses.entries()) {
    await upsertHypothesisRow(client, archiveId, researchCase.id, hypothesis, index, writeMode);
  }
  for (const [index, evidence] of researchCase.evidence.entries()) {
    await upsertEvidenceRow(client, archiveId, researchCase.id, evidence, index, writeMode);
  }
  for (const [index, task] of researchCase.tasks.entries()) {
    await upsertTaskRow(client, archiveId, researchCase.id, task, index, writeMode);
  }
}

export async function upsertHypothesisRow(
  client: PoolClient,
  archiveId: string,
  caseId: string,
  hypothesis: ResearchCase["hypotheses"][number],
  sortOrder: number,
  writeMode: RowWriteMode = "upsert"
): Promise<void> {
  const conflictClause = writeMode === "insert"
    ? ""
    : `ON CONFLICT (archive_id, id) DO UPDATE SET
       case_id = EXCLUDED.case_id, statement = EXCLUDED.statement, confidence = EXCLUDED.confidence,
       status = EXCLUDED.status, decisions = EXCLUDED.decisions, updated_at = EXCLUDED.updated_at,
       sort_order = EXCLUDED.sort_order`;
  await client.query(
    `INSERT INTO hypotheses (
       id, archive_id, case_id, statement, confidence, status, decisions, updated_at, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     ${conflictClause}`,
    [
      hypothesis.id,
      archiveId,
      caseId,
      hypothesis.statement,
      normalizeConfidence(hypothesis.confidence),
      hypothesis.status,
      JSON.stringify(hypothesis.decisions ?? []),
      hypothesis.updatedAt ?? new Date().toISOString(),
      sortOrder
    ]
  );
}

export async function updateHypothesisRow(
  client: PoolClient,
  archiveId: string,
  caseId: string,
  hypothesis: ResearchCase["hypotheses"][number]
): Promise<void> {
  await client.query(
    `UPDATE hypotheses SET statement = $4, confidence = $5, status = $6, decisions = $7::jsonb, updated_at = $8
     WHERE archive_id = $1 AND id = $2 AND case_id = $3`,
    [
      archiveId,
      hypothesis.id,
      caseId,
      hypothesis.statement,
      normalizeConfidence(hypothesis.confidence),
      hypothesis.status,
      JSON.stringify(hypothesis.decisions ?? []),
      hypothesis.updatedAt ?? new Date().toISOString()
    ]
  );
}

export async function upsertTaskRow(
  client: PoolClient,
  archiveId: string,
  caseId: string,
  task: ResearchCase["tasks"][number],
  sortOrder: number,
  writeMode: RowWriteMode = "upsert"
): Promise<void> {
  const now = new Date().toISOString();
  const conflictClause = writeMode === "insert"
    ? ""
    : `ON CONFLICT (archive_id, id) DO UPDATE SET
       case_id = EXCLUDED.case_id, title = EXCLUDED.title, status = EXCLUDED.status,
       origin = EXCLUDED.origin, priority = EXCLUDED.priority, guide_key = EXCLUDED.guide_key,
       work_fingerprint = EXCLUDED.work_fingerprint, guidance = EXCLUDED.guidance,
       target_hypothesis_id = EXCLUDED.target_hypothesis_id, context_refs = EXCLUDED.context_refs,
       outcomes = EXCLUDED.outcomes, created_at = EXCLUDED.created_at,
       completed_at = EXCLUDED.completed_at, updated_at = EXCLUDED.updated_at, sort_order = EXCLUDED.sort_order`;
  await client.query(
    `INSERT INTO tasks (
       id, archive_id, case_id, title, status, origin, priority, guide_key, work_fingerprint,
       guidance, target_hypothesis_id, context_refs, outcomes, created_at, completed_at, updated_at, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17)
     ${conflictClause}`,
    [
      task.id,
      archiveId,
      caseId,
      task.title,
      task.status,
      task.origin ?? "manual",
      task.priority ?? "normal",
      task.guideKey,
      task.workFingerprint?.trim() || normalizeWorkFingerprint(task.title),
      task.guidance ?? "",
      task.targetHypothesisId,
      JSON.stringify(task.contextRefs ?? []),
      JSON.stringify(task.outcomes ?? []),
      task.createdAt ?? now,
      task.completedAt,
      task.updatedAt ?? now,
      sortOrder
    ]
  );
}

export async function updateTaskRow(client: PoolClient, archiveId: string, caseId: string, task: ResearchCase["tasks"][number]): Promise<void> {
  await client.query(
    `UPDATE tasks SET title = $4, status = $5, origin = $6, priority = $7, guide_key = $8,
       work_fingerprint = $9, guidance = $10, target_hypothesis_id = $11,
       context_refs = $12::jsonb, outcomes = $13::jsonb, completed_at = $14, updated_at = $15
     WHERE archive_id = $1 AND id = $2 AND case_id = $3`,
    [
      archiveId,
      task.id,
      caseId,
      task.title,
      task.status,
      task.origin ?? "manual",
      task.priority ?? "normal",
      task.guideKey,
      task.workFingerprint?.trim() || normalizeWorkFingerprint(task.title),
      task.guidance ?? "",
      task.targetHypothesisId,
      JSON.stringify(task.contextRefs ?? []),
      JSON.stringify(task.outcomes ?? []),
      task.completedAt,
      task.updatedAt ?? new Date().toISOString()
    ]
  );
}

export async function upsertEvidenceRow(
  client: PoolClient,
  archiveId: string,
  caseId: string,
  evidence: ResearchCase["evidence"][number],
  sortOrder: number,
  writeMode: RowWriteMode = "upsert"
): Promise<void> {
  const conflictClause = writeMode === "insert"
    ? ""
    : `ON CONFLICT (archive_id, id) DO UPDATE SET
       title = EXCLUDED.title, evidence_type = EXCLUDED.evidence_type, summary = EXCLUDED.summary,
       confidence = EXCLUDED.confidence, linked_person_id = EXCLUDED.linked_person_id,
       linked_dna_match_id = EXCLUDED.linked_dna_match_id,
       sort_order = evidence_items.sort_order`;
  await client.query(
    `INSERT INTO evidence_items (
       id, archive_id, case_id, title, evidence_type, summary, confidence, linked_person_id, linked_dna_match_id, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ${conflictClause}`,
    [
      evidence.id,
      archiveId,
      caseId,
      evidence.title,
      evidence.type,
      evidence.summary,
      normalizeConfidence(evidence.confidence),
      evidence.linkedPersonId,
      evidence.linkedDnaMatchId,
      sortOrder
    ]
  );
}

export async function upsertDnaMatchRow(client: PoolClient, archiveId: string, match: DnaMatch, sortOrder?: number): Promise<void> {
  await client.query(
    `INSERT INTO dna_matches (
       id, archive_id, display_name, total_cm, longest_segment_cm, shared_dna_percent,
       predicted_relationship, side, tree_status, surnames, places, shared_matches, notes,
       ancestry_url, triage_status, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE($16, 0))
     ON CONFLICT (archive_id, id) DO UPDATE SET
       display_name = EXCLUDED.display_name, total_cm = EXCLUDED.total_cm,
       longest_segment_cm = EXCLUDED.longest_segment_cm, shared_dna_percent = EXCLUDED.shared_dna_percent,
       predicted_relationship = EXCLUDED.predicted_relationship, side = EXCLUDED.side,
       tree_status = EXCLUDED.tree_status, surnames = EXCLUDED.surnames, places = EXCLUDED.places,
       shared_matches = EXCLUDED.shared_matches, notes = EXCLUDED.notes,
       ancestry_url = EXCLUDED.ancestry_url, triage_status = EXCLUDED.triage_status,
       sort_order = COALESCE($16, dna_matches.sort_order)`,
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
      sortOrder
    ]
  );
}

export async function upsertDnaHypothesisRow(
  client: PoolClient,
  archiveId: string,
  matchId: string,
  hypothesis: DnaConnectionHypothesis
): Promise<void> {
  await client.query(
    `INSERT INTO dna_hypotheses (
       id, archive_id, dna_match_id, likely_branch, likely_generation, geography,
       candidate_common_ancestors, confidence, explanation, evidence, uncertainty
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
     ON CONFLICT (archive_id, id) DO UPDATE SET
       likely_branch = EXCLUDED.likely_branch, likely_generation = EXCLUDED.likely_generation,
       geography = EXCLUDED.geography, candidate_common_ancestors = EXCLUDED.candidate_common_ancestors,
       confidence = EXCLUDED.confidence, explanation = EXCLUDED.explanation,
       evidence = EXCLUDED.evidence, uncertainty = EXCLUDED.uncertainty`,
    [
      `hyp-${matchId}`,
      archiveId,
      matchId,
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

export async function deleteDnaMatchRows(client: PoolClient, archiveId: string, matchId: string): Promise<number> {
  await client.query("DELETE FROM dna_hypotheses WHERE archive_id = $1 AND dna_match_id = $2", [archiveId, matchId]);
  const deleted = await client.query("DELETE FROM dna_matches WHERE archive_id = $1 AND id = $2", [archiveId, matchId]);
  return deleted.rowCount ?? 0;
}

export async function upsertAiRunRow(client: PoolClient, archiveId: string, run: AIAnalysisRun, sortOrder: number): Promise<void> {
  await client.query(
    `INSERT INTO ai_runs (
       id, archive_id, run_type, provider, model, question, answer, status, provider_status,
       evidence, uncertainty, suggestions, context_references, result, anomaly_count, linked_case_id,
       prompt_redacted, error, created_at, completed_at, sort_order
     ) VALUES (
       $1, $2, 'analysis', $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
       $13::jsonb, $14, $15, $16, $17, $18, $19, $20
     )
     ON CONFLICT (archive_id, id) DO UPDATE SET
       provider = EXCLUDED.provider, model = EXCLUDED.model, question = EXCLUDED.question,
       answer = EXCLUDED.answer, status = EXCLUDED.status, provider_status = EXCLUDED.provider_status,
       evidence = EXCLUDED.evidence, uncertainty = EXCLUDED.uncertainty, suggestions = EXCLUDED.suggestions,
       context_references = EXCLUDED.context_references, result = EXCLUDED.result,
       anomaly_count = EXCLUDED.anomaly_count, linked_case_id = EXCLUDED.linked_case_id,
       prompt_redacted = EXCLUDED.prompt_redacted, error = EXCLUDED.error,
       created_at = EXCLUDED.created_at, completed_at = EXCLUDED.completed_at, sort_order = EXCLUDED.sort_order`,
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
      sortOrder
    ]
  );
}

// Newest rows have the lowest sort_order, so keeping the newest N means
// keeping the N lowest.
export async function pruneAiRunRows(client: PoolClient, archiveId: string, keep: number): Promise<void> {
  await client.query(
    `DELETE FROM ai_runs WHERE archive_id = $1 AND id NOT IN (
       SELECT id FROM ai_runs WHERE archive_id = $1 ORDER BY sort_order ASC, created_at DESC LIMIT $2
     )`,
    [archiveId, keep]
  );
}

export async function upsertImportSnapshotRow(
  client: PoolClient,
  archiveId: string,
  item: AppliedGedcomImport,
  sortOrder: number
): Promise<void> {
  await client.query(
    `INSERT INTO import_snapshots (
       id, archive_id, source_name, checksum, summary, record_count, people_imported,
       sources_imported, raw_record_count, backup_id, applied_at, sort_order
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (archive_id, id) DO UPDATE SET
       source_name = EXCLUDED.source_name, checksum = EXCLUDED.checksum, summary = EXCLUDED.summary,
       record_count = EXCLUDED.record_count, people_imported = EXCLUDED.people_imported,
       sources_imported = EXCLUDED.sources_imported, raw_record_count = EXCLUDED.raw_record_count,
       backup_id = EXCLUDED.backup_id, applied_at = EXCLUDED.applied_at, sort_order = EXCLUDED.sort_order`,
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
      sortOrder
    ]
  );
}

// Two writers on purpose: a fresh backup carries its full snapshot payload,
// while whole-workspace persists (seed, writeWorkspace) must never overwrite
// a previously stored snapshot with '{}'.
export async function insertBackupRow(
  client: PoolClient,
  archiveId: string,
  backup: WorkspaceBackup,
  snapshotJson: string,
  sortOrder: number
): Promise<void> {
  await client.query(
    `INSERT INTO workspace_backups (
       id, archive_id, created_at, reason, storage_key, people_count, sources_count,
       cases_count, dna_match_count, import_count, raw_record_count, snapshot, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
     ON CONFLICT (archive_id, id) DO UPDATE SET
       reason = EXCLUDED.reason, storage_key = EXCLUDED.storage_key,
       people_count = EXCLUDED.people_count, sources_count = EXCLUDED.sources_count,
       cases_count = EXCLUDED.cases_count, dna_match_count = EXCLUDED.dna_match_count,
       import_count = EXCLUDED.import_count, raw_record_count = EXCLUDED.raw_record_count,
       snapshot = EXCLUDED.snapshot, sort_order = EXCLUDED.sort_order`,
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
      snapshotJson,
      sortOrder
    ]
  );
}

export async function upsertBackupRowPreservingSnapshot(
  client: PoolClient,
  archiveId: string,
  backup: WorkspaceBackup,
  sortOrder: number
): Promise<void> {
  await client.query(
    `INSERT INTO workspace_backups (
       id, archive_id, created_at, reason, storage_key, people_count, sources_count,
       cases_count, dna_match_count, import_count, raw_record_count, snapshot, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '{}'::jsonb, $12)
     ON CONFLICT (archive_id, id) DO UPDATE SET
       reason = EXCLUDED.reason, storage_key = EXCLUDED.storage_key,
       people_count = EXCLUDED.people_count, sources_count = EXCLUDED.sources_count,
       cases_count = EXCLUDED.cases_count, dna_match_count = EXCLUDED.dna_match_count,
       import_count = EXCLUDED.import_count, raw_record_count = EXCLUDED.raw_record_count,
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
      sortOrder
    ]
  );
}

export async function pruneBackupRows(client: PoolClient, archiveId: string, keep: number): Promise<void> {
  await client.query(
    `DELETE FROM workspace_backups WHERE archive_id = $1 AND id NOT IN (
       SELECT id FROM workspace_backups WHERE archive_id = $1 ORDER BY sort_order ASC, created_at DESC LIMIT $2
     )`,
    [archiveId, keep]
  );
}

export async function updatePersonCurationRow(
  client: PoolClient,
  archiveId: string,
  personId: string,
  fields: { published: boolean; privacy: string; livingStatus: string }
): Promise<number> {
  const result = await client.query(
    "UPDATE people SET published = $3, privacy = $4, living_status = $5 WHERE archive_id = $1 AND id = $2",
    [archiveId, personId, fields.published, fields.privacy, fields.livingStatus]
  );
  return result.rowCount ?? 0;
}

export async function updatePeopleRelatives(
  client: PoolClient,
  archiveId: string,
  entries: Array<{ id: string; relatives: string[] }>
): Promise<void> {
  await insertJsonBatches(entries, async (batch) => {
    await client.query(
      `UPDATE people SET relatives = row.relatives
       FROM jsonb_to_recordset($2::jsonb) AS row(id text, relatives text[])
       WHERE people.archive_id = $1 AND people.id = row.id`,
      [archiveId, JSON.stringify(batch)]
    );
  });
}

export async function upsertPeopleRows(
  client: PoolClient,
  archiveId: string,
  people: PersonSummary[],
  startSortOrder: number
): Promise<void> {
  const personRows = people.map((person, index) => ({
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
    sort_order: startSortOrder + index
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
      )
      ON CONFLICT (archive_id, id) DO UPDATE SET
        slug = EXCLUDED.slug, display_name = EXCLUDED.display_name, given_name = EXCLUDED.given_name,
        surname = EXCLUDED.surname, sex = EXCLUDED.sex, birth_date = EXCLUDED.birth_date,
        birth_place = EXCLUDED.birth_place, death_date = EXCLUDED.death_date,
        death_place = EXCLUDED.death_place, living_status = EXCLUDED.living_status,
        privacy = EXCLUDED.privacy, published = EXCLUDED.published, relatives = EXCLUDED.relatives,
        notes = EXCLUDED.notes, sort_order = EXCLUDED.sort_order`,
      [archiveId, JSON.stringify(rows)]
    );
  });
}

// Facts have no stable identity across imports (their ids derive from file
// line numbers), so each person's facts are replaced wholesale.
export async function replacePersonFacts(client: PoolClient, archiveId: string, people: PersonSummary[]): Promise<void> {
  // Postgres caches each foreign key's referenced-row lookup plan per session.
  // If that plan was first built while `people` was tiny (e.g. the demo seed),
  // it can be a sequential scan — and a bulk fact insert right after a bulk
  // people insert then seq-scans the now-large people table once per fact row
  // (observed: ~20x slowdown on a 20k-person import). Dropping cached plans
  // forces the RI check to re-plan against the table's current size.
  await client.query("DISCARD PLANS");
  await client.query("DELETE FROM person_facts WHERE archive_id = $1 AND person_id = ANY($2)", [
    archiveId,
    people.map((person) => person.id)
  ]);

  const factRows = people.flatMap((person) =>
    person.facts.map((fact, sortOrder) => ({
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
    }))
  );

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
      )
      ON CONFLICT (archive_id, id) DO UPDATE SET
        person_id = EXCLUDED.person_id, fact_type = EXCLUDED.fact_type, date_text = EXCLUDED.date_text,
        place_text = EXCLUDED.place_text, value_text = EXCLUDED.value_text, source_text = EXCLUDED.source_text,
        privacy = EXCLUDED.privacy, confidence = EXCLUDED.confidence, sort_order = EXCLUDED.sort_order`,
      [archiveId, JSON.stringify(rows)]
    );
  });
}

export async function upsertSourceRows(
  client: PoolClient,
  archiveId: string,
  sources: SourceDocument[],
  startSortOrder: number
): Promise<void> {
  const sourceRows = sources.map((source, index) => ({
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
    sort_order: startSortOrder + index
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
      )
      ON CONFLICT (archive_id, id) DO UPDATE SET
        title = EXCLUDED.title, source_type = EXCLUDED.source_type, import_id = EXCLUDED.import_id,
        raw_record_id = EXCLUDED.raw_record_id, file_name = EXCLUDED.file_name,
        storage_key = EXCLUDED.storage_key, mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes, repository = EXCLUDED.repository, url = EXCLUDED.url,
        ancestry_apid = EXCLUDED.ancestry_apid, citation_date = EXCLUDED.citation_date,
        linked_person_id = EXCLUDED.linked_person_id, linked_case_id = EXCLUDED.linked_case_id,
        transcript = EXCLUDED.transcript, notes = EXCLUDED.notes, privacy = EXCLUDED.privacy,
        confidence = EXCLUDED.confidence, created_at = EXCLUDED.created_at, sort_order = EXCLUDED.sort_order`,
      [archiveId, JSON.stringify(rows)]
    );
  });
}

export async function insertRawRecordRows(
  client: PoolClient,
  archiveId: string,
  records: RawGedcomRecord[],
  startSortOrder: number
): Promise<void> {
  const recordRows = records.map((record, index) => ({
    id: record.id,
    import_id: record.importId,
    xref: record.xref,
    record_type: record.type,
    raw_text: record.raw,
    checksum: record.checksum,
    sort_order: startSortOrder + index
  }));

  await insertJsonBatches(recordRows, async (rows) => {
    await client.query(
      `INSERT INTO raw_records (id, archive_id, import_id, xref, record_type, raw_text, checksum, sort_order)
      SELECT row.id, $1::text, row.import_id, row.xref, row.record_type, row.raw_text, row.checksum, row.sort_order
      FROM jsonb_to_recordset($2::jsonb) AS row(
        id text, import_id text, xref text, record_type text, raw_text text, checksum text, sort_order integer
      )
      ON CONFLICT (archive_id, id) DO UPDATE SET
        import_id = EXCLUDED.import_id, xref = EXCLUDED.xref, record_type = EXCLUDED.record_type,
        raw_text = EXCLUDED.raw_text, checksum = EXCLUDED.checksum, sort_order = EXCLUDED.sort_order`,
      [archiveId, JSON.stringify(rows)]
    );
  });
}

export async function insertJsonBatches<T>(rows: T[], insert: (batch: T[]) => Promise<void>): Promise<void> {
  for (let index = 0; index < rows.length; index += bulkInsertBatchSize) {
    await insert(rows.slice(index, index + bulkInsertBatchSize));
  }
}
