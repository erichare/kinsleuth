# Kin Resolve roadmap

Last updated: 2026-07-20

This is the canonical public roadmap. The marketing page at
[kinresolve.com/roadmap](https://kinresolve.com/roadmap/) summarizes this file; when the
two disagree, this file wins. Each item links to the plan or design document behind it so
the gap between a claim and the current code can be examined.

**The discipline: in progress is not the same as available.** "Shipped" below is a
code-state claim — merged, reviewed, and tested on `main` — never a claim that a hosted
service offers the capability. Everything else is labeled by the gate it still has to
pass. Nothing here asserts a date, a price, or production readiness, and the public
claims contract in [docs/brand-and-domain.md](docs/brand-and-domain.md) governs every
line.

## Shipped

Merged and tested in the public source.

- **Single-archive private research workspace** — account-gated people, source, case,
  evidence, hypothesis, and task workflows over one Postgres-backed archive. See
  [docs/architecture.md](docs/architecture.md) and [docs/auth.md](docs/auth.md).
- **GEDCOM import preview, apply, rollback, and export** — reviewable re-import
  differences, pre-apply snapshots, and full GEDCOM 5.5.1 export. See
  [docs/data-source-integrations.md](docs/data-source-integrations.md).
- **Deterministic quality and privacy checks** — date-conflict, coverage-gap, and
  living-person checks that run with no AI provider configured. See the
  [feature tour](README.md#feature-tour).
- **Private data-source artifact storage and durable background jobs** —
  archive-namespaced private storage for data-source artifacts plus Postgres-leased jobs
  with retries, cancellation, and redacted errors; legacy general source-file attachments
  still target local disk and need the same backend before production use. See
  [docs/persistence.md](docs/persistence.md) and
  [docs/data-source-integrations.md](docs/data-source-integrations.md).
- **Private guided research loop** — a deterministic next-step case guide with durable
  outcomes and decisions, behind a server-side flag; no external model calls. See
  [plans/private-guided-research-loop.md](plans/private-guided-research-loop.md).
- **Synthetic research challenge and demo fixtures** — five browser-local investigations
  across thirty fictional Hartwell–Mercer records; every demo detail is invented. See the
  [feature tour](README.md#feature-tour).
- **Candidate-first release and rollback machinery** — staged candidate deployments,
  database write fencing, and a checked-in zero-runtime holding page as the rollback
  target. See [README.md](README.md#staging-and-production-releases) and
  [docs/static-holding-deployment.md](docs/static-holding-deployment.md).

## In progress

Active work with open gates. None of this is offered as a hosted service today.

- **Hosted private beta launch gates** — owner, legal, runtime, provider, and recovery
  evidence gates for the invitation-only hosted beta remain open. See
  [plans/hosted-private-beta-launch.md](plans/hosted-private-beta-launch.md) and
  [docs/hosted-beta-contract.md](docs/hosted-beta-contract.md).
- **Public demo cutover** — the always-on synthetic demo cell has a dedicated project and
  runbook; external configuration and rehearsal gates remain. See
  [docs/public-demo-runbook.md](docs/public-demo-runbook.md).
- **Production hardening** — observability, backup and restore evidence, and self-hosted
  storage portability ahead of any real-data pilot. See
  [plans/production-readiness-next-slices.md](plans/production-readiness-next-slices.md)
  and [docs/production-readiness.md](docs/production-readiness.md).

## Next

Queued behind the gates above. Listing an item here is planning, not a promise of timing.

- **One isolated plain-GEDCOM real-data pilot** — a single dedicated cell for one
  researcher, admitted only after every real-data gate passes. See
  [docs/hosted-beta-contract.md](docs/hosted-beta-contract.md).
- **Founder-operated onboarding, export, deletion, and support** — hands-on operation for
  the first hosted cohort, with operator-assisted export and deletion. See
  [docs/privacy-data-operations.md](docs/privacy-data-operations.md).
- **Scoped read-only API preview** — owner-scoped tokens and the published OpenAPI
  contract, released only after separate edge-limit, canary, and revocation gates. See
  [docs/api-v1.md](docs/api-v1.md) and
  [docs/api-edge-rate-limit-checklist.md](docs/api-edge-rate-limit-checklist.md).
- **Production delivery of the invitation and recovery perimeter** — the implemented
  invitation, email-verification, recovery, and exact-document acceptance flows still
  need live operational evidence. See [docs/auth.md](docs/auth.md).

## Exploring

Design intent without dates. None of these is implemented as a finished capability.

- **Semantic retrieval and stronger citation grounding** — the pgvector embeddings table
  is provisioned and unused; retrieval-backed, citation-grounded analysis is design work.
  See [docs/production-readiness.md](docs/production-readiness.md).
- **Genealogical Proof Standard conflict-resolution workflows** — explicit research logs,
  exhaustive-search checklists, and forced conflict resolution. See
  [docs/production-readiness.md](docs/production-readiness.md).
- **Agent-assisted record search** — tool-calling against partner record APIs, dependent
  on partnership approvals that do not exist yet. See
  [docs/production-readiness.md](docs/production-readiness.md) and
  [docs/ancestry-partnership-overview.md](docs/ancestry-partnership-overview.md).
- **Shared multi-archive hosting and tenant isolation** — database-policy tenant
  isolation and collaboration between unrelated families. See
  [docs/auth.md](docs/auth.md).
- **Granular fact, citation, and story publishing controls** — publication decisions at
  the fact and source level, beyond today's person-level gates. See
  [docs/production-readiness.md](docs/production-readiness.md).

## Not planned yet

Server-enforced hosted cohort-one boundaries, not hidden omissions. Several exist in
source for self-hosted operators; none has a hosted plan or date. The boundary contract
is [docs/hosted-beta-contract.md](docs/hosted-beta-contract.md).

- **Hosted DNA uploads or triage** — DNA match triage exists in the source product but
  remains disabled for the hosted cohort.
- **External-provider AI in the hosted cohort** — self-hosted operators can configure an
  OpenAI-compatible provider; the hosted cohort makes no external AI calls.
- **Hosted media packages or binary source attachments** — hosted source work stays
  transcript-only: metadata, links, and pasted text.
- **Real-data public publishing** — publication-readiness checks ship in source, while
  publishing real family data publicly stays disabled.
- **Open signup, billing, or shared multi-family hosting** — no self-service accounts, no
  payment collection, and no shared tenancy in the hosted cohort.

## How this file is maintained

The working planning documents live in [plans/](plans/) — planning documents, not claims
surfaces; see [plans/README.md](plans/README.md) for the convention. When an item moves
(a gate passes, a plan lands, an exploration is dropped), this file and
[site/lib/roadmap.ts](site/lib/roadmap.ts) move together so the site and the repository
tell the same story.
