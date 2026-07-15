# Credential rotation and access removal

**Status:** Prelaunch operator runbook. All production changes described here require
the appropriate protected environment/provider owner. This document does not authorize
a live rotation or account deletion.

Kin Resolve has multiple deliberately separate credentials. “Rotate the secrets” is not
one operation: each credential has different consumers, failure modes, and evidence.
Never place an old or new value in a command argument, shell history, issue, log, chat,
workflow input, or this repository.

## Universal rotation procedure

1. Open a private change/incident record with reason, scope, owner, UTC start, affected
   environments, and rollback posture. Use identifiers and digests, not values.
2. Pause invitations. For high-risk runtime credentials, announce maintenance and use
   the protected write fence or static holding path before changing consumers.
3. Inventory every consumer and owner: Vercel runtime, Vercel Cron, protected GitHub
   environments, monitor provider, email provider, Supabase, object store, offsite
   bucket, operator workstation, and recovery custody.
4. Create the replacement at the authoritative provider with least privilege and a
   distinct value. Do not revoke the old credential yet when a safe overlap is supported.
5. Update one bounded environment at a time through its protected control plane. Never
   expose production secrets to preview deployments or cleanup-only environments.
6. Deploy/restart through the protected workflow and verify the exact identity, public
   health, protected health, denial probes, worker schedules, and the capability that
   uses the credential.
7. Revoke the old credential at its source. Independently prove rejection without
   printing it or sending it to an unrelated endpoint.
8. Observe alerts and scheduled work through at least one expected cycle. Run a signed
   test alert if observability changed; run backup/restore proof if backup encryption or
   storage credentials changed.
9. Record provider credential ID, creation/revocation timestamps, environment names,
   verification result, workflow URLs, and evidence digests. Record no secret values.
10. Release the fence/resume service only after independent review. Resume invitations
    as a separate program decision.

If overlap is impossible, use announced maintenance and the attested static holding
deployment. A momentary dual configuration is preferable to an unreviewed direct edit,
but dual secrets must not remain indefinitely.

## Credential-specific rules

| Credential | Consumers | Rotation rule and required proof |
| --- | --- | --- |
| `AUTH_SECRET` | Production application | Single-value change invalidates session cryptography and may sign every participant out. Use maintenance, revoke sessions deliberately, deploy once, prove invite/login/recovery/denial paths, then notify the participant. Never reuse a recovery target secret. |
| `KINRESOLVE_BETA_PRIVACY_HMAC_SECRET` | Invitation, rate-limit, security audit, and data-operation digests | Current code has no key ring. Pause invitations and data operations, close/revoke pending capabilities, and ensure no export/deletion operation needs completion under the old digest before rotation. Treat historical digest-link discontinuity as an explicit audit event. |
| Operator Ed25519 private key and `KINRESOLVE_BETA_OPERATOR_KEY_ID`/public key | Offline operator and production verifier | Private key never enters Vercel or GitHub. Create a new offline pair/key ID, update only the public key/key ID through protected release, prove a signed no-content test request, then destroy/revoke the old private-key copy. The current runtime accepts one key, so use maintenance for emergency replacement. |
| `RESEND_API_KEY` | Production transactional email | Create a sender-scoped replacement, update production, issue only a synthetic invite/recovery email, verify SPF/DKIM/from/reply-to and redaction, then revoke old key. Do not send to a participant as the test. |
| `CRON_SECRET` | Vercel Cron and production cron routes | Update the authoritative scheduler and runtime within one maintenance window. Prove unsigned requests return 401 and both authenticated cron routes run once; then require healthy durable heartbeats. Never reuse as a probe or fence secret. |
| `RELEASE_FENCE_SECRET` | Runtime fence routes and protected release/recovery control | Rotate only while no fence workflow is in flight. Prove no active fence or record the exact active fence control state first. Update runtime and every authorized protected workflow atomically, then perform an identity-bound acquire/assert/release rehearsal on a disposable cell. |
| `KINRESOLVE_OBSERVABILITY_INGEST_SECRET` | Runtime event sender and event provider | Create/update provider receiver, update runtime, run `npm run beta:alert:test`, verify the exact allowlisted event, then revoke old receiver credential. Event delivery is best effort except the test. |
| `KINRESOLVE_OBSERVABILITY_PROBE_SECRET` | Production runtime, monitors, release/recovery smoke | Update runtime and protected monitor/workflow stores in maintenance. Prove an old/invalid probe gets 401 and the new probe gets exact protected health. It must not equal auth, cron, ingest, or fence values. |
| `DATABASE_URL` / migration database credential | Runtime or protected migration/recovery jobs | Runtime and migration credentials must remain distinct. Rotate against the exact database identity and verified TLS endpoint; prove runtime role posture and application smoke. Never give a runtime role DDL/fence-control authority or a cleanup environment source access. |
| `BLOB_READ_WRITE_TOKEN` or `S3_*` | Runtime, workers, protected backup/recovery source capture | Bind the replacement to the exact private store/bucket, update all web/worker consumers together, verify the identity sentinel/provider ID, private read/write/delete on a synthetic key, and both namespace inventory. Never test deletion on a participant object. |
| `SUPABASE_ACCESS_TOKEN` | Source backup-status proof | Keep source-scoped and read-only for the production project. Prove recovery-point read and prove it cannot delete the source. Never reuse the destructive disposable-target token. |
| Vercel token/org/project credentials | Protected deployment/containment workflows | Prefer team/project-scoped tokens. Revalidate exact readable/secret org and project IDs, generated-deployment protection, domain auto-assignment posture, and canonical alias before revoking old access. |
| Backup S3 access key | Protected backup/recovery workflow | Restrict to the immutable backup prefix and required get/put/head operations. Verify encrypted upload/download checksum with synthetic ciphertext, then revoke old key. It must not grant production DB/object access. |
| `RECOVERY_AGE_RECIPIENT` / `RECOVERY_AGE_IDENTITY` | Backup encryption / offline recovery custody | A new recipient protects only new backups. Retain the old identity under controlled custody until every old ciphertext is re-encrypted and verified or has expired. A rotation is incomplete until a disposable restore proves the new identity and old-backup disposition is recorded. |
| GitHub/Vercel/Supabase/provider human accounts | Control planes | Use named accounts, MFA/passkeys, least-privilege roles, and protected reviewers. Remove the person at every provider; rotating application secrets alone does not remove human access. |

