# Staging and production releases

This is the release-operator reference for Kin Resolve staging and production. It moved here from the repository README, which keeps only a short summary; the content below is the authoritative procedure.

Releases are candidate-first. Run `.github/workflows/vercel-release.yml` manually from
`main` with an exact full commit SHA, the matching stable `package.json` version, the
forward-only policy acknowledgement, and an explicit `release_target`. A `staging-only`
run must use application mode with intake disabled and every production recovery, API,
and writer-perimeter input empty. It stops after the isolated staging rehearsal and records
the exact candidate deployment ID, run, attempt, SHA, and version; it cannot enter the
production, marketing, or GitHub Release jobs. A `production` run additionally requires
the run ID plus SHA-256 of a fresh attested attempt-scoped
`production-recovery-evidence-<run_attempt>` artifact and the protected writer-perimeter
acknowledgement. The workflow refuses an existing tag or release; the stable GitHub tag
and Release are created idempotently only after the exact production candidate is live and
verified. GitHub verifies that recovery evidence came from the protected workflow at the
requested `main` commit; typed text is not accepted as backup or quiescence evidence. Git
auto-deployments remain disabled in `vercel.json`.

Protected infrastructure prerequisite: before approving a production release or holding
promotion, a reviewer must verify in the Vercel project dashboard that production
deployment auto-assignment is disabled and that Standard Protection covers every generated
deployment URL without an exception. Promotion can re-enable domain auto-assignment, so the
holding and release workflows immediately set the official project
`autoAssignCustomDomains` field to `false`, independently re-read the exact project, and
refuse to release the database fence until that state is proven. Automatic failure handlers
repeat that repair after runner loss; if the setting cannot be proven, they use Vercel's
project-pause API as the fail-closed fallback. Standard Protection remains a reviewed
dashboard prerequisite and is separately probed on every generated deployment URL. The
checked-in configuration validator also proves `git.deploymentEnabled=false`, `sfo1`, and
the two exact cron definitions. The holding workflow requires the first two exact
acknowledgements. The product-release and recovery workflows additionally require the
protected writer-perimeter acknowledgement before checkout:

```text
I acknowledge Vercel production deployment auto-assignment is disabled in the protected project dashboard.
I acknowledge Vercel Standard Protection covers every generated deployment URL and has no exceptions.
I acknowledge the production writer perimeter contains only the canonical Vercel runtime and protected GitHub release/recovery workflows; no external workers, SQL/API writers, or shared database/Blob credentials remain.
```

That final acknowledgement means the database runtime credential and Blob token exist only
in the canonical Vercel runtime, while migration, fence, backup, and recovery credentials
exist only in their protected GitHub environments. Hosted cells must have no long-lived
worker, Supabase SQL/Data API writer, stale custom-domain deployment, shared service token,
or operator process retaining write access during the fenced interval. The database fence
is application-enforced; this credential and deployment perimeter is therefore a required
part of the release safety boundary, not an optional operational convention.
The runtime role's exact fail-closed grant contract and current single-cell RLS tradeoff
are documented in [Production runtime database role](production-runtime-database-role.md).

After each generated production-target deployment is metadata-validated, the workflow
requires its unauthenticated URL to return a `401` or `403` protection response without
Kin Resolve application content. It then
smokes the same immutable URL with `VERCEL_AUTOMATION_BYPASS_SECRET` before any database
mutation or holding-page promotion.

The rollback target is also checked in and independently deployable: see
[Static maintenance holding deployment](static-holding-deployment.md). Its protected
manual workflow builds a zero-runtime page, stages it with `--skip-domain`, and reports the
validated ID to use as `STAGING_HOLDING_DEPLOYMENT_ID` or
`FIRST_CUTOVER_HOLDING_DEPLOYMENT_ID`, or `DEMO_HOLDING_DEPLOYMENT_ID`, depending on the
selected protected environment;
each target has a separate exact promotion acknowledgement.

The production target has four serialized phases. A staging-only target completes phases
1 and 2 and then emits its immutable candidate evidence:

1. Prove the requested SHA is the workflow's `main` SHA, run the full product/release
   suite, immutable migration checks, build, and production dependency audit without
   Vercel credentials.
