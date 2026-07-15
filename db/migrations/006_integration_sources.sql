-- Provider-neutral, archive-scoped persistence for remembered genealogy data
-- sources and review-before-apply refreshes. Direct provider credentials and
-- write-back are deliberately outside this migration.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE public.integration_connections (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  id text NOT NULL,
  provider text NOT NULL,
  authority text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  capabilities jsonb NOT NULL,
  remote_account_id text,
  remote_tree_id text,
  last_applied_snapshot_id text,
  last_refreshed_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id),
  CONSTRAINT integration_connections_provider_check
    CHECK (provider IN ('ancestry_export', 'family_tree_maker', 'rootsmagic', 'gedcom', 'ancestry_api')),
  CONSTRAINT integration_connections_status_check
    CHECK (status IN ('active', 'disconnected', 'error')),
  CONSTRAINT integration_connections_capabilities_object_check
    CHECK (jsonb_typeof(capabilities) = 'object'),
  CONSTRAINT integration_connections_no_writeback_check
    CHECK (capabilities @> '{"writeback": false}'::jsonb)
);

CREATE TABLE public.integration_artifacts (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  id text NOT NULL,
  connection_id text NOT NULL,
  file_name text NOT NULL,
  artifact_key text NOT NULL,
  sha256 text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  state text NOT NULL DEFAULT 'staged',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  PRIMARY KEY (archive_id, id),
  CONSTRAINT integration_artifacts_connection_fkey
    FOREIGN KEY (archive_id, connection_id)
    REFERENCES public.integration_connections(archive_id, id)
    ON DELETE CASCADE,
  CONSTRAINT integration_artifacts_connection_sha256_key
    UNIQUE (archive_id, connection_id, sha256),
  CONSTRAINT integration_artifacts_sha256_check
    CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT integration_artifacts_size_check
    CHECK (size_bytes > 0),
  CONSTRAINT integration_artifacts_state_check
    CHECK (state IN ('staged', 'quarantined', 'ready', 'abandoned', 'rejected'))
);

CREATE TABLE public.integration_snapshots (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  id text NOT NULL,
  connection_id text NOT NULL,
  artifact_key text NOT NULL,
  sha256 text NOT NULL,
  parser_version text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id),
  CONSTRAINT integration_snapshots_connection_fkey
    FOREIGN KEY (archive_id, connection_id)
    REFERENCES public.integration_connections(archive_id, id)
    ON DELETE CASCADE,
  CONSTRAINT integration_snapshots_connection_id_key
    UNIQUE (archive_id, connection_id, id),
  CONSTRAINT integration_snapshots_connection_sha256_key
    UNIQUE (archive_id, connection_id, sha256),
  CONSTRAINT integration_snapshots_sha256_check
    CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT integration_snapshots_counts_object_check
    CHECK (jsonb_typeof(counts) = 'object'),
  CONSTRAINT integration_snapshots_warnings_array_check
    CHECK (jsonb_typeof(warnings) = 'array'),
  CONSTRAINT integration_snapshots_source_metadata_object_check
    CHECK (jsonb_typeof(source_metadata) = 'object')
);

ALTER TABLE public.integration_connections
  ADD CONSTRAINT integration_connections_last_snapshot_fkey
  FOREIGN KEY (archive_id, id, last_applied_snapshot_id)
  REFERENCES public.integration_snapshots(archive_id, connection_id, id)
  ON DELETE RESTRICT;

CREATE FUNCTION public.reject_integration_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Integration snapshots are immutable';
END
$$;

CREATE TRIGGER integration_snapshots_immutable_update
  BEFORE UPDATE ON public.integration_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_integration_snapshot_update();

CREATE TABLE public.external_entity_refs (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  id text NOT NULL,
  connection_id text NOT NULL,
  snapshot_id text NOT NULL,
  entity_type text NOT NULL,
  external_id text NOT NULL,
  local_entity_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id),
  CONSTRAINT external_entity_refs_connection_fkey
    FOREIGN KEY (archive_id, connection_id)
    REFERENCES public.integration_connections(archive_id, id)
    ON DELETE CASCADE,
  CONSTRAINT external_entity_refs_snapshot_fkey
    FOREIGN KEY (archive_id, connection_id, snapshot_id)
    REFERENCES public.integration_snapshots(archive_id, connection_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT external_entity_refs_connection_external_key
    UNIQUE (archive_id, connection_id, entity_type, external_id),
  CONSTRAINT external_entity_refs_entity_type_check
    CHECK (entity_type IN ('person', 'family', 'fact', 'relationship', 'source', 'citation', 'media'))
);

