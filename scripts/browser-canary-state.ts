#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool, type PoolClient } from "pg";

import { getDatabaseConnectionString, isDatabaseTransportVerified } from "../lib/connection-string.ts";
import {
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "../lib/database-attestation.ts";
import { rollbackSyncRun } from "../lib/integrations/store.ts";
import { createConfiguredArchiveObjectStorage } from "../lib/storage/object-storage.ts";
import {
  browserCanaryCaseTitle,
  browserCanarySourceName,
  parseBrowserCanaryMode,
  resolveBrowserCanaryStateConfiguration,
  syntheticGedcomFixtureSha256,
  type BrowserCanaryMode,
  type BrowserCanaryStateConfiguration
} from "./browser-canary-contract.ts";

const stateSchemaVersion = 4;
const maxStateBytes = 64 * 1024;
const fixtureObjectPurpose = "integration-artifacts";
type CanonicalDigest = {
  rows: number;
  sha256: string;
};

type IdentityBaseline = {
  selectorSha256: string;
  userId: string | null;
  bootstrapCreated: boolean;
  sessionIds: string[];
  digests: {
    user: CanonicalDigest;
    accounts: CanonicalDigest;
    sessions: CanonicalDigest;
    memberships: CanonicalDigest;
  };
};

type TemporalTableBaseline = {
  primaryKeyColumns: string[];
  timestampColumns: string[];
  sortOrderColumn: "sort_order" | null;
  rows: Array<{
    keyValues: string[];
    timestampValues: Array<string | null>;
    sortOrderValue: string | null;
  }>;
};

type TemporalBaseline = Record<string, TemporalTableBaseline>;

type CanaryState = {
  schemaVersion: typeof stateSchemaVersion;
  mode: Exclude<BrowserCanaryMode, "production">;
  archiveId: string;
  releaseSha: string;
  runId: string;
  caseTitle: string;
  sourceName: string;
  databaseIdentity?: string;
  fixtureObjectKey: string;
  temporalBaseline: TemporalBaseline;
  archiveSnapshot: Record<string, CanonicalDigest>;
  identity: IdentityBaseline;
};

type ConnectionRow = {
  id: string;
  provider: string;
  display_name: string;
};

type RunRow = {
  id: string;
  status: string;
  backup_id: string | null;
};

const [action, rawMode, rawStatePath, ...flags] = process.argv.slice(2);
let pool: Pool | undefined;
let currentStage = "configuration";

void main().catch(() => {
  process.stderr.write(`Browser canary state guard failed during ${currentStage}.\n`);
  process.exitCode = 1;
}).finally(async () => {
  await pool?.end().catch(() => undefined);
});

async function main(): Promise<void> {
  if (action !== "prepare" && action !== "cleanup") throw new Error();
  const mode = parseBrowserCanaryMode(rawMode);
  if (mode === "production") throw new Error();
  const config = resolveBrowserCanaryStateConfiguration(mode);
  const statePath = strictStatePath(rawStatePath);
  const expectComplete = flags.length === 1 && flags[0] === "--expect-complete";
  if (action === "prepare" && flags.length !== 0) throw new Error();
  if (action === "cleanup" && flags.length > 1) throw new Error();

  process.env.DATABASE_AUTO_MIGRATE = "false";
  const databaseUrl = requiredEnvironment("KINRESOLVE_CANARY_OPERATOR_DATABASE_URL");
  if (!isDatabaseTransportVerified(databaseUrl)) throw new Error();
  pool = new Pool({
    connectionString: getDatabaseConnectionString(databaseUrl),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    max: 1
  });
  currentStage = "database identity binding";
  const databaseIdentity = await verifyDatabaseIdentity(pool, mode);

  if (action === "prepare") {
    currentStage = "zero-residue preflight";
    await prepareState(pool, statePath, config, mode, databaseIdentity);
    process.stdout.write("Browser canary zero-residue preflight passed.\n");
    return;
  }

  currentStage = "baseline state binding";
  const state = await readState(statePath, config, mode, databaseIdentity);
  currentStage = "scoped cleanup";
  await cleanupState(pool, state, config, databaseUrl, expectComplete);
  process.stdout.write("Browser canary state cleanup and invariants passed.\n");
}

async function prepareState(
  database: Pool,
  statePath: string,
  config: BrowserCanaryStateConfiguration,
  mode: Exclude<BrowserCanaryMode, "production">,
  databaseIdentity: string | undefined
): Promise<void> {
  const caseTitle = browserCanaryCaseTitle(config);
  const sourceName = browserCanarySourceName(config);
  const fixtureObjectKey = `archives/${config.archiveId}/${fixtureObjectPurpose}/${syntheticGedcomFixtureSha256}`;
  const client = await database.connect();
  let state: CanaryState;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_catalog.set_config('kinresolve.archive_id', $1, true)", [
      config.archiveId
    ]);
    await lockDemoArchive(client, config.archiveId);
    const residue = await client.query<{
      cases: string;
      connections: string;
      people: string;
      object_references: string;
    }>(
      `SELECT
         (SELECT count(*) FROM research_cases WHERE archive_id = $1 AND title = $2)::text AS cases,
         (SELECT count(*) FROM integration_connections WHERE archive_id = $1 AND display_name = $3)::text AS connections,
         (SELECT count(*) FROM people WHERE archive_id = $1 AND display_name = 'Rowan Canary')::text AS people,
         ((SELECT count(*) FROM integration_artifacts WHERE archive_id = $1 AND artifact_key = $4) +
          (SELECT count(*) FROM integration_snapshots WHERE archive_id = $1 AND artifact_key = $4) +
          (SELECT count(*) FROM integration_upload_intents WHERE archive_id = $1 AND staging_key = $4) +
          (SELECT count(*) FROM integration_media_objects WHERE archive_id = $1 AND object_key = $4) +
          (SELECT count(*) FROM integration_media_write_claims WHERE archive_id = $1 AND object_key = $4))::text
           AS object_references`,
      [config.archiveId, caseTitle, sourceName, fixtureObjectKey]
    );
    if (
      exactCount(residue.rows[0]?.cases) !== 0
      || exactCount(residue.rows[0]?.connections) !== 0
      || exactCount(residue.rows[0]?.people) !== 0
      || exactCount(residue.rows[0]?.object_references) !== 0
    ) throw new Error();
    state = {
      schemaVersion: stateSchemaVersion,
      mode,
      archiveId: config.archiveId,
      releaseSha: config.releaseSha,
      runId: config.runId,
      caseTitle,
      sourceName,
      ...(databaseIdentity ? { databaseIdentity } : {}),
      fixtureObjectKey,
      temporalBaseline: await readTemporalBaseline(client, config.archiveId),
      archiveSnapshot: await readCanonicalArchiveSnapshot(client, config.archiveId),
      identity: await readIdentityBaseline(client, config)
    };
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const storage = createConfiguredArchiveObjectStorage();
  if (await storage.stat({ archiveId: config.archiveId, key: fixtureObjectKey })) throw new Error();

  await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  await writeFile(statePath, `${JSON.stringify(state)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function cleanupState(
  database: Pool,
  state: CanaryState,
  config: BrowserCanaryStateConfiguration,
  databaseUrl: string,
  expectComplete: boolean
): Promise<void> {
  const graph = await inspectCanaryGraph(database, state);
  if (expectComplete) {
    if (graph.caseIds.length !== 1 || graph.connections.length !== 1 || graph.runs.length !== 1) throw new Error();
    if (graph.runs[0]?.status !== "rolled_back") throw new Error();
  }

  for (const run of graph.runs) {
    if (run.status === "applied") {
      currentStage = "partial apply rollback";
      await rollbackSyncRun(run.id, {
        actorId: "browser-canary-cleanup",
        idempotencyKey: `browser-canary-cleanup-${config.releaseSha.slice(0, 12)}-${config.runId}`,
        restoreBackup: true
      }, { archiveId: state.archiveId, databaseUrl });
    }
  }

  const refreshedGraph = await inspectCanaryGraph(database, state);
  if (refreshedGraph.runs.some((run) => run.status === "applied" || run.status === "applying")) {
    throw new Error();
  }
  currentStage = "rollback marker invariant";
  await assertPersonMarker(database, state.archiveId, false);
  currentStage = "private object cleanup";
  await deleteGraphObjects(database, state, refreshedGraph);
  currentStage = "database graph cleanup";
  await deleteGraphRows(database, state, refreshedGraph);
  currentStage = "canary identity and session cleanup";
  await cleanupCanaryIdentity(database, state, config);
  currentStage = "private object baseline invariant";
  const storage = createConfiguredArchiveObjectStorage();
  if (await storage.stat({ archiveId: state.archiveId, key: state.fixtureObjectKey })) throw new Error();

  currentStage = "restored baseline invariants";
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_catalog.set_config('kinresolve.archive_id', $1, true)", [
      state.archiveId
    ]);
    await lockDemoArchive(client, state.archiveId);
    currentStage = "exact temporal baseline restoration";
    await restoreTemporalBaseline(client, state.archiveId, state.temporalBaseline);
    currentStage = "canonical archive baseline invariant";
    const archiveSnapshot = await readCanonicalArchiveSnapshot(client, state.archiveId);
    const archiveMismatch = firstCanonicalMismatch(archiveSnapshot, state.archiveSnapshot);
    if (archiveMismatch) {
      currentStage = `canonical archive baseline invariant (${archiveMismatch})`;
      throw new Error();
    }
    currentStage = "canary identity baseline invariant";
    const identity = await readIdentitySnapshot(client, state.identity.userId);
    if (!sameIdentityDigests(identity.digests, state.identity.digests)) throw new Error();
    if (identity.sessionIds.join("\0") !== state.identity.sessionIds.join("\0")) throw new Error();
    const residue = await client.query<{ cases: string; connections: string; jobs: string }>(
      `SELECT
         (SELECT count(*) FROM research_cases WHERE archive_id = $1 AND title = $2)::text AS cases,
         (SELECT count(*) FROM integration_connections WHERE archive_id = $1 AND display_name = $3)::text AS connections,
         (SELECT count(*) FROM durable_jobs
           WHERE archive_id = $1 AND payload->>'runId' = ANY($4::text[]))::text AS jobs`,
      [state.archiveId, state.caseTitle, state.sourceName, refreshedGraph.runs.map((run) => run.id)]
    );
    if (
      exactCount(residue.rows[0]?.cases) !== 0
      || exactCount(residue.rows[0]?.connections) !== 0
      || exactCount(residue.rows[0]?.jobs) !== 0
    ) throw new Error();
    await assertPersonMarker(client, state.archiveId, false);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function inspectCanaryGraph(database: Pool, state: CanaryState): Promise<{
  caseIds: string[];
  connections: ConnectionRow[];
  runs: RunRow[];
  objectKeys: string[];
}> {
  const caseResult = await database.query<{ id: string }>(
    "SELECT id FROM research_cases WHERE archive_id = $1 AND title = $2 ORDER BY id",
    [state.archiveId, state.caseTitle]
  );
  const connectionResult = await database.query<ConnectionRow>(
    `SELECT id, provider, display_name FROM integration_connections
     WHERE archive_id = $1 AND display_name = $2 ORDER BY id`,
    [state.archiveId, state.sourceName]
  );
  if (caseResult.rows.length > 1 || connectionResult.rows.length > 1) throw new Error();
  if (connectionResult.rows.some((row) => row.provider !== "gedcom" || row.display_name !== state.sourceName)) {
    throw new Error();
  }
  const connectionIds = connectionResult.rows.map((row) => row.id);
  const runResult = connectionIds.length === 0
    ? { rows: [] as RunRow[] }
    : await database.query<RunRow>(
        `SELECT id, status, backup_id FROM sync_runs
         WHERE archive_id = $1 AND connection_id = ANY($2::text[]) ORDER BY id`,
        [state.archiveId, connectionIds]
      );
  if (runResult.rows.length > 1) throw new Error();
  const runIds = runResult.rows.map((row) => row.id);
  const keys = connectionIds.length === 0
    ? { rows: [] as Array<{ key: string }> }
    : await database.query<{ key: string }>(
        `SELECT artifact_key AS key FROM integration_artifacts
           WHERE archive_id = $1 AND connection_id = ANY($2::text[])
         UNION SELECT artifact_key AS key FROM integration_snapshots
           WHERE archive_id = $1 AND connection_id = ANY($2::text[])
         UNION SELECT staging_key AS key FROM integration_upload_intents
           WHERE archive_id = $1 AND connection_id = ANY($2::text[])
         UNION SELECT object_key AS key FROM integration_media_objects
           WHERE archive_id = $1 AND connection_id = ANY($2::text[])
         UNION SELECT object_key AS key FROM integration_media_write_claims
           WHERE archive_id = $1 AND run_id = ANY($3::text[])`,
        [state.archiveId, connectionIds, runIds]
      );
  const prefix = `archives/${state.archiveId}/`;
  if (keys.rows.some((row) => !row.key.startsWith(prefix) || row.key.includes("..") || row.key.includes("\\"))) {
    throw new Error();
  }
  return {
    caseIds: caseResult.rows.map((row) => row.id),
    connections: connectionResult.rows,
    runs: runResult.rows,
    objectKeys: [...new Set(keys.rows.map((row) => row.key))].sort()
  };
}

async function deleteGraphObjects(
  database: Pool,
  state: CanaryState,
  graph: Awaited<ReturnType<typeof inspectCanaryGraph>>
): Promise<void> {
  if (graph.objectKeys.length === 0) return;
  const connectionIds = graph.connections.map((connection) => connection.id);
  const runIds = graph.runs.map((run) => run.id);
  const storage = createConfiguredArchiveObjectStorage();
  for (const key of graph.objectKeys) {
    const references = await database.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM integration_artifacts
           WHERE archive_id = $1 AND artifact_key = $2 AND NOT (connection_id = ANY($3::text[]))) +
         (SELECT count(*) FROM integration_snapshots
           WHERE archive_id = $1 AND artifact_key = $2 AND NOT (connection_id = ANY($3::text[]))) +
         (SELECT count(*) FROM integration_upload_intents
           WHERE archive_id = $1 AND staging_key = $2 AND NOT (connection_id = ANY($3::text[]))) +
         (SELECT count(*) FROM integration_media_objects
           WHERE archive_id = $1 AND object_key = $2 AND NOT (connection_id = ANY($3::text[]))) +
         (SELECT count(*) FROM integration_media_write_claims
           WHERE archive_id = $1 AND object_key = $2 AND NOT (run_id = ANY($4::text[])))
       )::text AS count`,
      [state.archiveId, key, connectionIds, runIds]
    );
    if (exactCount(references.rows[0]?.count) !== 0) throw new Error();
    await storage.delete({ archiveId: state.archiveId, key });
    if (await storage.stat({ archiveId: state.archiveId, key })) throw new Error();
  }
}

