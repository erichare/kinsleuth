CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension extension
    JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'vector'
      AND namespace.nspname <> 'extensions'
  ) THEN
    ALTER EXTENSION vector SET SCHEMA extensions;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS archives (
  id text PRIMARY KEY,
  name text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  slug text NOT NULL UNIQUE,
  accent_color text NOT NULL DEFAULT '#00634f',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'contributor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Archive-scoped tables key rows by (archive_id, id): ids derive from GEDCOM
-- xrefs and seed fixtures, so the same id legitimately repeats across archives.
CREATE TABLE IF NOT EXISTS people (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  given_name text,
  surname text,
  sex text CHECK (sex IN ('M', 'F', 'U') OR sex IS NULL),
  birth_date text,
  birth_place text,
  death_date text,
  death_place text,
  living_status text NOT NULL DEFAULT 'unknown' CHECK (living_status IN ('living', 'deceased', 'unknown')),
  privacy text NOT NULL DEFAULT 'private' CHECK (privacy IN ('public', 'private', 'sensitive')),
  published boolean NOT NULL DEFAULT false,
  relatives text[] NOT NULL DEFAULT '{}',
  notes text,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id)
);

CREATE TABLE IF NOT EXISTS person_facts (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  person_id text NOT NULL,
  fact_type text NOT NULL,
  date_text text,
  place_text text,
  value_text text,
  source_text text,
  privacy text CHECK (privacy IN ('public', 'private', 'sensitive') OR privacy IS NULL),
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (archive_id, id),
  CONSTRAINT person_facts_archive_person_fkey FOREIGN KEY (archive_id, person_id) REFERENCES people (archive_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_snapshots (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  checksum text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  record_count integer NOT NULL DEFAULT 0,
  people_imported integer NOT NULL DEFAULT 0,
  sources_imported integer NOT NULL DEFAULT 0,
  raw_record_count integer NOT NULL DEFAULT 0,
  backup_id text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id)
);

CREATE TABLE IF NOT EXISTS raw_records (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  import_id text NOT NULL,
  xref text,
  record_type text NOT NULL,
  raw_text text NOT NULL,
  checksum text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (archive_id, id)
);

CREATE TABLE IF NOT EXISTS workspace_backups (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  storage_key text NOT NULL,
  people_count integer NOT NULL DEFAULT 0,
  sources_count integer NOT NULL DEFAULT 0,
  cases_count integer NOT NULL DEFAULT 0,
  dna_match_count integer NOT NULL DEFAULT 0,
  import_count integer NOT NULL DEFAULT 0,
  raw_record_count integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (archive_id, id)
);

CREATE TABLE IF NOT EXISTS sources (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_type text NOT NULL DEFAULT 'Document',
  import_id text,
  raw_record_id text,
  file_name text,
  storage_key text,
  mime_type text,
  size_bytes bigint,
  repository text,
  url text,
  ancestry_apid text,
  citation_date text,
  linked_person_id text,
  linked_case_id text,
  transcript text,
  notes text,
  privacy text NOT NULL DEFAULT 'private' CHECK (privacy IN ('public', 'private', 'sensitive')),
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id)
);

CREATE TABLE IF NOT EXISTS research_cases (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  title text NOT NULL,
  question text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'planning', 'paused', 'resolved')),
  focus text NOT NULL DEFAULT '',
  privacy text NOT NULL DEFAULT 'private' CHECK (privacy IN ('public', 'private', 'sensitive')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id)
);

