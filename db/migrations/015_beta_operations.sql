-- Privacy-safe hosted operations state for worker freshness, participant data
-- requests, and observable recovery/deletion workflows. This migration stores
-- only fixed enums, digests, UUID request identifiers, and timestamps; family
-- records, request bodies, provider paths, hosts, and exception text never
-- belong in these tables.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE public.beta_worker_heartbeats (
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  worker_kind text NOT NULL CHECK (
    worker_kind IN ('integration-jobs', 'import-upload-cleanup', 'retention-cleanup')
  ),
  last_outcome text NOT NULL CHECK (last_outcome IN ('running', 'succeeded', 'failed')),
  last_request_id uuid NOT NULL,
  last_started_at timestamptz NOT NULL,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_failure_code text CHECK (
    last_failure_code IS NULL OR last_failure_code IN (
      'AUTHORIZATION_ERROR', 'CONFIGURATION_ERROR', 'DATABASE_ERROR',
      'NETWORK_ERROR', 'STORAGE_ERROR', 'TEST_ALERT', 'TIMEOUT',
      'UNEXPECTED_ERROR'
    )
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, worker_kind),
  CHECK (updated_at >= last_started_at),
  CHECK (last_outcome <> 'succeeded' OR last_succeeded_at >= last_started_at),
  CHECK (last_outcome <> 'failed' OR last_failed_at >= last_started_at),
  CHECK (
    (last_outcome = 'running' AND last_failure_code IS NULL)
    OR (last_outcome = 'succeeded' AND last_succeeded_at IS NOT NULL AND last_failure_code IS NULL)
    OR (last_outcome = 'failed' AND last_failed_at IS NOT NULL AND last_failure_code IS NOT NULL)
  )
);

CREATE INDEX beta_worker_heartbeats_freshness_idx
  ON public.beta_worker_heartbeats (worker_kind, updated_at DESC, archive_id);

CREATE INDEX durable_jobs_failed_health_idx
  ON public.durable_jobs (archive_id, updated_at DESC, id)
  WHERE state = 'failed';

CREATE TABLE public.beta_data_operations (
  id uuid PRIMARY KEY,
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE RESTRICT,
  operation_type text NOT NULL CHECK (
    operation_type IN ('research-export', 'deletion-request')
  ),
  state text NOT NULL DEFAULT 'requested' CHECK (
    state IN ('requested', 'processing', 'completed', 'failed', 'cancelled')
  ),
  actor_digest text NOT NULL CHECK (actor_digest ~ '^[a-f0-9]{64}$'),
  request_id uuid NOT NULL,
  manifest_digest text CHECK (
    manifest_digest IS NULL OR manifest_digest ~ '^[a-f0-9]{64}$'
  ),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code IN (
      'DELETION_FAILED', 'EXPORT_FAILED', 'UNEXPECTED_ERROR'
    )
  ),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (archive_id, request_id),
  CHECK (updated_at >= requested_at),
  CHECK (started_at IS NULL OR started_at >= requested_at),
  CHECK (completed_at IS NULL OR completed_at >= COALESCE(started_at, requested_at)),
  CHECK (
    (state = 'requested' AND started_at IS NULL AND completed_at IS NULL
      AND manifest_digest IS NULL AND failure_code IS NULL)
    OR (state = 'processing' AND started_at IS NOT NULL AND completed_at IS NULL
      AND manifest_digest IS NULL AND failure_code IS NULL)
    OR (state = 'completed' AND completed_at IS NOT NULL AND manifest_digest IS NOT NULL
      AND failure_code IS NULL)
    OR (state = 'failed' AND completed_at IS NOT NULL AND manifest_digest IS NULL
      AND failure_code IS NOT NULL)
    OR (state = 'cancelled' AND completed_at IS NOT NULL AND manifest_digest IS NULL
      AND failure_code IS NULL)
  )
);

CREATE INDEX beta_data_operations_archive_time_idx
  ON public.beta_data_operations (archive_id, requested_at DESC, id DESC);

CREATE INDEX beta_data_operations_pending_idx
  ON public.beta_data_operations (operation_type, requested_at, archive_id, id)
  WHERE state IN ('requested', 'processing');

-- Data-operation evidence may advance only through the documented state
-- machine. Its participant, request identity, operation kind, and original
-- timestamp cannot be rewritten, and the row is retained until the isolated
-- cell itself is destroyed.
CREATE FUNCTION public.beta_protect_data_operation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'beta data-operation rows cannot be deleted';
  END IF;
  IF ROW(
    NEW.id, NEW.archive_id, NEW.operation_type,
    NEW.actor_digest, NEW.request_id, NEW.requested_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.archive_id, OLD.operation_type,
    OLD.actor_digest, OLD.request_id, OLD.requested_at
  ) THEN
    RAISE EXCEPTION 'beta data-operation identity is immutable';
  END IF;
  IF OLD.state IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'terminal beta data-operation rows are immutable';
  END IF;
  IF NOT (
    (OLD.state = 'requested' AND NEW.state IN ('processing', 'completed', 'failed', 'cancelled'))
    OR (OLD.state = 'processing' AND NEW.state IN ('completed', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid beta data-operation state transition';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER beta_data_operations_protected_transition
  BEFORE UPDATE OR DELETE ON public.beta_data_operations
  FOR EACH ROW EXECUTE FUNCTION public.beta_protect_data_operation_transition();

ALTER TABLE public.beta_worker_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_data_operations ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.beta_worker_heartbeats FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.beta_data_operations FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.beta_protect_data_operation_transition() FROM PUBLIC;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.beta_worker_heartbeats FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.beta_data_operations FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.beta_protect_data_operation_transition() FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
