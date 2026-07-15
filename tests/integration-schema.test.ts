import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import { listMigrationFiles } from "@/lib/migrations";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const migrationName = "006_integration_sources.sql";
const integrationTables = [
  "integration_connections",
  "integration_snapshots",
  "external_entity_refs",
  "sync_runs",
  "sync_changes"
] as const;

let integrationSql = "";

beforeAll(async () => {
  const migrationsDirectory = path.join(process.cwd(), "db", "migrations");
  const files = await listMigrationFiles(migrationsDirectory);
  const migration = files.find((file) => file.name === migrationName);
  if (migration) {
    integrationSql = (await readFile(migration.filePath, "utf8")).toLowerCase();
  }
});

afterAll(async () => {
  await closeDatabasePools();
});

describe("integration persistence migration contract", () => {
  it("ships the provider-neutral integration migration and records its immutable checksum", async () => {
    const files = await listMigrationFiles(path.join(process.cwd(), "db", "migrations"));
    const manifest = JSON.parse(
      await readFile(path.join(process.cwd(), "db", "migrations", "checksums.json"), "utf8")
    ) as { files?: Record<string, string> };

    expect(files.map((file) => file.name)).toContain(migrationName);
    expect(manifest.files?.[migrationName]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates the connection, snapshot, external identity, run, and change tables", () => {
    for (const table of integrationTables) {
      expect(integrationSql, `${table} should be introduced by ${migrationName}`).toMatch(
        new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+(?:public\\.)?${table}\\b`)
      );
    }
  });

  it("defines provider, SHA-256, classification, resolution, and rollback fields", () => {
    for (const token of [
      "ancestry_export",
      "family_tree_maker",
      "rootsmagic",
      "gedcom",
      "ancestry_api",
      "sha256",
      "last_applied_snapshot_id",
      "base_snapshot_id",
      "incoming_snapshot_id",
      "classification",
      "proposed_action",
      "resolution",
      "apply_idempotency_key",
      "applied_archive_updated_at",
      "backup_id",
      "rollback_idempotency_key",
      "rolled_back_at"
    ]) {
      expect(integrationSql, `${migrationName} should define ${token}`).toContain(token);
    }
  });
});

describeIfDatabase("installed integration schema", () => {
  it("uses archive-scoped primary keys and an archive ownership foreign key for every integration table", async () => {
    for (const table of integrationTables) {
      const primaryKey = await query<{ columns: string[] }>(
        `SELECT array_agg(attribute.attname::text ORDER BY key_column.position) AS columns
         FROM pg_catalog.pg_constraint constraint_record
         JOIN unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position) ON true
         JOIN pg_catalog.pg_attribute attribute
           ON attribute.attrelid = constraint_record.conrelid AND attribute.attnum = key_column.attnum
         WHERE constraint_record.conrelid = $1::regclass AND constraint_record.contype = 'p'
         GROUP BY constraint_record.oid`,
        [`public.${table}`],
        { databaseUrl: databaseUrl! }
      );
      const archiveForeignKey = await query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM pg_catalog.pg_constraint constraint_record
         WHERE constraint_record.conrelid = $1::regclass
           AND constraint_record.confrelid = 'public.archives'::regclass
           AND constraint_record.contype = 'f'
           AND pg_get_constraintdef(constraint_record.oid) ILIKE '%(archive_id)%'`,
        [`public.${table}`],
        { databaseUrl: databaseUrl! }
      );

      expect(primaryKey.rows).toEqual([{ columns: ["archive_id", "id"] }]);
      expect(archiveForeignKey.rows[0].count).toBe(1);
    }
  });

  it("keeps all integration relationships inside their owning archive", async () => {
    const expectedRelationships = [
      ["integration_connections", "integration_snapshots", ["archive_id", "id", "last_applied_snapshot_id"]],
      ["integration_snapshots", "integration_connections", ["archive_id", "connection_id"]],
      ["external_entity_refs", "integration_connections", ["archive_id", "connection_id"]],
      ["external_entity_refs", "integration_snapshots", ["archive_id", "connection_id", "snapshot_id"]],
      ["sync_runs", "integration_connections", ["archive_id", "connection_id"]],
      ["sync_runs", "integration_snapshots", ["archive_id", "connection_id", "base_snapshot_id"]],
      ["sync_runs", "integration_snapshots", ["archive_id", "connection_id", "incoming_snapshot_id"]],
      ["sync_runs", "workspace_backups", ["archive_id", "backup_id"]],
      ["sync_changes", "sync_runs", ["archive_id", "run_id"]]
    ] as const;

    for (const [childTable, parentTable, expectedColumns] of expectedRelationships) {
      const result = await query<{ columns: string[] }>(
        `SELECT array_agg(attribute.attname::text ORDER BY key_column.position) AS columns
         FROM pg_catalog.pg_constraint constraint_record
         JOIN unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position) ON true
         JOIN pg_catalog.pg_attribute attribute
           ON attribute.attrelid = constraint_record.conrelid AND attribute.attnum = key_column.attnum
         WHERE constraint_record.conrelid = $1::regclass
           AND constraint_record.confrelid = $2::regclass
           AND constraint_record.contype = 'f'
         GROUP BY constraint_record.oid`,
        [`public.${childTable}`, `public.${parentTable}`],
        { databaseUrl: databaseUrl! }
      );

      expect(result.rows.map((row) => row.columns)).toContainEqual([...expectedColumns]);
    }
  });

  it("binds every snapshot reference to the owning connection as well as the archive", async () => {
    const expectedRelationships = [
      ["integration_connections", ["archive_id", "id", "last_applied_snapshot_id"]],
      ["external_entity_refs", ["archive_id", "connection_id", "snapshot_id"]],
      ["sync_runs", ["archive_id", "connection_id", "base_snapshot_id"]],
      ["sync_runs", ["archive_id", "connection_id", "incoming_snapshot_id"]]
    ] as const;

    for (const [childTable, expectedColumns] of expectedRelationships) {
      const result = await query<{ columns: string[] }>(
        `SELECT array_agg(attribute.attname::text ORDER BY key_column.position) AS columns
         FROM pg_catalog.pg_constraint constraint_record
         JOIN unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position) ON true
         JOIN pg_catalog.pg_attribute attribute
           ON attribute.attrelid = constraint_record.conrelid AND attribute.attnum = key_column.attnum
         WHERE constraint_record.conrelid = $1::regclass
           AND constraint_record.confrelid = 'public.integration_snapshots'::regclass
           AND constraint_record.contype = 'f'
         GROUP BY constraint_record.oid`,
        [`public.${childTable}`],
        { databaseUrl: databaseUrl! }
      );

      expect(result.rows.map((row) => row.columns)).toContainEqual([...expectedColumns]);
    }
  });

  it("enforces connection-scoped snapshot deduplication at the database boundary", async () => {
    const uniqueConstraints = await query<{ definition: string }>(
      `SELECT pg_get_constraintdef(constraint_record.oid) AS definition
       FROM pg_catalog.pg_constraint constraint_record
       WHERE constraint_record.conrelid = 'public.integration_snapshots'::regclass
         AND constraint_record.contype = 'u'`,
      [],
      { databaseUrl: databaseUrl! }
    );

    expect(uniqueConstraints.rows.map((row) => row.definition.toLowerCase())).toContain(
      "unique (archive_id, connection_id, sha256)"
    );
  });

  it("makes each external identifier unique inside its connection", async () => {
    const uniqueConstraints = await query<{ definition: string }>(
      `SELECT pg_get_constraintdef(constraint_record.oid) AS definition
       FROM pg_catalog.pg_constraint constraint_record
       WHERE constraint_record.conrelid = 'public.external_entity_refs'::regclass
         AND constraint_record.contype = 'u'`,
      [],
      { databaseUrl: databaseUrl! }
    );

    expect(uniqueConstraints.rows.map((row) => row.definition.toLowerCase())).toContain(
      "unique (archive_id, connection_id, entity_type, external_id)"
    );
  });

  it("constrains provider, digest, run state, classification, and review action values", async () => {
    const checks = await query<{ table_name: string; definition: string }>(
      `SELECT relation.relname AS table_name, pg_get_constraintdef(constraint_record.oid) AS definition
       FROM pg_catalog.pg_constraint constraint_record
       JOIN pg_catalog.pg_class relation ON relation.oid = constraint_record.conrelid
       WHERE relation.relname = ANY($1::text[]) AND constraint_record.contype = 'c'`,
      [[...integrationTables]],
      { databaseUrl: databaseUrl! }
    );
    const definitions = checks.rows.map((row) => `${row.table_name} ${row.definition}`.toLowerCase()).join("\n");

    for (const value of [
      "ancestry_export",
      "family_tree_maker",
      "rootsmagic",
      "gedcom",
      "ancestry_api",
      "remote_only",
      "local_only",
      "same",
      "conflict",
      "deletion",
      "accept_incoming",
      "keep_local",
      "no_op",
      "review",
      "rolled_back"
    ]) {
      expect(definitions, `a check constraint should allow ${value}`).toContain(value);
    }
    expect(definitions).toMatch(/sha256[\s\S]*(64|a-f0-9)/);
  });
});
