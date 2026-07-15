# Production recovery evidence

`.github/workflows/recovery-evidence.yml` is the protected, fail-closed recovery drill required before a production release. It accepts only an exact commit currently at `main` and that commit's exact `package.json` version. Its infrastructure acknowledgements describe protected control-plane facts; they cannot select or override a result. Every pass/fail result is derived from the database, object providers, application, or GitHub runtime.

## Cell prerequisites

The production source cell must be a fresh, isolated pilot cell provisioned through
`013_release_write_fence.sql` **before any real data is loaded**. Never attach the
`v0.17.4` application or a legacy database to this cell. At rehearsal time its ledger may
be the complete candidate ledger, or an exact immutable prefix of the candidate policy,
but that prefix must include `013_release_write_fence.sql` with the candidate policy's
exact checksum. This means today's fresh current-schema first cutover is a valid no-op
migration; future candidates may prove and apply only migrations `014+`. A prefix before
013 is rejected because it cannot provide the durable database-backed fence. The cell
must contain exactly `EXPECTED_ARCHIVE_ID`.

The recovery database project and Vercel Blob store are destructive, disposable targets. Their attested identities and physical provider IDs must differ from production. `SUPABASE_PROJECT_REF` and `RECOVERY_TARGET_SUPABASE_PROJECT_REF` must also be distinct. Setting `RECOVERY_TARGET_DATABASE_REPLACEMENT_POLICY=identity-bound-disposable-v1` explicitly authorizes `pg_restore --clean` only against the protected `RECOVERY_TARGET_DATABASE_IDENTITY`; the restore tool re-reads that physical identity immediately before replacement and refuses the production identity. The target admin and runtime URLs must both resolve to `RECOVERY_TARGET_SUPABASE_PROJECT_REF`, while a live cross-session observation proves that their distinct roles reach the exact same target database.

The database project is single-use. After restore and application health pass, the workflow verifies its identity again, sends `DELETE /v1/projects/{ref}` with a target-scoped token, validates the returned project ref, and polls `GET` to HTTP 404. A later drill therefore requires a newly provisioned target project, identity, admin credential, and runtime credential. The Blob store must contain its recovery identity sentinel but no objects under either restored namespace:

- `archives/<EXPECTED_ARCHIVE_ID>/`, excluding `release-readiness/` identity sentinels
- `gedcom-imports/<EXPECTED_ARCHIVE_ID>/`

The workflow deliberately refuses to overwrite an occupied object target. On the success path it re-reads the exact restored set, removes it, proves both namespaces empty, and then destroys the database project before evidence assembly. The `always()` cleanup repeats both operations as a best-effort fallback when the runner is still available. No attestation or artifact is produced unless success-path cleanup is proven.

The encrypted backup bucket must be operationally independent from the production database and Blob store. Age private-key custody must also be separate from the bucket credentials. Enable bucket versioning and S3 Object Lock with a default `COMPLIANCE` period at least as long as the protected `RECOVERY_BACKUP_S3_MIN_RETENTION_DAYS`. The workflow verifies both bucket controls and the exact-version retain-until metadata, then downloads the same key and version ID; it never accepts an unversioned latest-object read. This proves a minimum retained-through time, not an exact expiry or deletion date. The GitHub-hosted runner necessarily handles the plaintext only while performing the drill, but GitHub artifact storage receives only the strict JSON evidence file, never a dump, object, key, provider response, age identity, secret, or application log.

## Protected `production-recovery` configuration

Create a GitHub environment named `production-recovery`, restrict deployment branches to `main`, require reviewers, and configure these protected variables:

- `PRODUCTION_APP_BASE_URL` — canonical HTTPS production origin, with no trailing slash
- `EXPECTED_ARCHIVE_ID`
- `KINRESOLVE_DATABASE_IDENTITY`
- `KINRESOLVE_OBJECT_STORAGE_IDENTITY`
- `KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID` — exact Vercel Blob store ID parsed from its private provider URL
- `RECOVERY_TARGET_DATABASE_IDENTITY`
- `RECOVERY_TARGET_DATABASE_REPLACEMENT_POLICY` — exactly `identity-bound-disposable-v1`
- `RECOVERY_TARGET_SUPABASE_PROJECT_REF` — exact 20-character ref of the single-use target project; never production
- `RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY`
- `RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID` — exact, physically distinct Vercel Blob store ID
- `SUPABASE_PROJECT_REF` — exact 20-character production source project ref
- `RECOVERY_AGE_RECIPIENT` — public age recipient for the separately held identity
- `RECOVERY_BACKUP_S3_BUCKET`
- `RECOVERY_BACKUP_S3_REGION`
- `RECOVERY_BACKUP_S3_ENDPOINT` — optional HTTPS S3-compatible endpoint
- `RECOVERY_BACKUP_S3_MIN_RETENTION_DAYS` — approved whole-day lower bound, `1..3650`;
  both the bucket default and exact object-version `COMPLIANCE` retention must satisfy it

