# Research export, deletion, and isolated-cell teardown

**Status:** Prelaunch privacy operations contract. Self-service structured export,
deletion-request recording, and the demo-only purge are implemented.
Complete real-pilot purge/provider teardown, backup-expiry proof, counsel-approved
retention, and a rehearsed deletion deadline remain launch gates. A request is not a
completed deletion.

This runbook is for the cohort-one isolated real pilot. It does not establish legal
compliance or a deletion deadline. The approved privacy notice, terms, processor terms,
and counsel decision control when they differ from this engineering proposal.

## Owner-facing data portability

Only a current archive owner has `archive:data-portability`. The owner uses two
different exports because they serve different purposes:

1. **GEDCOM export** is the portable family-tree representation.
2. **Structured research archive** is a JSON bundle for Kin Resolve-specific research
   context that GEDCOM does not represent.

`POST /api/exports/research-archive` creates a durable `research-export` operation,
builds the bundle, returns it as a private no-store attachment, and includes its SHA-256
in `x-content-sha256`. Successful completion stores only the operation identity,
participant HMAC digest, request UUID, timestamps, and manifest digest in
`beta_data_operations`; failure stores a fixed code, never exception text.

The structured bundle includes:

- the requesting participant's account/membership metadata;
- exact accepted beta legal document versions, URLs, hashes, method, and timestamps;
- archive name/tagline/version and research workspace data;
- people, sources, raw GEDCOM records, imports, backups, DNA rows if any, cases,
  evidence, hypotheses, tasks, and AI-run metadata with raw errors removed; and
- integration connection, artifact, snapshot, sync-run/change, and private-media
  metadata.

It excludes:

- passwords, provider credentials, sessions, cookies, and bearer capabilities;
- IP addresses, user agents, operator nonces, and durable rate-limit keys;
- database/object provider identities, object keys, and Blob URLs;
- worker leases and idempotency secrets; and
- object bytes. Cohort one disables binary/media ingestion; if that boundary changes,
  deletion must be blocked until an approved object-byte export exists.

The JSON bundle contains private family research and participant email. The owner should
download it over the authenticated app and store it privately. Support must not attach it
to ordinary email, upload it to a public issue, or retain an unencrypted copy.

## Deletion request intake

The owner types this exact confirmation in Settings:

```text
REQUEST DELETION REVIEW
```

`POST /api/data-operations/deletion-request` validates a bounded JSON body and creates a
durable `deletion-request` operation. It returns HTTP 202 and tells the owner that support
will verify export and whole-cell deletion. It does not delete rows, objects, accounts,
backups, deployments, or provider resources. The durable operation record is immutable
after a terminal transition and cannot be deleted while the cell exists.

Support must:

1. acknowledge through the participant's verified private contact route;
2. verify the request with an authenticated current owner without asking for a password,
   token, GEDCOM, or private records;
3. record the request ID/operation ID, UTC time, legal policy version, requested scope,
   export preference, and desired access cutoff in a private case;
4. pause new invitations for the cell and prevent any cohort expansion;
5. explain that final teardown is irreversible and retained provider/offsite backups
   expire on their actual lifecycle rather than disappearing immediately; and
6. obtain owner/counsel approval for any required non-content legal receipt retention.

Never promise immediate erasure from retained backups. Never mark the request complete
because the app is unpublished or the participant is locked out.

## Retention state and current gaps

The hosted daily cleanup currently performs bounded cleanup for expired invitation
capabilities, expired email-verification capabilities, expired durable auth-rate-limit
buckets, and expired operator nonces. Direct GEDCOM staging older than 24 hours and
expired integration upload/media claims have their own bounded cleanup paths.

The current cleanup does not implement a counsel-approved lifecycle for append-only beta
audit rows, legal acceptance, security events, data-operation evidence, provider logs, or
encrypted backups. The proposed 14-day operational-event, 90-day non-content audit, and
30-day post-primary-deletion backup limits remain unapproved/unverified. Do not publish
them as promises until provider lifecycle configuration and expiry rehearsal prove them.

## Deletion preconditions

No real-pilot deletion may begin until every precondition is true:

