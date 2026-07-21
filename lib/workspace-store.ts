import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { projectResearchCaseForDnaCapability } from "./case-search";
import { withTransaction, type DatabaseOptions } from "./db";
// Imported from ./db-rls directly so unit tests that mock "@/lib/db" keep the
// real scope helper.
import { withRlsArchiveScope } from "./db-rls";
import { createDemoAiRuns } from "./demo-ai-runs";
import { createDemoSources } from "./demo-sources";
import { demoPurgeProductTables } from "./demo-purge";
import { createDnaConnectionHypothesis, scoreDnaMatch } from "./dna";
import { readArchiveIdSetting } from "./environment-aliases";
import { demoCases, demoDnaMatches, demoPeople } from "./demo-data";
import { prepareGedcomImport, type PreparedGedcomImport } from "./gedcom/apply";
import { buildFamilyRelationshipMap, parseGedcom } from "./gedcom/parser";
import {
  requireHostedCapability,
  resolveHostedCapabilities,
  validateHostedGedcomPeople
} from "./hosted-capabilities";
import { integrationImportId } from "./integrations/import-id";
import { datasetModes, resolveDatasetConfiguration, type DatasetMode } from "./hosted-config";
import type { ImportPersonXrefMapping, PersonXrefMappingsByImportId } from "./person-relationships";
import { publicDemoCanonicalArchiveId } from "./public-demo-config";
import { buildResearchGuide } from "./research-guide";
import {
  mapAIAnalysisRun,
  mapAppliedImport,
  mapDnaMatch,
  mapEvidence,
  mapHypothesis,
  mapPersonFact,
  mapPersonRow,
  mapRawRecord,
  mapSourceDocument,
  mapTask,
  mapWorkspaceBackup,
  normalizeAIAnalysisRun
} from "./store/mappers";
import {
  deleteDnaMatchRows,
  insertBackupRow,
  insertRawRecordRows,
  normalizeConfidence,
  normalizeWorkFingerprint,
  prependCaseTaskSortOrder,
  prependSortOrder,
  prependSortOrderRange,
  pruneAiRunRows,
  pruneBackupRows,
  replaceCaseChildren,
  replacePersonFacts,
  updatePeopleRelatives,
  updatePersonCurationRow,
  updateHypothesisRow,
  updateTaskRow,
  upsertAiRunRow,
  upsertBackupRowPreservingSnapshot,
  upsertCaseRow,
  upsertDnaHypothesisRow,
  upsertDnaMatchRow,
  upsertEvidenceRow,
  upsertHypothesisRow,
  upsertImportSnapshotRow,
  upsertPeopleRows,
  upsertSourceRows,
  upsertTaskRow
} from "./store/rows";
import type {
  AIAnalysisRun,
  AppliedGedcomImport,
  DnaConnectionHypothesis,
  DnaMatch,
  PersonSummary,
  PrivacyLevel,
  RawGedcomRecord,
  ResearchCase,
  ResearchHypothesis,
  ResearchHypothesisDecision,
  ResearchReference,
  ResearchSearchScope,
  ResearchTask,
  ResearchTaskOutcome,
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

const apiResourceIdentitySnapshotKey = "__kinResolveApiResourceIdentities";
const apiResourceIdentityKinds = ["people", "personFacts", "sources", "researchCases"] as const;
type ApiResourceIdentityKind = (typeof apiResourceIdentityKinds)[number];
type ApiResourceIdentityMaps = Record<ApiResourceIdentityKind, Map<string, string>>;
type StoredApiResourceIdentitySnapshot = {
  schemaVersion: 1;
  archiveId: string;
  people: Array<{ id: string; apiId: string }>;
  personFacts: Array<{ id: string; apiId: string }>;
  sources: Array<{ id: string; apiId: string }>;
  researchCases: Array<{ id: string; apiId: string }>;
};
const apiResourceUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type WorkspaceStoreOptions = DatabaseOptions & {
  archiveId?: string;
  datasetMode?: DatasetMode;
  demoGuestFence?: DemoGuestGenerationFence;
};

export type DemoGuestGenerationFence = {
  sessionId: string;
  generation: number;
};

export type ArchiveProvisioning = {
  archiveId: string;
  datasetMode: DatasetMode;
  demoFixtureVersion: number | null;
};

export type ArchiveProvisioningResult = ArchiveProvisioning & {
  created: boolean;
};

export type CanonicalPublicDemoFixtureRotationResult = {
  archiveId: typeof publicDemoCanonicalArchiveId;
  previousDemoFixtureVersion: number | null;
  demoFixtureVersion: number;
  status: "not-provisioned" | "already-current" | "rotated";
};

type UpdateCaseTaskOptions = WorkspaceStoreOptions & {
  allowManualCompletionWithoutOutcome?: boolean;
};

const defaultArchiveId = "archive-default";
export const demoFixtureVersion = 5;
// Full pre-import snapshots are large; retain only the most recent ones.
const retainedBackupCount = 10;
const retainedAiRunCount = 25;

export function getArchiveId(options: WorkspaceStoreOptions = {}): string {
  return options.archiveId ?? readArchiveIdSetting() ?? defaultArchiveId;
}

export function createDemoWorkspace(now = new Date()): WorkspaceData {
  return {
    version: "0.17.0",
    archiveName: "Hartwell–Mercer Family Archive",
    archiveTagline: "A completely fictional family archive for exploring Kin Resolve.",
    people: demoPeople,
    cases: demoCases,
    sources: createDemoSources(now),
    dnaMatches: demoDnaMatches,
    aiRuns: createDemoAiRuns(),
    imports: [],
    rawRecords: [],
    backups: [],
    updatedAt: now.toISOString()
  };
}

// Compatibility name for self-hosted callers and tests. Hosted deployments
// create demo data only through provisionArchive("demo").
export const createSeedWorkspace = createDemoWorkspace;

export function createEmptyWorkspace(now = new Date()): WorkspaceData {
  return {
    version: "0.17.0",
    archiveName: "Kin Resolve Private Archive",
    archiveTagline: "A private family history research workspace.",
    people: [],
    cases: [],
    sources: [],
    dnaMatches: [],
    aiRuns: [],
    imports: [],
    rawRecords: [],
    backups: [],
    updatedAt: now.toISOString()
  };
}

type ArchiveProvisioningRow = {
  id: string;
  dataset_mode: string;
  demo_fixture_version: number | null;
};

export async function getArchiveProvisioning(
  options: WorkspaceStoreOptions = {}
): Promise<ArchiveProvisioning | null> {
  const archiveId = getArchiveId(options);
  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    const result = await client.query<ArchiveProvisioningRow>(
      "SELECT id, dataset_mode, demo_fixture_version FROM archives WHERE id = $1",
      [archiveId]
    );
    return result.rows[0] ? mapArchiveProvisioning(result.rows[0]) : null;
  });
}

export async function requireProvisionedArchive(
  options: WorkspaceStoreOptions = {}
): Promise<ArchiveProvisioning> {
  const archiveId = getArchiveId(options);
  return withTransaction(withRlsArchiveScope(options, archiveId), (client) => requireProvisionedArchiveRow(client, archiveId, options));
}

export async function provisionArchive(
  datasetMode: DatasetMode,
  options: WorkspaceStoreOptions = {}
): Promise<ArchiveProvisioningResult> {
  if (!isOneOf(datasetMode, datasetModes)) {
    throw new Error("dataset mode must be empty, demo, or pilot");
  }

  const archiveId = getArchiveId(options);
  const workspace = datasetMode === "demo" ? createDemoWorkspace() : createEmptyWorkspace();
  const fixtureVersion = datasetMode === "demo" ? demoFixtureVersion : null;

  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    const inserted = await client.query<ArchiveProvisioningRow>(
      `INSERT INTO archives
         (id, name, tagline, slug, dataset_mode, demo_fixture_version, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, dataset_mode, demo_fixture_version`,
      [
        archiveId,
        workspace.archiveName,
        workspace.archiveTagline,
        slugifyArchive(`${workspace.archiveName}-${archiveId}`),
        datasetMode,
        fixtureVersion,
        workspace.updatedAt
      ]
    );

    if (inserted.rows[0]) {
      await persistWorkspace(client, archiveId, workspace);
      return { ...mapArchiveProvisioning(inserted.rows[0]), created: true };
    }

    const existing = await client.query<ArchiveProvisioningRow>(
      "SELECT id, dataset_mode, demo_fixture_version FROM archives WHERE id = $1 FOR UPDATE",
      [archiveId]
    );
    const provisioning = existing.rows[0] ? mapArchiveProvisioning(existing.rows[0]) : null;
    if (!provisioning) {
      throw archiveNotProvisionedError(archiveId);
    }
    if (provisioning.datasetMode !== datasetMode) {
      throw new Error(
        `Archive ${archiveId} is already provisioned as ${provisioning.datasetMode}; refusing to reprovision it as ${datasetMode}.`
      );
    }
    assertCurrentDemoFixture(provisioning);
    return { ...provisioning, created: false };
  });
}