Configure these protected secrets:

- `MIGRATION_DATABASE_URL` — verified-TLS direct/session production connection, never a transaction pooler
- `BLOB_READ_WRITE_TOKEN` — private production Blob store token
- `RECOVERY_TARGET_DATABASE_URL` — verified-TLS direct/session disposable target connection
- `RECOVERY_TARGET_RUNTIME_DATABASE_URL` — distinct target role/credential used only by the restored app; it must address the same target project and database, have no superuser/owner/DDL/fence-control path, and have the grants needed for a rolled-back representative application write
- `RECOVERY_TARGET_BLOB_READ_WRITE_TOKEN` — distinct disposable Blob store token
- `RELEASE_FENCE_SECRET` — dedicated 256-bit-or-stronger base64url/hex fence-control bearer secret; generate with `openssl rand -hex 32` and never reuse `CRON_SECRET`
- `CRON_SECRET`
- `KINRESOLVE_OBSERVABILITY_PROBE_SECRET` — dedicated bearer secret for the restored application's detailed internal health contract; never reuse auth, cron, ingest, or fence credentials
- `SUPABASE_ACCESS_TOKEN` — source-scoped token with project/backup read access for only `SUPABASE_PROJECT_REF`; it must not have source project-delete authority
- `RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN` — fine-grained `projects:write` token scoped to only `RECOVERY_TARGET_SUPABASE_PROJECT_REF` when the provider supports project scoping; never reuse the source token
- `RECOVERY_AGE_IDENTITY`
- `RECOVERY_BACKUP_S3_ACCESS_KEY_ID`
- `RECOVERY_BACKUP_S3_SECRET_ACCESS_KEY`
- `RECOVERY_AUTH_SECRET` — throwaway local restored-app session secret
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `VERCEL_TOKEN`
- `VERCEL_AUTOMATION_BYPASS_SECRET`
- `FIRST_CUTOVER_HOLDING_DEPLOYMENT_ID`

Vercel production must have the matching `RELEASE_FENCE_SECRET`, `CRON_SECRET`, source identities, archive ID, database URL, and Blob token configured as Sensitive values where supported.

The offsite S3 principal may read bucket versioning and Object Lock configuration, create
new attempt-bound objects, and read/head exact versions and their retention metadata. It
must not bypass governance, shorten retention, reconfigure Object Lock, delete versions,
or delete the bucket.

Create a second environment named `production-recovery-cleanup` for the automatic
`workflow_run` janitor. Restrict it to `main`, do **not** add a manual reviewer that would
delay containment, and limit environment administration to the same recovery owners. It
needs only the source and target identity/ref variables listed above plus these target-only
secrets: `RECOVERY_TARGET_DATABASE_URL`, `RECOVERY_TARGET_BLOB_READ_WRITE_TOKEN`, and
`RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN`. It must not receive the production database URL,
production Blob token, source Supabase token, age identity, backup credentials, Vercel
credentials, or fence secret.

Before checkout or secret loading, the dispatch must supply these exact protected-infrastructure acknowledgements:

- `I acknowledge Vercel production deployment auto-assignment is disabled in the protected project dashboard.`
- `I acknowledge Vercel Standard Protection covers every generated deployment URL and has no exceptions.`
- `DESTROY DISPOSABLE KIN RESOLVE RECOVERY TARGET AFTER PROOF`
- `I acknowledge the production writer perimeter contains only the canonical Vercel runtime and protected GitHub release/recovery workflows; no external workers, SQL/API writers, or shared database/Blob credentials remain.`

The Standard Protection acknowledgement is backed by an unauthenticated generated-URL `/api/health` probe that accepts only HTTP 401 or 403 and rejects an application-health JSON body. Only afterward may the workflow use the protected automation bypass.

## What the drill proves

Before touching production state, the workflow installs the pinned Vercel CLI without credentials, pulls and validates the exact production project settings, proves the canonical origin is the approved static holding deployment, and creates an unaliased production candidate with the exact SHA/version metadata. Fence control and cron probes use this generated candidate origin with the protected automation bypass; the canonical holding alias is never moved by the recovery drill.

The workflow acquires or resumes the stable `fence-recovery-<release SHA>` production fence and leaves it active on success or failure. A failed run can therefore resume the same activation without rotating `activatedAt`; a different SHA cannot reuse it. It hashes privacy-safe database state plus both private object namespaces, waits 1,860 seconds, proves both authenticated cron endpoints return the same HTTP 423 fence, and then requires:

- unchanged database/object state;
- zero active durable-job leases;
- zero unexpired upload intents;
- zero client transactions that began at or before fence activation, excluding the manifest query's own connection;
- verified `pg_stat_activity` visibility for every database client role (or a database role with `pg_read_all_stats`);
- a fresh Supabase backup/PITR recovery point for the exact source project.