## Emergency secret exposure

For a credible exposure, declare the incident before cleanup. Preserve only the source,
timestamp, scope, provider credential ID, and a digest where useful—never the leaked
value. Then:

1. pause invitations and affected writes;
2. revoke sessions or tokens that could have been derived from the exposed secret;
3. disable the affected integration/control path when rapid safe replacement is not
   possible;
4. rotate downstream credentials that the exposed credential could read;
5. inspect provider audit logs privately for use from creation through revocation;
6. assess database, both object namespaces, backup ciphertext, and control-plane access;
7. complete the notification decision in
   [`incident-response.md`](incident-response.md); and
8. prove the replacement and old-value rejection before service resumes.

Do not delete provider audit logs or rotate so broadly that evidence is destroyed before
scope is understood.

## Human access removal

Use this checklist when an operator, contractor, or device no longer needs access. For
involuntary or high-risk removal, prepare replacements first and execute the checklist
in one coordinated window.

- [ ] Remove GitHub organization/repository membership, teams, deploy keys, personal
      access tokens, SSH keys, codespaces, and protected-environment reviewer access.
- [ ] Remove Vercel team/project membership, sessions, CLI tokens, integrations, and
      domain/project administration.
- [ ] Remove Supabase organization/project membership, tokens, database roles, saved
      connection strings, and support grants.
- [ ] Remove object-storage, offsite-bucket, monitor, email, registrar/DNS, status-page,
      password-manager, insurer, and private support-system access.
- [ ] Remove operator private-key copies and replace the runtime operator public key/key
      ID if that person or device had custody.
- [ ] Revoke Better Auth sessions and production participant/operator memberships when
      applicable. Do not delete immutable legal/audit evidence to make access disappear.
- [ ] Rotate every shared secret or recovery key the person could retrieve, including
      local `.env` files and CI environment values.
- [ ] Check backup/age-key custody. Recover or rotate hardware/recovery material, while
      retaining old decryption capability only under approved custody until ciphertext
      expiry/re-encryption.
- [ ] Review provider audit logs from the last known-good access review through removal.
- [ ] Independently verify denial using a new session/device; do not ask the departing
      person to prove their own removal.
- [ ] Record completion, exceptions, follow-up owners, and next access review.

## Periodic access review

Review human and machine access before the first real invitation, monthly during the
pilot, after every incident, and after any role/device change. The review receipt may
contain provider, principal ID or privacy-safe digest, role, justification, last-use
time, reviewer, and decision. It must not contain email addresses in public artifacts,
credential values, recovery codes, database hosts, object paths, or participant data.