const canonicalDemoFixtureWorkspaceTables = new Set<string>([
  "tasks",
  "evidence_items",
  "hypotheses",
  "research_cases",
  "dna_hypotheses",
  "person_facts",
  "ai_runs",
  "sources",
  "raw_records",
  "import_snapshots",
  "workspace_backups",
  "dna_matches",
  "people"
]);
const unsupportedCanonicalDemoFixtureRotationTables = demoPurgeProductTables.filter(
  (name) => !canonicalDemoFixtureWorkspaceTables.has(name)
);

export async function rotateCanonicalPublicDemoFixture(
  expectedPreviousFixtureVersion: number,
  options: WorkspaceStoreOptions = {}
): Promise<CanonicalPublicDemoFixtureRotationResult> {
  const archiveId = getArchiveId(options);
  if (archiveId !== publicDemoCanonicalArchiveId) {
    throw new Error(`Demo fixture rotation is allowed only for ${publicDemoCanonicalArchiveId}.`);
  }
  if (
    !Number.isSafeInteger(expectedPreviousFixtureVersion)
    || expectedPreviousFixtureVersion < 1
    || expectedPreviousFixtureVersion >= demoFixtureVersion
  ) {
    throw new Error("The expected previous demo fixture version must be a positive integer below the current version.");
  }

  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    await client.query("SET LOCAL lock_timeout = '60s'");
    await client.query("SET LOCAL statement_timeout = '5min'");
    const existing = await client.query<ArchiveProvisioningRow>(
      `SELECT id, dataset_mode, demo_fixture_version
       FROM archives
       WHERE id = $1
       FOR UPDATE`,
      [archiveId]
    );
    const provisioning = existing.rows[0] ? mapArchiveProvisioning(existing.rows[0]) : null;
    if (!provisioning) {
      return {
        archiveId,
        previousDemoFixtureVersion: null,
        demoFixtureVersion,
        status: "not-provisioned"
      };
    }
    if (provisioning.datasetMode !== "demo") {
      throw new Error("The canonical public demo archive is not persisted as the demo dataset.");
    }
    if (provisioning.demoFixtureVersion === demoFixtureVersion) {
      return {
        archiveId,
        previousDemoFixtureVersion: demoFixtureVersion,
        demoFixtureVersion,
        status: "already-current"
      };
    }
    if (provisioning.demoFixtureVersion !== expectedPreviousFixtureVersion) {
      throw new Error(
        `Canonical public demo rotation expected fixture version ${expectedPreviousFixtureVersion}, `
        + `but the persisted version is ${String(provisioning.demoFixtureVersion)}.`
      );
    }

    await client.query(
      `LOCK TABLE ${unsupportedCanonicalDemoFixtureRotationTables
        .map((name) => `public.${name}`)
        .join(", ")} IN SHARE ROW EXCLUSIVE MODE`
    );
    const unsupported = await client.query<{ table_name: string }>(
      unsupportedCanonicalDemoFixtureRotationTables
        .map((name) => (
          `SELECT '${name}'::text AS table_name `
          + `WHERE EXISTS (SELECT 1 FROM public.${name} WHERE archive_id = $1)`
        ))
        .join(" UNION ALL "),
      [archiveId]
    );
    if (unsupported.rows.length > 0) {
      throw new Error(
        `Canonical public demo fixture rotation found unsupported product data in ${unsupported.rows
          .map((row) => row.table_name)
          .join(", ")}.`
      );
    }

    await persistWorkspace(client, archiveId, createDemoWorkspace());
    const updated = await client.query(
      `UPDATE archives
       SET demo_fixture_version = $2
       WHERE id = $1
         AND dataset_mode = 'demo'
         AND demo_fixture_version = $3
       RETURNING id`,
      [archiveId, demoFixtureVersion, expectedPreviousFixtureVersion]
    );
    if (updated.rowCount !== 1) {
      throw new Error("The canonical public demo fixture changed during rotation.");
    }
    return {
      archiveId,
      previousDemoFixtureVersion: expectedPreviousFixtureVersion,
      demoFixtureVersion,
      status: "rotated"
    };
  });
}

export async function readWorkspace(options: WorkspaceStoreOptions = {}): Promise<WorkspaceData> {
  const archiveId = getArchiveId(options);

  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    await requireProvisionedArchiveRow(client, archiveId, options);
    return loadWorkspace(client, archiveId);
  });
}

export async function readWorkspaceSnapshot(
  client: PoolClient,
  options: WorkspaceStoreOptions = {}
): Promise<WorkspaceData> {
  const archiveId = getArchiveId(options);
  await requireProvisionedArchiveRow(client, archiveId, options);
  return loadWorkspace(client, archiveId);
}

// Integration-applied imports store raw GEDCOM records whose FAM members
// point at provider xrefs, while the imported people carry generated local
// ids. The identity layer records the xref -> local person id mapping per
// connection in external_entity_refs; this reader regroups those mappings by
// the workspace import each connection produced so family edges can be
// translated back onto workspace people (see lib/person-relationships.ts).
// Legacy GEDCOM imports have no entry here: their person ids are the xrefs.
export async function readPersonXrefMappingsByImportId(
  options: WorkspaceStoreOptions = {}
): Promise<PersonXrefMappingsByImportId> {
  const archiveId = getArchiveId(options);

  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    await requireProvisionedArchiveRow(client, archiveId, options);
    return loadPersonXrefMappingsByImportId(client, archiveId);
  });
}

async function loadPersonXrefMappingsByImportId(
  client: PoolClient,
  archiveId: string
): Promise<PersonXrefMappingsByImportId> {
  const refsResult = await client.query<{ connection_id: string; external_id: string; local_entity_id: string }>(
    `SELECT connection_id, external_id, local_entity_id
     FROM external_entity_refs
     WHERE archive_id = $1 AND entity_type = 'person'`,
    [archiveId]
  );
  if (refsResult.rowCount === 0) {
    return new Map();
  }

  // GEDCOM xrefs are only unique within one connection's exports, so each
  // connection keeps its own map; colliding xrefs from different connections
  // must never cross-translate.
  const personIdByXrefByConnectionId = new Map<string, Map<string, string>>();
  for (const row of refsResult.rows) {
    const personIdByXref = personIdByXrefByConnectionId.get(row.connection_id) ?? new Map<string, string>();
    personIdByXref.set(row.external_id, row.local_entity_id);
    personIdByXrefByConnectionId.set(row.connection_id, personIdByXref);
  }

  // Integration snapshots are immutable and keep the (connection, artifact
  // sha256) pair every applied refresh was derived from; the workspace import
  // id is deterministic on that pair, so it can be recomputed here instead of
  // being stored twice.
  const snapshotsResult = await client.query<{ connection_id: string; sha256: string }>(
    "SELECT connection_id, sha256 FROM integration_snapshots WHERE archive_id = $1",
    [archiveId]
  );

  const mappingsByImportId = new Map<string, ImportPersonXrefMapping>();
  for (const row of snapshotsResult.rows) {
    const personIdByXref = personIdByXrefByConnectionId.get(row.connection_id);
    if (!personIdByXref) continue;
    mappingsByImportId.set(integrationImportId(row.connection_id, row.sha256), {
      scopeId: row.connection_id,
      personIdByXref
    });
  }
  return mappingsByImportId;
}

// Keeps provisioning and the demo-guest generation fence locked for the
// complete scoped SQL read. Demo reset must not be able to rotate a session's
// archive generation after validation but before a later pool-level query.
export async function withWorkspaceReadTransaction<T>(
  options: WorkspaceStoreOptions,
  action: (client: PoolClient, archiveId: string) => Promise<T>
): Promise<T>;
export async function withWorkspaceReadTransaction(
  options: WorkspaceStoreOptions,
  action: (client: PoolClient, archiveId: string) => Promise<unknown>
): Promise<unknown> {
  const archiveId = getArchiveId(options);

  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    await requireProvisionedArchiveRow(client, archiveId, options);
    return action(client, archiveId);
  });
}