CREATE TABLE IF NOT EXISTS hypotheses (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  case_id text NOT NULL,
  statement text NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'supported', 'weakened', 'rejected')),
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (archive_id, id),
  CONSTRAINT hypotheses_archive_case_fkey FOREIGN KEY (archive_id, case_id) REFERENCES research_cases (archive_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evidence_items (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  case_id text NOT NULL,
  title text NOT NULL,
  evidence_type text NOT NULL,
  summary text NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  linked_person_id text,
  linked_dna_match_id text,
  source_id text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id),
  CONSTRAINT evidence_items_archive_case_fkey FOREIGN KEY (archive_id, case_id) REFERENCES research_cases (archive_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  case_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  due_at timestamptz,
  assignee_id text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id),
  CONSTRAINT tasks_archive_case_fkey FOREIGN KEY (archive_id, case_id) REFERENCES research_cases (archive_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dna_matches (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  total_cm numeric(8,2) NOT NULL,
  longest_segment_cm numeric(8,2),
  shared_dna_percent numeric(8,4),
  predicted_relationship text,
  side text NOT NULL DEFAULT 'unknown' CHECK (side IN ('maternal', 'paternal', 'both', 'unknown')),
  tree_status text NOT NULL DEFAULT 'unknown' CHECK (tree_status IN ('none', 'private', 'partial', 'public', 'unknown')),
  surnames text[] NOT NULL DEFAULT '{}',
  places text[] NOT NULL DEFAULT '{}',
  shared_matches text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  ancestry_url text,
  triage_status text NOT NULL DEFAULT 'needs_review' CHECK (triage_status IN ('needs_review', 'triaged', 'ignored', 'high_priority')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id)
);

CREATE TABLE IF NOT EXISTS dna_hypotheses (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  dna_match_id text NOT NULL,
  likely_branch text NOT NULL,
  likely_generation text NOT NULL,
  geography text[] NOT NULL DEFAULT '{}',
  candidate_common_ancestors text[] NOT NULL DEFAULT '{}',
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  explanation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id),
  CONSTRAINT dna_hypotheses_archive_match_fkey FOREIGN KEY (archive_id, dna_match_id) REFERENCES dna_matches (archive_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  content text NOT NULL,
  embedding extensions.vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id)
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id text NOT NULL,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  requested_by text,
  run_type text NOT NULL DEFAULT 'analysis',
  provider text NOT NULL DEFAULT 'local',
  model text NOT NULL DEFAULT 'local',
  question text NOT NULL,
  answer text NOT NULL,
  status text NOT NULL CHECK (status IN ('ready', 'configuration_required', 'provider_error')),
  provider_status text NOT NULL DEFAULT 'not_configured' CHECK (provider_status IN ('not_configured', 'completed', 'failed')),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  anomaly_count integer NOT NULL DEFAULT 0,
  linked_case_id text,
  prompt_redacted text NOT NULL DEFAULT '',
  error text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (archive_id, id)
);

CREATE INDEX IF NOT EXISTS people_archive_name_idx ON people (archive_id, surname, given_name);
CREATE INDEX IF NOT EXISTS people_archive_slug_idx ON people (archive_id, slug);
CREATE INDEX IF NOT EXISTS facts_person_idx ON person_facts (person_id, fact_type);
CREATE INDEX IF NOT EXISTS sources_archive_link_idx ON sources (archive_id, linked_person_id, linked_case_id);
CREATE INDEX IF NOT EXISTS cases_archive_status_idx ON research_cases (archive_id, status);
CREATE INDEX IF NOT EXISTS tasks_case_status_idx ON tasks (case_id, status);
CREATE INDEX IF NOT EXISTS dna_archive_status_idx ON dna_matches (archive_id, triage_status);
CREATE INDEX IF NOT EXISTS embeddings_archive_entity_idx ON embeddings (archive_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ai_runs_archive_created_idx ON ai_runs (archive_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dna_hypotheses_archive_idx ON dna_hypotheses (archive_id);
CREATE INDEX IF NOT EXISTS dna_hypotheses_match_idx ON dna_hypotheses (dna_match_id);
CREATE INDEX IF NOT EXISTS evidence_items_archive_idx ON evidence_items (archive_id);
CREATE INDEX IF NOT EXISTS evidence_items_case_idx ON evidence_items (case_id);
CREATE INDEX IF NOT EXISTS hypotheses_archive_idx ON hypotheses (archive_id);
CREATE INDEX IF NOT EXISTS hypotheses_case_idx ON hypotheses (case_id);
CREATE INDEX IF NOT EXISTS import_snapshots_archive_idx ON import_snapshots (archive_id);
CREATE INDEX IF NOT EXISTS person_facts_archive_idx ON person_facts (archive_id);
CREATE INDEX IF NOT EXISTS raw_records_archive_idx ON raw_records (archive_id);
CREATE INDEX IF NOT EXISTS tasks_archive_idx ON tasks (archive_id);
CREATE INDEX IF NOT EXISTS workspace_backups_archive_idx ON workspace_backups (archive_id);

ALTER TABLE archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE hypotheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna_hypotheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;

-- Supabase exposes the public schema through its Data API. KinSleuth accesses
-- Postgres only from the server, so keep the public API roles denied by default.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Upgrade: convert legacy global primary keys to per-archive composite keys.
--
-- The CREATE TABLE IF NOT EXISTS statements above only shape brand-new
-- databases. Databases bootstrapped before multi-archive support still carry
-- `PRIMARY KEY (id)` on the archive-scoped tables, which makes ids collide
-- across archives (person ids derive from GEDCOM xrefs and the demo seed uses
-- fixed ids). The block below detects the legacy single-column keys and
-- rewrites them to (archive_id, id); once the composite keys exist every step
-- is a no-op, so this file remains a single idempotent bootstrap.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  archive_scoped_table text;
  legacy_constraint record;
  composite_fk record;
BEGIN
  -- 1. Drop legacy single-column foreign keys first: the parent primary keys
  --    they depend on cannot be dropped while these still exist.
  FOR legacy_constraint IN
    SELECT child.conname, child.conrelid::regclass AS child_table
    FROM pg_constraint child
    WHERE child.contype = 'f'
      AND array_length(child.conkey, 1) = 1
      AND (child.conrelid, child.confrelid) IN (
        ('person_facts'::regclass, 'people'::regclass),
        ('hypotheses'::regclass, 'research_cases'::regclass),
        ('evidence_items'::regclass, 'research_cases'::regclass),
        ('tasks'::regclass, 'research_cases'::regclass),
        ('dna_hypotheses'::regclass, 'dna_matches'::regclass)
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', legacy_constraint.child_table, legacy_constraint.conname);
  END LOOP;

  -- 2. Replace each remaining single-column primary key with (archive_id, id).
  FOREACH archive_scoped_table IN ARRAY ARRAY[
    'people', 'person_facts', 'import_snapshots', 'raw_records', 'workspace_backups',
    'sources', 'research_cases', 'hypotheses', 'evidence_items', 'tasks',
    'dna_matches', 'dna_hypotheses', 'embeddings', 'ai_runs'
  ]
  LOOP
    FOR legacy_constraint IN
      SELECT pk.conname
      FROM pg_constraint pk
      WHERE pk.conrelid = archive_scoped_table::regclass
        AND pk.contype = 'p'
        AND array_length(pk.conkey, 1) = 1
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', archive_scoped_table, legacy_constraint.conname);
      EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (archive_id, id)', archive_scoped_table);
    END LOOP;
  END LOOP;

  -- 3. Recreate the child links as composite foreign keys. The names match the
  --    constraints declared in the CREATE TABLE statements above, so freshly
  --    bootstrapped databases skip this step.
  FOR composite_fk IN
    SELECT fk.conname, fk.child_table, fk.child_column, fk.parent_table
    FROM (VALUES
      ('person_facts_archive_person_fkey', 'person_facts', 'person_id', 'people'),
      ('hypotheses_archive_case_fkey', 'hypotheses', 'case_id', 'research_cases'),
      ('evidence_items_archive_case_fkey', 'evidence_items', 'case_id', 'research_cases'),
      ('tasks_archive_case_fkey', 'tasks', 'case_id', 'research_cases'),
      ('dna_hypotheses_archive_match_fkey', 'dna_hypotheses', 'dna_match_id', 'dna_matches')
    ) AS fk(conname, child_table, child_column, parent_table)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_constraint existing
      WHERE existing.conname = fk.conname
        AND existing.conrelid = fk.child_table::regclass
    )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (archive_id, %I) REFERENCES %I (archive_id, id) ON DELETE CASCADE',
      composite_fk.child_table, composite_fk.conname, composite_fk.child_column, composite_fk.parent_table
    );
  END LOOP;
END
$$;
