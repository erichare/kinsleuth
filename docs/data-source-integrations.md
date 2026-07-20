# Data source integrations

Kin Resolve treats genealogy programs as inbound data sources. A data source is a
remembered export origin, not a live vendor account connection. Researchers bring an
authorized export to Kin Resolve, review every proposed change, and decide what enters
their private archive.

The public product language is deliberately precise:

- Use **Import from Ancestry** for the first export.
- Use **Refresh from an Ancestry export** for later exports.
- Do not claim that Kin Resolve connects to, signs in to, or synchronizes an Ancestry
  account.
- Do not request Ancestry credentials, reuse account cookies, automate Ancestry pages,
  scrape records, or write changes back.

The implementation uses `IntegrationConnection` and `SyncRun` internally so providers
share one model. The user-facing workflow is an import and reviewable refresh.

## Implementation status

This slice is a working provider-neutral refresh vertical: Data sources UI,
archive-scoped persistence and REST APIs, safe package inspection, three-way change
classification for normalized people, sources, facts, relationships, citations, families,
and media references, searchable review and import reports, private S3/MinIO and Vercel
Blob storage, durable leased work, transactional apply, and backup restoration. People,
sources, facts, primary citation links, and relative links have canonical workspace apply
paths; families, richer relationship roles, secondary citation links, and GEDCOM media
records remain preserved in the snapshot/review layer rather than a fully expressive
canonical tree model.
Self-hosted deployments use the registered long-running parser; hosted deployments invoke
the same worker protocol in bounded scheduled batches. A parse job does not checkpoint
mid-file and must fit within its worker invocation.

Desktop packages receive media-reference reconciliation, missing/ambiguous reports, and
executable rejection. Every non-GEDCOM ZIP entry,
including an attachment that is not referenced by the GEDCOM, must pass a configured
private malware scanner before a run can become review-ready. Attachment-bearing FTM and
RootsMagic packages are accepted only when both deploy gates and the current per-package
rights acknowledgement are present; matching safe media is then extracted to private,
archive-namespaced storage. Attachment-bearing Ancestry and generic packages fail closed.

## Supported tracks

| Data source | Accepted package | Current boundary | Rollout gate |
| --- | --- | --- | --- |
| Ancestry export | `.zip`, `.ged`, `.gedcom` | Tree GEDCOM only; no account access or writeback | `KINRESOLVE_EXPORT_REFRESH_ENABLED` |
| Family Tree Maker | GEDCOM, or a rights-acknowledged ZIP containing one GEDCOM and referenced media | Tree refresh, media reconciliation, private restricted retention, authenticated download and ownership attestation | Export refresh plus both private-media deploy gates |
| RootsMagic | GEDCOM, or a rights-acknowledged ZIP containing one GEDCOM and referenced media | Tree refresh, media reconciliation, private restricted retention, authenticated download and ownership attestation | Export refresh plus both private-media deploy gates |
| Generic GEDCOM | `.ged`, `.gedcom` | Standards-based snapshot import and refresh | `KINRESOLVE_EXPORT_REFRESH_ENABLED` |
| Ancestry partner API | No public flow | Disabled until written authorization and an approved API contract exist | Enable flag **and** separate written-approval gate |