async function deleteGraphRows(
  database: Pool,
  state: CanaryState,
  graph: Awaited<ReturnType<typeof inspectCanaryGraph>>
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_catalog.set_config('kinresolve.archive_id', $1, true)", [
      state.archiveId
    ]);
    await lockDemoArchive(client, state.archiveId);
    for (const caseId of graph.caseIds) {
      const deleted = await client.query(
        "DELETE FROM research_cases WHERE archive_id = $1 AND id = $2 AND title = $3",
        [state.archiveId, caseId, state.caseTitle]
      );
      if (deleted.rowCount !== 1) throw new Error();
    }

    const connectionIds = graph.connections.map((connection) => connection.id);
    const runIds = graph.runs.map((run) => run.id);
    const backupIds = graph.runs.flatMap((run) => run.backup_id ? [run.backup_id] : []);
    if (connectionIds.length > 0) {
      if (runIds.length > 0) {
        const jobs = await client.query<{ kind: string }>(
          `SELECT kind FROM durable_jobs
           WHERE archive_id = $1 AND payload->>'runId' = ANY($2::text[]) FOR UPDATE`,
          [state.archiveId, runIds]
        );
        if (jobs.rows.some((row) => row.kind !== "integration_snapshot_parse")) throw new Error();
        await client.query(
          "DELETE FROM durable_jobs WHERE archive_id = $1 AND payload->>'runId' = ANY($2::text[])",
          [state.archiveId, runIds]
        );
        await client.query(
          "DELETE FROM integration_media_write_claims WHERE archive_id = $1 AND run_id = ANY($2::text[])",
          [state.archiveId, runIds]
        );
      }
      await client.query(
        "DELETE FROM integration_media_objects WHERE archive_id = $1 AND connection_id = ANY($2::text[])",
        [state.archiveId, connectionIds]
      );
      await client.query(
        "DELETE FROM external_entity_refs WHERE archive_id = $1 AND connection_id = ANY($2::text[])",
        [state.archiveId, connectionIds]
      );
      if (runIds.length > 0) {
        await client.query(
          "DELETE FROM sync_changes WHERE archive_id = $1 AND run_id = ANY($2::text[])",
          [state.archiveId, runIds]
        );
      }
      await client.query(
        "DELETE FROM integration_upload_intents WHERE archive_id = $1 AND connection_id = ANY($2::text[])",
        [state.archiveId, connectionIds]
      );
      await client.query(
        "UPDATE integration_connections SET last_applied_snapshot_id = NULL WHERE archive_id = $1 AND id = ANY($2::text[])",
        [state.archiveId, connectionIds]
      );
      await client.query(
        "DELETE FROM sync_runs WHERE archive_id = $1 AND connection_id = ANY($2::text[])",
        [state.archiveId, connectionIds]
      );
      if (backupIds.length > 0) {
        const backups = await client.query<{ id: string; reason: string }>(
          "SELECT id, reason FROM workspace_backups WHERE archive_id = $1 AND id = ANY($2::text[]) FOR UPDATE",
          [state.archiveId, backupIds]
        );
        if (backups.rows.some((row) => row.reason !== "Before applying browser-canary.ged")) throw new Error();
        await client.query(
          "DELETE FROM workspace_backups WHERE archive_id = $1 AND id = ANY($2::text[])",
          [state.archiveId, backupIds]
        );
      }
      await client.query(
        "DELETE FROM integration_snapshots WHERE archive_id = $1 AND connection_id = ANY($2::text[])",
        [state.archiveId, connectionIds]
      );
      await client.query(
        "DELETE FROM integration_artifacts WHERE archive_id = $1 AND connection_id = ANY($2::text[])",
        [state.archiveId, connectionIds]
      );
      const deleted = await client.query(
        `DELETE FROM integration_connections
         WHERE archive_id = $1 AND id = ANY($2::text[]) AND display_name = $3`,
        [state.archiveId, connectionIds, state.sourceName]
      );
      if (deleted.rowCount !== connectionIds.length) throw new Error();
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupCanaryIdentity(
  database: Pool,
  state: CanaryState,
  config: BrowserCanaryStateConfiguration
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_catalog.set_config('kinresolve.archive_id', $1, true)", [
      state.archiveId
    ]);
    await lockDemoArchive(client, state.archiveId);
    const selector = config.userId ?? config.email!.toLowerCase();
    if (sha256(`${config.mode}:${selector}`) !== state.identity.selectorSha256) throw new Error();
    const users = config.userId
      ? await client.query<{ id: string; name: string; email: string }>(
          'SELECT id, name, email FROM public."user" WHERE id = $1 FOR UPDATE',
          [config.userId]
        )
      : await client.query<{ id: string; name: string; email: string }>(
          'SELECT id, name, email FROM public."user" WHERE lower(email) = $1 FOR UPDATE',
          [selector]
        );
    if (users.rowCount !== 1) {
      if (!state.identity.bootstrapCreated || users.rowCount !== 0) throw new Error();
    } else {
      const user = users.rows[0]!;
      if (!state.identity.bootstrapCreated && user.id !== state.identity.userId) throw new Error();
      await client.query(
        `DELETE FROM public."session"
          WHERE "userId" = $1
            AND NOT (id = ANY($2::text[]))`,
        [user.id, state.identity.sessionIds]
      );
      if (state.identity.bootstrapCreated) {
        if (user.name !== "Synthetic Browser Canary" || user.email.toLowerCase() !== selector) throw new Error();
        const account = await client.query<{ provider_id: string }>(
          'SELECT "providerId" AS provider_id FROM public."account" WHERE "userId" = $1 FOR UPDATE',
          [user.id]
        );
        const membership = await client.query<{ archive_id: string; role: string }>(
          "SELECT archive_id, role FROM public.memberships WHERE user_id = $1 FOR UPDATE",
          [user.id]
        );
        const sessions = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM public."session" WHERE "userId" = $1',
          [user.id]
        );
        if (
          (account.rowCount ?? 0) > 1
          || account.rows.some((row) => row.provider_id !== "credential")
          || (membership.rowCount ?? 0) > 1
          || membership.rows.some((row) => row.archive_id !== state.archiveId || row.role !== "owner")
          || exactCount(sessions.rows[0]?.count) !== 0
        ) throw new Error();
        const deleted = await client.query('DELETE FROM public."user" WHERE id = $1', [user.id]);
        if (deleted.rowCount !== 1) throw new Error();
      }
    }

    const restored = await readIdentitySnapshot(client, state.identity.userId);
    if (!sameIdentityDigests(restored.digests, state.identity.digests)) throw new Error();
    if (restored.sessionIds.join("\0") !== state.identity.sessionIds.join("\0")) throw new Error();
    if (state.identity.bootstrapCreated) {
      const residue = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM public."user" WHERE lower(email) = $1',
        [selector]
      );
      if (exactCount(residue.rows[0]?.count) !== 0) throw new Error();
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function lockDemoArchive(client: PoolClient, archiveId: string): Promise<void> {
  const archive = await client.query<{ dataset_mode: string }>(
    "SELECT dataset_mode FROM archives WHERE id = $1 FOR UPDATE",
    [archiveId]
  );
  if (archive.rowCount !== 1 || archive.rows[0]?.dataset_mode !== "demo") throw new Error();
}

