# Kin Resolve brand and domain contract

Last updated: 2026-07-14

This document keeps the public name, URLs, claims, and legacy technical identifiers consistent while the product moves from KinSleuth to Kin Resolve.

## Public identity

- **Display name:** Kin Resolve
- **Compact wordmark:** KinResolve, only where a space is technically or visually impractical
- **Domain:** `kinresolve.com`
- **Repository:** `https://github.com/erichare/kinresolve`
- **Tagline:** Evidence-led genealogy research.
- **Primary message:** Resolve the questions your family tree cannot answer.
- **Primary call to action:** Apply for the private beta
- **Secondary call to action:** View on GitHub

The working visual direction pairs archival warmth with research rigor: warm paper, forest green, restrained rust and brass accents, editorial typography, and evidence-led rather than nostalgic imagery.

## Domain status and intended routing

`kinresolve.com` was registered through Cloudflare on 2026-07-13. Registration and DNS control do not substitute for a formal trademark review; legal clearance remains a separate founder decision.

Current public routing is:

| Host | Purpose | Status |
| --- | --- | --- |
| `kinresolve.com` | Public marketing site | Live on Vercel and verified |
| `www.kinresolve.com` | Redirect to the apex domain | Live; redirects to the apex |
| `app.kinresolve.com` | Hosted product | Not configured; no product DNS yet |
| `demo.kinresolve.com` | Proposed isolated synthetic demo | Not configured; pending the hosted-beta contract |
| `kinsleuth.vercel.app` | Legacy product hostname | Static `noindex` holding page; not a usable beta |

The marketing site and `beta@kinresolve.com` delivery are live. The site uses an isolated `kinresolve-marketing` Vercel project and cannot deploy the product. `app.kinresolve.com` must not receive product DNS until the protected product project, canonical `APP_BASE_URL`, TLS, candidate workflow, rollback ownership, and body-aware health checks are ready.

## Public claims contract

Safe current claims must distinguish implemented source capabilities from hosted availability:

- Private beta applications are open; hosted access is rolling out in small invitation cohorts.
- The source product implements a private, single-archive genealogy research workspace.
- The source product implements GEDCOM preview, reviewable refresh/apply/rollback, and GEDCOM 5.5.1 export.
- The source product implements people/source search, research cases, evidence, hypotheses, tasks, deterministic checks, private object storage, and durable background jobs.
- The public challenge, screenshots, examples, and launch media use synthetic Hartwell–Mercer data.
- Source is available under AGPL-3.0-only.

The recommended first hosted cohort is defined in [`docs/hosted-beta-contract.md`](hosted-beta-contract.md) and remains pending owner/legal sign-off. It proposes one isolated GEDCOM pilot plus a separate synthetic demo, with hosted DNA, external AI, media packages, real-data publishing, open signup, shared tenancy, and billing disabled.

Claims that must be labeled **in development** or **exploring**:

- Shared multi-archive hosting, tenant isolation, invitations, and family collaboration
- Production observability, provider/object restore, complete deletion, and incident operations
- Secure hosted email verification, recovery, and invitation delivery
- Scoped external API tokens, limits, and published OpenAPI contract
- Granular fact, citation, and story publishing controls
- Semantic retrieval and stronger citation grounding
- Explicit Genealogical Proof Standard conflict-resolution workflows
- Agent-assisted record search

Do not claim that the hosted product is live until `app.kinresolve.com` and every launch gate prove it. Do not claim production readiness, open hosted signup, shared multi-family tenancy, bundled hosted AI, audit logging, GPS certification, automated conflict resolution, GDPR compliance, unlimited GEDCOM size, guaranteed backups, Ancestry sync/approval, or production-grade hosted DNA handling.

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
