# KinSleuth

KinSleuth is a self-hosted genealogy research workspace for one private family archive. It pairs a curated public family-history site with a private workspace for GEDCOM imports, people curation, cases, evidence, DNA match triage, source review, publishing readiness, quality reports, and local AI-assisted analysis.

The repository uses synthetic fixtures only. Put real GEDCOM exports, DNA match files, source uploads, and workspace snapshots in ignored local storage such as `data/`, `uploads/`, or `storage/`.

## What is included

- Public archive routes for the home page, published people, person profiles, stories, and places.
- Private workspace routes under `/app` for dashboard, people, cases, DNA, sources, GEDCOM imports, AI Analyst, reports, publishing, and settings.
- Server-backed workspace persistence at `storage/workspace.json`, seeded from synthetic demo data on first run.
- GEDCOM 5.5.1 parsing and apply flow that preserves raw records, source records, custom tags, checksums, and import history.
- People search with server pagination, publication/privacy/living filters, and private curation controls.
- DNA match triage with CSV import, helpfulness scoring, editable match details, case evidence linking, and connection hypotheses.
- Source register with upload metadata, transcript/notes fields, filters, search, and person/case links.
- Publishing readiness and quality reports for privacy risks, source gaps, low-confidence facts, and case/DNA follow-up.
- Optional password gate for private pages and APIs.
- AI Analyst local checks for source gaps, privacy risks, date conflicts, DNA leads, and case-focused next steps, with an OpenAI-compatible provider configuration reserved for richer semantic analysis.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

By default, private `/app` routes are open in local development. To protect them, copy `.env.example` to `.env` and set `KINSLEUTH_APP_PASSWORD` plus a long `AUTH_SECRET`.

```bash
cp .env.example .env
npm run dev
```

## Useful routes

| Route | Purpose |
| --- | --- |
| `/` | Public archive landing page |
| `/people` | Published people list |
| `/people/[slug]` | Public person profile |
| `/app` | Private investigation dashboard |
| `/app/people` | Search, filter, and curate people |
| `/app/cases` | Research cases and evidence |
| `/app/dna` | DNA match triage and hypotheses |
| `/app/sources` | Source register and transcript review |
| `/app/imports` | GEDCOM preview and apply flow |
| `/app/ai` | AI Analyst local research pass |
| `/app/reports` | Quality and evidence reports |
| `/app/publishing` | Public-profile readiness review |
| `/app/settings` | Workspace snapshot export/import/reset |

## Data and storage

KinSleuth intentionally keeps real genealogy data out of Git.

| Path | Contents | Git status |
| --- | --- | --- |
| `fixtures/` | Synthetic sample GEDCOM/data used by tests and demos | committed |
| `storage/workspace.json` | Runtime workspace store created on first run | ignored |
| `storage/backups/` | JSON backups written before GEDCOM apply operations | ignored |
| `uploads/sources/` | Uploaded source files | ignored |
| `data/` | Optional local GEDCOM, DNA CSV, and research exports | ignored |

If you want to reset local demo data, use the reset flow in `/app/settings` or remove `storage/workspace.json` while the dev server is stopped.

## Environment

`.env.example` documents the supported settings:

| Variable | Notes |
| --- | --- |
| `APP_BASE_URL` | Base URL for the running app |
| `AUTH_SECRET` | Secret used to sign the private workspace session cookie |
| `KINSLEUTH_APP_PASSWORD` | Enables password protection for `/app` and private APIs when set |
| `KINSLEUTH_WORKSPACE_PATH` | Optional override for the JSON workspace store path |
| `DATABASE_URL` | Reserved for the Docker/Postgres architecture |
| `S3_*` | Reserved for object storage-backed uploads |
| `AI_BASE_URL` | OpenAI-compatible provider base URL |
| `AI_API_KEY` | Optional; local deterministic AI checks still run without it |
| `AI_CHAT_MODEL` | Chat model name for provider-backed analysis |
| `AI_EMBEDDING_MODEL` | Embedding model name for future semantic retrieval |

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

The app runs at [http://localhost:3000](http://localhost:3000). Compose also provisions Postgres and MinIO-compatible object storage for the intended self-hosted architecture, although the current vertical slice primarily uses the JSON workspace store.

## Development commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Use `npm run test:watch` for focused Vitest iteration.

## Project map

| Path | What lives there |
| --- | --- |
| `app/` | Next.js App Router pages and API routes |
| `components/` | Shared UI and workspace components |
| `lib/` | GEDCOM parsing, workspace store, search, DNA, AI, privacy, publishing, and report logic |
| `tests/` | Vitest coverage for core domain behavior |
| `docs/architecture.md` | Architecture notes and privacy model |
| `scripts/worker.mjs` | Placeholder worker entry point |
| `db/migrations/` | Planned relational schema |

## Privacy model

Anonymous visitors only see manually published public content. Private workspace pages and APIs are password-protected when `KINSLEUTH_APP_PASSWORD` is configured. Public profile rendering also applies publication and privacy gates so living, private, and sensitive records are withheld from public routes.

Before publishing real data, review `/app/publishing` and `/app/reports`, then inspect public `/people` and `/people/[slug]` pages manually.

## Current status

KinSleuth is an early vertical slice, not a production genealogy platform. The main workflows are functional enough for local/self-hosted beta exploration, but relational persistence, background jobs, object-storage integration, semantic indexing, role management, and production deployment hardening are still evolving.
