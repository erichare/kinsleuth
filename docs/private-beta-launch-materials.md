# Private-beta launch materials

- **Status:** Prelaunch copy and production brief; not authorization to claim launch
- **Updated:** 2026-07-20
- **Product boundary:** [`hosted-beta-contract.md`](hosted-beta-contract.md)
- **Legal handoff:** [`private-beta-legal-handoff.md`](private-beta-legal-handoff.md)
- **Demo launch:** [`public-demo-launch-materials.md`](public-demo-launch-materials.md)

This package gives marketing, product, and operations one claim set for applications,
launch, maintenance, and incident states. All media must use the fictional
Hartwell–Mercer archive. Text in a **launch-only** block stays unpublished until the
canonical product, legal, recovery, deletion, support, security, API, and canary gates
have recorded evidence.

## Current prelaunch message

Use these two sentences together:

> Private beta applications are open. Invitations have not started; hosted access
> begins only after the launch gates pass.

Supporting line:

> Apply with contact and workflow information only. Do not send GEDCOM files, DNA data,
> source images, credentials, or private family details.

Do not shorten the status to “the beta is open,” “access is rolling out,” “join the
beta,” or “try the API.” Those phrases imply hosted availability that has not been
proved.

## Message hierarchy

1. **Promise:** A private workspace for resolving family-history questions with
   evidence.
2. **Difference:** Review changes before they enter the archive; keep the question,
   evidence, competing hypotheses, and next action together.
3. **Control:** Start synthetic, keep excluded capabilities off, export the archive, and
   make publication a deliberate decision.
4. **Proof:** Demonstrate import preview/apply/rollback, cases, deterministic checks,
   token revocation, GEDCOM export, and recovery/deletion evidence.
5. **Invitation:** Apply without private records; participation remains small,
   founder-operated, and gated.

## Homepage and product copy

### Hero

Once the public demo is live, the homepage hero is demo-first; the approved demo message
set lives in [`public-demo-launch-materials.md`](public-demo-launch-materials.md).

**Headline**

> Resolve the questions your family tree cannot answer.

**Body**

> Kin Resolve keeps records, sources, research cases, competing hypotheses, and next
> steps together in one private genealogy workspace—so uncertainty stays visible until
> the evidence earns a conclusion.

**Primary action (after the demo-live flip):** Solve the passenger mystery (links to the public demo)

**Primary support line:** No signup · about 2 minutes · every record is fictional.

**Secondary action (after the demo-live flip):** Apply for the private beta

**Status note:** Use the exact current prelaunch message above. Before the demo-live flip,
keep the generic product call to action (Try Kin Resolve) primary and the beta application
secondary; the demo-first hero requires the public-demo runbook gates to pass.

### Six-part product tour

| Step | Headline | Proof to show | Required qualifier |
| --- | --- | --- | --- |
| 1 | Import without flattening the record | Synthetic GEDCOM preview and bounded change counts | Source capability; hosted plain-GEDCOM limit is 10 MiB/40,000 people |
| 2 | Work a question, not just a person | Case question, evidence, hypotheses, confidence, task | Fictional records only |
| 3 | Keep sources close to conclusions | Source transcript and linked case/person | Cohort one is text/transcript-only; no binary media |
| 4 | Check structure without sending data to AI | Deterministic date/privacy report | External-provider AI disabled in hosted cohort |
| 5 | Review before sharing | Publication-readiness blockers | Real-data public publishing disabled |
| 6 | Leave with your archive | GEDCOM export plus structured research export explanation | Deletion request is not completed deletion |

The API preview can appear as a seventh developer proof only after the API launch gate
passes. Before then, show documentation as a source preview and say it is unavailable on
the hosted origin.

## Application copy

**Invitation to apply**

> Bring an unresolved research workflow—not the records themselves. We are looking for
> family historians and genealogists willing to test how Kin Resolve handles GEDCOM
> review, sources, cases, uncertainty, and export.

**Application boundary — default mail fallback**

> The form opens your email client. The marketing site stores nothing. Your message is
> handled by your email provider, Kin Resolve mail routing, and the receiving beta
> mailbox. Applying consents only to beta communications; it does not create an account
> or accept participation terms.

**Application boundary — only after the native endpoint launch gate passes**

> The no-JavaScript form sends only the fixed contact, researcher, workflow,
> archive-size, optional tool, and consent fields to the Kin Resolve product service.
> It accepts no free text or files and stores no network address, user agent, or family
> data. Every application record is deleted within 90 days. A receipt is sent by email.
> Applying does not create an account, guarantee access, or accept participation terms.

**Proposed pilot summary**