async function readCanonicalArchiveSnapshot(
  client: PoolClient,
  archiveId: string
): Promise<Record<string, CanonicalDigest>> {
  const tables = await readArchiveScopedTableNames(client);
  const snapshot: Record<string, CanonicalDigest> = {
    "archives:id": await canonicalDigest(
      client,
      "SELECT * FROM public.archives WHERE id = $1",
      [archiveId]
    )
  };
  for (const table of tables) {
    if (!validSqlIdentifier(table)) throw new Error();
    snapshot[`archive_id:${table}`] = await canonicalDigest(
      client,
      `SELECT * FROM public."${table}" WHERE archive_id = $1`,
      [archiveId]
    );
  }
  return snapshot;
}

async function readArchiveScopedTableNames(client: PoolClient): Promise<string[]> {
  const tables = await client.query<{ table_name: string }>(
    `SELECT DISTINCT relation.relname AS table_name
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = relation.oid
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND attribute.attname = 'archive_id'
        AND attribute.attnum > 0
        AND attribute.attisdropped = false
      ORDER BY relation.relname`
  );
  const names = tables.rows.map((row) => row.table_name);
  if (names.some((table) => !validSqlIdentifier(table))) throw new Error();
  return names;
}

async function readTemporalBaseline(
  client: PoolClient,
  archiveId: string
): Promise<TemporalBaseline> {
  const baseline: TemporalBaseline = {};
  const tables = ["archives", ...await readArchiveScopedTableNames(client)];
  for (const table of tables) {
    if (!validSqlIdentifier(table)) throw new Error();
    const primaryKey = await client.query<{ column_name: string }>(
      `SELECT attribute.attname AS column_name
         FROM pg_catalog.pg_index AS index
         JOIN LATERAL unnest(index.indkey) WITH ORDINALITY AS key(attnum, position) ON true
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid = index.indrelid AND attribute.attnum = key.attnum
        WHERE index.indrelid = $1::regclass
          AND index.indisprimary
        ORDER BY key.position`,
      [`public.${table}`]
    );
    const timestamps = await client.query<{ column_name: string }>(
      `SELECT attname AS column_name
         FROM pg_catalog.pg_attribute
        WHERE attrelid = $1::regclass
          AND attname IN ('created_at', 'updated_at')
          AND atttypid = 'timestamptz'::regtype
          AND attnum > 0
          AND attisdropped = false
        ORDER BY attname`,
      [`public.${table}`]
    );
    const sortOrder = await client.query<{ column_name: string }>(
      `SELECT attname AS column_name
         FROM pg_catalog.pg_attribute
        WHERE attrelid = $1::regclass
          AND attname = 'sort_order'
          AND atttypid IN ('smallint'::regtype, 'integer'::regtype, 'bigint'::regtype)
          AND attnum > 0
          AND attisdropped = false`,
      [`public.${table}`]
    );
    const primaryKeyColumns = primaryKey.rows.map((row) => row.column_name);
    const timestampColumns = timestamps.rows.map((row) => row.column_name);
    const sortOrderColumn = sortOrder.rows[0]?.column_name === "sort_order" ? "sort_order" : null;
    if (timestampColumns.length === 0 && sortOrderColumn === null) continue;
    if (primaryKeyColumns.length === 0
      || [...primaryKeyColumns, ...timestampColumns, ...(sortOrderColumn ? [sortOrderColumn] : [])]
        .some((column) => !validSqlIdentifier(column))) throw new Error();
    const projections = [
      ...primaryKeyColumns.map((column, index) => `"${column}"::text AS "key_${index}"`),
      ...timestampColumns.map((column, index) => `"${column}"::text AS "timestamp_${index}"`),
      ...(sortOrderColumn ? [`"${sortOrderColumn}"::text AS "sort_order"`] : [])
    ];
    const rows = await client.query<Record<string, string | null>>(
      `SELECT ${projections.join(", ")}
         FROM public."${table}"
        WHERE "${table === "archives" ? "id" : "archive_id"}" = $1
        ORDER BY ${primaryKeyColumns.map((column) => `"${column}"`).join(", ")}`,
      [archiveId]
    );
    baseline[table] = {
      primaryKeyColumns,
      timestampColumns,
      sortOrderColumn,
      rows: rows.rows.map((row) => ({
        keyValues: primaryKeyColumns.map((_, index) => row[`key_${index}`] ?? ""),
        timestampValues: timestampColumns.map((_, index) => row[`timestamp_${index}`] ?? null),
        sortOrderValue: sortOrderColumn ? row.sort_order ?? null : null
      }))
    };
  }
  if (!validTemporalBaseline(baseline) || baseline.archives?.rows.length !== 1) throw new Error();
  return baseline;
}