2. Prove the protected `beta-staging` canonical origin is on its exact approved static
   holding deployment and smoke that zero-runtime target before mutation. Then rehearse
   the release using a separate target-specific build from the same commit and procedure,
   a separate Vercel project, database, object store, archive, and generated unaliased URL.
   The workflow temporarily promotes that exact candidate for the authenticated browser
   journey, then restores and proves the pinned holding deployment from a fresh finalizer.
   A staging-only run never leaves the candidate promoted or enters production; it must
   upload an attempt-scoped machine evidence artifact containing the candidate ID, run,
   attempt, SHA, and version.
3. In the protected `production` environment, validate Vercel metadata and actual
   readable settings, verify policy and machine-attested recovery/fence evidence, prove
   the canonical alias is on the approved static holding deployment, build and deploy an
   unaliased candidate, attest its runtime database identity, revalidate and smoke the
   holding deployment again immediately before mutation, require the live production
   ledger to equal the exact checksum-bound prefix proved by recovery evidence, migrate
   through the matching dedicated connection, prove the exact final ledger, smoke the
   candidate, and promote it.
4. Prove the canonical alias resolves to the candidate, run the full non-mutating smoke
   while writes remain fenced, disable and independently re-read production domain
   auto-assignment, release that exact fence, rerun the full canonical smoke, revalidate
   the alias and release namespace, then publish the stable GitHub Release in a separately
   retryable final job. A failed post-promotion step must re-contain writes before the alias
   can return to the approved holding deployment.

The legacy staging demo controller is retired and checked in only as a credential-free
historical tombstone. The always-on synthetic public demo uses the dedicated
`kinresolve-demo` project, database, holding target, release workflow, safety workflow, and
monitoring cell. Its exact external configuration, first hostname cutover, release,
rollback, containment, and rehearsal procedure are documented in
[the public demo runbook](public-demo-runbook.md). Public-demo release remains blocked
until GitHub reports the legacy controller manually disabled and idle.

The protected GitHub environments are intentionally separate. Configure their exact
inventory as follows; do not promote a repository-level secret as a shortcut:

- `beta-staging` secrets: `CRON_SECRET`, `KINRESOLVE_OBSERVABILITY_PROBE_SECRET`,
  `MIGRATION_DATABASE_URL`, `STAGING_BROWSER_CANARY_EMAIL`,
  `STAGING_BROWSER_CANARY_PASSWORD`, `STAGING_BROWSER_CANARY_USER_ID`,
  `STAGING_HOLDING_DEPLOYMENT_ID`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`; when protected intake rehearsal is enabled it
  also needs `BETA_APPLICATION_CANARY_EMAIL_PATTERN`. Variables: `APP_BASE_URL`,
  `VERCEL_PROJECT_ID`, `KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID`, and the exact protected
  production exclusions `FORBIDDEN_PRODUCTION_DATABASE_IDENTITY`,
  `FORBIDDEN_PRODUCTION_OBJECT_STORAGE_IDENTITY`, and
  `FORBIDDEN_PRODUCTION_OBJECT_STORAGE_PROVIDER_ID`. The pulled Vercel Production setting
  `KINRESOLVE_SCHEDULED_WRITES_ENABLED` must be readable and exactly `false`.
- `production` secrets: `CRON_SECRET`, `FIRST_CUTOVER_HOLDING_DEPLOYMENT_ID`,
  `MIGRATION_DATABASE_URL`, `RELEASE_FENCE_SECRET`, `VERCEL_AUTOMATION_BYPASS_SECRET`,
  `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`. Variables: `APP_BASE_URL`,
  `VERCEL_PROJECT_ID`, `KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID`, `SUPABASE_PROJECT_REF`,
  `RECOVERY_TARGET_DATABASE_IDENTITY`, `RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY`,
  `RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID`, and
  `RECOVERY_TARGET_SUPABASE_PROJECT_REF`. The two project refs are required release
  evidence bindings and must differ. The pulled scheduled-write setting must be readable
  and exactly `true`.
- `demo-production` is the protected public-demo release environment. Secrets:
  `DEMO_HOLDING_DEPLOYMENT_ID`, `KINRESOLVE_DEMO_CANARY_SECRET`,
  `KINRESOLVE_OBSERVABILITY_PROBE_SECRET`, `MIGRATION_DATABASE_URL`,
  `PUBLIC_DEMO_RUNTIME_DATABASE_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET`,
  `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`. Variables:
  `APP_BASE_URL`, `KINRESOLVE_DATABASE_IDENTITY`,
  `MARKETING_VERCEL_PROJECT_ID`, `PRODUCTION_DATABASE_IDENTITY`,
  `PRODUCTION_VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. The exact
  setup and runtime contract are in [the public demo runbook](public-demo-runbook.md).
