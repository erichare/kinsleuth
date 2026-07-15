# Hosted private beta contract

- **Status:** Proposed; owner and counsel sign-off pending
- **Updated:** 2026-07-14
- **Planning base:** `main` at `8f40da57a2febd20753737137d2e06f16e623a4b`
- **Product origin:** `https://app.kinresolve.com` (not live yet)
- **Marketing origin:** `https://kinresolve.com` (live)
- **Execution blueprint:** [`plans/hosted-private-beta-launch.md`](../plans/hosted-private-beta-launch.md)

This document is the compact product, data, support, API, and public-claims contract for the first hosted Kin Resolve cohort. It records recommended defaults so engineering and marketing have one coherent proposal. It does **not** represent owner or legal approval until the sign-off table is completed.

## Current public status

Use this wording consistently until the production launch gates pass:

> Private beta applications are open. Hosted access is rolling out in small invitation cohorts.

Applying records interest. It does not create an account, guarantee access, or authorize an applicant to send family records, GEDCOM files, DNA data, source images, credentials, or private details.

Do not say that the hosted product is live, current, working, or available until `app.kinresolve.com` serves the promoted product and the launch checklist is signed.

## Recommended decisions pending sign-off

| ID | Decision | Recommended default | Owner status |
| --- | --- | --- | --- |
| D1 | Launch data | Synthetic demo first; one real GEDCOM pilot only after legal, restore, deletion, recovery, and security gates | Pending |
| D2 | Isolation | One real household per deployment, database, object store, secrets, and archive ID | Pending |
| D3 | DNA, external AI, and media | Disabled for cohort one at both UI and server boundaries | Pending |
| D4 | API | Same-origin, scoped, read-only `/api/v1` developer preview | Pending |
| D5 | Recovery | Supabase Pro daily database backup plus encrypted off-provider database/object backup; explicit 24-hour RPO unless PITR is purchased | Pending |
| D6 | Pilot size | One 30-day participant; expand only after an incident-free week and another restore rehearsal | Pending |
| D7 | Billing | Free private beta; no payment or entitlement surface | Pending |
| D8 | First hosted cutover | Forward-only maintenance cutover; never attach `v0.17.4` to pilot data; establish the first compatible hosted release as the future rollback anchor | Pending |

Approval must record the approver, date, and any deviation here before a policy-dependent implementation is enabled in production.

## Proposed cohort-one boundary

- Invitation-only and founder-operated.
- One genealogist or one trusted household in one isolated real-data cell.
- A separate resettable deployment contains the synthetic Hartwell–Mercer demo.
- Plain GEDCOM only, initially limited to 10 MiB (10,485,760 bytes) and 40,000 people. ZIP and package uploads are outside the admitted boundary. The 50,000-person fixture is a proof target, not the admitted limit.
- One-business-day support acknowledgement target, weekly check-in, announced maintenance, and no uptime SLA.
- Participant begins in the synthetic demo. Real family data is accepted only after every real-data gate passes.

### Proposed cohort-one capability manifest

All seven values must be present together in a hosted deployment. They are recommended settings pending owner and counsel sign-off; this table does not approve production enablement.

`KINSLEUTH_ALLOW_SIGNUPS` must be exactly `false` for every hosted release. Hosted accounts are provisioned through the controlled invitation path; `/setup` and open self-registration are unavailable.

| Capability flag | Cohort-one value | Enforced boundary |
| --- | --- | --- |
| `KINRESOLVE_DNA_ENABLED` | `false` | DNA disabled |
| `KINRESOLVE_EXTERNAL_AI_ENABLED` | `false` | External-provider AI disabled |
| `KINRESOLVE_PUBLIC_ARCHIVE_ENABLED` | `false` | Public archive disabled |
| `KINRESOLVE_PUBLIC_PUBLISHING_ENABLED` | `false` | Real-data public publishing disabled |
| `KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED` | `false` | Binary source and evidence uploads disabled |
| `KINRESOLVE_PACKAGE_MEDIA_ENABLED` | `false` | ZIP and package media disabled |
| `KINRESOLVE_PLAIN_GEDCOM_ENABLED` | `true` | Plain `.ged` and `.gedcom` imports enabled within the fixed limits |

### Included in the proposed pilot

- Private account and archive access.
- GEDCOM upload, durable processing, review, apply, rollback, and export.
- People and source search; source creation is transcript-only, limited to metadata, links, and pasted text/transcripts.
- Cases, evidence, hypotheses, tasks, and next-step workflow.
- Deterministic local analysis and quality/privacy checks that make no external provider call.
- Publication-readiness review without publishing the real archive.
- Owner-scoped, read-only API access after the API gate passes.
- Founder-assisted export, recovery, and deletion.