async function restoreTemporalBaseline(
  client: PoolClient,
  archiveId: string,
  baseline: TemporalBaseline
): Promise<void> {
  for (const [table, tableBaseline] of Object.entries(baseline).sort(([left], [right]) => left.localeCompare(right))) {
    if (!validSqlIdentifier(table)) throw new Error();
    for (const row of tableBaseline.rows) {
      const restoredValues = [
        ...row.timestampValues,
        ...(tableBaseline.sortOrderColumn ? [row.sortOrderValue] : [])
      ];
      const keyOffset = 2 + restoredValues.length;
      const assignments = tableBaseline.timestampColumns.map(
        (column, index) => `"${column}" = $${index + 2}::timestamptz`
      );
      if (tableBaseline.sortOrderColumn) {
        assignments.push(
          `"${tableBaseline.sortOrderColumn}" = $${tableBaseline.timestampColumns.length + 2}::integer`
        );
      }
      const keyPredicates = tableBaseline.primaryKeyColumns.map(
        (column, index) => `"${column}"::text = $${keyOffset + index}`
      );
      const restored = await client.query(
        `UPDATE public."${table}"
            SET ${assignments.join(", ")}
          WHERE "${table === "archives" ? "id" : "archive_id"}" = $1
            AND ${keyPredicates.join(" AND ")}`,
        [archiveId, ...restoredValues, ...row.keyValues]
      );
      if (restored.rowCount !== 1) throw new Error();
    }
  }
}