It then creates a custom-format logical database backup including privileges and a deterministic object archive, encrypts both with age, verifies offsite bucket versioning and Object Lock, uploads both to offsite S3 with SHA-256 provider checksums, captures each exact version ID and `COMPLIANCE` retain-until timestamp, deletes local originals, downloads those same key/version locators, and restores only those round-tripped ciphertexts. Both ciphertext SHA-256 digests are serialized into the attested evidence. The database manifest covers rows, sequences, constraints, indexes, RLS flags/policies, triggers, functions, extensions, ACLs, and default privileges.

The restored target must first match the source backup byte-for-manifest and carry the
same exact migration-policy prefix. Only then does the workflow record a separate
migration timer, apply the candidate migrations remaining after that prefix, require the
full candidate ledger, re-capture the post-migration database manifest, and boot the
candidate locally against the target. The post-migration manifest is intentionally **not**
required to equal the pre-migration manifest: forward migrations are allowed to change
schema and rows. Instead, evidence schema v2 records both manifests, the exact applied
migration suffix (including an empty suffix for a no-op first cutover), the final ledger,
the candidate semantic/catalog checks, both object manifests, application health, and
restore/migration timings. The restored app uses `RECOVERY_TARGET_RUNTIME_DATABASE_URL`, never the migration/admin credential. After candidate migration, the workflow applies the same checked-in beta-operations runtime grant contract used by staging and production, re-attests exact effective DML on `beta_data_operations` and `beta_worker_heartbeats`, and keeps `release_write_fences` and `schema_migrations` SELECT-only. A privacy-safe role digest and explicit posture record prove distinct credentials, a live session observed from the migration connection on the same database, no superuser/CREATEDB/CREATEROLE/REPLICATION or owner path, no effective mutation rights on `release_write_fences`, no `CREATE` on `public`, and a representative application update that is immediately rolled back. Protected recovery health must also return a complete, well-formed three-worker diagnostic set and bounded job-lag object; null or malformed operational diagnostics stop evidence. Because the current single-cell schema enables RLS without runtime policies, this evidence records (and temporarily permits) the role's actual `BYPASSRLS` flag; it does not conceal that posture as least privilege.

After health, the app is stopped, object-data removal is proven, and the database project is destroyed and polled to 404. Immediately afterward, `/api/release/fence/assert` must return the exact original `fenceId`, commit, activation generation, and `activatedAt`. A release/reacquire cycle therefore invalidates older evidence. The strict schema-v2 JSON serializes the exact source prefix versions, count, ledger digest, checksum-bound policy digest, migration-013 checksum, release commit, source and target database/object identities, both Supabase project refs, physical provider store IDs, privacy-safe runtime-role posture, `targetObjectDataRemoved=true`, and `targetDatabaseDestroyed=true`. Release readiness accepts it only against the same checked-in candidate policy, then the release migrator refuses production unless its live ledger still equals that exact evidenced prefix. The sole release evidence payload is `recovery-evidence.json`, uploaded under the immutable attempt-scoped artifact name `production-recovery-evidence-<run_attempt>`; GitHub Artifact Attestations signs that exact file. A separate attempt-scoped, non-secret cleanup lease contains only the already-protected source/target identities needed to authorize the janitor and is retained for 90 days. Database dumps, object bytes, age identity material, raw provider responses, credentials, role names, and application logs are never uploaded as Actions artifacts.

## Run and failure handling

Dispatch **Production recovery evidence** from `main` with the exact current 40-character `main` SHA, exact semantic version, and the four exact acknowledgements above. Any missing configuration, provider ambiguity, equal project ref, identity mismatch, occupied target, unsafe runtime role, state change, stale transaction, restore mismatch, health failure, incomplete object removal, or unproven target-project deletion stops the job without producing release evidence.

The production fence intentionally remains active after every post-acquisition outcome. Investigate the failure while writes stay paused. The `always()` cleanup verifies the recovery target's sentinel and physical provider store ID, deletes only a matching subset of the exact objects this run intended to restore, refuses unexpected objects, proves both target namespaces empty, and retries target-project deletion only after the target was identity-checked and marked as touched.

If the recovery runner is lost, `.github/workflows/recovery-cleanup.yml` starts from the completed failed, cancelled, or timed-out run. Before checkout or secret loading it requires the exact repository, `main` branch, candidate SHA, workflow path/name, original `workflow_dispatch` event, run attempt, and immutable cleanup lease. A missing lease is accepted as a safe no-op only when the exact source-attempt job record proves the lease-publication step never succeeded; a lease that was published and later deleted or expired fails closed and blocks the release queue. It then verifies the target Blob sentinel and provider store, removes only the two disposable target prefixes (never the sentinel), and independently attempts identity-bound target-project deletion with the target-scoped token. The database attempt still runs when object cleanup fails. The janitor has no source write credential and uploads no artifact. If this separate workflow also fails, no evidence exists, the fence stays active, and an environment owner must rerun the janitor or use the same identity-bound scripts before proceeding. Release the production fence only through the separately protected release workflow after that workflow verifies the attested evidence, or through the dedicated fence recovery procedure with the exact `fenceId` and commit.