### Excluded from the proposed pilot

- DNA upload, storage, triage, or analysis.
- External-provider AI on participant data.
- ZIP, FTM, RootsMagic, record-image, media-package, or binary attachment retention.
- Real-data public publishing.
- Ancestry OAuth, partner API, DNA, hints, messages, sync, or writeback.
- Shared multi-family tenancy, open signup, self-service provisioning, billing, or an uptime guarantee.
- Public write API, webhooks, SDK guarantees, or unversioned internal API access.

An excluded capability must be rejected by the server, not merely hidden in the interface.

## Proposed data and recovery contract

These values remain subject to owner and counsel approval:

| Data class | Proposed handling |
| --- | --- |
| Beta application | Minimal contact/workflow fields only; no family data or files; delete stale/declined applications after 90 days |
| Invitations and recovery tokens | Hashed, single-use, short-lived; remove expired token material on a bounded schedule |
| Real pilot archive | Dedicated database and object namespaces; retained only for the pilot and agreed export/deletion window |
| Import artifacts | Private and archive-scoped; retention documented before upload and covered by both-prefix object inventory |
| Operational logs | Redacted allowlisted fields; no record content, GEDCOM lines, credentials, cookies, token values, or raw queries; proposed 14-day retention |
| Security/audit events | Non-content metadata only; proposed 90-day retention |
| Primary deletion | Complete within seven days of a valid request after optional export; for the isolated pilot, destroy the dedicated data cell |
| Retained backups | Expire under the published provider/off-provider schedule; proposed maximum 30 days after primary deletion |

The recovery claim covers only what has been inventoried, backed up, and restored in rehearsal. A database backup does not cover Vercel Blob. Both `gedcom-imports/{archive}/` and `archives/{archive}/` must have explicit manifest, retention, restore, and deletion treatment.

## Proposed API contract

- Base URL: `https://app.kinresolve.com/api/v1`.
- Developer Preview, read-only, and bound to the participant's one archive.
- Owner-created bearer token shown once, stored only as a digest, expiring and revocable.
- Proposed scopes: `archive:read`, `sources:read`, `cases:read`, `reports:read`, and separate `archive:export`.
- Initial resources: metadata, people, sources, cases, quality report, and GEDCOM export.
- Opaque cursor pagination, bounded page sizes, stable safe errors with request IDs, durable per-token limits, and an edge invalid-token limit.
- Internal browser `/api/*` routes are not the public API contract.

Do not market API availability until token revocation, archive isolation, OpenAPI validation, documentation, limits, and production canary gates pass.

## Support and incident contract

- `beta@kinresolve.com`: applications and cohort communication.
- `support@kinresolve.com`: participant help and deletion/export requests; monitored before invitations.
- `security@kinresolve.com`: private vulnerability/security reports; monitored before invitations.
- Proposed support acknowledgement: one business day.
- Severity-0/1 privacy, authorization, corruption, data-loss, secret-exposure, or cross-archive signals pause invitations and real-data use immediately.
- Participants must not put private family data in email or public GitHub issues; use an approved private support route.

## Public claims

### Safe before hosted launch

- Private beta applications are open.
- Kin Resolve's source product implements a single-archive research workspace, reviewable GEDCOM workflows, cases, deterministic checks, and export.
- The public challenge and marketing media use synthetic Hartwell–Mercer records.
- Source is available under AGPL-3.0-only.

### Safe only after their production gates pass

- Invitation-only private beta is live at `app.kinresolve.com`.
- One isolated participant can use the enabled GEDCOM research workflow.
- A scoped, read-only API is available to beta participants.
- The exact published backup, recovery, support, and deletion targets have been rehearsed.

### Prohibited for cohort one

- Production-ready, enterprise-ready, multi-tenant, open signup, guaranteed uptime, or guaranteed zero data loss.
- GDPR, CCPA, HIPAA, genetic-privacy, or other legal compliance claims without counsel.
- Hosted DNA safety, Ancestry sync/approval, bundled AI, or fact-level public publishing.
- Grounded or citation-verified autonomous research agent.
- Guaranteed backups or recovery beyond observed and published RPO/RTO.

## Sign-off

| Role | Name | Decision/version | Date | Status |
| --- | --- | --- | --- | --- |
| Product owner | — | D1–D8 | — | Pending |
| Engineering | — | Implementation feasibility | — | Pending |
| Privacy/legal | — | Terms, privacy, retention, processors, deletion | — | Pending before real data |
| Launch owner | — | Production Gate A–F | — | Pending |
