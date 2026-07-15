import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const migrationName = "008_integration_upload_intents.sql";

describe("direct integration upload migration contract", () => {
  it("defines an archive-scoped, expiring, one-use upload intent", async () => {
    const sql = (await readFile(path.join(process.cwd(), "db", "migrations", migrationName), "utf8"))
      .toLowerCase();

    expect(sql).toContain("create table public.integration_upload_intents");
    expect(sql).toContain("primary key (archive_id, id)");
    expect(sql).toContain("foreign key (archive_id, connection_id)");
    expect(sql).toContain("foreign key (archive_id, connection_id, artifact_id)");
    expect(sql).toContain("expires_at");
    expect(sql).toContain("consumed_at");
    expect(sql).toContain("staging_deleted_at");
    expect(sql).toContain("declared_size_bytes <= 134217728");
    expect(sql).toMatch(/status\s*=\s*'pending'\s+and\s+consumed_at\s+is\s+null\s+and\s+artifact_id\s+is\s+null/);
    expect(sql).toMatch(
      /create index integration_upload_intents_cleanup_idx[\s\S]*?where staging_deleted_at is null/
    );
  });
});

describeIfDatabase("installed direct integration upload schema", () => {
  afterAll(async () => {
    await closeDatabasePools();
  });

  it("binds intents and completed artifacts to the same archive and connection", async () => {
    const primaryKey = await query<{ columns: string[] }>(
      `SELECT array_agg(attribute.attname::text ORDER BY key_column.position) AS columns
       FROM pg_catalog.pg_constraint constraint_record
       JOIN unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position) ON true
       JOIN pg_catalog.pg_attribute attribute
         ON attribute.attrelid = constraint_record.conrelid AND attribute.attnum = key_column.attnum
       WHERE constraint_record.conrelid = 'public.integration_upload_intents'::regclass
         AND constraint_record.contype = 'p'
       GROUP BY constraint_record.oid`,
      [],
      { databaseUrl: databaseUrl! }
    );
    const relationships = await query<{ parent: string; columns: string[] }>(
      `SELECT constraint_record.confrelid::regclass::text AS parent,
              array_agg(attribute.attname::text ORDER BY key_column.position) AS columns
       FROM pg_catalog.pg_constraint constraint_record
       JOIN unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position) ON true
       JOIN pg_catalog.pg_attribute attribute
         ON attribute.attrelid = constraint_record.conrelid AND attribute.attnum = key_column.attnum
       WHERE constraint_record.conrelid = 'public.integration_upload_intents'::regclass
         AND constraint_record.contype = 'f'
       GROUP BY constraint_record.oid, constraint_record.confrelid`,
      [],
      { databaseUrl: databaseUrl! }
    );

    expect(primaryKey.rows).toEqual([{ columns: ["archive_id", "id"] }]);
    expect(relationships.rows).toEqual(expect.arrayContaining([
      { parent: "archives", columns: ["archive_id"] },
      { parent: "integration_connections", columns: ["archive_id", "connection_id"] },
      { parent: "integration_artifacts", columns: ["archive_id", "connection_id", "artifact_id"] }
    ]));
  });
});