async function readIdentityBaseline(
  client: PoolClient,
  config: BrowserCanaryStateConfiguration
): Promise<IdentityBaseline> {
  const selector = config.userId ?? config.email!.toLowerCase();
  const users = config.userId
    ? await client.query<{ id: string }>('SELECT id FROM public."user" WHERE id = $1', [config.userId])
    : await client.query<{ id: string }>('SELECT id FROM public."user" WHERE lower(email) = $1', [selector]);
  if (users.rowCount && users.rowCount > 1) throw new Error();
  if (config.mode === "staging" && users.rowCount !== 1) throw new Error();
  const userId = users.rows[0]?.id ?? null;
  const snapshot = await readIdentitySnapshot(client, userId);
  return {
    selectorSha256: sha256(`${config.mode}:${selector}`),
    userId,
    bootstrapCreated: config.mode === "disposable" && userId === null,
    ...snapshot
  };
}

async function readIdentitySnapshot(
  client: PoolClient,
  userId: string | null
): Promise<Pick<IdentityBaseline, "digests" | "sessionIds">> {
  const sessionIds = userId === null
    ? []
    : (await client.query<{ id: string }>(
        'SELECT id FROM public."session" WHERE "userId" = $1 ORDER BY id',
        [userId]
      )).rows.map((row) => row.id);
  return {
    sessionIds,
    digests: {
      user: await canonicalDigest(client, 'SELECT * FROM public."user" WHERE id = $1', [userId]),
      accounts: await canonicalDigest(client, 'SELECT * FROM public."account" WHERE "userId" = $1', [userId]),
      sessions: await canonicalDigest(client, 'SELECT * FROM public."session" WHERE "userId" = $1', [userId]),
      memberships: await canonicalDigest(client, "SELECT * FROM public.memberships WHERE user_id = $1", [userId])
    }
  };
}