// Scoped SQL readers call this before querying archive-owned rows. It validates
// provisioning without creating or loading a workspace.
export async function ensureWorkspaceProvisioned(options: WorkspaceStoreOptions = {}): Promise<void> {
  await requireProvisionedArchive(options);
}

export async function writeWorkspace(workspace: WorkspaceData, options: WorkspaceStoreOptions = {}): Promise<WorkspaceData> {
  const archiveId = getArchiveId(options);
  const next = normalizeWorkspaceData({
    ...workspace,
    updatedAt: new Date().toISOString()
  });

  await withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    await requireProvisionedArchiveRow(client, archiveId, options);
    await persistWorkspace(client, archiveId, next);
  });

  return next;
}

// Runs a row-level mutation inside ONE transaction. The UPDATE on the archive
// row both takes the lock that serializes concurrent mutations (the same
// guarantee the old SELECT ... FOR UPDATE gave the whole-workspace writer) and
// bumps the workspace timestamp. Provisioning is always an explicit operator
// action, so a missing archive fails without creating any data.
async function withArchiveMutation<T>(
  options: WorkspaceStoreOptions,
  action: (client: PoolClient, archiveId: string) => Promise<T>
): Promise<T> {
  const archiveId = getArchiveId(options);

  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    const locked = await client.query<ArchiveProvisioningRow>(
      `UPDATE archives SET updated_at = now() WHERE id = $1
       RETURNING id, dataset_mode, demo_fixture_version`,
      [archiveId]
    );
    if (locked.rowCount === 0) {
      throw archiveNotProvisionedError(archiveId);
    }
    validateArchiveProvisioning(mapArchiveProvisioning(locked.rows[0]!), options);
    await assertDemoGuestGenerationFenceInTransaction(
      client,
      archiveId,
      options.demoGuestFence
    );
    return action(client, archiveId);
  });
}

export async function assertDemoGuestGenerationFenceInTransaction(
  client: PoolClient,
  archiveId: string,
  fence?: DemoGuestGenerationFence
): Promise<void> {
  if (!fence) return;
  if (!Number.isSafeInteger(fence.generation) || fence.generation < 1) {
    throw new Error("The public demo generation fence is invalid.");
  }
  const active = await client.query(
    `SELECT 1
     FROM public.public_demo_sessions AS session
     WHERE session.id = $2::uuid
       AND session.archive_id = $1
       AND session.generation = $3
       AND session.status = 'active'
       AND session.expires_at > clock_timestamp()
     FOR SHARE`,
    [archiveId, fence.sessionId, fence.generation]
  );
  if (active.rows.length !== 1) {
    throw new Error("The public demo request uses a stale archive generation.");
  }
}

async function requireProvisionedArchiveRow(
  client: PoolClient,
  archiveId: string,
  options: WorkspaceStoreOptions
): Promise<ArchiveProvisioning> {
  const result = await client.query<ArchiveProvisioningRow>(
    "SELECT id, dataset_mode, demo_fixture_version FROM archives WHERE id = $1 FOR SHARE",
    [archiveId]
  );
  if (!result.rows[0]) {
    throw archiveNotProvisionedError(archiveId);
  }
  const provisioning = mapArchiveProvisioning(result.rows[0]);
  validateArchiveProvisioning(provisioning, options);
  await assertDemoGuestGenerationFenceInTransaction(
    client,
    archiveId,
    options.demoGuestFence
  );
  return provisioning;
}

function mapArchiveProvisioning(row: ArchiveProvisioningRow): ArchiveProvisioning {
  if (!isOneOf(row.dataset_mode, datasetModes)) {
    throw new Error(`Archive ${row.id} has invalid persisted dataset mode ${row.dataset_mode}.`);
  }
  return {
    archiveId: row.id,
    datasetMode: row.dataset_mode,
    demoFixtureVersion: row.demo_fixture_version
  };
}

function validateArchiveProvisioning(
  provisioning: ArchiveProvisioning,
  options: WorkspaceStoreOptions
): void {
  const expected = expectedDatasetMode(options);
  if (expected && provisioning.datasetMode !== expected) {
    throw new Error(
      `Archive dataset mode mismatch: configured ${expected}, but persisted ${provisioning.datasetMode} for ${provisioning.archiveId}.`
    );
  }
  assertCurrentDemoFixture(provisioning);
}

function expectedDatasetMode(options: WorkspaceStoreOptions): DatasetMode | undefined {
  if (options.datasetMode) {
    if (!isOneOf(options.datasetMode, datasetModes)) {
      throw new Error("dataset mode must be empty, demo, or pilot");
    }
    return options.datasetMode;
  }
  const configuration = resolveDatasetConfiguration();
  return configuration.deploymentMode === "hosted" || configuration.explicitDatasetMode
    ? configuration.datasetMode
    : undefined;
}

function assertCurrentDemoFixture(provisioning: ArchiveProvisioning): void {
  if (provisioning.datasetMode === "demo" && provisioning.demoFixtureVersion !== demoFixtureVersion) {
    throw new Error(
      `Archive ${provisioning.archiveId} uses demo fixture version ${String(provisioning.demoFixtureVersion)}; ` +
        `version ${demoFixtureVersion} requires a freshly provisioned demo archive.`
    );
  }
}

function archiveNotProvisionedError(archiveId: string): Error {
  return new Error(`Archive ${archiveId} is not provisioned. Run the explicit archive provisioning command first.`);
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

  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    const existing = await client.query<ArchiveProvisioningRow>(
      "SELECT id, dataset_mode, demo_fixture_version FROM archives WHERE id = $1 FOR UPDATE",
      [archiveId]
    );
    if (!existing.rows[0]) {
      throw archiveNotProvisionedError(archiveId);
    }
    validateArchiveProvisioning(mapArchiveProvisioning(existing.rows[0]), options);

    await client.query("UPDATE archives SET name = $2, tagline = $3, updated_at = now() WHERE id = $1", [archiveId, name, tagline]);
    return { name, tagline };
  });
}

export type NewCaseInput = {
  title: string;
  question: string;
  focus?: string;
  hypotheses?: Array<{
    statement: string;
    confidence?: number;
  }>;
  evidence?: Array<{
    title: string;
    type: string;
    summary: string;
    confidence?: number;
  }>;
};

/**
 * Creates a user-authored case without accepting persistence ids, workflow
 * state, guide metadata, or attributed history from the caller.
 */
export async function createNewCase(
  input: NewCaseInput,
  options: WorkspaceStoreOptions = {}
): Promise<ResearchCase> {
  const now = new Date().toISOString();
  return createCase(
    {
      title: input.title,
      question: input.question,
      focus: input.focus ?? "",
      status: "active",
      privacy: "private",
      hypotheses: (input.hypotheses ?? []).map((hypothesis) => ({
        id: `hyp-${randomUUID()}`,
        statement: hypothesis.statement,
        confidence: hypothesis.confidence ?? 0.5,
        status: "open",
        decisions: [],
        updatedAt: now
      })),
      evidence: (input.evidence ?? []).map((evidence) => ({
        id: `ev-${randomUUID()}`,
        title: evidence.title,
        type: evidence.type,
        summary: evidence.summary,
        confidence: evidence.confidence ?? 0.5
      })),
      tasks: []
    },
    options
  );
}

export async function createCase(input: Partial<ResearchCase>, options: WorkspaceStoreOptions = {}): Promise<ResearchCase> {
  if (!input.title?.trim() || !input.question?.trim()) {
    throw new Error("title and question are required");
  }

  const created = normalizeResearchCase({
    id: input.id ?? `case-${randomUUID()}`,
    title: input.title.trim(),
    question: input.question.trim(),
    status: input.status ?? "active",
    privacy: input.privacy ?? "private",
    focus: input.focus ?? "",
    hypotheses: input.hypotheses ?? [],
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
  });

  return withArchiveMutation(options, async (client, archiveId) => {
    const sortOrder = await prependSortOrder(client, "research_cases", archiveId);
    // Case creation is insert-only. Reusing any archive-scoped parent or child
    // id must roll the transaction back instead of overwriting or moving rows.
    await upsertCaseRow(client, archiveId, created, sortOrder, "insert");
    await replaceCaseChildren(client, archiveId, created, "insert");
    return created;
  });
}

