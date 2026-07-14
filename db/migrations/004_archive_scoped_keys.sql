-- Convert globally keyed workspace rows to archive-scoped keys. This is a
-- blocking maintenance-window migration: all affected tables are locked until
-- the transaction commits, and every primary-key index is rebuilt.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE
  public.archives,
  public.people,
  public.person_facts,
  public.import_snapshots,
  public.raw_records,
  public.workspace_backups,
  public.sources,
  public.research_cases,
  public.hypotheses,
  public.evidence_items,
  public.tasks,
  public.dna_matches,
  public.dna_hypotheses,
  public.embeddings,
  public.ai_runs
IN ACCESS EXCLUSIVE MODE;

DO $migration$
DECLARE
  archive_scoped_table text;
  primary_key record;
  archive_foreign_key record;
  relationship record;
  relationship_foreign_key record;
  key_columns text[];
  referenced_columns text[];
  schema_mode text;
  table_mode text;
  relationship_mode text;
  matching_count integer;
  inbound_relationship_count integer;
  has_invalid_rows boolean;
BEGIN
  -- Classify every primary key before changing anything. Only the complete
  -- shipped legacy state or the complete desired state is accepted.
  FOREACH archive_scoped_table IN ARRAY ARRAY[
    'people', 'person_facts', 'import_snapshots', 'raw_records', 'workspace_backups',
    'sources', 'research_cases', 'hypotheses', 'evidence_items', 'tasks',
    'dna_matches', 'dna_hypotheses', 'embeddings', 'ai_runs'
  ]
  LOOP
    IF to_regclass(format('public.%I', archive_scoped_table)) IS NULL THEN
      RAISE EXCEPTION 'Unexpected or partial archive-key state: table public.% is missing', archive_scoped_table;
    END IF;

    SELECT count(*) INTO matching_count
    FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conrelid = format('public.%I', archive_scoped_table)::regclass
      AND constraint_record.contype = 'p';

    IF matching_count <> 1 THEN
      RAISE EXCEPTION 'Unexpected or partial archive-key state: public.% must have exactly one primary key', archive_scoped_table;
    END IF;

    SELECT constraint_record.* INTO primary_key
    FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conrelid = format('public.%I', archive_scoped_table)::regclass
      AND constraint_record.contype = 'p';

    SELECT array_agg(attribute.attname::text ORDER BY key_column.position) INTO key_columns
    FROM unnest(primary_key.conkey) WITH ORDINALITY AS key_column(attnum, position)
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = primary_key.conrelid
      AND attribute.attnum = key_column.attnum;

    IF primary_key.conname <> archive_scoped_table || '_pkey'
      OR NOT primary_key.convalidated
      OR primary_key.condeferrable
      OR primary_key.condeferred
    THEN
      RAISE EXCEPTION 'Unexpected or partial archive-key state: primary key metadata for public.% is not recognized', archive_scoped_table;
    END IF;

    IF key_columns = ARRAY['id']::text[] THEN
      table_mode := 'legacy';
    ELSIF key_columns = ARRAY['archive_id', 'id']::text[] THEN
      table_mode := 'desired';
    ELSE
      RAISE EXCEPTION 'Unexpected or partial archive-key state: primary key columns for public.% are not recognized', archive_scoped_table;
    END IF;

    IF schema_mode IS NULL THEN
      schema_mode := table_mode;
    ELSIF schema_mode <> table_mode THEN
      RAISE EXCEPTION 'Unexpected mixed archive-key state: public.% is % while earlier tables are %',
        archive_scoped_table, table_mode, schema_mode;
    END IF;

    SELECT count(*) INTO matching_count
    FROM pg_catalog.pg_attribute attribute
    WHERE attribute.attrelid = format('public.%I', archive_scoped_table)::regclass
      AND attribute.attname IN ('archive_id', 'id')
      AND attribute.atttypid = 'text'::regtype
      AND attribute.attnotnull
      AND NOT attribute.attisdropped;
    IF matching_count <> 2 THEN
      RAISE EXCEPTION 'Unexpected or partial archive-key state: public.% key columns must be NOT NULL text', archive_scoped_table;
    END IF;

    -- A second global-id or composite unique index would preserve the very
    -- uniqueness rule this migration removes, so reject it explicitly.
    SELECT count(*) INTO matching_count
    FROM pg_catalog.pg_index index_record
    WHERE index_record.indrelid = format('public.%I', archive_scoped_table)::regclass
      AND index_record.indisunique
      AND NOT index_record.indisprimary
      AND index_record.indexprs IS NULL
      AND ARRAY(
        SELECT attribute.attname::text
        FROM unnest(index_record.indkey::smallint[]) WITH ORDINALITY AS index_column(attnum, position)
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = index_record.indrelid
          AND attribute.attnum = index_column.attnum
        ORDER BY index_column.position
      ) IN (ARRAY['id']::text[], ARRAY['archive_id', 'id']::text[]);
    IF matching_count <> 0 THEN
      RAISE EXCEPTION 'Unexpected archive-key uniqueness: public.% has a duplicate unique index', archive_scoped_table;
    END IF;

    -- The archive ownership constraint is invariant across both supported
    -- states and must be exact before any key is rebuilt.
    SELECT count(*) INTO matching_count
    FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conrelid = format('public.%I', archive_scoped_table)::regclass
      AND constraint_record.confrelid = 'public.archives'::regclass
      AND constraint_record.contype = 'f';
    IF matching_count <> 1 THEN
      RAISE EXCEPTION 'Unexpected or partial archive-key state: public.% must have one archive foreign key', archive_scoped_table;
    END IF;

    SELECT constraint_record.* INTO archive_foreign_key
    FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conrelid = format('public.%I', archive_scoped_table)::regclass
      AND constraint_record.confrelid = 'public.archives'::regclass
      AND constraint_record.contype = 'f';

    SELECT array_agg(attribute.attname::text ORDER BY key_column.position) INTO key_columns
    FROM unnest(archive_foreign_key.conkey) WITH ORDINALITY AS key_column(attnum, position)
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = archive_foreign_key.conrelid
      AND attribute.attnum = key_column.attnum;
    SELECT array_agg(attribute.attname::text ORDER BY key_column.position) INTO referenced_columns
    FROM unnest(archive_foreign_key.confkey) WITH ORDINALITY AS key_column(attnum, position)
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = archive_foreign_key.confrelid
      AND attribute.attnum = key_column.attnum;

    IF archive_foreign_key.conname <> archive_scoped_table || '_archive_id_fkey'
      OR key_columns <> ARRAY['archive_id']::text[]
      OR referenced_columns <> ARRAY['id']::text[]
      OR archive_foreign_key.confdeltype <> 'c'
      OR archive_foreign_key.confupdtype <> 'a'
      OR archive_foreign_key.confmatchtype <> 's'
      OR NOT archive_foreign_key.convalidated
      OR archive_foreign_key.condeferrable
      OR archive_foreign_key.condeferred
      OR archive_foreign_key.conindid <> (
        SELECT constraint_record.conindid
        FROM pg_catalog.pg_constraint constraint_record
        WHERE constraint_record.conrelid = 'public.archives'::regclass
          AND constraint_record.contype = 'p'
      )
    THEN
      RAISE EXCEPTION 'Unexpected or partial archive-key state: archive foreign key for public.% is not recognized', archive_scoped_table;
    END IF;
  END LOOP;

  -- Classify the five parent-child relationships whose referenced key changes.
  FOR relationship IN
    SELECT * FROM (VALUES
      ('person_facts', 'person_id', 'people', 'person_facts_person_id_fkey', 'person_facts_archive_person_fkey'),
      ('hypotheses', 'case_id', 'research_cases', 'hypotheses_case_id_fkey', 'hypotheses_archive_case_fkey'),
      ('evidence_items', 'case_id', 'research_cases', 'evidence_items_case_id_fkey', 'evidence_items_archive_case_fkey'),
      ('tasks', 'case_id', 'research_cases', 'tasks_case_id_fkey', 'tasks_archive_case_fkey'),
      ('dna_hypotheses', 'dna_match_id', 'dna_matches', 'dna_hypotheses_dna_match_id_fkey', 'dna_hypotheses_archive_match_fkey')
    ) AS specification(child_table, child_column, parent_table, legacy_name, desired_name)
  LOOP
    SELECT count(*) INTO matching_count
    FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conrelid = format('public.%I', relationship.child_table)::regclass
      AND constraint_record.confrelid = format('public.%I', relationship.parent_table)::regclass
      AND constraint_record.contype = 'f';
    IF matching_count <> 1 THEN
      RAISE EXCEPTION 'Unexpected or partial archive-key state: relationship public.% to public.% must have one foreign key',
        relationship.child_table, relationship.parent_table;
    END IF;

    SELECT constraint_record.* INTO relationship_foreign_key
    FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conrelid = format('public.%I', relationship.child_table)::regclass
      AND constraint_record.confrelid = format('public.%I', relationship.parent_table)::regclass
      AND constraint_record.contype = 'f';

    SELECT array_agg(attribute.attname::text ORDER BY key_column.position) INTO key_columns
    FROM unnest(relationship_foreign_key.conkey) WITH ORDINALITY AS key_column(attnum, position)
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = relationship_foreign_key.conrelid
      AND attribute.attnum = key_column.attnum;
    SELECT array_agg(attribute.attname::text ORDER BY key_column.position) INTO referenced_columns
    FROM unnest(relationship_foreign_key.confkey) WITH ORDINALITY AS key_column(attnum, position)
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = relationship_foreign_key.confrelid
      AND attribute.attnum = key_column.attnum;

    IF relationship_foreign_key.conname = relationship.legacy_name
      AND key_columns = ARRAY[relationship.child_column]::text[]
      AND referenced_columns = ARRAY['id']::text[]
    THEN
      relationship_mode := 'legacy';
    ELSIF relationship_foreign_key.conname = relationship.desired_name
      AND key_columns = ARRAY['archive_id', relationship.child_column]::text[]
      AND referenced_columns = ARRAY['archive_id', 'id']::text[]
    THEN
      relationship_mode := 'desired';
    ELSE
      RAISE EXCEPTION 'Unexpected or partial archive-key state: relationship public.% to public.% is not recognized',
        relationship.child_table, relationship.parent_table;
    END IF;

    IF relationship_mode <> schema_mode THEN
      RAISE EXCEPTION 'Unexpected mixed archive-key state: relationship public.% to public.% is % while primary keys are %',
        relationship.child_table, relationship.parent_table, relationship_mode, schema_mode;
    END IF;

    IF relationship_foreign_key.confdeltype <> 'c'
      OR relationship_foreign_key.confupdtype <> 'a'
      OR relationship_foreign_key.confmatchtype <> 's'
      OR NOT relationship_foreign_key.convalidated
      OR relationship_foreign_key.condeferrable
      OR relationship_foreign_key.condeferred
      OR relationship_foreign_key.conindid <> (
        SELECT constraint_record.conindid
        FROM pg_catalog.pg_constraint constraint_record
        WHERE constraint_record.conrelid = format('public.%I', relationship.parent_table)::regclass
          AND constraint_record.contype = 'p'
      )
    THEN
      RAISE EXCEPTION 'Unexpected or partial archive-key state: foreign key metadata for public.% is not recognized',
        relationship.child_table;
    END IF;
  END LOOP;

  SELECT count(*) INTO inbound_relationship_count
  FROM pg_catalog.pg_constraint constraint_record
  WHERE constraint_record.contype = 'f'
    AND constraint_record.confrelid IN (
      'public.people'::regclass,
      'public.research_cases'::regclass,
      'public.dna_matches'::regclass
    );
  IF inbound_relationship_count <> 5 THEN
    RAISE EXCEPTION 'Unexpected archive-key dependencies: expected 5 inbound workspace foreign keys, found %',
      inbound_relationship_count;
  END IF;

  IF schema_mode = 'desired' THEN
    RETURN;
  END IF;

  -- Reject orphaned and cross-archive references before any DDL. The legacy
  -- single-column constraints cannot detect the cross-archive case.
  FOR relationship IN
    SELECT * FROM (VALUES
      ('person_facts', 'person_id', 'people'),
      ('hypotheses', 'case_id', 'research_cases'),
      ('evidence_items', 'case_id', 'research_cases'),
      ('tasks', 'case_id', 'research_cases'),
      ('dna_hypotheses', 'dna_match_id', 'dna_matches')
    ) AS specification(child_table, child_column, parent_table)
  LOOP
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1 FROM public.%I child
         WHERE NOT EXISTS (
           SELECT 1 FROM public.%I parent
           WHERE parent.archive_id = child.archive_id AND parent.id = child.%I
         )
       )',
      relationship.child_table, relationship.parent_table, relationship.child_column
    ) INTO has_invalid_rows;
    IF has_invalid_rows THEN
      RAISE EXCEPTION 'Cannot migrate public.%: cross-archive or orphan % rows exist',
        relationship.child_table, relationship.child_column;
    END IF;
  END LOOP;

  FOR relationship IN
    SELECT * FROM (VALUES
      ('person_facts', 'person_facts_person_id_fkey'),
      ('hypotheses', 'hypotheses_case_id_fkey'),
      ('evidence_items', 'evidence_items_case_id_fkey'),
      ('tasks', 'tasks_case_id_fkey'),
      ('dna_hypotheses', 'dna_hypotheses_dna_match_id_fkey')
    ) AS specification(child_table, legacy_name)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', relationship.child_table, relationship.legacy_name);
  END LOOP;

  FOREACH archive_scoped_table IN ARRAY ARRAY[
    'people', 'person_facts', 'import_snapshots', 'raw_records', 'workspace_backups',
    'sources', 'research_cases', 'hypotheses', 'evidence_items', 'tasks',
    'dna_matches', 'dna_hypotheses', 'embeddings', 'ai_runs'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT %I, ADD CONSTRAINT %I PRIMARY KEY (archive_id, id)',
      archive_scoped_table, archive_scoped_table || '_pkey', archive_scoped_table || '_pkey'
    );
  END LOOP;

  FOR relationship IN
    SELECT * FROM (VALUES
      ('person_facts', 'person_id', 'people', 'person_facts_archive_person_fkey'),
      ('hypotheses', 'case_id', 'research_cases', 'hypotheses_archive_case_fkey'),
      ('evidence_items', 'case_id', 'research_cases', 'evidence_items_archive_case_fkey'),
      ('tasks', 'case_id', 'research_cases', 'tasks_archive_case_fkey'),
      ('dna_hypotheses', 'dna_match_id', 'dna_matches', 'dna_hypotheses_archive_match_fkey')
    ) AS specification(child_table, child_column, parent_table, desired_name)
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (archive_id, %I) REFERENCES public.%I (archive_id, id) ON DELETE CASCADE NOT VALID',
      relationship.child_table, relationship.desired_name, relationship.child_column, relationship.parent_table
    );
    EXECUTE format(
      'ALTER TABLE public.%I VALIDATE CONSTRAINT %I', relationship.child_table, relationship.desired_name
    );
  END LOOP;

  -- Postcondition: every primary key and converted foreign key must now have
  -- the exact desired ordered columns and be validated.
  FOREACH archive_scoped_table IN ARRAY ARRAY[
    'people', 'person_facts', 'import_snapshots', 'raw_records', 'workspace_backups',
    'sources', 'research_cases', 'hypotheses', 'evidence_items', 'tasks',
    'dna_matches', 'dna_hypotheses', 'embeddings', 'ai_runs'
  ]
  LOOP
    SELECT constraint_record.* INTO primary_key
    FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conrelid = format('public.%I', archive_scoped_table)::regclass
      AND constraint_record.contype = 'p';
    SELECT array_agg(attribute.attname::text ORDER BY key_column.position) INTO key_columns
    FROM unnest(primary_key.conkey) WITH ORDINALITY AS key_column(attnum, position)
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = primary_key.conrelid
      AND attribute.attnum = key_column.attnum;
    IF key_columns <> ARRAY['archive_id', 'id']::text[] THEN
      RAISE EXCEPTION 'Archive-key migration postcondition failed for public.%', archive_scoped_table;
    END IF;
  END LOOP;

  FOR relationship IN
    SELECT * FROM (VALUES
      ('person_facts', 'person_id', 'people', 'person_facts_archive_person_fkey'),
      ('hypotheses', 'case_id', 'research_cases', 'hypotheses_archive_case_fkey'),
      ('evidence_items', 'case_id', 'research_cases', 'evidence_items_archive_case_fkey'),
      ('tasks', 'case_id', 'research_cases', 'tasks_archive_case_fkey'),
      ('dna_hypotheses', 'dna_match_id', 'dna_matches', 'dna_hypotheses_archive_match_fkey')
    ) AS specification(child_table, child_column, parent_table, desired_name)
  LOOP
    SELECT constraint_record.* INTO relationship_foreign_key
    FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conrelid = format('public.%I', relationship.child_table)::regclass
      AND constraint_record.conname = relationship.desired_name;
    SELECT array_agg(attribute.attname::text ORDER BY key_column.position) INTO key_columns
    FROM unnest(relationship_foreign_key.conkey) WITH ORDINALITY AS key_column(attnum, position)
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = relationship_foreign_key.conrelid
      AND attribute.attnum = key_column.attnum;
    IF key_columns <> ARRAY['archive_id', relationship.child_column]::text[]
      OR NOT relationship_foreign_key.convalidated
    THEN
      RAISE EXCEPTION 'Archive-key migration postcondition failed for public.%', relationship.child_table;
    END IF;
  END LOOP;
END
$migration$;