async function canonicalDigest(
  client: PoolClient,
  selection: string,
  parameters: unknown[]
): Promise<CanonicalDigest> {
  const result = await client.query<{ row_count: string; payload: string }>(
    `SELECT count(*)::text AS row_count,
            coalesce(
              jsonb_agg(to_jsonb(canonical_row) ORDER BY to_jsonb(canonical_row)::text),
              '[]'::jsonb
            )::text AS payload
       FROM (${selection}) AS canonical_row`,
    parameters
  );
  return {
    rows: exactCount(result.rows[0]?.row_count),
    sha256: sha256(result.rows[0]?.payload ?? "")
  };
}

async function assertPersonMarker(
  database: Pick<Pool, "query"> | PoolClient,
  archiveId: string,
  expected: boolean
): Promise<void> {
  const result = await database.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM people WHERE archive_id = $1 AND display_name = 'Rowan Canary'",
    [archiveId]
  );
  if (exactCount(result.rows[0]?.count) !== (expected ? 1 : 0)) throw new Error();
}

async function verifyDatabaseIdentity(
  database: Pool,
  mode: Exclude<BrowserCanaryMode, "production">
): Promise<string | undefined> {
  const configured = process.env.KINRESOLVE_DATABASE_IDENTITY?.trim();
  if (mode === "staging" && !configured) throw new Error();
  if (!configured) return undefined;
  return validateConfiguredDatabaseIdentity(configured, await readDatabaseIdentity(database)).fingerprint;
}

