# Production runtime database role

Hosted staging and production must use a dedicated application login in Vercel's
`DATABASE_URL`. It must not reuse `MIGRATION_DATABASE_URL`, a project owner, or a
Supabase administrative login. Provisioning this role is a protected, external database
operation. The release workflow never creates the role or changes role attributes,
memberships, ownership, schema privileges, database privileges, or protected-table
privileges. After a migration creates a reviewed application table, the workflow may
reconcile only that migration's checked-in table-DML contract and must attest the result.

Before either cell builds or deploys, the workflow parses the pulled Vercel dotenv as
data (never with `source` or shell evaluation), then opens the runtime and migration
connections over verified transport. The gate pins the runtime backend in an explicit
transaction and fails unless the migration connection can observe that exact PID,
database OID/name, and session role on the same configured physical database while
`current_user` differs. This remains valid behind transaction poolers that rewrite
`application_name` or mask privileged activity columns. Its privacy-safe JSON records
only the database fingerprint, a domain-separated role-name digest, and boolean posture
results.

The runtime role must be a login with no `SUPERUSER`, `CREATEDB`, `CREATEROLE`, or
`REPLICATION`; no membership in the migration role, `pg_write_all_data`, an admin role,
or any role that owns the database or an object in `public`; no ownership of the public
schema, relations, functions, or types; and no `CREATE` on `public`. It must be able to
`SELECT` `public.release_write_fences`, but must have no effective `INSERT`, `UPDATE`,
`DELETE`, `TRUNCATE`, `TRIGGER`, or `REFERENCES` privilege on that table. Hosted HTTP
fence mutation is disabled; protected release automation performs fence transitions
directly through the migration connection.

The attester also locks the configured archive row, performs the same kind of archive
timestamp `UPDATE` used by application persistence, rolls the transaction back, and
proves the row version and timestamp are unchanged afterward. Failure to query catalogs,
observe the live session, access the archive, perform the write, roll back, or prove the
unchanged row stops the release. The workflow does not automatically fall back to an
admin credential.

## Post-migration grant contract

Migrations `014_beta_invitations`, `015_beta_operations`, `016_beta_api_tokens`, and
`017_beta_applications` create these seven runtime-managed tables after the dedicated
runtime role has already been provisioned: `auth_rate_limit_buckets`, `beta_applications`,
`beta_data_operations`, `beta_worker_heartbeats`, `api_tokens`,
`api_rate_limit_buckets`, and `security_events`. PostgreSQL does not retroactively apply
the role's old table grants to those relations. Immediately after the exact migration
ledger is verified, staging and production run:

```sh
npm run db:runtime-role:grant-beta-operations -- "$RUNNER_TEMP/runtime-grants.json"
```

The command reads the actual runtime `DATABASE_URL`, database identity, and archive ID
from the Vercel environment file that was already pulled and validated by the release; it
never shell-sources that file. It takes only the protected `MIGRATION_DATABASE_URL` from
the workflow environment. Before changing an ACL, it proves verified transport, the
configured physical database identity, distinct direct runtime and migration roles, a
live runtime session visible to the migration connection, and the complete safe-role
posture above.

The public-demo release uses the command's explicit `--public-demo` mode because Vercel
Sensitive values are non-readable after creation and are not available to a GitHub runner
through `vercel pull`. In that mode, the bounded runtime URL comes from the step-scoped
`PUBLIC_DEMO_RUNTIME_DATABASE_URL` secret in the protected `demo-production` GitHub
environment; database identity, dataset mode, public-demo enablement, and archive ID still
come from the validated readable Vercel file. This workflow-only credential is forbidden
from Vercel under its duplicate name. It must contain the same URL as Vercel's Sensitive
`DATABASE_URL`, and operators must rotate both copies together.

Within one transaction, the command revokes direct privileges only on those seven named
tables and restores their exact least-privilege contract. The two operations tables and
`api_tokens` receive `SELECT`, `INSERT`, and `UPDATE`; the expiring
`auth_rate_limit_buckets`, `beta_applications`, and `api_rate_limit_buckets` tables also
receive `DELETE` for bounded retention, DSAR deletion, and cleanup; append-only
`security_events` receives only `INSERT`. `TRUNCATE`, `REFERENCES`,
`TRIGGER`, `MAINTAIN`, every grant option, ownership, and `CREATE` on `public` remain
absent, and `DELETE` remains absent from every managed table except the two rate buckets
and `beta_applications`.
The runtime must also have no database-level `CREATE` path. The transaction re-attests
privileges across every role the runtime can enter with `SET ROLE`, so an unsafe direct
or membership-derived privilege causes a rollback. It never issues a grant or revoke
against `release_write_fences` or `schema_migrations`; both are independently checked as
SELECT-only protected tables.

