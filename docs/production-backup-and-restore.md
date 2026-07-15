# Production backup and restore rehearsal

**Status:** Prelaunch runbook. No RPO, RTO, deletion deadline, or backup-expiry
promise may be published until the corresponding workflow has run successfully and the
owner has signed the timed evidence.

Kin Resolve protects a real pilot as one isolated cell: one deployment, one database,
one private object store, one archive ID, and one secret set. A database backup alone
is incomplete because Vercel Blob is a separate data plane. This runbook covers the
scheduled encrypted backup and the disposable restore rehearsal. The stricter release
gate is documented in
[`production-recovery-evidence.md`](production-recovery-evidence.md).

## Recovery boundary

The recoverable cell consists of:

- the exact production PostgreSQL database and migration ledger;
- `gedcom-imports/<archive-id>/`;
- `archives/<archive-id>/`, excluding the object-storage identity sentinel from the
  participant-data manifest;
- the exact release commit, database identity, object-store identity, physical provider
  store ID, and archive ID; and
- the separately observed provider database recovery point.

### Object-class inventory

| Namespace/class | Purpose | Retention/recovery treatment |
| --- | --- | --- |
| `gedcom-imports/<archive>/...` | Legacy/direct staged GEDCOM uploads | Intentionally ephemeral; stale objects are removed after 24 hours. Inventory and capture any object present so an in-flight backup is internally consistent, but do not promise long-term staging retention. |
| `archives/<archive>/integration-upload-staging/...` | One-use direct-upload staging | Intentionally ephemeral. The fenced backup requires zero unexpired upload intents; any residual object is still inventoried so restore and deletion can account for it. |
| `archives/<archive>/integration-artifacts/...` | Retained original integration package | Recoverable. Manifest pathname, content type, size, and SHA-256; copy encrypted off-provider. |
| `archives/<archive>/integration-media/...` | Private retained package media | Disabled for cohort one. If present, treat as recoverable and block real-data launch unless rights, export, restore, and deletion treatment are approved. |
| `archives/<archive>/release-readiness/...` | Object-store identity sentinel | Infrastructure identity, not participant content. Verify independently; exclude from the object-data tar/manifest and never delete as an ordinary archive object. |

General source attachments under local `uploads/sources/` are outside this hosted object
contract and therefore remain disabled for cohort one. Enabling them creates an
unprotected data class and reopens the launch gate.

## Trust and credential separation

- The backup bucket must be operationally independent from production PostgreSQL and
  production object storage.
- The bucket must have versioning enabled and S3 Object Lock enabled with one default
  `COMPLIANCE` retention period. Set protected
  `RECOVERY_BACKUP_S3_MIN_RETENTION_DAYS` to the minimum approved whole-day period;
  the workflow rejects a shorter bucket default and rejects either exact object version
  unless its provider retention is `COMPLIANCE` through at least that minimum. This is
  a measured lower bound, not a promise that the object expires on that day.
- Encrypt database and object archives with `age` before upload. Keep the private age
  identity separate from bucket credentials; the scheduled backup needs only the public
  recipient.
- Use a verified-TLS direct/session database credential, never a transaction pooler.
- The source Supabase token may read backup status for only the source project and must
  not be able to delete it.
- The offsite credential needs only bucket versioning/Object Lock reads plus create-only
  object upload, exact-version head/read, checksum, and retention reads. It must not have
  retention bypass, Object Lock reconfiguration, version deletion, or bucket deletion.
- Backup object keys are immutable and attempt-bound:
  `production-backup/YYYY-MM-DD/<commit>/<run>-<attempt>/{database.dump,objects.tar}.age`.
  Every upload must return a nonempty provider version ID. Round-trip reads specify that
  exact key and version ID; reading the unversioned latest key is prohibited.
- GitHub artifacts receive only the privacy-safe JSON evidence. Never upload a dump,
  object tar, manifest containing pathnames, provider response, age identity, secret,
  or application log.
- The `production-backup` GitHub environment must be restricted to `main`, have a
  tightly limited administrator set, and expose the smallest source-read and
  offsite-write credential set. Because the daily run is unattended, do not configure
  a reviewer/wait rule that leaves scheduled backups silently awaiting approval; use
  narrowly scoped credentials, environment audit, concurrency, and the deadman alert.
  Manual recovery, deletion, and environment changes remain separately reviewed.

