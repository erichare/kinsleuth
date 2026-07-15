-- One-use, archive-scoped upload intents for direct browser uploads into the
-- configured private object store. Clients receive only an expiring upload
-- ticket; the server retains and later resolves the authoritative object key.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE public.integration_artifacts
  ADD CONSTRAINT integration_artifacts_archive_connection_id_key
  UNIQUE (archive_id, connection_id, id);

CREATE TABLE public.integration_upload_intents (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  id text NOT NULL,
  connection_id text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  declared_size_bytes bigint NOT NULL,
  staging_key text NOT NULL,
  backend text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  artifact_id text,
  artifact_duplicate boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  staging_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id),
  CONSTRAINT integration_upload_intents_connection_fkey
    FOREIGN KEY (archive_id, connection_id)
    REFERENCES public.integration_connections(archive_id, id)
    ON DELETE CASCADE,
  CONSTRAINT integration_upload_intents_artifact_fkey
    FOREIGN KEY (archive_id, connection_id, artifact_id)
    REFERENCES public.integration_artifacts(archive_id, connection_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT integration_upload_intents_staging_key_unique
    UNIQUE (archive_id, staging_key),
  CONSTRAINT integration_upload_intents_size_check
    CHECK (declared_size_bytes > 0 AND declared_size_bytes <= 134217728),
  CONSTRAINT integration_upload_intents_backend_check
    CHECK (backend IN ('s3', 'vercel_blob')),
  CONSTRAINT integration_upload_intents_status_check
    CHECK (status IN ('pending', 'completed', 'rejected', 'expired')),
  CONSTRAINT integration_upload_intents_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT integration_upload_intents_terminal_state_check
    CHECK (
      (status = 'pending' AND consumed_at IS NULL AND artifact_id IS NULL)
      OR
      (status = 'completed' AND consumed_at IS NOT NULL AND artifact_id IS NOT NULL)
      OR
      (status IN ('rejected', 'expired') AND consumed_at IS NOT NULL AND artifact_id IS NULL)
    )
);

CREATE INDEX integration_upload_intents_expiry_idx
  ON public.integration_upload_intents (expires_at, archive_id, id)
  WHERE status = 'pending';

CREATE INDEX integration_upload_intents_cleanup_idx
  ON public.integration_upload_intents (status, expires_at, archive_id, id)
  WHERE staging_deleted_at IS NULL;