After commit, a fresh full role attestation and a runtime-session privilege read must
match the transactional result and original privacy-safe role digest. The receipt
contains only the database fingerprint, role digest, fixed relation names, and booleans.
If any proof fails, the release stops before staging smoke or production fence release.
Adding another runtime table requires a separately reviewed contract change; broad
`ALL TABLES`, default privileges, or role-name inputs are intentionally unsupported.

## RLS policies and the staged NOBYPASSRLS flip

Migration `020_core_rls_policies` defines the archive-scoped policies that were the
first half of this follow-up. Every application table keyed by `archive_id` (and the
`archives` root itself) now carries mutation-only policies: `SELECT` stays unscoped
because many server reads still run as one-shot pool queries outside a transaction,
while `INSERT`/`UPDATE`/`DELETE` (and the `UPDATE`-policy check behind
`SELECT ... FOR UPDATE/SHARE`) require the writing transaction to pin its archive via
`set_config('kinresolve.archive_id', <archive id>, true)`. Cross-archive system work
(demo purge, provisioning cleanup, operator identity flows) instead sets
`set_config('kinresolve.rls_mode', 'maintenance', true)`. Application code attaches
these transaction-local settings through `withRlsArchiveScope` /
`withRlsMaintenanceMode` (`lib/db-rls.ts`), and the attester's rolled-back
representative write pins its configured archive the same way. Because
`current_setting(..., true)` is `NULL` when unset, an unpinned write under a
non-bypass role is denied by default — the designed loud failure for any missed
call site.

The policies are inert for the current dedicated `BYPASSRLS` runtime login and for
the table owner (no `FORCE ROW LEVEL SECURITY`; the owner runs migrations, fixture
rotation, and recovery purges). The remaining operator action is re-provisioning the
runtime role with `NOBYPASSRLS`, staged deliberately: flip the disposable public-demo
cell first, observe the demo lifecycle (provision, session start, outcome recording,
cleanup/drain) under the restricted role, then flip the hosted cells. The attester
already records `bypassRls` explicitly, so each cell's posture stays visible in the
release evidence during the rollout. `tests/core-rls-policies.test.ts` proves the
demo lifecycle and the policy matrix against a non-owner `NOBYPASSRLS` role carrying
the checked-in grant contract.

## External provisioning checklist

Run the equivalent of the following through the protected database control plane, with a
new generated password supplied out of band. Adapt the table grant loop to the exact
checked-in application inventory and review its output before committing it; never store
the password or resulting URL in this repository. Once a cell completes the staged
`NOBYPASSRLS` flip described above, provision (or re-provision) its role with
`NOBYPASSRLS` in place of `BYPASSRLS` below.

```sql
CREATE ROLE kinresolve_runtime
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT BYPASSRLS
  PASSWORD '<generated outside this repository>';

GRANT CONNECT ON DATABASE postgres TO kinresolve_runtime;
GRANT USAGE ON SCHEMA public TO kinresolve_runtime;
REVOKE CREATE ON SCHEMA public FROM kinresolve_runtime;

DO $$
DECLARE relation_name text;
BEGIN
  FOR relation_name IN
    SELECT format('%I.%I', n.nspname, c.relname)
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('release_write_fences', 'schema_migrations')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO kinresolve_runtime',
      relation_name
    );
  END LOOP;
END
$$;

REVOKE ALL ON TABLE public.release_write_fences FROM kinresolve_runtime;
GRANT SELECT ON TABLE public.release_write_fences TO kinresolve_runtime;
REVOKE ALL ON TABLE public.schema_migrations FROM kinresolve_runtime;
GRANT SELECT ON TABLE public.schema_migrations TO kinresolve_runtime;
```

After creating the role, put its verified-TLS pooler URL only in the target Vercel
Production `DATABASE_URL`. Put the distinct direct/session migration URL only in that
cell's protected GitHub `MIGRATION_DATABASE_URL`. Apply and review baseline grants
externally before dispatching the first release. Later checked-in post-migration grant
contracts may reconcile only their named new tables as described above. Missing or stale
baseline grants deliberately stop the pre-deploy gate; do not temporarily substitute the
migration URL to make it pass.