- invitation-only, proposed free 30-day pilot, no billing;
- synthetic data first;
- one isolated real plain-GEDCOM pilot only after every real-data gate;
- plain `.ged`/`.gedcom`, up to 10 MiB and 40,000 people;
- founder-operated onboarding, export, deletion, and support;
- one-business-day support acknowledgement target, not an SLA; and
- DNA, external AI, binary media, real-data public publishing, open signup, and shared
  multi-family hosting disabled.

## Email templates

These templates contain no family data and ask for none. Transactional templates must
be sent only through the approved provider and exact canonical product origin.

### Application acknowledgement

**Subject:** Kin Resolve private beta application received

> Thanks for telling us about the research workflow you would like to test. This message
> confirms receipt only; it does not create an account or guarantee an invitation.
>
> Please do not reply with GEDCOM files, record images, DNA information, names of living
> people, credentials, or private family details. If the proposed cohort is a fit and
> capacity is available, we will send a separate invitation with the exact participation
> terms, privacy notice, and cohort boundary to review before account creation.

### Waitlist or capacity hold

**Subject:** Kin Resolve private beta application update

> We are keeping the first cohort deliberately small and do not have an invitation for
> you now. We will retain your application only under the approved application-retention
> policy and contact you if a suitable place becomes available. You may ask us to remove
> the application by replying without including family records or private evidence.

Do not send this template until its retention sentence matches an approved, enforced
mailbox policy.

### Invitation — launch-only

**Subject:** Your Kin Resolve private beta invitation

> You have been selected for the invitation-only Kin Resolve private beta. This
> single-use invitation expires at the time shown on the acceptance page and is bound to
> this email address and one archive role.
>
> Before an account is created, you will review and explicitly accept the exact private-
> beta participation terms, privacy notice, and cohort boundary. Start with the fictional
> Hartwell–Mercer demo. Do not upload real family data until your onboarding message
> explicitly confirms that the real-data gates for your isolated pilot have passed.
>
> Never forward this invitation or send credentials, records, GEDCOM files, or DNA data
> by email.

The product supplies the canonical, token-bearing invite link. Marketing copy never
constructs or logs it.

### Maintenance

**Subject:** Kin Resolve private beta maintenance

> Kin Resolve private beta is temporarily unavailable while we verify the safety of the
> hosted service. Your access has been paused; please do not send family records or files
> by email. We will provide the next private update by <UTC time or condition>.
>
> Private support: support@kinresolve.com

### End of pilot and export

**Subject:** Kin Resolve private beta pilot ending — export and deletion choices

> Your pilot access is scheduled to end on <date and UTC time>. Before access changes,
> you may download a fresh GEDCOM export and a structured Kin Resolve research export,
> or explicitly decline each.
>
> Access cutoff is not deletion. If you request deletion, support will verify the request
> and the exact isolated cell, then provide separate confirmation of primary teardown and
> retained-backup expiry under the approved terms. Do not send archive files, tokens, or
> screenshots by email.

### Security or privacy incident

Do not improvise from marketing copy. Use the reviewed severity-specific participant
template in [`incident-response.md`](incident-response.md), with counsel/owner decisions
and confirmed facts only.

## Screenshot and demo brief

Every screenshot must visibly belong to the fictional Hartwell–Mercer universe. Before
capture, scan the database, browser storage, filename, URL, terminal, notifications, and
image metadata for real names, emails, archive IDs, provider IDs, tokens, and secrets.

Required six-image set:

1. **Import review:** synthetic filename; additions/edits/conflicts; no local path.
2. **Case workspace:** question, three evidence items, two competing hypotheses, next
   task, visible uncertainty.
3. **Source in context:** fictional transcript linked to a person and case; no record
   image rights ambiguity.
4. **Deterministic checks:** date/privacy findings with “No external AI used.”
5. **Publication readiness:** deceased fictional person plus blockers; never imply
   cohort-one real publishing.
6. **Export and control:** GEDCOM export and deletion-request explanation; never show a
   credential, object key, provider URL, or API token.

Optional API image after launch: token name/prefix and scopes plus a successful `/meta`
response, followed by revocation. The secret value must never appear in media.

## Ninety-second synthetic demo

| Time | Visual | Voiceover point |
| --- | --- | --- |
| 0–10s | Fictional case question and records | Trees show conclusions; Kin Resolve keeps the investigation trail |
| 10–25s | GEDCOM preview | See additions, edits, conflicts, and deletions before apply |
| 25–42s | Source and case links | Keep evidence attached to the question it informs |
| 42–57s | Competing hypotheses and task | Preserve uncertainty and decide the next useful search |
| 57–70s | Deterministic report | Run structural/privacy checks without an external AI provider |
| 70–82s | Rollback and export | Prove control of change and keep an exit path |
| 82–90s | Application page with prelaunch status | Apply without sending private records; invitations begin only after the gates pass |

