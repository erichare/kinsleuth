import { afterAll, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  MAX_SYNC_CHANGE_SEARCH_PROJECTION_BYTES,
  syncChangeSearchProjection
} from "@/lib/integrations/change-search";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

afterAll(async () => {
  await closeDatabasePools();
});

describe("sync change search projection", () => {
  it("indexes bounded review labels while excluding free-form private content", () => {
    const projection = syncChangeSearchProjection({
      entityType: "person",
      externalId: "@I1@",
      localEntityId: "person-mara-quill",
      classification: "conflict",
      resolutionPayload: { values: {
        base: {
          displayName: "Mara Quill",
          givenName: "Mara",
          surname: "Quill",
          notes: "sealed synthetic note"
        },
        local: {
          displayName: "Mara  Quill",
          transcript: "private synthetic transcript"
        },
        incoming: {
          displayName: "Mara Quinn",
          raw: "0 @PRIVATE_RAW@ INDI\n1 NAME Mara /Quinn/"
        }
      } }
    });

    expect(projection).toContain("person");
    expect(projection).toContain("@I1@");
    expect(projection).toContain("conflict");
    expect(projection).toContain("Mara Quill");
    expect(projection).toContain("Mara Quinn");
    expect(projection).not.toContain("sealed synthetic note");
    expect(projection).not.toContain("private synthetic transcript");
    expect(projection).not.toContain("@PRIVATE_RAW@");
    expect(Buffer.byteLength(projection, "utf8")).toBeLessThanOrEqual(MAX_SYNC_CHANGE_SEARCH_PROJECTION_BYTES);
  });

  it("caps adversarially long labels without indexing unapproved fields", () => {
    const projection = syncChangeSearchProjection({
      entityType: "source",
      classification: "remote_only",
      resolutionPayload: { values: {
        incoming: {
          title: `Synthetic harbor ledger ${"x".repeat(20_000)}`,
          repository: `Northlight archive ${"y".repeat(20_000)}`,
          notes: "do-not-index"
        }
      } }
    });

    expect(projection).toContain("Synthetic harbor ledger");
    expect(projection).toContain("Northlight archive");
    expect(projection).not.toContain("do-not-index");
    expect(Buffer.byteLength(projection, "utf8")).toBeLessThanOrEqual(MAX_SYNC_CHANGE_SEARCH_PROJECTION_BYTES);
  });
});

describeIfDatabase("installed sync change search projection", () => {
  it("stores a required bounded projection behind a trigram index", async () => {
    const column = await query<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sync_changes'
         AND column_name = 'search_projection'`,
      [],
      { databaseUrl: databaseUrl! }
    );
    const constraint = await query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'public.sync_changes'::regclass
         AND conname = 'sync_changes_search_projection_size_check'`,
      [],
      { databaseUrl: databaseUrl! }
    );
    const index = await query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'sync_changes'
         AND indexname = 'sync_changes_search_projection_trgm_idx'`,
      [],
      { databaseUrl: databaseUrl! }
    );

    expect(column.rows).toEqual([{ is_nullable: "NO", column_default: "''::text" }]);
    expect(constraint.rows[0]?.definition.toLowerCase()).toContain("octet_length(search_projection) <= 4096");
    expect(index.rows[0]?.indexdef.toLowerCase()).toMatch(
      /using gin \(search_projection extensions\.gin_trgm_ops\)/
    );
  });
});