- `demo-containment` is the matching automatic, no-reviewer safety environment. It carries
  only the pinned holding, monitor/canary, and Vercel control credentials needed to prove a
  compatible rollback, restore exact holding bytes, repair hostname ownership, or pause
  `kinresolve-demo` fail-closed.
- `demo-monitoring` carries `APP_BASE_URL`, the demo canary/health-probe secrets, and an
  optional fixed-schema alert URL. It receives no database, migration, AI, auth, email,
  object-storage, or Vercel deployment credential.
- `beta-staging-containment` is an automatic safety environment with no required reviewers
  or wait timer. Secrets: `STAGING_HOLDING_DEPLOYMENT_ID`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`. Variables: `APP_BASE_URL`, `VERCEL_ORG_ID`, and
  `VERCEL_PROJECT_ID`. Its Vercel organization, project, hostname, and pinned holding
  identities must exactly match the `beta-staging` cell; it exists so explicit close and
  failed release/holding/demo runs cannot wait for an interactive deployment approval before
  restoring holding traffic or disabling domain auto-assignment.
- `production-containment` is an automatic safety environment with no required reviewers
  or wait timer. Secrets: `MIGRATION_DATABASE_URL`,
  `FIRST_CUTOVER_HOLDING_DEPLOYMENT_ID`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and
  `VERCEL_TOKEN`. Variables: `APP_BASE_URL`, `EXPECTED_ARCHIVE_ID`,
  `KINRESOLVE_DATABASE_IDENTITY`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`.
- `production-recovery` secrets: `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`,
  `FIRST_CUTOVER_HOLDING_DEPLOYMENT_ID`, `MIGRATION_DATABASE_URL`,
  `RECOVERY_AGE_IDENTITY`, `RECOVERY_AUTH_SECRET`, `RECOVERY_BACKUP_S3_ACCESS_KEY_ID`,
  `RECOVERY_BACKUP_S3_SECRET_ACCESS_KEY`, `RECOVERY_TARGET_BLOB_READ_WRITE_TOKEN`,
  `RECOVERY_TARGET_DATABASE_URL`, `RECOVERY_TARGET_RUNTIME_DATABASE_URL`,
  `RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN`, `RELEASE_FENCE_SECRET`,
  `SUPABASE_ACCESS_TOKEN`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`. Variables: `PRODUCTION_APP_BASE_URL`,
  `EXPECTED_ARCHIVE_ID`, both production database/object identities and provider IDs,
  both `SUPABASE_PROJECT_REF` values, `RECOVERY_TARGET_DATABASE_REPLACEMENT_POLICY`,
  `RECOVERY_AGE_RECIPIENT`, and the recovery S3 bucket, region, and endpoint.
- `production-recovery-cleanup` is target-only. Secrets:
  `RECOVERY_TARGET_BLOB_READ_WRITE_TOKEN`, `RECOVERY_TARGET_DATABASE_URL`, and
  `RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN`. Variables: `EXPECTED_ARCHIVE_ID`, both
  source and target database/object identities and provider IDs, and both source and
  target Supabase project refs. It must not receive the production database, Blob, fence,
  backup, Vercel, or source Supabase write credentials.

Protect the interactive release and recovery environments with reviewers; the automatic
containment and cleanup environments must remain able to respond to runner loss. Staging and
production values must differ. Automatic safety cells require their secret and independently
readable Vercel organization/project IDs to match before any control-plane mutation. The
protected recovery workflow produces one attested release-evidence payload plus a non-secret,
attempt-scoped 90-day cleanup lease. A successful cutover writes only a privacy-safe Actions
summary with the commit, version, deployment IDs, fence ID, and passed gates.

Required Vercel production environment: `DATABASE_URL` (Supabase transaction pooler on
port `6543` with `sslmode=require`—the app upgrades known Supabase pooler connections to
`verify-full` with the bundled root CA), `DATABASE_POOL_MAX=2`,
`DATABASE_AUTO_MIGRATE=false`, `APP_BASE_URL` set to the canonical HTTPS product origin,
`KINRESOLVE_DEPLOYMENT_MODE=hosted`, an explicit `KINRESOLVE_DATASET_MODE`, an explicit
`KINSLEUTH_ARCHIVE_ID`, `KINSLEUTH_ALLOW_SIGNUPS=false`, catalog-derived
`KINRESOLVE_DATABASE_IDENTITY`, sentinel-derived
`KINRESOLVE_OBJECT_STORAGE_IDENTITY`,
`KINRESOLVE_OBJECT_STORAGE_BACKEND=vercel-blob`, guided research and export refresh
enabled, explicit `KINRESOLVE_API_V1_ENABLED` and
`KINRESOLVE_BETA_APPLICATIONS_ENABLED` values, the exact seven-flag
cohort-one manifest, the approved legal manifest, the
audience-bound operator public identity, the approved Resend sender contract,
`AUTH_SECRET`, `KINRESOLVE_API_CURSOR_SECRET`,
`KINRESOLVE_BETA_PRIVACY_HMAC_SECRET`, both observability secrets, `RESEND_API_KEY`,
`BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, and `RELEASE_FENCE_SECRET`. Every listed
credential, including `DATABASE_URL`, must be a Vercel Sensitive variable. When native
applications are enabled, `KINRESOLVE_BETA_APPLICATION_HMAC_SECRET` is an additional
required Sensitive variable; app-off releases do not require it. Every listed
noncredential setting must remain readable, and every assignment
must be scoped to Production only so the workflow can validate configuration without
reading secret values. Before either staging or production can build, deploy, or mutate a
database, the workflow rejects control-plane-only credentials (including migration/admin
database URLs, recovery/offsite/age credentials, Supabase management tokens, GitHub
tokens, and user-configured Vercel deploy/bypass assignments) from both the complete Vercel metadata inventory
and the pulled runtime environment; validation reports names and counts only, never values.

