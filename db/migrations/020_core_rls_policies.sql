-- Archive-scoped row-level-security mutation policies for every application
-- table keyed by archive_id, plus explicit server policies for the remaining
-- policy-less RLS tables.
--
-- Why mutation-only: many server reads still run as one-shot pool queries
-- outside any transaction, so a transaction-local archive setting cannot be
-- attached to them yet. SELECT therefore stays unscoped (USING (true)) while
-- INSERT/UPDATE/DELETE require the writing transaction to pin its archive
-- through set_config('kinresolve.archive_id', <archive id>, true). Because
-- current_setting(..., true) yields NULL when the setting is absent, a
-- non-bypass role that forgets to pin an archive is denied by default.
-- PostgreSQL applies UPDATE policies to SELECT ... FOR UPDATE/FOR SHARE as
-- well, so row-locking reads also need the pinned archive.
--
-- Maintenance policies: cross-archive system work (demo purges, provisioning
-- cleanup, operator identity flows) instead sets
-- set_config('kinresolve.rls_mode', 'maintenance', true). Policies are
-- permissive, so the archive-scoped and maintenance policies combine with OR.
--
-- Why no FORCE ROW LEVEL SECURITY: the table owner runs migrations, fixture
-- rotation, and recovery purges; forcing RLS onto the owner would break those
-- reviewed paths without adding protection for the runtime role, which is a
-- distinct non-owner login. The operator follow-up that makes these policies
-- load-bearing is re-provisioning the runtime role with NOBYPASSRLS (demo
-- cell first, then hosted) as documented in
-- docs/production-runtime-database-role.md.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

-- The integration tables (006-011) never enabled row-level security, so their
-- new policies would otherwise be inert. Enabling RLS here is invisible to
-- the current BYPASSRLS runtime role and to the owner.
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_entity_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.durable_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_upload_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_media_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_media_write_claims ENABLE ROW LEVEL SECURITY;

-- Every application table with an archive_id tenancy column and no existing
-- policy. The public_demo_* tables are absent on purpose: migration 018/019
-- already gave them permissive server policies.
DO $$
DECLARE
  scoped_table text;
BEGIN
  FOREACH scoped_table IN ARRAY ARRAY[
    -- 001_initial
    'people', 'person_facts', 'import_snapshots', 'raw_records',
    'workspace_backups', 'sources', 'research_cases', 'hypotheses',
    'evidence_items', 'tasks', 'dna_matches', 'dna_hypotheses',
    'embeddings', 'ai_runs',
    -- 006-011 integrations
    'integration_connections', 'integration_snapshots', 'sync_runs',
    'sync_changes', 'external_entity_refs', 'integration_artifacts',
    'durable_jobs', 'integration_upload_intents', 'integration_media_objects',
    'integration_media_write_claims',
    -- 014-016 beta operations. beta_identity_audit_events rows may carry a
    -- NULL archive_id; their writer runs in maintenance mode.
    'beta_invitations', 'beta_email_verification_tokens',
    'beta_terms_acceptances', 'beta_identity_audit_events',
    'beta_data_operations', 'beta_worker_heartbeats', 'api_tokens',
    'security_events'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (true)',
      scoped_table || '_server_select_policy', scoped_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT
       WITH CHECK (archive_id::text = current_setting(''kinresolve.archive_id'', true))',
      scoped_table || '_archive_insert_policy', scoped_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE
       USING (archive_id::text = current_setting(''kinresolve.archive_id'', true))
       WITH CHECK (archive_id::text = current_setting(''kinresolve.archive_id'', true))',
      scoped_table || '_archive_update_policy', scoped_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE
       USING (archive_id::text = current_setting(''kinresolve.archive_id'', true))',
      scoped_table || '_archive_delete_policy', scoped_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT
       WITH CHECK (current_setting(''kinresolve.rls_mode'', true) = ''maintenance'')',
      scoped_table || '_maintenance_insert_policy', scoped_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE
       USING (current_setting(''kinresolve.rls_mode'', true) = ''maintenance'')
       WITH CHECK (current_setting(''kinresolve.rls_mode'', true) = ''maintenance'')',
      scoped_table || '_maintenance_update_policy', scoped_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE
       USING (current_setting(''kinresolve.rls_mode'', true) = ''maintenance'')',
      scoped_table || '_maintenance_delete_policy', scoped_table
    );
  END LOOP;
END
$$;

-- The archives table is the tenancy root: its primary key IS the archive id.
-- Provisioning and demo cleanup create and delete archive rows, so the
-- maintenance mode admits those verbs too.
CREATE POLICY archives_server_select_policy ON public.archives
  FOR SELECT USING (true);
CREATE POLICY archives_archive_insert_policy ON public.archives
  FOR INSERT WITH CHECK (id::text = current_setting('kinresolve.archive_id', true));
CREATE POLICY archives_archive_update_policy ON public.archives
  FOR UPDATE USING (id::text = current_setting('kinresolve.archive_id', true))
  WITH CHECK (id::text = current_setting('kinresolve.archive_id', true));
CREATE POLICY archives_archive_delete_policy ON public.archives
  FOR DELETE USING (id::text = current_setting('kinresolve.archive_id', true));
CREATE POLICY archives_maintenance_insert_policy ON public.archives
  FOR INSERT WITH CHECK (current_setting('kinresolve.rls_mode', true) = 'maintenance');
CREATE POLICY archives_maintenance_update_policy ON public.archives
  FOR UPDATE USING (current_setting('kinresolve.rls_mode', true) = 'maintenance')
  WITH CHECK (current_setting('kinresolve.rls_mode', true) = 'maintenance');
CREATE POLICY archives_maintenance_delete_policy ON public.archives
  FOR DELETE USING (current_setting('kinresolve.rls_mode', true) = 'maintenance');

-- RLS-enabled tables without an archive tenancy column keep working for a
-- non-owner runtime role through a permissive server policy, matching the
-- public_demo_* idiom from migration 018. Access stays server-only because
-- PUBLIC and Supabase API roles receive no table ACL; the reviewed
-- runtime-grant workflow grants the bounded DML separately.
--
-- memberships does carry archive_id, but it is written by identity flows
-- (sign-up, invitation acceptance) that decide which archives a user may
-- access in the first place; scoping those writes by the archive setting
-- would be circular, so it stays on the auth-plane server policy.
DO $$
DECLARE
  server_table text;
BEGIN
  FOREACH server_table IN ARRAY ARRAY[
    'legacy_users', '"user"', 'session', 'account', 'verification',
    'memberships', 'beta_invitation_control', 'auth_rate_limit_buckets',
    'beta_operator_nonces', 'api_rate_limit_buckets', 'beta_applications'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%s USING (true) WITH CHECK (true)',
      trim(both '"' from server_table) || '_server_policy', server_table
    );
  END LOOP;
END
$$;
