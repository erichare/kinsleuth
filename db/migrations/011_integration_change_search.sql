-- Keep review search bounded and indexable without scanning resolution JSON.
-- Only application-selected review labels are copied into this private,
-- archive-scoped projection; raw GEDCOM and free-form notes remain excluded.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension extension
    JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'pg_trgm'
      AND namespace.nspname <> 'extensions'
  ) THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END
$$;

ALTER TABLE public.sync_changes
  ADD COLUMN search_projection text NOT NULL DEFAULT '',
  ADD CONSTRAINT sync_changes_search_projection_size_check
    CHECK (octet_length(search_projection) <= 4096);

CREATE INDEX sync_changes_search_projection_trgm_idx
  ON public.sync_changes
  USING gin (search_projection extensions.gin_trgm_ops)
  WHERE search_projection <> '';