The first hosted cutover is forward-only: never attach `v0.17.4` to the migrated pilot
database. Provision the fresh, empty pilot cell through `013_release_write_fence.sql`
before loading real data. Recovery evidence rejects every earlier ledger prefix; it may
prove the full candidate ledger as a no-op migration, or, for future releases, prove an
exact prefix containing 013 and apply only the remaining candidate migrations on the
recovery target before production is allowed to advance from that identical prefix. If
promotion or the live smoke fails, automation may move the alias only to the
captured, pre-approved static holding deployment and only after the production write
fence is active. It never runs a down migration or reattaches the legacy application.
A failed, cancelled, or timed-out release run starts a credential-free classifier first.
It independently restores the pinned staging holding deployment, or proves the exact
staging project is paused, before its safety receipt can succeed. It leaves production
alone when the production job was skipped, and it leaves a verified
candidate live when only GitHub publication failed after the final canonical revalidation.
A failed, cancelled, or timed-out production job instead recontains the exact database
fence and rolls back to the pre-approved holding deployment. A failed, cancelled, or
timed-out recovery run starts the target-only recovery janitor, which removes restored
target objects and destroys only the identity-bound disposable target database project.
A failed, cancelled, or timed-out holding promotion starts a target-specific automatic
repair that disables and independently re-reads domain auto-assignment; when promotion may
have occurred and repair cannot be proven, it pauses that exact Vercel project. Every marked
failed source attempt needs its exact successful containment, cleanup, holding-repair, or
demo-session repair receipt before any later release, recovery, holding, or demo run may
load protected credentials.
Vercel's [Cron Jobs rollback guidance](https://vercel.com/docs/cron-jobs/manage-cron-jobs#rollbacks-with-cron-jobs)
and [Instant Rollback guidance](https://vercel.com/docs/instant-rollback) describe different
schedule behavior, so both rollback paths keep the durable write fence active and record mandatory dashboard cron verification; the
zero-runtime holding deployment remains the traffic target until that follow-up is done.
The operator containment runbook remains the fallback if either automation fails. An
alias rollback is not a database rollback, and restore/forward-fix evidence remains a
separate launch gate rather than something inferred from a successful migration.