- The cell is contractually and physically isolated: one participant/household,
  deployment, database project, object store, archive ID, and secret set.
- Database identity, Supabase project ref, object-store identity, physical provider
  store ID, Vercel project/deployment, and canonical origin match the private deletion
  case. Use digests/IDs, not connection strings or tokens, in the case record.
- The owner has had a reasonable opportunity to download fresh GEDCOM and structured
  research exports, or has explicitly declined each.
- A recent successful encrypted backup evidence ID matches the exact cell and release.
  This is an irreversible-operation safeguard, not a reason to retain the backup beyond
  approved expiry.
- The write fence is active and exact-ID verified; invitations/sessions are revoked;
  scheduled writers are fenced/disabled; active job leases, unexpired upload intents,
  and pre-fence straggler transactions are zero.
- A complete dry-run inventory covers the database and every object under both
  `gedcom-imports/<archive>/` and `archives/<archive>/`, with the identity sentinel
  distinguished from participant objects.
- The dry-run produces a private detailed manifest and a privacy-safe inventory digest.
- The owner, operations lead, and independent reviewer approve the inventory digest,
  recent backup ID, target provider identities, retained-backup treatment, and final
  irreversible step.
- Counsel/owner have decided which non-content request/legal receipt, if any, must remain
  outside the destroyed cell and for how long.

If any identity, inventory, fence, backup, lease, or authority is ambiguous, stop. Do not
substitute a row count, database name, object prefix, or operator memory for an attested
physical identity.

## Two-step confirmation contract

The final purge/teardown tooling must require two separate confirmations:

1. **Inventory confirmation:** approve the exact dry-run manifest digest, source release,
   cell identities, object counts/sizes by namespace, and recent backup evidence ID.
2. **Destructive confirmation:** after re-reading all identities and proving the
   inventory has not changed, type the one-time command-generated phrase bound to that
   digest and those physical provider resources.

A hard-coded generic phrase is not sufficient for final deletion. The destructive
confirmation expires on any fence generation, release, database/object identity,
inventory, backup, or provider-state change. Do not manually fabricate a confirmation
while complete real-pilot teardown tooling remains unimplemented.

## Authoritative real-pilot whole-cell teardown

For real pilot data, row-by-row application deletion is not the authoritative finish.
The dedicated cell itself must be destroyed:

1. Freeze the approved case record and privacy-safe inventory digest.
2. Confirm optional exports completed/declined and the owner understands final
   irreversibility and retained-backup expiry.
3. Revalidate the exact fence and zero-work conditions immediately before destruction.
4. Purge every participant object under both archive prefixes, using paginated provider
   listing and bounded deletes. Re-list until both prefixes contain no participant
   objects. Keep the identity sentinel only long enough to authorize/verify target
   cleanup.
5. Purge mutable archive-scoped application data and credentials only through the
   idempotent, audited deletion primitive. It must cover workspace rows, integrations,
   durable jobs, upload/token capabilities, sessions, and other mutable security state.
   It must inventory—but must not weaken triggers or referential restrictions protecting—
   append-only legal, invitation-audit, and data-operation evidence. Those protected rows,
   memberships/accounts they restrict, and the audit record remain until whole-database
   destruction. If the primitive fails or is not available, do not improvise SQL;
   proceed only under the reviewed whole-resource destruction path.
6. Remove the product deployment's access to the cell and rotate/revoke cell-specific
   database, object, auth, email, cron, fence, observability, and operator credentials.
7. Destroy the exact dedicated object-storage resource after its identity and empty
   participant prefixes are proven. A shared store is outside the admitted real-pilot
   architecture and blocks this procedure.
8. Destroy the exact dedicated database project with a target-scoped provider token.
   Validate the provider response identity and poll until the project is unavailable.
9. Remove/unpublish the participant deployment and canonical mapping without disturbing
   support/security mail DNS.
10. Write a privacy-safe off-cell completion receipt containing request/operation digest,
    timestamps, release and evidence digests, destroyed provider resource IDs/digests,
    both-prefix empty proof, approvers, and backup-expiry schedule. Include no family
    content, email, object path, raw archive ID, token, host, or provider response.