CREATE TABLE public.sync_runs (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  id text NOT NULL,
  connection_id text NOT NULL,
  artifact_id text,
  base_snapshot_id text,
  incoming_snapshot_id text,
  status text NOT NULL DEFAULT 'queued',
  apply_idempotency_key text,
  apply_request_hash text,
  backup_id text,
  applied_change_count integer NOT NULL DEFAULT 0,
  applied_at timestamptz,
  applied_archive_updated_at timestamptz,
  rollback_idempotency_key text,
  rollback_request_hash text,
  rolled_back_at timestamptz,
  rolled_back_by text,
  cancel_requested_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id),
  CONSTRAINT sync_runs_connection_fkey
    FOREIGN KEY (archive_id, connection_id)
    REFERENCES public.integration_connections(archive_id, id)
    ON DELETE CASCADE,
  CONSTRAINT sync_runs_artifact_fkey
    FOREIGN KEY (archive_id, artifact_id)
    REFERENCES public.integration_artifacts(archive_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sync_runs_base_snapshot_fkey
    FOREIGN KEY (archive_id, connection_id, base_snapshot_id)
    REFERENCES public.integration_snapshots(archive_id, connection_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sync_runs_incoming_snapshot_fkey
    FOREIGN KEY (archive_id, connection_id, incoming_snapshot_id)
    REFERENCES public.integration_snapshots(archive_id, connection_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sync_runs_backup_fkey
    FOREIGN KEY (archive_id, backup_id)
    REFERENCES public.workspace_backups(archive_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sync_runs_status_check
    CHECK (status IN (
      'queued', 'parsing', 'review_ready', 'applying', 'applied',
      'cancel_requested', 'cancelled', 'failed', 'rolled_back'
    )),
  CONSTRAINT sync_runs_applied_change_count_check
    CHECK (applied_change_count >= 0)
);

CREATE UNIQUE INDEX sync_runs_archive_apply_idempotency_unique_idx
  ON public.sync_runs (archive_id, apply_idempotency_key)
  WHERE apply_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX sync_runs_archive_rollback_idempotency_unique_idx
  ON public.sync_runs (archive_id, rollback_idempotency_key)
  WHERE rollback_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX sync_runs_one_active_per_connection_idx
  ON public.sync_runs (archive_id, connection_id)
  WHERE status IN ('queued', 'parsing', 'review_ready', 'applying', 'cancel_requested');

CREATE TABLE public.sync_changes (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  id text NOT NULL,
  run_id text NOT NULL,
  entity_type text NOT NULL,
  external_id text,
  local_entity_id text,
  base_hash text,
  local_hash text,
  incoming_hash text,
  classification text NOT NULL,
  proposed_action text NOT NULL,
  resolution text,
  resolution_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, id),
  CONSTRAINT sync_changes_run_fkey
    FOREIGN KEY (archive_id, run_id)
    REFERENCES public.sync_runs(archive_id, id)
    ON DELETE CASCADE,
  CONSTRAINT sync_changes_entity_type_check
    CHECK (entity_type IN ('person', 'family', 'fact', 'relationship', 'source', 'citation', 'media')),
  CONSTRAINT sync_changes_classification_check
    CHECK (classification IN ('remote_only', 'local_only', 'same', 'conflict', 'deletion')),
  CONSTRAINT sync_changes_proposed_action_check
    CHECK (proposed_action IN ('accept_incoming', 'keep_local', 'no_op', 'review')),
  CONSTRAINT sync_changes_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('accept_incoming', 'keep_local', 'no_op')),
  CONSTRAINT sync_changes_deletion_keep_local_check
    CHECK (classification <> 'deletion' OR proposed_action = 'keep_local'),
  CONSTRAINT sync_changes_deletion_resolution_keep_local_check
    CHECK (classification <> 'deletion' OR resolution IS NULL OR resolution IN ('keep_local', 'no_op')),
  CONSTRAINT sync_changes_resolution_payload_object_check
    CHECK (jsonb_typeof(resolution_payload) = 'object')
);

CREATE INDEX sync_changes_run_page_idx
  ON public.sync_changes (archive_id, run_id, sort_order, id);

CREATE TABLE public.durable_jobs (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  id text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  idempotency_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  maximum_attempts integer NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  result jsonb,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  PRIMARY KEY (archive_id, id),
  CONSTRAINT durable_jobs_archive_idempotency_key
    UNIQUE (archive_id, idempotency_key),
  CONSTRAINT durable_jobs_state_check
    CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT durable_jobs_attempt_check
    CHECK (attempt >= 0 AND attempt <= maximum_attempts),
  CONSTRAINT durable_jobs_maximum_attempts_check
    CHECK (maximum_attempts > 0),
  CONSTRAINT durable_jobs_payload_object_check
    CHECK (jsonb_typeof(payload) IS NOT NULL),
  CONSTRAINT durable_jobs_lease_check
    CHECK (
      (state = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR
      (state <> 'running' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    )
);

CREATE INDEX durable_jobs_queue_idx
  ON public.durable_jobs (archive_id, state, available_at, created_at, id)
  WHERE state IN ('queued', 'running');
