-- Private, rights-gated binary media retained from authorized desktop export
-- packages. Source provenance is immutable; later ownership attestation may
-- only relax the license label, never privacy, publishing, or AI eligibility.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE public.integration_upload_intents
  ADD COLUMN media_rights_acknowledgement_version text,
  ADD COLUMN media_rights_acknowledged_by text,
  ADD COLUMN media_rights_acknowledged_at timestamptz,
  ADD CONSTRAINT integration_upload_intents_media_rights_acknowledgement_check
    CHECK (
      num_nonnulls(
        media_rights_acknowledgement_version,
        media_rights_acknowledged_by,
        media_rights_acknowledged_at
      ) = 0
      OR
      (
        num_nonnulls(
          media_rights_acknowledgement_version,
          media_rights_acknowledged_by,
          media_rights_acknowledged_at
        ) = 3
        AND
        length(btrim(media_rights_acknowledgement_version)) > 0
        AND length(btrim(media_rights_acknowledged_by)) > 0
      )
    );

ALTER TABLE public.integration_artifacts
  ADD COLUMN media_rights_acknowledgement_version text,
  ADD COLUMN media_rights_acknowledged_by text,
  ADD COLUMN media_rights_acknowledged_at timestamptz,
  ADD CONSTRAINT integration_artifacts_media_rights_acknowledgement_check
    CHECK (
      num_nonnulls(
        media_rights_acknowledgement_version,
        media_rights_acknowledged_by,
        media_rights_acknowledged_at
      ) = 0
      OR
      (
        num_nonnulls(
          media_rights_acknowledgement_version,
          media_rights_acknowledged_by,
          media_rights_acknowledged_at
        ) = 3
        AND
        length(btrim(media_rights_acknowledgement_version)) > 0
        AND length(btrim(media_rights_acknowledged_by)) > 0
      )
    );

ALTER TABLE public.sync_runs
  ADD COLUMN media_rights_acknowledgement_version text,
  ADD COLUMN media_rights_acknowledged_by text,
  ADD COLUMN media_rights_acknowledged_at timestamptz,
  ADD CONSTRAINT sync_runs_media_rights_acknowledgement_check
    CHECK (
      num_nonnulls(
        media_rights_acknowledgement_version,
        media_rights_acknowledged_by,
        media_rights_acknowledged_at
      ) = 0
      OR
      (
        num_nonnulls(
          media_rights_acknowledgement_version,
          media_rights_acknowledged_by,
          media_rights_acknowledged_at
        ) = 3
        AND
        length(btrim(media_rights_acknowledgement_version)) > 0
        AND length(btrim(media_rights_acknowledged_by)) > 0
      )
    ),
  ADD CONSTRAINT sync_runs_archive_connection_id_key
    UNIQUE (archive_id, connection_id, id);