11. Mark every retained provider and encrypted offsite backup with its actual expiration
    or approved deletion action. Verify expiry from an independent provider read and
    update the receipt. Primary deletion completion and final backup expiry are distinct
    timestamps.
12. Notify the owner with confirmed facts, remaining backup expiry dates, support route,
    and the final verification date. Emit a privacy-safe `deletion_completed` event only
    when the implemented operation can do so without depending on the already destroyed
    cell.

Destruction has no rollback after the final confirmation. A backup is available only for
the approved recovery/retention window and must not be restored after a valid deletion
except under explicit owner/counsel authority recorded in the case.

## Synthetic demo purge is a different operation

The demo purge is an in-place, identity-bound reset primitive for the resettable
synthetic cell. It refuses unless both configured and persisted dataset mode are exactly
`demo`, the database contains exactly the expected archive, the database/object/physical
provider identities and release commit match, and the supplied encrypted backup receipt
is strict schema version 3, belongs to that exact cell, matches the exact product rows
and object manifests being removed, proves exact-version offsite round-trip plus Object
Lock `COMPLIANCE` retention, and completed within the last 24 hours. Both ciphertext
versions must remain retained for at least the fixed 24-hour recovery window when new
destructive work begins. Older evidence is accepted only to resume the exact durable
receipt and fence generation whose inventory proved the evidence was fresh; it cannot
authorize a new purge. Schema versions 1 and 2 are never accepted for destructive work.
The purge can never target a `pilot` or unknown dataset mode.

The inventory step requires paused invitations; zero pending invitation/email or OAuth
bearer capabilities; zero active job leases, unexpired upload intents, other active
release fences, and pre-existing client transactions; and sufficient visibility to make
those assertions. It hashes every classified product, mutable security-capability, and
preserved table plus every object under both private archive namespaces. Object
pathnames appear only as digests in the private inventory. The inventory expires after
15 minutes.

Run it only from an approved private operator environment with the exact source
credentials/identities; never place a credential on the command line:

- `KINRESOLVE_DATASET_MODE=demo`;
- sensitive `DEMO_PURGE_DATABASE_URL` using verified TLS/direct PostgreSQL, never the
  transaction pooler;
- sensitive `DEMO_PURGE_BLOB_READ_WRITE_TOKEN` for the exact private Blob store;
- `EXPECTED_ARCHIVE_ID`, `EXPECTED_DATABASE_IDENTITY`,
  `EXPECTED_OBJECT_STORAGE_IDENTITY`, and
  `EXPECTED_OBJECT_STORAGE_PROVIDER_ID`; and
- the exact 40-character `RELEASE_COMMIT` represented by the backup receipt; and
- `DEMO_PURGE_APPROVED_BACKUP_EVIDENCE_SHA256`, the lowercase SHA-256 of the exact raw
  evidence file independently approved below.

The purge operator must not self-authorize the backup artifact. A separate reviewer
downloads the exact run/attempt artifact, verifies its GitHub attestation against the
protected repository, signer workflow, and `main` source ref, then hashes the bytes:

```bash
gh run download "$BACKUP_RUN_ID" \
  --name "production-backup-evidence-${BACKUP_RUN_ID}-${BACKUP_RUN_ATTEMPT}" \
  --dir approved-backup
gh attestation verify approved-backup/production-backup-evidence.json \
  --repo OWNER/REPOSITORY \
  --signer-workflow OWNER/REPOSITORY/.github/workflows/production-backup.yml \
  --source-ref refs/heads/main
shasum -a 256 approved-backup/production-backup-evidence.json
```

The reviewer records that exact digest in the protected operator environment without
editing or reserializing the JSON. The CLI hashes the raw file before JSON parsing and
fails closed unless the bytes match. Successful JSON validation alone is not approval.

```bash
npm run demo:purge -- inventory <backup-evidence.json> <inventory.json>
```

Review the private inventory, backup digest, table/object totals, both namespace
manifests, identities, release, and expiry. Execution then requires both exact
environment confirmations:

```text
DEMO_PURGE_CONFIRM_DATASET_MODE=demo
DEMO_PURGE_CONFIRMATION=PURGE-DEMO:<archiveDigest>:<inventoryDigest>
```