export async function addCaseTask(
  caseId: string,
  input: {
    id?: string;
    title?: string;
    status?: ResearchTask["status"];
    priority?: ResearchTask["priority"];
    guidance?: string;
  },
  options: WorkspaceStoreOptions = {}
): Promise<{ case: ResearchCase; task: ResearchCase["tasks"][number] }> {
  if (!input.title?.trim()) {
    throw new Error("task title is required");
  }
  if (input.status === "done") {
    throw new Error("complete tasks by recording an outcome");
  }

  const now = new Date().toISOString();
  const task: ResearchTask = {
    id: input.id ?? `task-${randomUUID()}`,
    title: input.title.trim(),
    status: input.status ?? "todo",
    origin: "manual",
    priority: input.priority ?? "normal",
    workFingerprint: normalizeWorkFingerprint(input.title),
    guidance: input.guidance?.trim() ?? "",
    contextRefs: [],
    outcomes: [],
    createdAt: now,
    updatedAt: now
  };

  return withArchiveMutation(options, async (client, archiveId) => {
    const researchCase = await loadCaseData(client, archiveId, caseId);
    if (!researchCase) {
      throw new Error("case not found");
    }
    if (task.status === "doing" && researchCase.tasks.some((item) => item.status === "doing")) {
      throw guidedResearchError("ACTIVE_ASSIGNMENT_CONFLICT", "another assignment is already in progress");
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
  input: {
    title?: string;
    status?: ResearchTask["status"];
    priority?: ResearchTask["priority"];
    guidance?: string;
    expectedUpdatedAt: string;
  },
  options: UpdateCaseTaskOptions = {}
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
    if (!input.expectedUpdatedAt) {
      throw guidedResearchError("INVALID_TASK_UPDATE", "expectedUpdatedAt is required for task updates");
    }
    if (input.expectedUpdatedAt !== currentTask.updatedAt) {
      throw guidedResearchError("STALE_RESEARCH_STATE", "task was updated by another request");
    }
    const isManualTask = (currentTask.origin ?? "manual") === "manual";
    const canCompleteWithoutOutcome = options.allowManualCompletionWithoutOutcome && isManualTask;
    if (input.status === "done" && !canCompleteWithoutOutcome) {
      throw new Error("complete tasks by recording an outcome");
    }
    if (currentTask.status === "done") {
      throw guidedResearchError("INVALID_TASK_UPDATE", "completed tasks are immutable; append an outcome correction instead");
    }
    if (
      currentTask.origin === "guide" &&
      (input.title !== undefined || input.priority !== undefined || input.guidance !== undefined)
    ) {
      throw guidedResearchError("IMMUTABLE_GUIDE_METADATA", "guide metadata is server-owned and immutable");
    }
    if (
      input.status === "doing" &&
      researchCase.tasks.some((task) => task.id !== currentTask.id && task.status === "doing")
    ) {
      throw guidedResearchError("ACTIVE_ASSIGNMENT_CONFLICT", "another assignment is already in progress");
    }

    const title = input.title?.trim() || currentTask.title;

    const updatedAt = nextUpdatedAt(currentTask.updatedAt);
    const status = input.status ?? currentTask.status;
    const task: ResearchTask = {
      ...currentTask,
      title,
      status,
      priority: input.priority ?? currentTask.priority ?? "normal",
      guidance: input.guidance?.trim() ?? currentTask.guidance ?? "",
      workFingerprint: title === currentTask.title ? currentTask.workFingerprint : normalizeWorkFingerprint(title),
      completedAt: status === "done" ? currentTask.completedAt ?? updatedAt : currentTask.completedAt,
      updatedAt
    };
    await updateTaskRow(client, archiveId, caseId, task);

    const updatedCase: ResearchCase = {
      ...researchCase,
      tasks: researchCase.tasks.map((item) => (item.id === taskId ? task : item))
    };
    return { case: updatedCase, task };
  });
}

export async function readResearchCase(caseId: string, options: WorkspaceStoreOptions = {}): Promise<ResearchCase | undefined> {
  const archiveId = getArchiveId(options);
  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
    await requireProvisionedArchiveRow(client, archiveId, options);
    return loadCaseData(client, archiveId, caseId);
  });
}

export async function addCaseHypothesis(
  caseId: string,
  input: { id?: string; statement?: string; confidence?: number },
  options: WorkspaceStoreOptions = {}
): Promise<{ case: ResearchCase; hypothesis: ResearchHypothesis }> {
  if (!input.statement?.trim()) {
    throw new Error("hypothesis statement is required");
  }
  const statement = input.statement.trim();

  return withArchiveMutation(options, async (client, archiveId) => {
    const researchCase = await loadCaseData(client, archiveId, caseId);
    if (!researchCase) {
      throw new Error("case not found");
    }
    const hypothesis: ResearchHypothesis = {
      id: input.id ?? `hyp-${randomUUID()}`,
      statement,
      confidence: normalizeConfidence(input.confidence ?? 0.5),
      status: "open",
      decisions: [],
      updatedAt: new Date().toISOString()
    };
    const sortOrder = await prependSortOrder(client, "hypotheses", archiveId);
    await upsertHypothesisRow(client, archiveId, caseId, hypothesis, sortOrder);
    const updatedCase = { ...researchCase, hypotheses: [hypothesis, ...researchCase.hypotheses] };
    return { case: updatedCase, hypothesis };
  });
}

export type HypothesisDecisionInput = {
  requestId: string;
  expectedUpdatedAt: string;
  status: ResearchHypothesis["status"];
  reason: string;
  actorId: string;
  actorName: string;
};

export async function updateCaseHypothesis(
  caseId: string,
  hypothesisId: string,
  input: {
    statement?: string;
    confidence?: number;
    expectedUpdatedAt?: string;
    requestId?: string;
    status?: ResearchHypothesis["status"];
    reason?: string;
    actorId?: string;
    actorName?: string;
    contextRefs?: ResearchReference[];
  },
  options: WorkspaceStoreOptions = {}
): Promise<{ case: ResearchCase; hypothesis: ResearchHypothesis }> {
  return withArchiveMutation(options, async (client, archiveId) => {
    const researchCase = await loadCaseData(client, archiveId, caseId);
    if (!researchCase) {
      throw new Error("case not found");
    }
    const current = researchCase.hypotheses.find((hypothesis) => hypothesis.id === hypothesisId);
    if (!current) {
      throw new Error("hypothesis not found");
    }

    const updated = applyHypothesisUpdate(current, input);
    for (const decision of updated.decisions ?? []) {
      assertCaseOwnedReferences(researchCase, decision.contextRefs);
    }
    await updateHypothesisRow(client, archiveId, caseId, updated);
    const updatedCase = {
      ...researchCase,
      hypotheses: researchCase.hypotheses.map((hypothesis) => (hypothesis.id === hypothesisId ? updated : hypothesis))
    };
    return { case: updatedCase, hypothesis: updated };
  });
}

export async function acceptGuideAssignment(
  caseId: string,
  guideKey: string,
  options: WorkspaceStoreOptions = {}
): Promise<{ created: boolean; case: ResearchCase; task: ResearchTask }> {
  return withArchiveMutation(options, async (client, archiveId) => {
    const researchCase = await loadCaseData(client, archiveId, caseId);
    if (!researchCase) {
      throw new Error("case not found");
    }
    const dnaEnabled = resolveHostedCapabilities().dna;
    const visibleResearchCase = projectResearchCaseForDnaCapability(researchCase, dnaEnabled);

    const existing = visibleResearchCase.tasks.find((task) => task.guideKey === guideKey);
    if (existing) {
      return { created: false, case: researchCase, task: existing };
    }

    const assignment = buildResearchGuide(visibleResearchCase, { dnaEnabled: true }).assignment;
    if (!assignment || assignment.source !== "generated" || assignment.guideKey !== guideKey) {
      throw guidedResearchError("STALE_GUIDE_KEY", "guide assignment is no longer available");
    }

    const now = new Date().toISOString();
    const task: ResearchTask = {
      id: `task-${randomUUID()}`,
      title: assignment.title,
      status: "todo",
      origin: "guide",
      priority: "normal",
      guideKey: assignment.guideKey,
      workFingerprint: assignment.workFingerprint,
      guidance: assignment.guidance,
      targetHypothesisId: assignment.targetHypothesisId,
      contextRefs: assignment.contextRefs ?? [],
      outcomes: [],
      createdAt: now,
      updatedAt: now
    };
    assertCaseOwnedTaskReferences(researchCase, task);
    const sortOrder = await prependCaseTaskSortOrder(client, archiveId, caseId);
    await upsertTaskRow(client, archiveId, caseId, task, sortOrder);
    const updatedCase = { ...researchCase, tasks: [task, ...researchCase.tasks] };
    return { created: true, case: updatedCase, task };
  });
}