Do not show hosted login, live API success, real participant data, support dashboards,
backup provider consoles, or “beta live” language until those exact surfaces are
approved for capture.

## Social copy

### Prelaunch

> Kin Resolve is building an evidence-led genealogy workspace for the work behind the
> tree: sources, research cases, competing hypotheses, reviewable GEDCOM changes, and a
> clear export path. Private beta applications are open; invitations have not started.
> Apply without sending family records: https://kinresolve.com/beta/

### Demo-launch

> The Kin Resolve public demo is live. Solve a fictional records mystery in about two
> minutes—no signup, and every record is invented. Kin Resolve is an open-source,
> evidence-led genealogy workspace; private beta applications are open, and invitations
> have not started. Try it: https://demo.kinresolve.com/

Do not publish the demo-launch variant until every external gate in
[`public-demo-runbook.md`](public-demo-runbook.md) has recorded evidence and the
launch-day flip checklist in
[`public-demo-launch-materials.md`](public-demo-launch-materials.md) has verified the
production hero. The variant claims only that the demo is live; it never implies hosted
invitations, open signup, or API availability.

### Launch-only

> Kin Resolve’s invitation-only private beta is live for its first deliberately small
> cohort. Review GEDCOM changes before apply, work questions through cases and evidence,
> run deterministic checks without external AI, and export the archive when you leave.
> Apply: https://kinresolve.com/beta/

Do not publish launch-only copy until the signed launch record says the canonical
product is live and names which gated surfaces, including the API, actually passed.

## Launch note skeleton — launch-only

Title: **Kin Resolve private beta: evidence first, deliberately small**

The note must include, in this order:

1. the exact UTC launch date and canonical product origin;
2. who can access it and how invitations work;
3. the synthetic-first product journey and implemented proof;
4. the exact admitted GEDCOM/content limits;
5. disabled capabilities and why the boundary is narrow;
6. whether the API launch gate passed; omit API availability if it did not;
7. support, security, export, deletion, backup, maintenance, and no-SLA posture;
8. links to the approved participation terms, privacy notice, cohort boundary, data
   practices, status, support, developers/OpenAPI, GitHub, and application;
9. known limitations and the next expansion gate; and
10. the fictional-data disclosure for every included image/video.

Never fill evidence fields from memory. The launch owner copies only privacy-safe facts
from the signed release, recovery, monitoring, deletion, legal, and canary records.

## Public link readiness

| Link | Prelaunch behavior | Launch requirement |
| --- | --- | --- |
| Apply | Public `/beta/`; verified `mailto` fallback, no family data | Native form only after the product endpoint, exact-origin/abuse controls, database grants, 90-day cleanup, signed deletion, and both Resend deliveries pass; rebuild `mailto` to roll back |
| Product login | Do not add while product DNS is holding/unconfigured | Exact `https://app.kinresolve.com/login`, invitation-only, body-aware health proof |
| Developers | Public source/developer-preview documentation may be visible but must say hosted API unavailable | Add live API call-to-action only after API edge/canary/revocation gate |
| Privacy | Public data-practices page, explicitly non-legal | Link exact approved versioned privacy notice separately at launch |
| Support | Describe planned route; no private evidence in email | `support@kinresolve.com` delivery test and private escalation path |
| Security | Describe responsible private route and safe-report rules | `security@kinresolve.com` delivery test, owner, escalation, response process |
| Status | Do not link a placeholder | Public status origin, incident-history policy, and owner-tested alert/update path |
| GitHub | Public repository | Keep source claims separate from hosted availability |

## Claim switch checklist

Change the centralized marketing status from prelaunch to launch only when all are true:

- [ ] Product owner and counsel have signed the cohort decisions and exact documents.
- [ ] Marketing, support, and security mail routes are delivery-tested.
- [ ] `app.kinresolve.com` serves the exact promoted product behind invitation-only auth.
- [ ] Legal-byte, capability, database/object identity, runtime-role, migration, and
      release contracts pass on the exact SHA.
- [ ] Backup, restore, cleanup, deletion, monitoring, incident, holding, and recovery
      evidence is current and approved.
- [ ] Synthetic authenticated browser journey passes; production canary passes.
- [ ] Real-data use remains off until its additional gates pass.
- [ ] API availability is stated only if its separate OpenAPI, edge-limit, token,
      archive-isolation, canary, and revocation proof passes.
- [ ] Status, privacy, support, security, developers, legal, and application links have
      no placeholders or contradictory state.
- [ ] The public launch note and social copy match the exact enabled surfaces.

If the product is later contained or unpublished, immediately switch away from
launch-only wording and use the state-specific copy in
[`unpublish-and-rollback.md`](unpublish-and-rollback.md).