With those values present in the protected environment, execute:

```bash
npm run demo:purge -- execute <backup-evidence.json> <inventory.json> <receipt.json>
```

For a fresh transition, execution revalidates the backup and unexpired inventory,
acquires an inventory-derived release fence, writes and fsyncs an exact pending receipt,
drains admitted writes for six minutes, proves zero work/stragglers again, and verifies
the table/object manifests did not change. It then deletes classified demo product rows
plus all isolated-cell session, Better Auth verification, rate-bucket, and
operator-nonce rows in one table-locked transaction, and deletes only the exact
inventoried objects from both namespaces. It re-inventories to prove zero mutable
product/capability rows and zero participant objects and verifies the preserved
manifests are unchanged. Before releasing the fence it atomically replaces the pending
receipt with a generation-bound, verified-empty pre-release receipt; only then does it
release the exact fence and atomically write the privacy-safe final receipt.

The deterministic database fence plus pending/pre-release receipt is the recovery
authority after a crash. A rerun accepts an expired inventory only when that exact
durable fence or inventory-bound receipt already exists. It resumes only from an exact
pre-delete state or from an all-database-rows-empty state whose remaining objects are a
strict subset of the confirmed inventory. A pre-release receipt can finalize only
against the same activation generation and a release timestamp after empty-state
verification. A final receipt is idempotent only while the cell remains empty and the
database fence still matches. Missing, conflicting, expanded, or corrupted state fails
closed.

The purge preserves the archive/account/membership identity perimeter, password
credential record, terminal invitation/legal/audit evidence, beta operation/heartbeat
rows, invitation control, and the object-store release-readiness sentinel. Pending
invitation/email capabilities or OAuth account tokens block inventory; sessions,
recovery verifications, rate buckets, and accepted operator nonces are purged. It does
not reprovision the Hartwell–Mercer fixture; deterministic demo provisioning is a separate next action after the
receipt is reviewed. If failure occurs after destructive work begins, treat the exact
purge fence and receipt/inventory as recovery evidence; do not release the fence, create
a new inventory, or improvise deletes until the operator recovery path has reconciled
both data planes.

Never invoke this command against real pilot data, adapt its environment checks, or use
workspace-only provisioning as deletion. The authoritative real-pilot operation remains
whole-cell teardown.

## Verification checklist

- [ ] Auth/session, membership, invitation/recovery, and operator capabilities denied.
- [ ] Database project unavailable from both admin and runtime paths.
- [ ] Object provider resource unavailable; before destruction both archive prefixes
      were independently proven empty.
- [ ] Vercel deployment/canonical route no longer reaches the participant cell.
- [ ] Cron schedules disabled and old cron/fence/probe credentials denied.
- [ ] Offsite/provider backups have exact recorded expiry/deletion actions.
- [ ] Operational/event provider holds no disallowed payload fields.
- [ ] Only the approved privacy-safe completion receipt remains outside expiring backups.
- [ ] Participant update and counsel/owner decision recorded.
- [ ] Final backup expiry is independently rechecked on its scheduled date.

## Private operation record template

```text
Request operation ID/digest:
Request received / identity verified (UTC):
Policy/legal decision and approver:
GEDCOM export: completed / declined; digest and UTC:
Research archive export: completed / declined; digest and UTC:
Cell database identity digest / provider project ID:
Cell object identity digest / provider store ID:
Cell deployment ID / release commit:
Recent backup evidence ID/digest and completedAt:
Write fence ID/generation/activatedAt:
Zero leases/intents/stragglers proof:
Dry-run manifest digest:
Inventory confirmation approvers / UTC:
Destructive confirmation approvers / UTC:
Both participant object prefixes empty proof / UTC:
Object resource destruction proof / UTC:
Database project destruction proof / UTC:
Deployment/access/credential removal proof / UTC:
Primary deletion completedAt:
Provider backup expiry expected / verifiedAt:
Offsite backup expiry expected / verifiedAt:
Non-content receipt retention decision:
Participant notifiedAt:
Exceptions/incidents:
Independent reviewer closure / UTC:
```