export type RecordCaseTaskOutcomeInput = {
  requestId: string;
  expectedTaskUpdatedAt: string;
  outcome: ResearchTaskOutcome["type"];
  note: string;
  searchScope?: ResearchSearchScope;
  correctsOutcomeId?: string;
  actorId: string;
  actorName: string;
  hypothesisDecision?: {
    hypothesisId: string;
    expectedUpdatedAt?: string;
    expectedHypothesisUpdatedAt?: string;
    status: ResearchHypothesis["status"];
    reason: string;
  };
};

export async function recordCaseTaskOutcome(
  caseId: string,
  taskId: string,
  input: RecordCaseTaskOutcomeInput,
  options: WorkspaceStoreOptions = {}
): Promise<{ applied: boolean; case: ResearchCase; task: ResearchTask; hypothesis?: ResearchHypothesis }> {
  validateOutcomeInput(input);

  return withArchiveMutation(options, async (client, archiveId) => {
    const researchCase = await loadCaseData(client, archiveId, caseId);
    if (!researchCase) {
      throw new Error("case not found");
    }
    const currentTask = researchCase.tasks.find((task) => task.id === taskId);
    if (!currentTask) {
      throw new Error("task not found");
    }

    const existingOutcome = (currentTask.outcomes ?? []).find((outcome) => outcome.requestId === input.requestId);
    if (existingOutcome) {
      if (!sameOutcomeRequest(existingOutcome, input)) {
        throw guidedResearchError("IDEMPOTENCY_CONFLICT", "request id was already used for a different outcome");
      }
      const existingHypothesis = assertSameOutcomeDecisionReplay(researchCase, taskId, input);
      return { applied: false, case: researchCase, task: currentTask, hypothesis: existingHypothesis };
    }

    if (currentTask.updatedAt !== input.expectedTaskUpdatedAt) {
      throw guidedResearchError("STALE_RESEARCH_STATE", "task was updated by another request");
    }
    const priorOutcomes = currentTask.outcomes ?? [];
    const correctedOutcome = input.correctsOutcomeId
      ? priorOutcomes.find((outcome) => outcome.id === input.correctsOutcomeId)
      : undefined;
    if (input.correctsOutcomeId && (currentTask.status !== "done" || !correctedOutcome)) {
      throw guidedResearchError("INVALID_OUTCOME", "outcome corrections must target an earlier outcome on this task");
    }
    if (currentTask.status === "done" && priorOutcomes.length > 0 && !correctedOutcome) {
      throw guidedResearchError("INVALID_OUTCOME", "completed assignments can only receive an explicit outcome correction");
    }

    let updatedHypothesis: ResearchHypothesis | undefined;
    if (input.hypothesisDecision) {
      const currentHypothesis = researchCase.hypotheses.find(
        (hypothesis) => hypothesis.id === input.hypothesisDecision?.hypothesisId
      );
      if (!currentHypothesis) {
        throw new Error("hypothesis does not belong to this case");
      }
      updatedHypothesis = applyHypothesisUpdate(currentHypothesis, {
        requestId: input.requestId,
        expectedUpdatedAt:
          input.hypothesisDecision.expectedUpdatedAt ?? input.hypothesisDecision.expectedHypothesisUpdatedAt,
        status: input.hypothesisDecision.status,
        reason: input.hypothesisDecision.reason,
        actorId: input.actorId,
        actorName: input.actorName,
        contextRefs: [{ type: "task", id: taskId }]
      });
      for (const decision of updatedHypothesis.decisions ?? []) {
        assertCaseOwnedReferences(researchCase, decision.contextRefs);
      }
    }

    const now = nextUpdatedAt(currentTask.updatedAt);
    const outcome: ResearchTaskOutcome = {
      id: `outcome-${randomUUID()}`,
      requestId: input.requestId,
      type: input.outcome,
      note: input.note.trim(),
      searchScope: normalizeSearchScope(input.searchScope),
      actorId: input.actorId,
      actorName: input.actorName.trim(),
      createdAt: now,
      correctsOutcomeId: input.correctsOutcomeId
    };
    const task: ResearchTask = {
      ...currentTask,
      status: "done",
      outcomes: [...priorOutcomes, outcome],
      completedAt: currentTask.completedAt ?? now,
      updatedAt: now
    };

    await updateTaskRow(client, archiveId, caseId, task);
    if (updatedHypothesis) {
      await updateHypothesisRow(client, archiveId, caseId, updatedHypothesis);
    }

    const updatedCase: ResearchCase = {
      ...researchCase,
      tasks: researchCase.tasks.map((item) => (item.id === taskId ? task : item)),
      hypotheses: updatedHypothesis
        ? researchCase.hypotheses.map((hypothesis) =>
            hypothesis.id === updatedHypothesis?.id ? updatedHypothesis : hypothesis
          )
        : researchCase.hypotheses
    };
    return { applied: true, case: updatedCase, task, hypothesis: updatedHypothesis };
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
  requireHostedCapability("dna");
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
  requireHostedCapability("dna");
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
  requireHostedCapability("dna");
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
  requireHostedCapability("dna");
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
  requireHostedCapability("dna");
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
  if (input.fileName || input.storageKey || input.mimeType || input.size !== undefined) {
    requireHostedCapability("evidenceBinaryUploads");
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
  if (input.published !== undefined && typeof input.published !== "boolean") {
    throw new Error("published must be a boolean");
  }
  if (input.published === true) {
    requireHostedCapability("publicPublishing");
  }
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
    return applyPreparedGedcomImportInTransaction(client, archiveId, prepared);
  });
}

/**
 * Applies a prepared import using an existing, archive-locked transaction.
 * Integration refreshes use this seam so the workspace mutation, backup,
 * reviewed resolutions, and remembered baseline commit atomically.
 */
export async function applyPreparedGedcomImportInTransaction(
  client: PoolClient,
  archiveId: string,
  prepared: PreparedGedcomImport,
  options: { preserveCurationByStableId?: boolean } = {}
): Promise<{
  import: AppliedGedcomImport;
  backup: WorkspaceBackup;
  peopleImported: number;
  sourcesImported: number;
  rawRecordCount: number;
}> {
  // The full pre-import workspace is still loaded once here: it becomes the
  // restorable backup snapshot. The writes below stay scoped to the tables
  // the import actually touches — cases, DNA matches, and AI runs are not
  // rewritten anymore.
  const workspace = await loadWorkspace(client, archiveId);
  // mergeImportedPeople returns the merged imports first, then untouched
  // existing people; only the imported slice needs to be written.
  const mergedPeople = mergeImportedPeople(
    workspace.people,
    prepared.people,
    options.preserveCurationByStableId === true
  );
  if (resolveHostedCapabilities().deploymentMode === "hosted") {
    validateHostedGedcomPeople(mergedPeople.length);
  }
  const backup = await persistWorkspaceBackupInTransaction(
    client,
    archiveId,
    workspace,
    `Before applying ${prepared.snapshot.sourceName}`
  );
  const appliedImport: AppliedGedcomImport = {
    ...prepared.appliedImport,
    backupId: backup.id
  };

  const mergedImported = mergedPeople.slice(0, prepared.people.length);
  const peopleStart = await prependSortOrderRange(client, "people", archiveId, mergedImported.length);
  await upsertPeopleRows(client, archiveId, mergedImported, peopleStart);
  await replacePersonFacts(client, archiveId, mergedImported);

  const sources = options.preserveCurationByStableId
    ? preserveImportedSourceCuration(workspace.sources, prepared.sources)
    : prepared.sources;
  const sourcesStart = await prependSortOrderRange(client, "sources", archiveId, sources.length);
  await upsertSourceRows(client, archiveId, sources, sourcesStart);

  // Re-importing a file replaces exactly that import's raw records.
  const rawStart = await prependSortOrderRange(client, "raw_records", archiveId, prepared.rawRecords.length);
  await client.query("DELETE FROM raw_records WHERE archive_id = $1 AND import_id = $2", [archiveId, prepared.snapshot.id]);
  await insertRawRecordRows(client, archiveId, prepared.rawRecords, rawStart);

  const importSort = await prependSortOrder(client, "import_snapshots", archiveId);
  await upsertImportSnapshotRow(client, archiveId, appliedImport, importSort);

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
}

/** Creates a full, restorable archive backup inside the caller's transaction. */
export async function createWorkspaceBackupInTransaction(
  client: PoolClient,
  archiveId: string,
  reason: string
): Promise<WorkspaceBackup> {
  const workspace = await loadWorkspace(client, archiveId);
  return persistWorkspaceBackupInTransaction(client, archiveId, workspace, reason);
}

async function persistWorkspaceBackupInTransaction(
  client: PoolClient,
  archiveId: string,
  workspace: WorkspaceData,
  reason: string
): Promise<WorkspaceBackup> {
  const backup = createWorkspaceBackup(workspace, reason);
  const apiResourceIdentities = await loadApiResourceIdentityMaps(client, archiveId);
  const backupSort = await prependSortOrder(client, "workspace_backups", archiveId);
  await insertBackupRow(client, archiveId, backup, JSON.stringify({
    ...workspace,
    [apiResourceIdentitySnapshotKey]: serializeApiResourceIdentitySnapshot(
      archiveId,
      apiResourceIdentities
    )
  }), backupSort);
  await pruneBackupRows(client, archiveId, retainedBackupCount);
  return backup;
}

/** Restores a workspace backup without leaving the caller's transaction. */
export async function restoreWorkspaceBackupInTransaction(
  client: PoolClient,
  archiveId: string,
  backupId: string
): Promise<WorkspaceData> {
  const result = await client.query<{ snapshot: unknown }>(
    "SELECT snapshot FROM workspace_backups WHERE archive_id = $1 AND id = $2",
    [archiveId, backupId]
  );
  if (result.rowCount !== 1 || !result.rows[0].snapshot || typeof result.rows[0].snapshot !== "object") {
    throw new Error("Workspace backup not found or invalid");
  }

  const current = await loadWorkspace(client, archiveId);
  const snapshot = result.rows[0].snapshot as Partial<WorkspaceData> & Record<string, unknown>;
  const restoredApiResourceIdentities = parseApiResourceIdentitySnapshot(
    snapshot[apiResourceIdentitySnapshotKey],
    archiveId
  );
  const restored = normalizeWorkspaceData({
    ...snapshot,
    // Keep the current backup ledger. In particular, the sync run being
    // rolled back has a restrictive FK to its pre-apply backup.
    backups: current.backups,
    updatedAt: new Date().toISOString()
  });
  await persistWorkspace(client, archiveId, restored, restoredApiResourceIdentities);
  return restored;
}

export type GedcomRelationshipRepairResult = {
  rawRecordCount: number;
  importedPeopleChecked: number;
  updatedPeople: number;
  relationshipCount: number;
};

export async function repairGedcomRelationshipLinks(options: WorkspaceStoreOptions = {}): Promise<GedcomRelationshipRepairResult> {
  const archiveId = getArchiveId(options);

  return withTransaction(withRlsArchiveScope(options, archiveId), async (client) => {
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

async function persistWorkspace(
  client: PoolClient,
  archiveId: string,
  workspace: WorkspaceData,
  restoredApiResourceIdentities?: ApiResourceIdentityMaps
): Promise<void> {
  const normalized = normalizeWorkspaceData(workspace);

  const updated = await client.query(
    `UPDATE archives
     SET name = $2, tagline = $3, updated_at = $4
     WHERE id = $1
     RETURNING id`,
    [archiveId, normalized.archiveName, normalized.archiveTagline, normalized.updatedAt]
  );
  if (updated.rowCount === 0) {
    throw archiveNotProvisionedError(archiveId);
  }
  const apiResourceIdentities = mergeApiResourceIdentityMaps(
    await loadApiResourceIdentityMaps(client, archiveId),
    restoredApiResourceIdentities
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

  await upsertPeopleRows(client, archiveId, normalized.people, 0, apiResourceIdentities.people);
  await replacePersonFacts(client, archiveId, normalized.people, apiResourceIdentities.personFacts);
  await upsertSourceRows(client, archiveId, normalized.sources, 0, apiResourceIdentities.sources);

  for (const [index, researchCase] of normalized.cases.entries()) {
    await upsertCaseRow(
      client,
      archiveId,
      researchCase,
      index,
      "upsert",
      apiResourceIdentities.researchCases.get(researchCase.id)
    );
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

async function loadApiResourceIdentityMaps(
  client: PoolClient,
  archiveId: string
): Promise<ApiResourceIdentityMaps> {
  const result = await client.query<{ kind: ApiResourceIdentityKind; id: string; api_id: string }>(
    `SELECT 'people'::text AS kind, id, api_id::text FROM public.people WHERE archive_id = $1
     UNION ALL
     SELECT 'personFacts', id, api_id::text FROM public.person_facts WHERE archive_id = $1
     UNION ALL
     SELECT 'sources', id, api_id::text FROM public.sources WHERE archive_id = $1
     UNION ALL
     SELECT 'researchCases', id, api_id::text FROM public.research_cases WHERE archive_id = $1
     ORDER BY kind, id`,
    [archiveId]
  );
  const maps = emptyApiResourceIdentityMaps();
  for (const row of result.rows) {
    if (!apiResourceIdentityKinds.includes(row.kind) || !apiResourceUuidPattern.test(row.api_id)) {
      throw new Error("Stored API resource identity is invalid");
    }
    maps[row.kind].set(row.id, row.api_id);
  }
  return maps;
}

function emptyApiResourceIdentityMaps(): ApiResourceIdentityMaps {
  return {
    people: new Map(),
    personFacts: new Map(),
    sources: new Map(),
    researchCases: new Map()
  };
}

function mergeApiResourceIdentityMaps(
  current: ApiResourceIdentityMaps,
  restored?: ApiResourceIdentityMaps
): ApiResourceIdentityMaps {
  if (!restored) return current;
  const merged = emptyApiResourceIdentityMaps();
  for (const kind of apiResourceIdentityKinds) {
    for (const [id, apiId] of current[kind]) merged[kind].set(id, apiId);
    for (const [id, apiId] of restored[kind]) merged[kind].set(id, apiId);
  }
  return merged;
}

function serializeApiResourceIdentitySnapshot(
  archiveId: string,
  maps: ApiResourceIdentityMaps
): StoredApiResourceIdentitySnapshot {
  const entries = (kind: ApiResourceIdentityKind) => [...maps[kind]]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, apiId]) => ({ id, apiId }));
  return {
    schemaVersion: 1,
    archiveId,
    people: entries("people"),
    personFacts: entries("personFacts"),
    sources: entries("sources"),
    researchCases: entries("researchCases")
  };
}

function parseApiResourceIdentitySnapshot(
  value: unknown,
  archiveId: string
): ApiResourceIdentityMaps | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object"
    || value === null
    || (value as { schemaVersion?: unknown }).schemaVersion !== 1
    || (value as { archiveId?: unknown }).archiveId !== archiveId
  ) {
    throw new Error("Workspace backup API resource identity metadata is invalid");
  }
  const maps = emptyApiResourceIdentityMaps();
  for (const kind of apiResourceIdentityKinds) {
    const entries = (value as Record<string, unknown>)[kind];
    if (!Array.isArray(entries)) {
      throw new Error("Workspace backup API resource identity metadata is invalid");
    }
    const seenApiIds = new Set<string>();
    for (const entry of entries) {
      const id = typeof entry === "object" && entry !== null
        ? (entry as { id?: unknown }).id
        : undefined;
      const apiId = typeof entry === "object" && entry !== null
        ? (entry as { apiId?: unknown }).apiId
        : undefined;
      if (
        typeof id !== "string"
        || id.length < 1
        || typeof apiId !== "string"
        || !apiResourceUuidPattern.test(apiId)
        || maps[kind].has(id)
        || seenApiIds.has(apiId)
      ) {
        throw new Error("Workspace backup API resource identity metadata is invalid");
      }
      maps[kind].set(id, apiId);
      seenApiIds.add(apiId);
    }
  }
  return maps;
}

function normalizeWorkspaceData(value: Partial<WorkspaceData>): WorkspaceData {
  return {
    version: "0.17.0",
    archiveName: value.archiveName || "Kin Resolve Private Archive",
    archiveTagline: value.archiveTagline ?? "",
    people: Array.isArray(value.people) ? value.people : [],
    cases: Array.isArray(value.cases) ? value.cases.map(normalizeResearchCase) : [],
    sources: Array.isArray(value.sources) ? value.sources : [],
    dnaMatches: Array.isArray(value.dnaMatches) ? value.dnaMatches : [],
    aiRuns: Array.isArray(value.aiRuns) ? value.aiRuns.map(normalizeAIAnalysisRun) : [],
    imports: Array.isArray(value.imports) ? value.imports : [],
    rawRecords: Array.isArray(value.rawRecords) ? value.rawRecords : [],
    backups: Array.isArray(value.backups) ? value.backups : [],
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

function normalizeResearchCase(researchCase: ResearchCase): ResearchCase {
  if (!isOneOf(researchCase.status, ["active", "planning", "paused", "resolved"])) {
    throw new Error("invalid research case status");
  }
  if (!isOneOf(researchCase.privacy, ["public", "private", "sensitive"])) {
    throw new Error("invalid research case privacy");
  }

  const normalized: ResearchCase = {
    ...researchCase,
    focus: researchCase.focus ?? "",
    hypotheses: (researchCase.hypotheses ?? []).map((hypothesis) => {
      if (!isOneOf(hypothesis.status, ["open", "supported", "weakened", "rejected"])) {
        throw new Error("invalid hypothesis status");
      }
      const normalizedHypothesis: ResearchHypothesis = {
        ...hypothesis,
        id: hypothesis.id || `hyp-${randomUUID()}`,
        statement: hypothesis.statement.trim(),
        confidence: normalizeConfidence(hypothesis.confidence),
        decisions: (hypothesis.decisions ?? []).map(normalizeHypothesisDecision)
      };
      assertHypothesisDecisionHistory(normalizedHypothesis);
      return normalizedHypothesis;
    }),
    evidence: (researchCase.evidence ?? []).map((evidence) => ({
      ...evidence,
      id: evidence.id || `ev-${randomUUID()}`,
      title: evidence.title.trim(),
      summary: evidence.summary ?? "",
      confidence: normalizeConfidence(evidence.confidence)
    })),
    tasks: (researchCase.tasks ?? []).map((task) => {
      if (!isOneOf(task.status, ["todo", "doing", "done"])) {
        throw new Error("invalid research task status");
      }
      const title = task.title.trim();
      const origin = task.origin ?? (task.guideKey ? "guide" : "manual");
      const priority = task.priority ?? "normal";
      if (!isOneOf(origin, ["manual", "guide"])) {
        throw new Error("invalid research task origin");
      }
      if (!isOneOf(priority, ["high", "normal", "low"])) {
        throw new Error("invalid research task priority");
      }
      if (origin === "manual" && task.guideKey) {
        throw new Error("invalid manual task guide key");
      }
      const outcomes = normalizeTaskOutcomeHistory(task.outcomes ?? []);
      if (outcomes.length > 0 && task.status !== "done") {
        throw new Error("invalid task outcome history for an incomplete task");
      }
      return {
        ...task,
        id: task.id || `task-${randomUUID()}`,
        title,
        origin,
        priority,
        guideKey: origin === "guide" ? task.guideKey : undefined,
        workFingerprint: task.workFingerprint?.trim() || normalizeWorkFingerprint(title),
        guidance: task.guidance?.trim() ?? "",
        contextRefs: (task.contextRefs ?? []).map(normalizeResearchReference),
        outcomes
      };
    })
  };

  if (normalized.tasks.filter((task) => task.status === "doing").length > 1) {
    throw new Error("only one task in a case may be doing at a time");
  }

  for (const hypothesis of normalized.hypotheses) {
    for (const decision of hypothesis.decisions ?? []) {
      assertCaseOwnedReferences(normalized, decision.contextRefs);
    }
  }
  for (const task of normalized.tasks) {
    assertCaseOwnedTaskReferences(normalized, task);
  }
  return normalized;
}

function normalizeHypothesisDecision(decision: ResearchHypothesisDecision): ResearchHypothesisDecision {
  if (
    !decision.id?.trim() ||
    !decision.requestId?.trim() ||
    !decision.statement?.trim() ||
    !decision.reason?.trim() ||
    !decision.actorId?.trim() ||
    !decision.actorName?.trim() ||
    !isOneOf(decision.fromStatus, ["open", "supported", "weakened", "rejected"]) ||
    !isOneOf(decision.toStatus, ["open", "supported", "weakened", "rejected"]) ||
    !isTimestamp(decision.createdAt)
  ) {
    throw new Error("invalid hypothesis decision history");
  }
  return {
    ...decision,
    id: decision.id.trim(),
    requestId: decision.requestId.trim(),
    statement: decision.statement.trim(),
    reason: decision.reason.trim(),
    actorId: decision.actorId.trim(),
    actorName: decision.actorName.trim(),
    contextRefs: (decision.contextRefs ?? []).map(normalizeResearchReference)
  };
}

function normalizeTaskOutcome(outcome: ResearchTaskOutcome): ResearchTaskOutcome {
  if (
    !outcome.id?.trim() ||
    !outcome.requestId?.trim() ||
    !outcome.note?.trim() ||
    !outcome.actorId?.trim() ||
    !outcome.actorName?.trim() ||
    !isOneOf(outcome.type, ["found", "not_found", "inconclusive", "blocked", "already_tried"]) ||
    !isTimestamp(outcome.createdAt) ||
    (outcome.correctsOutcomeId !== undefined && !outcome.correctsOutcomeId.trim())
  ) {
    throw new Error("invalid task outcome history");
  }
  const searchScope = normalizeSearchScope(outcome.searchScope);
  if ((outcome.type === "not_found" || outcome.type === "already_tried") && !searchScope) {
    throw new Error("invalid negative task outcome search scope");
  }
  return {
    ...outcome,
    id: outcome.id.trim(),
    requestId: outcome.requestId.trim(),
    note: outcome.note.trim(),
    actorId: outcome.actorId.trim(),
    actorName: outcome.actorName.trim(),
    searchScope,
    correctsOutcomeId: outcome.correctsOutcomeId?.trim() || undefined
  };
}

function assertHypothesisDecisionHistory(hypothesis: ResearchHypothesis): void {
  const decisions = hypothesis.decisions ?? [];
  const ids = new Set<string>();
  const requestIds = new Set<string>();

  for (const [index, decision] of decisions.entries()) {
    if (ids.has(decision.id) || requestIds.has(decision.requestId)) {
      throw new Error("duplicate hypothesis decision id or request id");
    }
    const previous = decisions[index - 1];
    if (previous && decision.fromStatus !== previous.toStatus) {
      throw new Error("invalid hypothesis decision chronology");
    }
    if (previous && Date.parse(decision.createdAt) < Date.parse(previous.createdAt)) {
      throw new Error("invalid hypothesis decision chronology");
    }
    ids.add(decision.id);
    requestIds.add(decision.requestId);
  }

  const latest = decisions.at(-1);
  if (latest && latest.toStatus !== hypothesis.status) {
    throw new Error("final hypothesis decision does not match hypothesis status");
  }
}

function normalizeTaskOutcomeHistory(outcomes: ResearchTaskOutcome[]): ResearchTaskOutcome[] {
  const normalized = outcomes.map(normalizeTaskOutcome);
  const ids = new Set<string>();
  const requestIds = new Set<string>();

  for (const [index, outcome] of normalized.entries()) {
    if (ids.has(outcome.id) || requestIds.has(outcome.requestId)) {
      throw new Error("duplicate task outcome id or request id");
    }
    if (outcome.correctsOutcomeId && !ids.has(outcome.correctsOutcomeId)) {
      throw new Error("outcome correction must target an earlier outcome on this task");
    }
    const previous = normalized[index - 1];
    if (previous && Date.parse(outcome.createdAt) < Date.parse(previous.createdAt)) {
      throw new Error("invalid task outcome chronology");
    }
    ids.add(outcome.id);
    requestIds.add(outcome.requestId);
  }

  return normalized;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function normalizeResearchReference(reference: ResearchReference): ResearchReference {
  if (!reference || !["case", "hypothesis", "evidence", "task"].includes(reference.type) || !reference.id?.trim()) {
    throw new Error("invalid research context reference");
  }
  return { type: reference.type, id: reference.id.trim() };
}

function assertCaseOwnedTaskReferences(researchCase: ResearchCase, task: ResearchTask): void {
  if (task.targetHypothesisId && !researchCase.hypotheses.some((hypothesis) => hypothesis.id === task.targetHypothesisId)) {
    throw new Error("task target hypothesis does not belong to this case");
  }
  assertCaseOwnedReferences(researchCase, task.contextRefs ?? []);
}

function assertCaseOwnedReferences(researchCase: ResearchCase, references: ResearchReference[]): void {
  const ids = {
    case: new Set([researchCase.id]),
    hypothesis: new Set(researchCase.hypotheses.map((hypothesis) => hypothesis.id)),
    evidence: new Set(researchCase.evidence.map((evidence) => evidence.id)),
    task: new Set(researchCase.tasks.map((task) => task.id))
  };
  for (const reference of references) {
    if (!ids[reference.type].has(reference.id)) {
      throw new Error(`research ${reference.type} reference does not belong to this case`);
    }
  }
}

function applyHypothesisUpdate(
  current: ResearchHypothesis,
  input: {
    statement?: string;
    confidence?: number;
    expectedUpdatedAt?: string;
    requestId?: string;
    status?: ResearchHypothesis["status"];
    reason?: string;
    actorId?: string;
    actorName?: string;
    contextRefs?: ResearchReference[];
  }
): ResearchHypothesis {
  const hasEdit = input.statement !== undefined || input.confidence !== undefined;
  const hasDecision = input.status !== undefined;
  const existingDecision = input.requestId
    ? (current.decisions ?? []).find((decision) => decision.requestId === input.requestId)
    : undefined;
  if (existingDecision) {
    if (
      hasEdit ||
      existingDecision.toStatus !== input.status ||
      existingDecision.reason !== input.reason?.trim() ||
      existingDecision.actorId !== input.actorId ||
      existingDecision.actorName !== input.actorName?.trim() ||
      !sameResearchReferences(existingDecision.contextRefs, input.contextRefs ?? [])
    ) {
      throw guidedResearchError("IDEMPOTENCY_CONFLICT", "request id was already used for a different decision");
    }
    return current;
  }
  if (hasEdit && hasDecision) {
    throw guidedResearchError("INVALID_DECISION", "hypothesis edits and status decisions must be submitted separately");
  }
  if (!hasDecision && (input.requestId !== undefined || input.reason !== undefined || input.contextRefs !== undefined)) {
    throw guidedResearchError("INVALID_DECISION", "decision metadata may only accompany a status decision");
  }
  if (current.updatedAt && input.expectedUpdatedAt !== current.updatedAt) {
    throw guidedResearchError("STALE_RESEARCH_STATE", "hypothesis was updated by another request");
  }

  const statement = input.statement?.trim() || current.statement;
  const confidence = input.confidence === undefined ? current.confidence : normalizeConfidence(input.confidence);
  let decisions = current.decisions ?? [];
  let status = current.status;
  if (input.status !== undefined) {
    if (!input.requestId?.trim() || !input.reason?.trim() || !input.actorId?.trim() || !input.actorName?.trim()) {
      throw new Error("hypothesis decisions require request id, reason, and actor");
    }
    const createdAt = nextUpdatedAt(current.updatedAt);
    const decision: ResearchHypothesisDecision = {
      id: `decision-${randomUUID()}`,
      requestId: input.requestId,
      fromStatus: current.status,
      toStatus: input.status,
      statement,
      reason: input.reason.trim(),
      contextRefs: (input.contextRefs ?? []).map(normalizeResearchReference),
      actorId: input.actorId,
      actorName: input.actorName.trim(),
      createdAt
    };
    decisions = [...decisions, decision];
    status = input.status;
  }

  if (statement === current.statement && confidence === current.confidence && status === current.status && decisions === current.decisions) {
    return current;
  }
  return {
    ...current,
    statement,
    confidence,
    status,
    decisions,
    updatedAt: nextUpdatedAt(current.updatedAt)
  };
}

function sameResearchReferences(left: ResearchReference[], right: ResearchReference[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const normalizedRight = right.map(normalizeResearchReference);
  return left.every(
    (reference, index) =>
      reference.type === normalizedRight[index]?.type && reference.id === normalizedRight[index]?.id
  );
}

function validateOutcomeInput(input: RecordCaseTaskOutcomeInput): void {
  if (!input.requestId?.trim() || !input.note?.trim() || !input.actorId?.trim() || !input.actorName?.trim()) {
    throw new Error("task outcomes require request id, note, and actor");
  }
  if ((input.outcome === "not_found" || input.outcome === "already_tried") && !input.searchScope?.repository?.trim()) {
    throw new Error("negative search outcomes require a repository or search location");
  }
}

function normalizeSearchScope(scope?: ResearchSearchScope): ResearchSearchScope | undefined {
  if (!scope) {
    return undefined;
  }
  const repository = scope.repository?.trim();
  if (!repository) {
    return undefined;
  }
  return {
    repository,
    collection: scope.collection?.trim() || undefined,
    place: scope.place?.trim() || undefined,
    dateRange: scope.dateRange?.trim() || undefined,
    query: scope.query?.trim() || undefined
  };
}

function sameOutcomeRequest(outcome: ResearchTaskOutcome, input: RecordCaseTaskOutcomeInput): boolean {
  const expectedScope = normalizeSearchScope(input.searchScope);
  return (
    outcome.type === input.outcome &&
    outcome.note === input.note.trim() &&
    sameSearchScope(outcome.searchScope, expectedScope) &&
    outcome.actorId === input.actorId &&
    outcome.actorName === input.actorName.trim() &&
    outcome.correctsOutcomeId === input.correctsOutcomeId
  );
}

function assertSameOutcomeDecisionReplay(
  researchCase: ResearchCase,
  taskId: string,
  input: RecordCaseTaskOutcomeInput
): ResearchHypothesis | undefined {
  const decisions = researchCase.hypotheses.flatMap((hypothesis) =>
    (hypothesis.decisions ?? [])
      .filter((decision) => decision.requestId === input.requestId)
      .map((decision) => ({ hypothesis, decision }))
  );

  if (!input.hypothesisDecision) {
    if (decisions.length > 0) {
      throw guidedResearchError("IDEMPOTENCY_CONFLICT", "request id was already used with a hypothesis decision");
    }
    return undefined;
  }

  const match = decisions.find(({ hypothesis }) => hypothesis.id === input.hypothesisDecision?.hypothesisId);
  if (
    decisions.length !== 1 ||
    !match ||
    match.decision.toStatus !== input.hypothesisDecision.status ||
    match.decision.reason !== input.hypothesisDecision.reason.trim() ||
    match.decision.actorId !== input.actorId ||
    match.decision.actorName !== input.actorName.trim() ||
    !match.decision.contextRefs.some((reference) => reference.type === "task" && reference.id === taskId)
  ) {
    throw guidedResearchError("IDEMPOTENCY_CONFLICT", "request id was already used for a different hypothesis decision");
  }

  return match.hypothesis;
}

function sameSearchScope(left?: ResearchSearchScope, right?: ResearchSearchScope): boolean {
  return (
    left?.repository === right?.repository &&
    left?.collection === right?.collection &&
    left?.place === right?.place &&
    left?.dateRange === right?.dateRange &&
    left?.query === right?.query
  );
}

function nextUpdatedAt(previous?: string): string {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now).toISOString();
}

function guidedResearchError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
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

function mergeImportedPeople(
  existing: PersonSummary[],
  imported: PersonSummary[],
  preserveCurationByStableId = false
): PersonSummary[] {
  const existingById = new Map(existing.map((person) => [person.id, person]));
  const importedIds = new Set(imported.map((person) => person.id));
  const mergedImported = imported.map((person) => {
    const current = existingById.get(person.id);
    // GEDCOM xrefs are only unique within one file, so an id collision can be
    // a different person from an unrelated import. Only carry curation flags
    // forward when the incoming record plausibly is the same person —
    // otherwise inheriting published/privacy could expose a living stranger.
    if (!current || (!preserveCurationByStableId && !isSameImportedPerson(current, person))) {
      return person;
    }
    const currentFacts = new Map(current.facts.map((fact) => [fact.id, fact]));
    return {
      ...person,
      privacy: current.privacy,
      published: current.published,
      livingStatus: current.livingStatus,
      facts: person.facts.map((fact) => ({
        ...fact,
        privacy: currentFacts.get(fact.id)?.privacy ?? fact.privacy,
        confidence: currentFacts.get(fact.id)?.confidence ?? fact.confidence
      }))
    };
  });
  return [...mergedImported, ...existing.filter((person) => !importedIds.has(person.id))];
}

function preserveImportedSourceCuration(
  existing: SourceDocument[],
  imported: SourceDocument[]
): SourceDocument[] {
  const existingById = new Map(existing.map((source) => [source.id, source]));
  return imported.map((source) => ({
    ...source,
    privacy: existingById.get(source.id)?.privacy ?? source.privacy,
    confidence: existingById.get(source.id)?.confidence ?? source.confidence
  }));
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

function slugifyArchive(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "archive";
}
