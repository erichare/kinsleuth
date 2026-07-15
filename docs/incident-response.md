# Hosted beta incident response

**Status:** Prelaunch operating procedure. The private escalation channel, current
phone tree, counsel contact, provider account owners, and participant contact must be
recorded in the private operations vault before real data is admitted. They do not
belong in this repository.

This procedure covers availability, authorization, privacy, data integrity, backup,
secret exposure, and release incidents for the isolated hosted beta cell. Safety takes
priority over uptime; cohort one has no uptime SLA.

## Roles and contact routes

Assign these roles at declaration. One person may hold more than one role for a small
beta, but the incident commander and independent reviewer must be different for a
SEV-0/SEV-1 closure.

| Role | Responsibility | Repository-safe contact |
| --- | --- | --- |
| Incident commander | Own severity, containment, decisions, and closure | Current launch owner in the private operations vault |
| Operations lead | Executes protected workflows and provider controls | Current GitHub environment/Vercel/Supabase owner |
| Privacy/security lead | Determines data classes, exposure, notification, and evidence handling | `security@kinresolve.com` |
| Participant liaison | Sends approved private participant updates | `support@kinresolve.com` |
| Beta/program owner | Pauses cohort activity and public claims | `beta@kinresolve.com` |
| Scribe | Maintains UTC timeline, decisions, and evidence digests | Private incident record only |

Never ask a participant to email family records, GEDCOM files, credentials, screenshots
containing private research, or token-bearing URLs. Use a separately approved private
transfer route when evidence bytes are truly necessary.

## Severity table

| Severity | Definition | Examples | Initial action target |
| --- | --- | --- | --- |
| **SEV-0 — Critical** | Confirmed or actively credible unauthorized disclosure/destruction, cross-cell access, control-plane compromise, or secret use with production access | Participant data returned anonymously; cross-archive read/write; active exfiltration; production DB/object/backup credential used by an unauthorized actor; destructive corruption or cell deletion | Declare immediately; contain before diagnosis; pause invitations and real-data use |
| **SEV-1 — High** | Serious privacy, authorization, integrity, recovery, or full-service risk without confirmed active exfiltration | Suspected secret exposure; persistent product outage; wrong database/object identity; failed/missed backup; restore or target-cleanup failure; stale critical worker; migration/fence ambiguity; loss or corruption signal | Declare promptly; pause affected writes and new invitations; owner engaged |
| **SEV-2 — Moderate** | Material partial degradation with a bounded safe workaround and no evidence of privacy/integrity loss | Transactional email failure; one recovered worker failure; export unavailable; monitor warning; noncritical provider degradation | Open private incident, assign owner, correct before cohort expansion |
| **SEV-3 — Low** | Low-impact defect or support issue with no data/security risk | Cosmetic defect, confusing copy, isolated retryable participant issue | Track in normal private support/engineering queue |

Any SEV-0/SEV-1 privacy, authorization, corruption, data-loss, secret-exposure, or
cross-archive signal immediately pauses invitations and real-data ingestion. Start at
the higher severity when evidence is incomplete; downgrade only with recorded proof.

## First 15 minutes

1. **Declare.** Create a private incident ID, UTC start, initial severity, commander,
   scribe, affected cell/release, and one-sentence impact statement. Do not include an
   archive ID, email, name, object path, record content, or credential in the title.
2. **Preserve safe evidence.** Record workflow URLs, provider event IDs, Git commit,
   request IDs, timestamps, fixed error codes, and SHA-256 digests. Do not copy raw
   database rows, objects, headers, cookies, URLs, or provider response bodies into the
   incident record.
3. **Pause acquisition.** Use the signed operator control to pause invitations and
   revoke outstanding invitations when the identity perimeter may be involved:

   ```bash
   npm run beta:operator -- control paused incident
   npm run beta:operator -- revoke-all
   ```

4. **Contain writes when warranted.** Use the protected, identity-bound release-fence
   control path. Do not run ad hoc production SQL or reuse the cron secret. Record the
   exact fence ID, release commit, activation generation, and timestamp.
5. **Choose the serving posture.** Keep a proven read-only product online only when it
   cannot worsen the incident. Otherwise promote the attested static holding deployment
   or pause the exact Vercel project according to
   [`unpublish-and-rollback.md`](unpublish-and-rollback.md).
6. **Revoke access.** For a credential or operator compromise, follow
   [`credential-rotation-and-access-removal.md`](credential-rotation-and-access-removal.md).
   Revoke the old credential only after the replacement/containment path is proven,
   unless continued access is the greater danger.
7. **Establish facts.** Identify the earliest and latest possible exposure, affected
   data class, affected processor/provider, whether data was read/changed/deleted, and
   whether backups or audit evidence are trustworthy.

Do not release a write fence, resume cron, re-enable invitations, restore from backup,
delete objects, destroy a provider resource, or change DNS merely to test a theory.
Those are separate approved actions with identity checks.

## Investigation and containment checklist

