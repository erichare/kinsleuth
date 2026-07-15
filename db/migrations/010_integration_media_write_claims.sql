-- Durable ownership for content-addressed desktop media between the object
-- store write and the atomic snapshot/media publication transaction. Claims
-- make crash leftovers discoverable and prevent one failed run from deleting
-- bytes another run is still preparing or has committed.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE public.integration_media_write_claims (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  object_key text NOT NULL,
  sha256 text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, run_id, object_key),
  CONSTRAINT integration_media_write_claims_run_fkey
    FOREIGN KEY (archive_id, run_id)
    REFERENCES public.sync_runs(archive_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT integration_media_write_claims_sha256_check
    CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT integration_media_write_claims_object_key_check
    CHECK (object_key = 'archives/' || archive_id || '/integration-media/' || sha256),
  CONSTRAINT integration_media_write_claims_mime_check
    CHECK (mime_type IN (
      'image/jpeg', 'image/png', 'image/gif', 'image/tiff',
      'image/bmp', 'image/webp', 'application/pdf'
    )),
  CONSTRAINT integration_media_write_claims_size_check
    CHECK (size_bytes > 0)
);

CREATE INDEX integration_media_write_claims_expiry_idx
  ON public.integration_media_write_claims (expires_at, archive_id, object_key);

CREATE INDEX integration_media_write_claims_object_idx
  ON public.integration_media_write_claims (archive_id, object_key, expires_at);