async function readState(
  statePath: string,
  config: BrowserCanaryStateConfiguration,
  mode: Exclude<BrowserCanaryMode, "production">,
  databaseIdentity: string | undefined
): Promise<CanaryState> {
  const metadata = await stat(statePath);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > maxStateBytes) throw new Error();
  const parsed = JSON.parse(await readFile(statePath, "utf8")) as unknown;
  if (
    !isRecord(parsed)
    || !isRecord(parsed.archiveSnapshot)
    || !isRecord(parsed.identity)
    || !isRecord(parsed.identity.digests)
    || !isRecord(parsed.temporalBaseline)
  ) throw new Error();
  const state = parsed as CanaryState;
  const selector = config.userId ?? config.email!.toLowerCase();
  const expectedFixtureObjectKey =
    `archives/${config.archiveId}/${fixtureObjectPurpose}/${syntheticGedcomFixtureSha256}`;
  if (
    state.schemaVersion !== stateSchemaVersion
    || state.mode !== mode
    || state.archiveId !== config.archiveId
    || state.releaseSha !== config.releaseSha
    || state.runId !== config.runId
    || state.caseTitle !== browserCanaryCaseTitle(config)
    || state.sourceName !== browserCanarySourceName(config)
    || state.databaseIdentity !== databaseIdentity
    || state.fixtureObjectKey !== expectedFixtureObjectKey
    || !validTemporalBaseline(state.temporalBaseline)
    || !validCanonicalSnapshot(state.archiveSnapshot)
    || state.archiveSnapshot["archives:id"]?.rows !== 1
    || state.identity.selectorSha256 !== sha256(`${config.mode}:${selector}`)
    || (state.identity.userId !== null
      && (typeof state.identity.userId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(state.identity.userId)))
    || (config.mode === "staging" && state.identity.userId !== config.userId)
    || typeof state.identity.bootstrapCreated !== "boolean"
    || state.identity.bootstrapCreated !== (config.mode === "disposable" && state.identity.userId === null)
    || !Array.isArray(state.identity.sessionIds)
    || state.identity.sessionIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(id))
    || new Set(state.identity.sessionIds).size !== state.identity.sessionIds.length
    || !validCanonicalSnapshot(state.identity.digests)
    || Object.keys(state.identity.digests).sort().join("\0") !== [
      "accounts", "memberships", "sessions", "user"
    ].join("\0")
  ) throw new Error();
  return state;
}

