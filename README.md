<div align="center">

# 🌲 Kin Resolve

**Self-hosted genealogy research workspace — a private investigation lab paired with a curated public family archive.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-2e7d32.svg)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev)
[![Postgres + pgvector](https://img.shields.io/badge/Postgres-pgvector-336791?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Tests: Vitest](https://img.shields.io/badge/Tests-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

*Import and refresh tree exports from Ancestry, Family Tree Maker, RootsMagic, or any GEDCOM-producing app; triage DNA matches; build research cases; and publish selected deceased profiles through privacy gates.*

<p><em>Every person, record, place, photograph, story, and DNA value shown below belongs to the wholly fictional Hartwell–Mercer demo.</em></p>

<img src="docs/screenshots/dashboard.webp" alt="Fictional Hartwell–Mercer Kin Resolve investigation dashboard" width="90%" />

</div>

---

## Why Kin Resolve?

Most genealogy tools make you choose between *sharing everything* and *sharing nothing*. Kin Resolve splits the difference with two faces on one database:

| 🔒 Private workspace (`/app`) | 🌍 Public archive (`/`) |
| --- | --- |
| Every imported person, source, DNA match, and research note | Only profiles you explicitly curate and publish |
| Account-gated pages and APIs (owner-created accounts) | Living, private, and sensitive records withheld automatically |
| Research cases, task queues, AI analysis runs | Published deceased profiles and facts already marked public |

The repository ships with the wholly fictional **Hartwell–Mercer Family Archive**. Every included name, date, place, record, photograph, story, and DNA value was invented for Kin Resolve; no detail represents a real person or family. Real GEDCOM exports, DNA match files, and uploads belong in ignored local storage (`data/`, `uploads/`).

## Hosted private beta — proposed, not live

The hosted private beta at `app.kinresolve.com` is a gated proposal, not a currently available service. Owner and counsel approval remains pending, and real family data must not be accepted until the launch gates in the [hosted beta contract](docs/hosted-beta-contract.md) pass.

The proposed first cohort is intentionally narrow:

- Plain GEDCOM imports only: up to 10 MiB (10,485,760 bytes) and 40,000 people.
- Sources are transcript-only: metadata, links, and pasted text/transcripts are allowed; binary source and evidence uploads are disabled.
- Deterministic local analysis makes no external provider call; external-provider AI is disabled.
- DNA is disabled.
- The public archive is disabled.
- Real-data public publishing is disabled.
- ZIP and package media are disabled.

These hosted limits do not narrow the features available to local/self-hosted operators. Hosted deployment requires the exact seven-flag manifest documented below and in the beta contract.

## Feature tour

### Public family archive

A curated, privacy-gated site for the ancestors you choose to share — published profiles pass both a manual publish flag *and* automated living/privacy gates before anonymous visitors see them. Current controls are person-level; granular fact/source curation and persisted stories are still in progress.

<img src="docs/screenshots/public-home.webp" alt="Fictional Hartwell–Mercer public archive landing page" width="90%" />

### Immersive synthetic research challenge

Open thirty period-inspired record images across five immersive investigations, compare accessible transcripts, save cited observations to a clue notebook, and state conclusions without erasing unresolved conflicts. The cases span identity, provenance, photograph dating, same-name reconstruction, and DNA clustering, and run entirely in the browser with fictional data.

<img src="docs/screenshots/research-challenge.webp" alt="Fictional Hartwell–Mercer immersive record desk with a synthetic household schedule and transcript" width="90%" />

### Investigation dashboard

Workspace metrics, cases in motion, an action queue of privacy and quality problems, and top DNA signals — all computed from your actual archive.

### People workspace

Server-paginated search over every imported person with publication, privacy, and life-status filters plus per-person curation controls.

<img src="docs/screenshots/people-workspace.webp" alt="Fictional Hartwell–Mercer people workspace with search and curation" width="90%" />

### Remembered data sources with reviewable refreshes

The **Data sources** workspace presents import paths for Ancestry's downloaded ZIP or GEDCOM, media-capable Family Tree Maker and RootsMagic packages, and generic GEDCOM files. The provider-neutral persistence and API foundation remembers each source and models later exports against the last applied snapshot and current local research. Its review contract groups additions, edits, conflicts, and deletions; a missing remote record keeps the local record by default.

This is an export workflow, not an Ancestry account connection: Kin Resolve never asks for Ancestry credentials, automates Ancestry pages, or writes changes back. Every non-GEDCOM file in a ZIP must pass the private malware scanner before review, including unreferenced attachments. FTM and RootsMagic media packages fail closed unless the private-media feature, documented legal-review gate, and a versioned user rights acknowledgement are all present. Retained media starts third-party restricted, private, non-publishable, and excluded from AI context; an authenticated owner can attest that a file is user-owned without automatically making it public or AI eligible.

Apply and rollback requests are archive-scoped and idempotent. An apply writes the selected incoming entities and its pre-apply backup in the same transaction; rollback restores that backup. Raw GEDCOM records, xrefs, custom tags, source references, and checksums remain available for provenance. Private package storage uses archive-namespaced keys, and the registered Postgres worker handler provides exclusive leases, retries, cancellation, and redacted status errors. Production enablement requires a configured storage backend plus either the long-running worker or bounded scheduled invocation.

Your data is never locked in: the whole archive exports back to GEDCOM 5.5.1 from the Data sources page (or `GET /api/exports/gedcom`), with curation flags carried as compatibility-preserved custom `_KS_` tags. The explicit legacy Kin Resolve migration path can restore those tags; the provider-neutral Data sources workflow treats incoming publication controls as untrusted and always creates new people private and unpublished. See [Data source integrations](docs/data-source-integrations.md) for the provider boundary, API, deployment, rights, and rollout contract.

### DNA match triage

Import DNA match CSVs, rank matches by a helpfulness score (shared cM, tree status, surnames, places, shared matches), edit match details, link matches to cases as evidence, and generate connection hypotheses with candidate common ancestors.

<img src="docs/screenshots/dna-triage.webp" alt="Fictional Hartwell–Mercer DNA match triage queue with hypothesis panel" width="90%" />

### AI Analyst

Deterministic structural checks (date conflicts, privacy risks) run with no API key at all. Add an OpenAI-compatible provider key and the analyst answers research questions with cited workspace context, saved run history, and staged case-task suggestions you approve before they land.

<img src="docs/screenshots/ai-analyst.webp" alt="Fictional Hartwell–Mercer AI analyst workspace" width="90%" />

### Publishing readiness & quality reports

Per-profile readiness scoring, publication blockers, source-coverage gaps, and low-confidence facts — reviewed before anything goes public.

<img src="docs/screenshots/publishing-review.webp" alt="Fictional Hartwell–Mercer publishing readiness review" width="90%" />

## Quick start

```bash
git clone https://github.com/erichare/kinresolve.git
cd kinresolve
npm install
cp .env.example .env
docker compose up -d postgres
npm run archive:provision -- --mode demo
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The provisioning command creates the versioned, wholly fictional demo exactly once; rerunning it verifies the same persisted mode without resetting later work.

> `DATABASE_URL` is required (the `.env.example` default matches the bundled Postgres service). Private `/app` routes are open in local development; set a long `AUTH_SECRET` and create the owner account at `/setup` to protect them.

### Full stack via Docker Compose

```bash
cp .env.example .env
# Set MINIO_ROOT_USER and MINIO_ROOT_PASSWORD in .env before continuing.
docker compose up --build
```

Before starting Compose, set unique non-empty `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` values in `.env` (for example, generate the password with `openssl rand -hex 32`). Compose fails closed when either value is missing and supplies the same credential pair to the app, worker, MinIO, and bucket initializer.

Compose provisions Postgres with pgvector, explicitly provisions the versioned fictional demo, and starts private MinIO object storage alongside the production app. Both the app and worker wait for that one-shot provisioning service. The MinIO API and console are published only on the host loopback interface at ports `9000` and `9001`. The data-source storage contract uses archive-namespaced keys; legacy general source-file attachments still use local disk. MinIO allows direct-upload CORS from `http://localhost:3000`; production deployments must configure their exact HTTPS app origin for multipart `POST` uploads. Durable job state lives in Postgres, and the worker runs the registered export parser continuously by default. The web and worker processes share database, storage, and rollout configuration.

## Route map

| Route | Purpose |
| --- | --- |
| `/` | Public archive landing page |
| `/people`, `/people/[slug]` | Published people and profiles |
| `/stories`, `/places` | Synthetic demo stories and the public place index |
| `/challenge` | Five immersive investigations across thirty fictional records with browser-local progress |
| `/app` | Investigation dashboard |
| `/app/people` | Search, filter, and curate people |
| `/app/cases` | Research cases, evidence, hypotheses, and task queues |
| `/app/dna` | DNA match triage and connection hypotheses |
| `/app/sources` | Source register and transcript review |
| `/app/imports` | Remembered Ancestry/FTM/RootsMagic/GEDCOM data sources, reviewable refreshes, rollback, and full-archive GEDCOM export |
| `/app/ai` | AI Analyst with saved run history |
| `/app/reports` | Quality and evidence reports |
| `/app/publishing` | Public-profile readiness review |
| `/app/settings` | Archive branding, provider, storage, and role reference |
| `/api/health` | JSON runtime health (`200` healthy / `503` degraded) |

## Configuration

`.env.example` documents every supported variable:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | **Required.** Postgres connection string for workspace storage |
| `DATABASE_POOL_MAX` | Max connections per instance; use `2` for serverless |
| `DATABASE_AUTO_MIGRATE` | Applies pending versioned migrations at boot; set `false` in production and run `npm run db:migrate` at deploy time instead |
| `KINRESOLVE_DEPLOYMENT_MODE` | `self-hosted` or `hosted`; required in hosted production and set explicitly by the bundled Compose stack |
| `KINRESOLVE_DATASET_MODE` | Persisted archive contract: `empty`, versioned fictional `demo`, or real-data `pilot`; required for hosted deployments and provisioning |
| `KINRESOLVE_DNA_ENABLED` | Hosted cohort one: `false`; server-side DNA capability gate |
| `KINRESOLVE_EXTERNAL_AI_ENABLED` | Hosted cohort one: `false`; prevents external-provider analysis calls |
| `KINRESOLVE_PUBLIC_ARCHIVE_ENABLED` | Hosted cohort one: `false`; disables anonymous archive surfaces |
| `KINRESOLVE_PUBLIC_PUBLISHING_ENABLED` | Hosted cohort one: `false`; disables publication mutations independently from archive visibility |
| `KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED` | Hosted cohort one: `false`; permits transcript-only sources while rejecting binary source/evidence uploads |
| `KINRESOLVE_PACKAGE_MEDIA_ENABLED` | Hosted cohort one: `false`; disables ZIP/package media retention |
| `KINRESOLVE_PLAIN_GEDCOM_ENABLED` | Hosted cohort one: `true`; admits only `.ged`/`.gedcom` files subject to the fixed 10 MiB and 40,000-person limits |
| `KINSLEUTH_ALLOW_SIGNUPS` | Hosted releases require exactly `false`; self-hosted first-run signup remains available when no account exists |
| `KINRESOLVE_GUIDED_RESEARCH_ENABLED` | Server-side kill switch for the private case guide and its mutation APIs; defaults to `true`, set `false` to disable without deleting research history |
| `KINRESOLVE_EXPORT_REFRESH_ENABLED` | Data-source tree import/refresh gate; defaults to `true` |
| `KINRESOLVE_DESKTOP_MEDIA_ENABLED` | Requests the private FTM/RootsMagic media path; defaults to `false` and is ineffective without the legal-review gate and per-package rights acknowledgement |
| `KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED` | Independent operator assertion that the private media rights language and release were reviewed; defaults to `false` |
| `KINRESOLVE_MALWARE_SCANNER` | Worker malware scanner provider: `clamd` or `none`; media-bearing ZIPs fail closed when unset |
| `KINRESOLVE_CLAMD_HOST` / `KINRESOLVE_CLAMD_PORT` | Private clamd TCP endpoint; no filenames or genealogy metadata are sent |
| `KINRESOLVE_MALWARE_SCAN_TIMEOUT_MS` | Whole-file clamd connection/scan timeout, default `30000` |
| `KINRESOLVE_MALWARE_SCAN_MAX_BYTES` | Per-file INSTREAM ceiling, default `25165824`; must not exceed clamd `StreamMaxLength` |
| `KINRESOLVE_ANCESTRY_API_ENABLED` | Future partner-API rollout request; defaults to `false` and has no effect without separate written approval |
| `KINRESOLVE_ANCESTRY_PARTNER_APPROVED` | Independent operator assertion that written Ancestry approval exists; both Ancestry API gates must be true |
| `AUTH_SECRET` | Secret for account sessions (better-auth); required in production |
| `KINSLEUTH_ARCHIVE_ID` | Archive id; set explicitly before `npm run archive:provision` (the runtime fallback remains `archive-default` for legacy self-hosted installs) |
| `KINRESOLVE_OBJECT_STORAGE_BACKEND` | Private data-source artifact backend (`s3` or `vercel-blob`); archive namespace enforcement is fixed by the storage contract |
| `BLOB_READ_WRITE_TOKEN` | Server-only credential for Vercel Blob artifact storage and archive-namespaced legacy large-GEDCOM staging |
| `S3_ENDPOINT` | Server/worker endpoint for S3-compatible private artifact reads and writes |
| `S3_PUBLIC_ENDPOINT` | Browser-reachable endpoint used only when signing direct-upload POST policies |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | **Required for Docker Compose.** Operator-supplied credentials shared by the bundled MinIO service, app, worker, and bucket initializer |
| `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Private S3/MinIO bucket and server-only credentials for non-Compose runtimes; Compose derives its access keys from the required MinIO values |
| `KINRESOLVE_WORKER_*` | Worker identity, polling and maintenance intervals, lease duration, per-run parse bound, and bounded staged-upload cleanup limit |
| `CRON_SECRET` | Bearer token for scheduled integration parsing and stale-upload cleanup jobs |
| `AI_BASE_URL` / `AI_API_KEY` | OpenAI-compatible provider; deterministic fallback runs without a key |
| `AI_API_MODE` | `responses` (default) or `chat` |
| `AI_CHAT_MODEL` / `AI_EMBEDDING_MODEL` | Chat model for analysis; the embedding model is reserved for planned pgvector retrieval (not implemented yet) |
| `APP_BASE_URL` | Exact canonical origin of the running app; production requires one HTTPS origin such as `https://app.kinresolve.com` and uses it for redirects and cookie-mutation origin checks |

The seven hosted capability flags are required together and fail closed when absent or invalid. They remain commented in `.env.example` so copying that file does not change self-hosted defaults; a hosted operator must uncomment the complete cohort-one manifest. The 10 MiB (10,485,760-byte) and 40,000-person GEDCOM limits are fixed application boundaries, not environment overrides.

Browser-facing cookie mutations are registered explicitly and fail before database or
session access unless `Origin` equals `APP_BASE_URL` exactly and
`Sec-Fetch-Site: same-origin` is present. Better Auth endpoints keep Better Auth's own
origin validation, and cron endpoints require their independent bearer secret. Scripts
should not reuse browser session cookies as an API credential; the versioned bearer API
is a separate release surface. If a trusted diagnostic must reproduce a browser
mutation, it must send both request-origin headers in addition to the protected session
cookie.

Archive name and tagline are edited in **Settings → Archive branding** and flow through both the private workspace and the public site. Settings also reports live database, storage, and AI-provider health.

<img src="docs/screenshots/settings.webp" alt="Fictional Hartwell–Mercer settings with archive branding and runtime status" width="90%" />

## Development

```bash
npm run typecheck     # TypeScript
npm run lint          # ESLint
npm run test          # Vitest unit tests
npm run test:db       # Every Postgres-gated suite, serialized (needs TEST_DATABASE_URL)
npm run test:db:large # 10.5+ MB / 65k-person GEDCOM load regression
npm run test:release-upgrade # Rehearse v0.17.4 -> current (needs a local control DB)
npm run migrations:verify   # Verify migration checksums and released history
npm run demo:verify # Block retired real-family demo identifiers and images
npm run db:migrate    # Apply pending db/migrations to DATABASE_URL (Node 22.6+)
npm run build         # Production build
```

Schema changes live as ordered SQL files in `db/migrations/` (`NNN_name.sql`). Applied versions are tracked in the `schema_migrations` table, each file runs in its own transaction, and concurrent runners serialize on an advisory lock. In development the app applies pending migrations at boot (`DATABASE_AUTO_MIGRATE`); in production run `npm run db:migrate` against the production `DATABASE_URL` when a release includes new migrations.

Set `TEST_DATABASE_URL` to a **disposable** Postgres database before running either DB
command—never point it at real data. `test:db` intentionally runs every database-gated
suite serially because several legacy fixture cleanups share an archive prefix. The
command fails before Vitest when the URL is absent or identifies the same database as
`DATABASE_URL`.

The upgrade rehearsal is destructive by design: set
`TEST_RELEASE_UPGRADE_DATABASE_URL` to a separate local disposable control database.
It creates and drops isolated child databases and refuses remote hosts, application/test
database reuse, and connection-routing overrides. Product CI gives the standard suite,
large-import regression, and released-schema upgrade rehearsal separate required jobs.

## Data & privacy model

```
Provider export / DNA CSV ──▶ Private workspace (Postgres) ──▶ Curation gates ──▶ Public archive
                                  │                                  │
                                  ├─ raw records and snapshots       ├─ manual publish flag
                                  ├─ reviewable refresh changes      ├─ living-person gate
                                  └─ cases, evidence, AI runs        └─ privacy level gate
```

- Anonymous visitors see only manually published, automatically re-checked public content.
- Imported people default to private; publication requires deceased status and public privacy.
- Pre-import backups store a full workspace snapshot (the ten most recent are retained).
- Before publishing real data, review `/app/publishing` and `/app/reports`, then spot-check the public pages.

| Path | Contents | Git status |
| --- | --- | --- |
| `fixtures/` | Synthetic sample GEDCOM used by tests and demos | committed |
| `uploads/sources/` | Uploaded source files | ignored |
| `data/` | Local GEDCOM, DNA CSV, and research exports | ignored |

## Production releases

Deployments are release-driven: publishing a stable GitHub Release runs
`.github/workflows/vercel-release.yml` (Git auto-deployments are disabled in
`vercel.json`). The workflow requires the tag to match `package.json`, verifies that the
tagged commit is the checked-out revision on `origin/main`, matches the linked Vercel
project and organization, validates actual pulled production values, builds one prebuilt
artifact, and probes the deployment URL emitted by Vercel.

Required GitHub Actions secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

Required Vercel production environment: `DATABASE_URL` (Supabase transaction pooler on
port `6543` with `sslmode=require`—the app upgrades known Supabase pooler connections to
`verify-full` with the bundled root CA), `DATABASE_POOL_MAX=2`,
`DATABASE_AUTO_MIGRATE=false`, `APP_BASE_URL` set to the canonical HTTPS product origin,
`KINRESOLVE_DEPLOYMENT_MODE=hosted`, an explicit `KINRESOLVE_DATASET_MODE`, an explicit
`KINSLEUTH_ARCHIVE_ID`, `KINSLEUTH_ALLOW_SIGNUPS=false`, `AUTH_SECRET`, the selected private object-storage credentials, `CRON_SECRET`, and the
integration feature flags. The current product provider
configuration is intentionally considered incomplete until `APP_BASE_URL` is present;
the release workflow fails rather than guessing a legacy hostname.

This is still the legacy post-publication deployment choreography. It does not migrate
the production database or prove a backup/restore point, candidate smoke test, promotion,
or database rollback. Do not publish a migration-bearing release until the candidate-first
release slice and its runbook land; use `npm run db:migrate` only through an explicitly
reviewed maintenance procedure.

## Project map

| Path | What lives there |
| --- | --- |
| `app/` | Next.js App Router pages and API routes |
| `components/` | Shared UI and workspace components |
| `lib/` | GEDCOM/package parsing, integrations, private object storage, durable jobs, workspace store, search, DNA, AI, privacy, publishing, reports |
| `db/migrations/` | Versioned Postgres + pgvector schema migrations, tracked in `schema_migrations` |
| `tests/` | Vitest unit and Postgres integration coverage |
| `docs/` | Architecture notes and README screenshots |

## Status & known limitations

Kin Resolve is a working vertical slice suited to local/self-hosted beta use — not yet a production genealogy platform.

- Data-source artifacts have an archive-namespaced private-storage contract; legacy general source-file attachments still target local disk and need the same backend before production use.
- ANSEL-encoded GEDCOM files are decoded on a best-effort basis (UTF-8, UTF-16, and Windows-1252 are handled properly).
- Remembered data sources scope provider identifiers and GEDCOM xrefs to a connection. The legacy direct `/api/imports` path still uses xref-derived record ids, so two unrelated files sent through that legacy route can collide.
- Ancestry support is export-only. Partner OAuth, incremental API pulls, AncestryDNA, hints, messages, and writeback remain disabled unless a future written partner agreement explicitly authorizes them.
- FTM/RootsMagic binary media retention is not implemented. Packages still receive path reconciliation and missing/ambiguous-file reports. All non-GEDCOM ZIP entries must scan clean even while desktop media retention is disabled; retention stays gated on the unfinished rights-attestation release.
- Semantic (pgvector) retrieval is planned but not implemented; the embeddings table is provisioned and unused.
- Durable Postgres jobs provide leases, retries, cancellation, idempotency, and redacted errors. The registered integration parser runs through `npm run worker` for self-hosting or `/api/cron/integration-jobs` for bounded hosted processing. Invitations and member management are still evolving.

## License

Kin Resolve is free software licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). You may self-host, modify, and redistribute it under the AGPL's terms; if you run a modified version as a network service, the AGPL requires you to offer its source to users of that service. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution terms.
