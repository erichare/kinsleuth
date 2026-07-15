# Hosted beta unpublish, containment, and rollback

**Status:** Prelaunch operator runbook. Every canonical-domain, provider-pause, fence,
or production credential action requires the authorized protected environment owner.
This document does not authorize a live change.

Kin Resolve uses a forward-only data model. “Rollback” normally means moving canonical
traffic to the pre-attested zero-runtime holding deployment while preserving the
isolated data cell under a known write posture. It does not mean attaching an older,
schema-incompatible application to production data.

## Containment postures

| Posture | Participant experience | Data posture | Use when |
| --- | --- | --- | --- |
| Invitations paused | Existing participant can continue; no new invitation may be issued/accepted | Normal application writes continue | Intake/support issue with no data-path risk |
| Write-fenced product | Product remains reachable but protected writes and scheduled writers fail closed | Durable fence pauses mutations; reads may remain available | Integrity investigation, backup/recovery operation, controlled drain |
| Static holding deployment | Canonical origin serves a private-beta maintenance page; `/api/health` is 404 | Holding has no runtime, database, object, auth, cron, or environment access | Broken/unsafe candidate, prolonged provider issue, privacy/auth concern, unpublish decision |
| Vercel project paused | Product project is unavailable | Runtime cannot reach data; data providers remain separately intact | Last-resort containment when alias/auto-assignment safety cannot be proven |
| Whole-cell teardown | Product remains unpublished for that participant | Dedicated database/object resources are destroyed under the deletion runbook | Valid final real-pilot deletion only; never incident experimentation |

Unpublishing the app does not delete data, revoke provider credentials, cancel backups,
or complete a participant deletion request. Those are separate operations.

## Decision guide

| Signal | Default action |
| --- | --- |
| Anonymous/cross-archive data access, credential compromise, wrong database/object identity | Declare SEV-0, pause invitations, contain writes, move canonical traffic to holding, rotate/remove access |
| Corruption or migration ambiguity | Declare SEV-1, contain writes, preserve source, compare only through a disposable restore; use holding if reads are not proven safe |
| Broken deployment with healthy unchanged data | Run protected release containment; canonical traffic returns to the attested holding deployment |
| Database/object provider outage | Use holding when requests cannot fail safely or outage persists; do not point at a replacement cell without full identity/recovery proof |
| Observability provider outage only | Disable external event delivery if needed; keep public/protected health; do not unpublish solely because optional telemetry is unavailable unless the launch owner cannot operate safely |
| Transactional email outage | Pause invitations and recovery-dependent onboarding; existing safe product access may remain |
| Missed/failed backup or restore evidence | Pause new real-data ingestion and invitations; preserve current cell; use holding if recovery risk makes continued writes unacceptable |
| Product/program withdrawal | Announce maintenance, pause invitations, export on request, preserve/fence the cell, then follow approved participant deletion/retention steps |

Start at the safer posture when facts are incomplete. The incident commander records
why any less restrictive posture is safe.

## Immediate unpublish sequence

1. Declare the incident/change with UTC time, exact release commit, canonical origin,
   database/object identity digests, owner, and intended serving posture.
2. Pause invitations and revoke outstanding invitation capabilities through the signed
   operator path:

   ```bash
   npm run beta:operator -- control paused incident
   npm run beta:operator -- revoke-all
   ```

3. Revoke participant sessions when account access itself is unsafe. Do not delete the
   participant account or audit/legal evidence as an improvised access-control step.
4. Acquire or preserve the exact protected write fence when writes could worsen the
   incident. Record fence ID, commit, generation, and activation time. Confirm both cron
   routes are fenced or disabled.
5. Revalidate the approved static holding deployment using
   [`static-holding-deployment.md`](static-holding-deployment.md). It must have the
   expected metadata, no runtime functions, no health impersonation, and no application
   credentials.
6. Promote canonical traffic only through the protected holding/release containment
   workflow with the exact production acknowledgement and exact approved deployment ID.
   Do not change DNS, add an alias to an unverified deployment, or use a random previous
   Vercel deployment.
7. Independently poll the canonical origin. Prove it resolves to the exact holding
   deployment, `/login` shows the checked-in maintenance page, `/api/health` is 404,
   generated deployments remain protected, and custom-domain auto-assignment is off.
8. Verify/disable both Vercel cron schedules in the provider dashboard as required by
   the workflow receipt. A holding page has no cron functions, but provider schedule
   posture still needs explicit confirmation.
9. If alias safety cannot be proven, pause and independently re-read the exact Vercel
   project through the containment workflow. Treat a failed containment workflow as an
   active SEV-1 until repaired.
10. Update the participant and public wording using the templates below. Preserve the
    support/security mail routes; do not disturb mail DNS while changing web serving.

The automatic release-containment and holding-safety workflows repair runner-loss
outcomes with control-plane-only credentials. Review their receipt before taking a
second manual action; concurrent alias or pause changes make evidence ambiguous.

## Roll-forward versus rollback

- Never connect legacy `v0.17.4` or any pre-fence schema application to the pilot cell.
- Never run down migrations or restore an old database over the current source to make
  an older binary boot.
- The first production cutover has one approved rollback target: the attested static
  holding deployment.
- A later product-to-product rollback is allowed only when release policy, migration
  ledger, runtime role, object contract, and protected smoke explicitly prove backward
  compatibility. In the absence of that proof, use holding and roll forward.
- Prepare a fix on a new candidate, run the full protected recovery/release gates, and
  promote it through the normal workflow. Do not repair the production deployment or
  database interactively.

## Public and participant wording

When the hosted product is unpublished, marketing must return to the prelaunch truth:

> Private beta applications are open. Hosted access is rolling out in small invitation
> cohorts.

Do not say the hosted beta is live, currently available, or accepting participant data
while canonical traffic is on holding. Remove or disable API availability claims if the
API origin is unavailable.

Participant maintenance update:

```text
Kin Resolve private beta is temporarily unavailable while we verify the safety of the
hosted service. Your access has been paused; please do not send family records or files
by email. We will provide the next private update by <UTC time or condition>.

Private support: support@kinresolve.com
```

For a security/privacy incident, use the reviewed incident template rather than this
generic maintenance wording.

## Republish gates

Canonical product traffic may resume only when all relevant boxes are checked:

- [ ] Incident/change owner and independent reviewer approve the exact candidate and
      serving posture.
- [ ] Candidate commit is current protected `main` and has full required CI.
- [ ] Recovery evidence is fresh, attested, identity-bound, and accepted by the release
      workflow.
- [ ] Database migration ledger, runtime role, dataset mode, capability manifest,
      database identity, object identity, and provider store ID match protected values.
- [ ] Public health, protected health, login, app redirect, anonymous API denial,
      unsigned cron denial, and security headers pass.
- [ ] All three worker heartbeats are healthy after scheduled writers are reconciled.
- [ ] Relevant disposable/staging browser and API journeys pass with synthetic data.
- [ ] Affected credentials/access grants are rotated or removed and the old paths are
      denied.
- [ ] Observability alerts deliver; a signed test alert is observed if that path changed.
- [ ] Canonical alias and domain auto-assignment are independently verified after
      promotion.
- [ ] Participant, counsel, and public-status decisions are recorded.

Release the fence only through the protected workflow after these proofs. Resume
invitations later through a separate signed operator decision; successful republish does
not automatically resume cohort intake.