Ancestry documents its tree download as a text-only GEDCOM delivered in a ZIP. Photos
and other media binaries are not included, although recent exports may retain references
that Ancestry can use to relink files on its own service. Only a tree owner can export
the tree. See [Ancestry's tree export instructions](https://ancestry.my.site.com/FrCa/articles/en_US/Support_Site/Uploading-and-Downloading-Trees).

Ancestry's current terms prohibit access or collection that exceeds normal human use,
including unapproved automated or programmatic access. Kin Resolve therefore has no
browser automation fallback. See the [Ancestry Terms and Conditions](https://www.ancestry.com/c/legal/termsandconditions-en).

## Refresh semantics

A refresh compares three states:

1. The last snapshot applied from this data source, called the **base**.
2. The current Kin Resolve entity, called **local**.
3. The newly uploaded export, called **incoming**.

Every entity is classified before apply:

| Classification | Meaning | Default action |
| --- | --- | --- |
| `remote_only` | Incoming changed while local still matches the base | Accept incoming |
| `local_only` | Local changed while incoming still matches the base | Keep local |
| `same` | Local and incoming agree | No operation |
| `conflict` | Local and incoming both diverged from the base | Require review |
| `deletion` | An entity present in the base is absent from incoming | Keep local |

A missing record in an export is never treated as permission to hard-delete local
research. Curated privacy, living status, publication choices, and locally maintained
research remain protected.

The lifecycle is:

1. Create or reuse an archive-scoped integration connection and record where the
   researcher says authoritative tree edits happen. A later refresh updates that
   declaration on the connection in the same transaction that starts the run.
2. Stage a private artifact under that connection.
3. Create a durable refresh run for the artifact.
4. Inspect the package, preserve a snapshot, and generate paginated changes.
5. Review conflicts, deletions, unsupported data, and missing or ambiguous media in
   bounded cursor pages. The browser does not eagerly materialize a large tree's full
   change set. Search and classification filters execute on the server, while a bounded
   summary reports run-wide classification and unresolved counts so unloaded conflicts
   cannot be mistaken for completed review.
6. Apply selected resolutions in one archive-scoped transaction using an idempotency
   key. The apply creates a restorable pre-apply backup.
7. Use the explicit rollback action to restore that backup if needed.

The latest run is remembered per connection. Reloading the Data sources page resumes
polling queued or parsing work and offers explicit controls to reopen a prepared or
applied review and cancel an active refresh. Run status reports expose aggregate counts
and bounded findings only; parser manifests and entity-value maps remain server-side.

If relationship-aware identity matching produces more than one plausible local entity,
the authenticated review shows those candidate IDs and requires an explicit selection
before incoming values can be accepted. The chosen ID is validated against the locked
server-generated candidates, written to the change and its resolution evidence, and
remembered as an external reference in the same apply transaction.

Disconnecting a remembered source keeps already imported research. The server cancels
queued, parsing, or review-ready work and its durable job before marking the connection
disconnected. An applying run cannot be disconnected. Rollback controls are shown only
while the applied run still references a retained backup; after pruning, the UI reports
that the restore point expired.

Provider identifiers and GEDCOM xrefs are scoped to their connection and snapshot.
They map to stable Kin Resolve entity identifiers; an xref is not a globally unique
person identifier. This prevents unrelated trees that both contain `@I1@` from being
treated as the same source identity.

Raw GEDCOM records, xrefs, custom tags, source references, and checksums remain
available for provenance. Full-archive GEDCOM exports carry curation flags as
compatibility-preserved custom `_KS_` tags, and the explicit legacy Kin Resolve
migration path can restore those tags; the provider-neutral refresh workflow treats
incoming publication controls as untrusted and always creates new people private and
unpublished.

## Package and media safety

The package inspector accepts a single GEDCOM directly or exactly one GEDCOM inside a
ZIP. ZIP inspection rejects traversal paths, symbolic links, duplicate case-insensitive
paths, encrypted or multi-disk archives, unsupported compression, bad checksums,
executable content, excessive entry counts, excessive expanded size, and suspicious
compression ratios. Missing and ambiguous GEDCOM media references are reported instead
of guessed.

The original ZIP remains a private archive artifact, so every non-GEDCOM entry is sent by
bytes only to a private clamd `INSTREAM` endpoint before review. Kin Resolve does not send
filenames, paths, tree names, or genealogy metadata to clamd. A missing scanner, timeout,
oversized stream, protocol error, or non-clean verdict fails closed with a redacted status
code. The stock Kin Resolve limit is 24 MiB per file and can be raised only when clamd's
`StreamMaxLength` is raised to match.

Every extracted media object is created with this policy:

| Field | Default |
| --- | --- |
| License class | `third_party_restricted` |
| Privacy | `private` |
| Public publishing | Disabled |
| AI context | Disabled |

This default applies even when a package came from Family Tree Maker or RootsMagic.
Those products have authorized Ancestry workflows, but their transfer formats have
documented fidelity gaps and do not grant Kin Resolve new rights to record images or
other licensed material. See [Family Tree Maker FamilySync limitations](https://support.mackiev.com/444769-Whats-Not-Synced-with-FamilySync-in-FTM-2024) and [RootsMagic TreeShare](https://help.rootsmagic.com/RM11/ancestry-treeshare.html).

The authenticated Data sources workspace may mark a file as user-owned only after the
current explicit ownership attestation. That changes the recorded license class but does
not make the file public or AI eligible.
Ancestry record images and other third-party licensed media remain private, retain their
source attribution, and stay excluded from the public archive and AI context. Broad
record-image ingestion remains gated on approved rights language and legal review.

## Object storage deployment

Integration artifacts are private and archive-namespaced. Buffered uploads use a
content-addressed object name; direct browser uploads use a server-generated random
staging name. After streaming validation, the server promotes those bytes to a separate
content-addressed artifact key before committing the artifact. A completed artifact
therefore never points at a browser-writable staging key. The client never chooses or
returns an object key during completion. The key contract is:

```text
archives/<archive-id>/<purpose>/<server-owned-object-id>
```

Reads and deletes fail closed when a key is outside the authenticated archive prefix.
Public object access is not part of the integration contract.

Select the backend with `KINRESOLVE_OBJECT_STORAGE_BACKEND`:

- `s3` for S3-compatible storage, including MinIO in self-hosted deployments.
- `vercel-blob` for hosted Vercel Blob deployments.

The `archives/<archive-id>/` namespace is fixed rather than operator-configurable so
scope checks cannot drift between processes. The web process and every worker process
must use the same backend, bucket, and credentials. Keep `BLOB_READ_WRITE_TOKEN` or
`S3_*` credentials server-side.

Large browser uploads use an expiring, connection-bound, one-use upload intent:

- Vercel Blob receives an official private client token for the exact pathname,
  declared content type, maximum size, non-overwrite policy, and multipart upload.
- S3/MinIO receives a presigned multipart `POST` policy for a random staging key.
  The provider enforces the exact key, content type, private cache policy, and declared
  byte length before accepting the upload.
  `S3_PUBLIC_ENDPOINT` must be the browser-reachable signing endpoint, while
  `S3_ENDPOINT` remains the server/worker endpoint.
- Completion accepts only the opaque intent id, streams the private object into
  SHA-256, verifies exact stat/stream size, MIME and ZIP/GEDCOM signature, copies the
  validated source to an immutable content-addressed key with a source-identity
  precondition, re-streams and re-hashes the promoted object, and consumes the intent in
  the artifact transaction. The worker independently rechecks the bytes.
- Family Tree Maker and RootsMagic ZIP staging accepts only the current explicit
  `mediaRightsAcknowledgement` (JSON) or `mediaRightsAcknowledgementAccepted=true` plus
  `mediaRightsAcknowledgementVersion` (multipart) while both media release gates are on.
  The server binds the actor, persists the same version/actor/time on the intent,
  artifact, and sync run, and rejects this acknowledgement for other providers.
- Expired pending intents and failed redundant-object deletions remain eligible for the
  bounded `cleanupExpiredDirectIntegrationUploadIntents` maintenance function. Hosted
  cron invocations run one bounded cleanup even when no parse job exists; long-running
  workers run it on a separate maintenance interval rather than every queue poll.

Browser multipart `POST` also requires CORS. Docker Compose sets MinIO's allowed API
origin to the exact development origin `http://localhost:3000`. A production S3/MinIO
policy must allow the exact HTTPS application origin and method `POST`; do not use `*`
for a private archive deployment.

Before enabling export refresh in production:

- provision a private bucket or Blob store;
- verify cross-archive reads and deletes are rejected;
- configure retention for abandoned staged artifacts;
- verify backups and deletion procedures;
- set package size limits that fit the runtime's memory and request model; and
- keep public source-file delivery separate from private integration artifacts.

## Durable job deployment

Long parsing and apply work is represented by archive-scoped Postgres jobs. The job
store provides idempotent enqueue, exclusive leases, lease expiry and reclamation,
bounded retries, cancellation, renewable lease-token fencing, and redacted public
errors. A parser rechecks its lease immediately before the atomic review commit; a
reclaimed job can finish from that durable checkpoint without parsing twice.

Two deployment shapes use the same queue:

- **Self-hosted:** run a long-lived worker alongside the app and Postgres.
- **Serverless hosted:** invoke the worker on a schedule, process at most
  `KINRESOLVE_WORKER_MAX_JOBS_PER_RUN`, and exit before the platform time limit. The
  current parser does not checkpoint within a package, so each leased job must fit the
  invocation limit.

Worker instances require `DATABASE_URL`, the same object-storage configuration as the
web app, and these controls:

| Variable | Purpose |
| --- | --- |
| `KINRESOLVE_WORKER_ID` | Stable operator-visible identity for lease ownership |
| `KINRESOLVE_WORKER_POLL_INTERVAL_MS` | Delay between empty queue polls for a long-lived worker |
| `KINRESOLVE_WORKER_LEASE_DURATION_MS` | Time before unfinished work can be reclaimed |
| `KINRESOLVE_WORKER_MAX_JOBS_PER_RUN` | Bound for scheduled or one-shot invocation |
| `KINRESOLVE_WORKER_MAINTENANCE_INTERVAL_MS` | Long-running-worker interval for abandoned direct-upload cleanup; default 15 minutes |
| `KINRESOLVE_WORKER_MAINTENANCE_LIMIT` | Maximum upload intents examined per cleanup pass; default 100, maximum 500 |
| `KINRESOLVE_MALWARE_SCANNER` | Scanner provider (`clamd` or `none`); ZIP attachments fail closed when absent |
| `KINRESOLVE_CLAMD_HOST` / `KINRESOLVE_CLAMD_PORT` | Private clamd TCP endpoint used by the worker |
| `KINRESOLVE_MALWARE_SCAN_TIMEOUT_MS` | Strict connection plus whole-file scan timeout |
| `KINRESOLVE_MALWARE_SCAN_MAX_BYTES` | Per-file INSTREAM ceiling; must not exceed clamd `StreamMaxLength` |

The shipped worker claims only `integration_snapshot_parse`, whose handler is registered
in the same build. Raw exceptions may contain paths, credentials, or family details;
only a stable public error code and generic message may be persisted for status readers.

## Feature flags

Flags are server-side rollout controls, not authorization substitutes.

| Variable | Default | Effect |
| --- | --- | --- |
| `KINRESOLVE_EXPORT_REFRESH_ENABLED` | `true` | Enables Ancestry export, Family Tree Maker, RootsMagic, and generic GEDCOM tree refreshes |
| `KINRESOLVE_DESKTOP_MEDIA_ENABLED` | `false` | Requests the FTM/RootsMagic private-media path; ineffective by itself |
| `KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED` | `false` | Independent operator gate confirming the private-media rights language/release was reviewed; both deploy gates and a current per-package acknowledgement are required |
| `KINRESOLVE_MALWARE_SCANNER` | `none` | Set to `clamd` for deployments accepting ZIPs with non-GEDCOM files; otherwise those runs fail closed |
| `KINRESOLVE_ANCESTRY_API_ENABLED` | `false` | Requests the future partner API surface; ineffective without approval |
| `KINRESOLVE_ANCESTRY_PARTNER_APPROVED` | `false` | Records that written partner authorization exists; ineffective without the enable flag |

Both Ancestry variables reserve a future partner capability gate, but no public
`ancestry_api` connection route, OAuth flow, or incremental client ships today. Written
partner approval is an external release gate and must not be inferred from a deployment,
an API key, or a developer's local environment. Writeback remains false for every
provider.

## REST API

Every route below requires the session-derived `imports:manage` permission and scopes
all operations to the session archive.

| Method and route | Behavior |
| --- | --- |
| `GET /api/integrations` | List remembered data sources |
| `POST /api/integrations` | Create a supported data source with server-owned capabilities |
| `DELETE /api/integrations/[id]` | Disconnect a source without deleting imported research |
| `POST /api/integrations/[id]/artifacts` | Stage a private multipart GEDCOM or ZIP package |
| `POST /api/integrations/[id]/artifacts/stage` | Create an expiring one-use direct-upload intent and private upload instructions |
| `POST /api/integrations/[id]/artifacts/complete` | Stream-validate the server-owned object and atomically create/reuse an opaque artifact |
| `GET /api/integrations/[id]/artifacts/[artifactId]/download` | Download a ready original package as a private authenticated attachment |
| `DELETE /api/integrations/[id]/artifacts` | Abandon a staged artifact |
| `GET /api/integrations/[id]/sync-runs` | Read the connection's latest run for browser reload recovery |
| `POST /api/integrations/[id]/sync-runs` | Queue a refresh for a staged artifact |
| `GET /api/integration-runs/[id]` | Read status plus incoming snapshot counts, warnings, and source report when available |
| `DELETE /api/integration-runs/[id]` | Request cancellation |
| `GET /api/integration-runs/[id]/changes` | Read a cursor page of up to 100 proposed changes with optional `query` and `classification` filters plus bounded run-wide summary counts |
| `POST /api/integration-runs/[id]/apply` | Atomically apply reviewed resolutions; requires `Idempotency-Key` |
| `POST /api/integration-runs/[id]/rollback` | Restore the pre-apply backup; requires `Idempotency-Key` |
| `GET /api/integration-media` | Page through private retained-media metadata without object keys |
| `GET /api/integration-media/[id]/download` | Stream an authenticated private attachment with no-store/nosniff headers |
| `PATCH /api/integration-media/[id]` | Record the current ownership attestation while keeping publication and AI use disabled |

The compatibility multipart staging route remains capped at 64 MiB because the
application process validates and buffers that request. The direct stage/complete
protocol avoids request buffering and supports declared packages through 128 MiB.
Neither public artifact response exposes its private object key or SHA-256. The browser
uses this direct protocol for all Data sources uploads and records the current media-rights
acknowledgement before an enabled FTM/RootsMagic ZIP can receive an upload ticket.

The API returns private `404` responses for identifiers outside the archive and generic
server errors that do not include database URLs, credentials, filenames, person
identifiers, or family details. Validation, conflict, unsupported-media, security-scan,
and temporary processing failures use stable `4xx` or `503` responses without exposing
raw parser or storage errors.

## Synthetic-only test policy

All committed fixtures, screenshots, package names, tree names, people, places, stories,
citations, record images, media, DNA values, and error examples must be wholly synthetic.
Never copy a beta participant's export, screenshot, email, family name, tree name, file
path, or record image into the repository, issue tracker, CI artifact, or documentation.

The integration test matrix should cover:

- identical re-uploads and idempotent applies;
- reordered records and changed xrefs;
- unrelated trees with matching xrefs;
- local-only, remote-only, conflict, no-op, and deletion classifications;
- living people, private notes, shared citations, and unknown GEDCOM tags;
- malformed encodings, unsafe ZIPs, executable signatures, and package limits;
- missing, ambiguous, restricted, and explicitly user-owned media;
- cross-archive route, storage, snapshot, job, and rollback access;
- expired leases, retries, cancellation, stale workers, and redacted failures; and
- hosted and S3/MinIO deployment paths.

Database suites must use a disposable `TEST_DATABASE_URL`. Test logs and metrics may
record counts, durations, classifications, and stable error codes, but not genealogical
content or original filenames.

`getIntegrationOperationalMetrics` exposes archive-scoped aggregates for time to
preview, parser failures, no-op refreshes, conflict rate, applies, rollbacks, and repeat
refresh use. Its query never selects names, facts, filenames, external identifiers, or
snapshot metadata.

## Gated Ancestry partner track

Direct Ancestry access is not part of the export-refresh release. The partnership track
starts with a non-confidential business inquiry through [Ancestry Corporate](https://www.ancestry.com/corporate/contact).
Use the repository's [non-confidential partnership overview](ancestry-partnership-overview.md)
as a reviewed draft; submitting it is an explicit business action, not part of deployment.

Before any partner code is enabled, obtain written answers covering:

- API and sandbox access;
- OAuth registration and allowed redirect URIs;
- stable person, tree, citation, and media identifiers;
- read-only scopes, shared-tree permissions, and living-person behavior;
- incremental cursors or webhooks, rate limits, and retention rules;
- revocation, disconnect, and deletion requirements;
- record-image and attribution rights; and
- permission for runtime AI-assisted research without model training.

Only after approval should Kin Resolve add OAuth authorization code flow with PKCE,
one-use archive- and user-bound state, encrypted tokens stored separately from login
accounts, tree selection, revocation, and inbound incremental pulls. Partner changes
must enter the same review pipeline as file exports. Two-way writeback, AncestryDNA,
hints, messages, and a complete account mirror remain out of scope.