function validTemporalBaseline(value: TemporalBaseline): boolean {
  const entries = Object.entries(value);
  return entries.length > 0
    && Object.hasOwn(value, "archives")
    && entries.every(([table, tableBaseline]) => {
      if (!validSqlIdentifier(table)
        || !isRecord(tableBaseline)
        || !Array.isArray(tableBaseline.primaryKeyColumns)
        || tableBaseline.primaryKeyColumns.length === 0
        || tableBaseline.primaryKeyColumns.some((column) => !validSqlIdentifier(column))
        || new Set(tableBaseline.primaryKeyColumns).size !== tableBaseline.primaryKeyColumns.length
        || !Array.isArray(tableBaseline.timestampColumns)
        || tableBaseline.timestampColumns.some((column) => column !== "created_at" && column !== "updated_at")
        || new Set(tableBaseline.timestampColumns).size !== tableBaseline.timestampColumns.length
        || (tableBaseline.sortOrderColumn !== null && tableBaseline.sortOrderColumn !== "sort_order")
        || (tableBaseline.timestampColumns.length === 0 && tableBaseline.sortOrderColumn === null)
        || !Array.isArray(tableBaseline.rows)) return false;
      const rows = tableBaseline.rows as TemporalTableBaseline["rows"];
      return rows.every((row) => (
        isRecord(row)
        && Array.isArray(row.keyValues)
        && row.keyValues.length === tableBaseline.primaryKeyColumns.length
        && row.keyValues.every(validTemporalKeyValue)
        && Array.isArray(row.timestampValues)
        && row.timestampValues.length === tableBaseline.timestampColumns.length
        && row.timestampValues.every((timestamp) => timestamp === null || validDatabaseTimestamp(timestamp))
        && (tableBaseline.sortOrderColumn
          ? typeof row.sortOrderValue === "string" && /^-?[0-9]+$/.test(row.sortOrderValue)
          : row.sortOrderValue === null)
      )) && new Set(rows.map((row) => row.keyValues.join("\0"))).size === rows.length;
    });
}

function validTemporalKeyValue(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value);
}

function validSqlIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(value);
}

function validDatabaseTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 64
    && !/[\0\r\n]/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validCanonicalSnapshot(value: Record<string, unknown>): boolean {
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, digest]) => (
    /^[A-Za-z0-9_:.-]{1,128}$/.test(key)
    && isRecord(digest)
    && Number.isSafeInteger(digest.rows)
    && typeof digest.rows === "number"
    && digest.rows >= 0
    && typeof digest.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(digest.sha256)
  ));
}

function sameCanonicalSnapshot(
  left: Record<string, CanonicalDigest>,
  right: Record<string, CanonicalDigest>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.join("\0") === rightKeys.join("\0")
    && leftKeys.every((key) => (
      left[key]?.rows === right[key]?.rows
      && left[key]?.sha256 === right[key]?.sha256
    ));
}

function firstCanonicalMismatch(
  left: Record<string, CanonicalDigest>,
  right: Record<string, CanonicalDigest>
): string | undefined {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.find((key) => (
    left[key]?.rows !== right[key]?.rows
    || left[key]?.sha256 !== right[key]?.sha256
  ));
}

function sameIdentityDigests(
  left: IdentityBaseline["digests"],
  right: IdentityBaseline["digests"]
): boolean {
  return sameCanonicalSnapshot(left, right);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactCount(value: string | undefined): number {
  if (!value || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error();
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new Error();
  return count;
}

function strictStatePath(value: string | undefined): string {
  if (!value || value.includes("\0") || !value.endsWith(".json")) throw new Error();
  return path.resolve(value);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
