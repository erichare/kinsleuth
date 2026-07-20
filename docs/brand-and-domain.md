# Kin Resolve brand and domain contract

Last updated: 2026-07-20

This document keeps the public name, URLs, claims, and legacy technical identifiers consistent while the product moves from KinSleuth to Kin Resolve.

## Public identity

- **Display name:** Kin Resolve
- **Compact wordmark:** KinResolve, only where a space is technically or visually impractical
- **Domain:** `kinresolve.com`
- **Repository:** `https://github.com/erichare/kinresolve`
- **Tagline:** Evidence-led genealogy research.
- **Primary message:** Resolve the questions your family tree cannot answer.
- **Primary call to action (demo live):** Solve the passenger mystery
- **Generic product call to action:** Try Kin Resolve
- **Secondary call to action:** Apply for the private beta

The demo-live primary call to action becomes primary only after the public-demo runbook
gates pass; until then, the generic product call to action remains primary. “Try Kin
Resolve” stays the generic product call to action wherever a surface is not specifically
promoting the live demo mystery.

The working visual direction pairs archival warmth with research rigor: warm paper, forest green, restrained rust and brass accents, editorial typography, and evidence-led rather than nostalgic imagery.

## Domain status and intended routing

`kinresolve.com` was registered through Cloudflare on 2026-07-13. Registration and DNS control do not substitute for a formal trademark review; legal clearance remains a separate founder decision.

Current public routing is:

| Host | Purpose | Status |
| --- | --- | --- |
| `kinresolve.com` | Public marketing site | Live on Vercel and verified |
| `www.kinresolve.com` | Redirect to the apex domain | Live; redirects to the apex |
| `app.kinresolve.com` | Hosted private beta | Holding only; real-family launch remains separate |
| `demo.kinresolve.com` | Always-on isolated synthetic public demo | Dedicated project/holding cutover pending external configuration and rehearsal |
| `kinsleuth.vercel.app` | Legacy product hostname | Static `noindex` holding page; not a usable beta |

The marketing site and `beta@kinresolve.com` delivery are live. The site uses an isolated
`kinresolve-marketing` Vercel project and cannot deploy the product. The public demo uses
the separate `kinresolve-demo` project and synthetic database; its external cutover and
rehearsal gates are tracked in [`public-demo-runbook.md`](public-demo-runbook.md).
`app.kinresolve.com` remains separate and must not receive a real-family runtime until its
private-beta launch gates pass.

## Public claims contract

Copy discipline: visitor-facing pages carry one status line each, sourced from the shared
status modules; the full claims discipline lives in this document, not in repeated
on-page qualifiers.

Safe current claims must distinguish implemented source capabilities from hosted availability:

- Private beta applications are open; invitations have not started.
- The source product implements a private, single-archive genealogy research workspace.
- The source product implements GEDCOM preview, reviewable refresh/apply/rollback, and GEDCOM 5.5.1 export.
- The source product implements people/source search, research cases, evidence, hypotheses, tasks, deterministic checks, private object storage, and durable background jobs.
- The public challenge, screenshots, examples, and launch media use synthetic Hartwell–Mercer data.
- Source is available under AGPL-3.0-only.

The recommended first hosted cohort is defined in [`docs/hosted-beta-contract.md`](hosted-beta-contract.md) and remains pending owner/legal sign-off. It proposes one isolated GEDCOM pilot plus a separate synthetic demo, with hosted DNA, external AI, media packages, real-data publishing, open signup, shared tenancy, and billing disabled.

Claims that must be labeled **in development** or **exploring**:

- Shared multi-archive hosting, database-policy tenant isolation, and unrelated-family collaboration
- Live provider configuration and evidence for backup, object restore, real-pilot teardown, monitoring, and incident escalation
- Production delivery of the implemented invitation, email-verification, recovery, and exact-document acceptance perimeter
- Production availability of the implemented scoped API tokens, limits, and OpenAPI contract; edge-limit and canary proof remain gates
- Granular fact, citation, and story publishing controls
- Semantic retrieval and stronger citation grounding
- Explicit Genealogical Proof Standard conflict-resolution workflows
- Agent-assisted record search

Do not claim that the hosted product is live until `app.kinresolve.com` and every launch gate prove it. Do not claim production readiness, open hosted signup, shared multi-family tenancy, bundled hosted AI, audit logging, GPS certification, automated conflict resolution, GDPR compliance, unlimited GEDCOM size, guaranteed backups, Ancestry sync/approval, or production-grade hosted DNA handling.

### Demo-live claims — publishable only after the public-demo runbook gates pass

Once every external gate in [`public-demo-runbook.md`](public-demo-runbook.md) has
recorded evidence and `demo.kinresolve.com` serves the promoted demo, these additional
claims become safe:

- The public demo at `demo.kinresolve.com` is live: solve the fictional Mercer–March
  passenger mystery in about two minutes, with no signup, in a disposable workspace that
  expires after 24 hours.
- Every demo record is fictional Hartwell–Mercer data; the demo accepts no uploads and no
  real family data.
- The demo changes nothing about hosted availability: the hosted private beta remains
  invitation-only, and applications continue through the public application page.

Demo-live wording never implies open hosted signup, production readiness, or hosted API
availability. Visitor-facing pages carry one status line each; the full claims discipline
lives in this document, and the approved demo-live message set lives in
[`public-demo-launch-materials.md`](public-demo-launch-materials.md).

## Compatibility contract

The rename is a display and repository change, not permission to break stored data or deployments. Preserve these identifiers until an explicit migration provides dual-read compatibility:

- The legacy `/kinsleuth` route, with a redirect if a new canonical product route is added
- Snapshot keys and the existing `product: "KinSleuth"` discriminator
- GEDCOM `SOUR KINSLEUTH` parsing and `_KS_*` custom tags
- Existing `KINSLEUTH_*` environment-variable aliases
- Serialized health-response fields
- Postgres database/user defaults, bucket names, storage paths, and Compose volume names
- The existing production URL until the replacement is live and verified

New display copy should use **Kin Resolve**. New repository links should use `erichare/kinresolve`. New technical identifiers may use `kinresolve` when they do not create a migration burden.

## Ownership before launch

- The founder retains Cloudflare registrar and DNS recovery access.
- Vercel deploy access and GitHub repository administration must remain available to at least one recovery owner.
- Secrets stay in the deployment provider or GitHub Actions; never in source or this document.
- The private-beta mailbox is active and tested; preserve its Cloudflare MX, SPF, and DKIM records during web-domain cutover.
- Any public demo must use synthetic records only.