CREATE TABLE public.integration_media_objects (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  id text NOT NULL,
  connection_id text NOT NULL,
  snapshot_id text NOT NULL,
  run_id text NOT NULL,
  artifact_id text NOT NULL,
  object_key text NOT NULL,
  source_provider text NOT NULL,
  source_artifact_sha256 text NOT NULL,
  source_gedcom_path text NOT NULL,
  source_normalized_path text NOT NULL,
  source_archive_path text NOT NULL,
  sha256 text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  license_class text NOT NULL DEFAULT 'third_party_restricted',
  privacy text NOT NULL DEFAULT 'private',
  publishable boolean NOT NULL DEFAULT false,
  ai_eligible boolean NOT NULL DEFAULT false,
  rights_acknowledgement_version text NOT NULL,
  rights_acknowledged_by text NOT NULL,
  rights_acknowledged_at timestamptz NOT NULL,
  ownership_attestation_version text,
  ownership_attested_by text,
  ownership_attested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id),
  CONSTRAINT integration_media_objects_connection_fkey
    FOREIGN KEY (archive_id, connection_id)
    REFERENCES public.integration_connections(archive_id, id)
    ON DELETE CASCADE,
  CONSTRAINT integration_media_objects_snapshot_fkey
    FOREIGN KEY (archive_id, connection_id, snapshot_id)
    REFERENCES public.integration_snapshots(archive_id, connection_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT integration_media_objects_run_fkey
    FOREIGN KEY (archive_id, connection_id, run_id)
    REFERENCES public.sync_runs(archive_id, connection_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT integration_media_objects_artifact_fkey
    FOREIGN KEY (archive_id, connection_id, artifact_id)
    REFERENCES public.integration_artifacts(archive_id, connection_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT integration_media_objects_snapshot_path_key
    UNIQUE (archive_id, snapshot_id, source_normalized_path),
  CONSTRAINT integration_media_objects_provider_check
    CHECK (source_provider IN ('family_tree_maker', 'rootsmagic')),
  CONSTRAINT integration_media_objects_source_sha256_check
    CHECK (source_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT integration_media_objects_sha256_check
    CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT integration_media_objects_size_check
    CHECK (size_bytes > 0),
  CONSTRAINT integration_media_objects_mime_check
    CHECK (mime_type IN (
      'image/jpeg', 'image/png', 'image/gif', 'image/tiff',
      'image/bmp', 'image/webp', 'application/pdf'
    )),
  CONSTRAINT integration_media_objects_license_check
    CHECK (license_class IN ('third_party_restricted', 'user_owned')),
  CONSTRAINT integration_media_objects_private_only_check
    CHECK (privacy = 'private' AND publishable = false AND ai_eligible = false),
  CONSTRAINT integration_media_objects_object_key_check
    CHECK (object_key = 'archives/' || archive_id || '/integration-media/' || sha256),
  CONSTRAINT integration_media_objects_rights_check
    CHECK (
      length(btrim(rights_acknowledgement_version)) > 0
      AND length(btrim(rights_acknowledged_by)) > 0
    ),
  CONSTRAINT integration_media_objects_ownership_check
    CHECK (
      (
        license_class = 'third_party_restricted'
        AND num_nonnulls(
          ownership_attestation_version,
          ownership_attested_by,
          ownership_attested_at
        ) = 0
      )
      OR
      (
        license_class = 'user_owned'
        AND num_nonnulls(
          ownership_attestation_version,
          ownership_attested_by,
          ownership_attested_at
        ) = 3
        AND length(btrim(ownership_attestation_version)) > 0
        AND length(btrim(ownership_attested_by)) > 0
      )
    )
);

CREATE INDEX integration_media_objects_archive_page_idx
  ON public.integration_media_objects (archive_id, created_at DESC, id DESC);

CREATE INDEX integration_media_objects_connection_idx
  ON public.integration_media_objects (archive_id, connection_id, created_at DESC, id DESC);

CREATE FUNCTION public.reject_integration_media_provenance_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.archive_id,
    NEW.id,
    NEW.connection_id,
    NEW.snapshot_id,
    NEW.run_id,
    NEW.artifact_id,
    NEW.object_key,
    NEW.source_provider,
    NEW.source_artifact_sha256,
    NEW.source_gedcom_path,
    NEW.source_normalized_path,
    NEW.source_archive_path,
    NEW.sha256,
    NEW.mime_type,
    NEW.size_bytes,
    NEW.rights_acknowledgement_version,
    NEW.rights_acknowledged_by,
    NEW.rights_acknowledged_at,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.archive_id,
    OLD.id,
    OLD.connection_id,
    OLD.snapshot_id,
    OLD.run_id,
    OLD.artifact_id,
    OLD.object_key,
    OLD.source_provider,
    OLD.source_artifact_sha256,
    OLD.source_gedcom_path,
    OLD.source_normalized_path,
    OLD.source_archive_path,
    OLD.sha256,
    OLD.mime_type,
    OLD.size_bytes,
    OLD.rights_acknowledgement_version,
    OLD.rights_acknowledged_by,
    OLD.rights_acknowledged_at,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Integration media source provenance is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER integration_media_objects_provenance_immutable
  BEFORE UPDATE ON public.integration_media_objects
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_integration_media_provenance_update();