- [ ] Exact production release and canonical deployment identified.
- [ ] Database identity, object-store identity, and provider store ID independently
      matched protected configuration.
- [ ] Public and protected health checked without copying protected bodies publicly.
- [ ] Relevant request IDs/event names/fixed codes collected; event payload redaction
      revalidated.
- [ ] Invitation state, sessions, operator key, cron, fence, observability, database,
      object, email, Vercel, GitHub, Supabase, and offsite-backup credentials assessed.
- [ ] Both object prefixes considered; a database-only assessment is incomplete.
- [ ] Durable job lag/recent failures, active leases, upload intents, and worker
      heartbeat state assessed.
- [ ] Last known-good encrypted backup and last successful restore evidence identified.
- [ ] Provider logs retained privately under their approved retention policy.
- [ ] Scope and participant impact recorded as facts, unknowns, and assumptions.
- [ ] Containment actions independently verified from a second control surface.

For suspected corruption, preserve the current cell under a write fence and restore a
known-good backup only into a clean disposable target for comparison. Never overwrite
the source during investigation.

## Participant and external notification decision

The incident commander and privacy/security lead record a decision even when the
decision is “no notification yet.” Consult counsel for any event involving personal
data, account access, backup material, genetic data, or a processor breach. Engineering
does not make legal compliance claims or invent statutory deadlines.

The decision record must include:

- confirmed and possible data classes;
- number of cells/participants, stated as a bounded count rather than identities;
- exposure, alteration, loss, and availability status;
- jurisdictions and approved legal/contractual deadline source;
- containment completed and residual risk;
- whether law enforcement, insurer, processor, regulator, or participant notice is
  advised by the authorized owner/counsel;
- approver and UTC time; and
- next reassessment time if facts remain incomplete.

Participant updates use plain impact language, do not speculate, do not include other
participants, and do not promise recovery or deletion times that have not been observed.

## Recovery and closure gates

SEV-0/SEV-1 service may resume only when:

1. the incident commander documents the root failure or the bounded residual unknown;
2. database/object/deployment identities are independently verified;
3. affected credentials and access grants are rotated or removed;
4. the candidate passes protected health, denial probes, heartbeat/job-lag checks, and
   the relevant synthetic journey;
5. backup integrity and restore evidence remain trustworthy, or a new protected backup
   and rehearsal have completed;
6. both object namespaces and durable work state are reconciled;
7. alerts are delivering, including an owner-observed test when the telemetry path
   changed;
8. participant/processor/legal notification decisions are recorded;
9. the independent reviewer approves fence release and serving posture; and
10. invitations remain paused until the program owner separately resumes them.

Close the operational incident only after follow-up owners and dates exist. Publish a
privacy-safe postmortem only after privacy/security review.

## Incident declaration template

```text
Incident ID: KR-YYYYMMDD-NN
Declared at (UTC):
Declared by:
Severity: SEV-0 / SEV-1 / SEV-2 / SEV-3
Incident commander:
Scribe:
Affected environment/cell digest:
Affected release commit:
Current serving posture: product / write-fenced / holding / project-paused
Impact statement (no private data):
Known start / detection time:
Signals and privacy-safe evidence IDs:
Known facts:
Unknowns:
Immediate containment owner and action:
Next update at (UTC):
```

## Participant/status update template

```text
Kin Resolve private beta incident update — <UTC timestamp>

Status: Investigating / Contained / Monitoring / Resolved
Impact: <what the participant cannot do or what risk is being investigated>
Started: <known time or "under investigation">
What we have done: <plain-language containment actions>
What you should do: <none, or one specific action>
Data/privacy statement: <confirmed facts only; no speculation>
Next update: <UTC timestamp or condition>
Private support: support@kinresolve.com
```

For a public status page, remove the email address if it would invite private evidence
submission and omit every internal identifier.

## Postmortem template

```markdown
# KR-YYYYMMDD-NN — <privacy-safe title>

## Summary

- Severity:
- UTC start / detection / containment / recovery / closure:
- Participant-visible duration:
- Affected capability and bounded scope:
- Data confidentiality / integrity / availability result:

## Impact

State verified impact separately from plausible-but-unconfirmed impact.

## Detection

Which monitor/person detected it? Which expected control did or did not fire?

## Timeline

UTC timestamps and privacy-safe actions/decisions only.

## Root cause and contributing conditions

Technical cause, process cause, and why existing controls did not prevent it.

## Response assessment

What helped, what delayed containment, and where authority/ownership was unclear.

## Data and notification decision

Data classes, bounded scope, counsel/owner decision, processor/participant actions,
and retained-backup implications. Do not include private records or legal advice.

## Recovery proof

Release/evidence digests, health/canary result, credential rotations, both-prefix
verification, and independent reviewer approval.

## Corrective actions

| Action | Owner | Due date | Verification | Status |
| --- | --- | --- | --- | --- |

## Public follow-up

Approved privacy-safe wording, approver, publication location, and date—or reason no
public report is appropriate for the private cohort.
```