## Scheduled backup contract

The protected scheduled workflow must fail closed in this order:

1. Read the sanitized 40-character `releaseCommitSha` from authenticated production
   health, require that it is an ancestor of current protected `main`, check out that
   exact commit, and bind the run to it plus the protected database/object/provider
   identities. A package version or shortened/missing SHA is insufficient.
2. Acquire a durable release write fence bound to that commit and run attempt.
3. Wait for the maximum admitted request/lease window, then prove zero active job
   leases, zero unexpired upload intents, zero pre-fence straggler transactions, and
   visibility sufficient to make that proof.
4. Verify the exact migration ledger and capture a privacy-safe database manifest.
5. Inventory and read every object under both archive namespaces, hashing each byte
   stream and producing deterministic private manifests.
6. Confirm a source provider database recovery point is available.
7. Create a logical database dump and deterministic object archive on a private runner
   directory. Encrypt both with the configured age recipient.
8. Prove bucket versioning and default Object Lock `COMPLIANCE` retention, upload each
   ciphertext with an immutable create-only key, capture its exact version ID and
   version-level retention, then download that same key and version. Require exact
   provider checksum, local SHA-256, size, bucket digest, and retention matches.
9. Release the exact durable fence and prove its release timestamp follows activation.
10. Assemble the privacy-safe evidence, attest that evidence file, upload only that
    file, and notify the backup deadman only after every proof above succeeds.
11. On every outcome, remove plaintext, ciphertext, private manifests, downloads, and
    provider responses from the runner.

A run is not successful merely because `pg_dump`, encryption, or upload completed. It
is successful only when the round-trip checksums, both object namespaces, database
manifest, provider recovery point, and exact fence release are all represented in the
attested evidence.

Before fence acquisition, the source run publishes an immutable cleanup lease bound to
its run ID, attempt, source-head SHA, deployed release commit, database identity, and
derived fence ID. The independent **Production backup fence cleanup** `workflow_run`
janitor authorizes that exact artifact without credentials, then enters the protected
`production-backup-cleanup` environment and revalidates it using trusted current `main`
code. It releases only the exact matching fence. A missing exact fence or an already
released exact fence is a safe no-op; a conflicting identity fails closed. This covers
source-job failure, cancellation, timeout, and runner loss after lease publication.

Configure `production-backup-cleanup` for protected `main` without a reviewer delay. It
needs only `KINRESOLVE_DATABASE_IDENTITY` and `MIGRATION_DATABASE_URL`; do not give it
object-store, offsite-bucket, age, Supabase control-plane, Vercel, monitor, or application
credentials. The source job's `always()` cleanup remains a first attempt, not the sole
containment mechanism.

Until exact release is independently confirmed, treat production writes as being in an
unknown/paused state and declare SEV-1. Never acquire a second fence or edit the database
by hand to make a backup run appear complete.

## Backup evidence acceptance

Accept evidence only when all fields are present and match protected configuration:

- `kind: kinresolve-encrypted-offsite-backup` and strict schema version 3;
- exact release commit, run ID, and run attempt;
- privacy-safe archive digest, never raw archive ID in the uploaded evidence;
- exact database and object-store identities;
- database manifest SHA-256, exact migration versions, and the privacy-safe
  demo-product manifest used to prevent removal of rows absent from the backup;
- summaries for exactly the two object namespaces;
- provider recovery-point timestamp;
- nonempty database/object ciphertext sizes, matching round-trip SHA-256 values, and
  exact upload/download timestamps;
- for each ciphertext, the exact immutable key, provider version ID, bucket-name digest,
  enabled versioning, enabled Object Lock, default `COMPLIANCE` period, exact-version
  `COMPLIANCE` retain-until timestamp, and validated minimum days; both transfer sides
  must contain the identical locator and retention proof;
- exact fence ID, activation/release timestamps, and positive duration; and
- completion timestamp at or after fence release, no more than five minutes in the
  future, and before the configured freshness deadline.

