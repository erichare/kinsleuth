-- SQL-side people search matches accent-insensitively (parity with the
-- in-memory search's NFKD normalization). unaccent lives in the extensions
-- schema alongside pgvector; queries call it schema-qualified.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- CREATE EXTENSION IF NOT EXISTS is a no-op when the extension already exists
-- in another schema (common on self-hosted databases where a DBA installed it
-- into public), which would leave extensions.unaccent(...) unresolvable.
-- Relocate it, mirroring what 001 does for pgvector.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'unaccent' AND n.nspname <> 'extensions'
  ) THEN
    ALTER EXTENSION unaccent SET SCHEMA extensions;
  END IF;
END $$;