The detailed database/object manifests remain encrypted with the backup, not in Actions
evidence. A backup deadman notification is a liveness signal, not evidence by itself.

## Restore rehearsal

Use the protected **Production recovery evidence** workflow and the disposable target
contract in
[`production-recovery-evidence.md`](production-recovery-evidence.md). Never rehearse by
restoring over production. The target database project and object store must have
independently attested identities and physical provider IDs different from production.

The timed rehearsal must prove, in order:

1. The selected encrypted database/object pair belongs to one exact source attempt and
   passes offsite download checksums.
2. The age identity decrypts both files only on the private runner.
3. The clean target database accepts the logical restore and its pre-migration manifest
   matches the source manifest.
4. Both target object namespaces begin empty, accept exactly the manifest set, and each
   restored object matches its size, content type, and SHA-256.
5. The restored migration ledger is the expected source prefix; only the exact candidate
   suffix is applied; the final ledger matches policy.
6. The app boots against a distinct target runtime role and protected internal health
   reports the expected target identity, version, capabilities, and dataset mode.
7. A synthetic authenticated import, review/apply/rollback, research workflow, and both
   GEDCOM and structured archive exports succeed without participant content.
8. The target object data is removed and both namespaces are proven empty.
9. The single-use target database project is destroyed and provider GET returns 404.
10. Only privacy-safe, attested evidence remains; all restored bytes and credentials are
    removed from the runner.

The production fence remains active through the protected recovery drill as documented
in the release evidence runbook. Failure produces no release evidence. Do not release
that fence until target cleanup is complete or the independent recovery janitor has
proved containment.

The current protected recovery workflow proves encrypted download, database restore,
migration, both-prefix object restore, runtime-role posture, internal health, target
object cleanup, and target database destruction. It does not yet run the complete
authenticated synthetic import/review/apply/rollback/export journey in item 7. The
restore exit gate remains open until that journey is added and timed; health alone is
not equivalent to product recovery.

## Measuring RPO and RTO

Record measurements; do not reverse-engineer a favorable number from the proposal.

- **Observed RPO:** the interval between the newest successfully restored source data
  timestamp and the rehearsal recovery-point cutoff. Include both database and object
  data; use the worse value.
- **Observed RTO:** wall-clock time from the recorded restore authorization to a healthy
  restored app completing the required synthetic journey. Keep migration time as a
  separate sub-measurement.
- **Deletion expiry:** time from primary-cell destruction to independent proof that each
  retained provider/offsite backup has expired or been deleted under its actual policy.

The planning candidates are a 24-hour RPO, 8-hour RTO, primary deletion within seven
days, and retained-backup expiry within 30 days. They remain non-public hypotheses until
at least one complete rehearsal and one synthetic deletion produce evidence at or better
than those values, and owner/counsel approve the wording.

## Rehearsal record template

```text
Rehearsal ID:
UTC start / end:
Operator / reviewer:
Source release commit:
Backup run / attempt:
Backup evidence digest and attestation URL:
Source database identity digest:
Source object-store identity digest:
Disposable target database identity digest:
Disposable target object-store identity digest:
Database ciphertext SHA-256:
Object ciphertext SHA-256:
Observed RPO:
Observed RTO:
Migration duration:
Database manifest match: PASS / FAIL
Both object manifest/checksum matches: PASS / FAIL
Internal health and synthetic journey: PASS / FAIL
Target object removal: PASS / FAIL
Target database destruction: PASS / FAIL
Participant data used: NO (required)
Incidents/exceptions:
Owner decision and UTC time:
```

Store the signed record in the private operations system. The repository may retain
only a privacy-safe evidence digest and public workflow link.

## Frequency and failure handling

- Run the encrypted off-provider backup daily while any real pilot data exists.
- Complete a timed disposable restore before admitting real data, after a material
  database/object-storage change, after age or backup-provider migration, and at least
  monthly during the pilot.
- Missed backup, checksum mismatch, unavailable provider recovery point, or failed
  target cleanup is SEV-1 and pauses new invitations and real-data ingestion.
- A suspected confidentiality breach of backup material is SEV-0. Disable the affected
  path, rotate credentials, preserve privacy-safe evidence, and follow
  [`incident-response.md`](incident-response.md).
