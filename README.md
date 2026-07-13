# KinSleuth

KinSleuth is a self-hosted genealogy research workspace for one private family archive. It pairs a curated public family-history site with a private Postgres-backed workspace for GEDCOM imports, people curation, cases, evidence, DNA match triage, source review, publishing readiness, quality reports, and provider-backed AI-assisted analysis.

The repository uses synthetic fixtures only. Put real GEDCOM exports, DNA match files, source uploads, and research exports in ignored local storage such as `data/` or `uploads/`.

## What is included

- Public archive routes for the home page, published people, person profiles, stories, and places.
- Private workspace routes under `/app` for dashboard, people, cases, DNA, sources, GEDCOM imports, AI Analyst, reports, publishing, and settings.
- Postgres workspace persistence, seeded idempotently from synthetic demo data on first run.
- GEDCOM 5.5.1 parsing and apply flow that preserves raw records, source records, custom tags, checksums, and import history.
- Private direct-to-object-storage staging for large GEDCOM files, with bounded previews and batched Postgres persistence.
- People search with server pagination, publication/privacy/living filters, and private curation controls.
- DNA match triage with CSV import, helpfulness scoring, editable match details, case evidence linking, and connection hypotheses.
- Source register with upload metadata, transcript/notes fields, filters, search, and person/case links.
- Publishing readiness and quality reports for privacy risks, source gaps, low-confidence facts, and case/DNA follow-up.
- Optional password gate for private pages and APIs.
- AI Analyst deterministic checks plus OpenAI-compatible provider calls, saved run history, cited context, provider fallback handling, and staged case-task suggestions.
- Case tasks can be added and moved through todo, doing, and done states from the case detail page.

## Quick start

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`DATABASE_URL` is required. The default `.env.example` value matches the Postgres service in `docker-compose.yml`. By default, private `/app` routes are open in local development. To protect them, set `KINSLEUTH_APP_PASSWORD` plus a long `AUTH_SECRET`.

## Useful routes

| Route | Purpose |
| --- | --- |
| `/` | Public archive landing page |
| `/people` | Published people list |
| `/people/[slug]` | Public person profile |
| `/app` | Private investigation dashboard |
| `/app/people` | Search, filter, and curate people |
| `/app/cases` | Research cases, evidence, and task queues |
| `/app/dna` | DNA match triage and hypotheses |
| `/app/sources` | Source register and transcript review |
| `/app/imports` | GEDCOM preview and apply flow |
| `/app/ai` | Provider-backed AI Analyst, saved run history, cited context, and staged task creation |
| `/app/reports` | Quality and evidence reports |
| `/app/publishing` | Public-profile readiness review |
| `/app/settings` | Runtime, provider, archive, and role settings |
| `/api/health` | JSON runtime health for Postgres and AI provider configuration |

## Data and storage

KinSleuth intentionally keeps real genealogy data out of Git.

| Path | Contents | Git status |
| --- | --- | --- |
| `fixtures/` | Synthetic sample GEDCOM/data used by tests and demos | committed |
| `uploads/sources/` | Uploaded source files | ignored |
| `data/` | Optional local GEDCOM, DNA CSV, and research exports | ignored |

Workspace records live in Postgres. To reset local demo data, use a disposable local database or clear the `archives` row for your `KINSLEUTH_ARCHIVE_ID`; the next read seeds synthetic data again.

## Environment

`.env.example` documents the supported settings:

| Variable | Notes |
| --- | --- |
| `APP_BASE_URL` | Base URL for the running app |
| `AUTH_SECRET` | Secret used to sign the private workspace session cookie |
| `KINSLEUTH_APP_PASSWORD` | Enables password protection for `/app` and private APIs when set |
| `KINSLEUTH_ARCHIVE_ID` | Optional archive id; defaults to `archive-default` |
| `DATABASE_URL` | Required Postgres connection string for runtime workspace storage |
| `DATABASE_POOL_MAX` | Maximum connections per app instance; use `2` for serverless deployments |
| `DATABASE_AUTO_MIGRATE` | Runs the idempotent bootstrap schema when enabled; set `false` after provisioning production |
| `TEST_DATABASE_URL` | Optional Postgres connection string for DB integration tests |
| `BLOB_READ_WRITE_TOKEN` | Server-only token for the private Vercel Blob store used to stage large GEDCOM imports |
| `CRON_SECRET` | Server-only bearer token used by the daily stale-import cleanup job |
| `S3_*` | Reserved for object storage-backed uploads |
| `AI_BASE_URL` | OpenAI-compatible provider base URL |
| `AI_API_KEY` / `OPENAI_API_KEY` | Optional; provider-backed AI runs when present, deterministic fallback runs without it |
| `AI_API_MODE` | `responses` by default; set `chat` for chat-completions-compatible providers |
| `AI_CHAT_MODEL` | Chat model name for provider-backed analysis |
| `AI_EMBEDDING_MODEL` | Reserved for planned pgvector-backed semantic retrieval; embeddings are not generated or queried yet |

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

The app runs at [http://localhost:3000](http://localhost:3000). Compose provisions Postgres with pgvector and MinIO-compatible object storage. Runtime workspace data is stored in Postgres. Small GEDCOM imports continue to work without Blob in local development; files whose combined request would approach Vercel's function limit use the private Blob staging flow when `BLOB_READ_WRITE_TOKEN` is configured.

## Development commands

```bash
npm run typecheck
npm run lint
npm run test
npm run test:db
npm run test:db:large
npm run build
```

Use `npm run test:watch` for focused Vitest iteration. Set `TEST_DATABASE_URL` before `npm run test:db` to run the Postgres-backed workspace and GEDCOM apply integration tests; without it, those tests are skipped. `npm run test:db:large` is the explicit 10.5+ MB, 65,000-person load regression and uses the same disposable test database. Stable-release CI runs both database commands against an ephemeral pgvector/Postgres service before deploying.

`/api/health` returns `200` when Postgres is reachable and `503` when the app is degraded because `DATABASE_URL` is missing or the database cannot be reached.

## Production releases

Production deployments are release-driven. Vercel Git auto-deployments are disabled in `vercel.json`; publishing a stable GitHub Release runs `.github/workflows/vercel-release.yml`, checks out that release tag, validates it, builds it with the production environment, and deploys the prebuilt artifact.

Configure these GitHub Actions secrets before publishing a release:

| Secret | Purpose |
| --- | --- |
| `VERCEL_TOKEN` | Project-scoped Vercel token used only by the release workflow |
| `VERCEL_ORG_ID` | Vercel team id from `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Vercel project id from `.vercel/project.json` |

The Vercel production environment must include `DATABASE_URL`, `DATABASE_POOL_MAX=2`, `DATABASE_AUTO_MIGRATE=false`, `AUTH_SECRET`, `KINSLEUTH_APP_PASSWORD`, `BLOB_READ_WRITE_TOKEN` from a private Vercel Blob store, and `CRON_SECRET`. Use Supabase's transaction-pooler connection string on port `6543` for `DATABASE_URL` with `sslmode=require`; KinSleuth upgrades known Supabase pooler connections to `verify-full` with the bundled Supabase root CA. Never use the production database as `TEST_DATABASE_URL`.

GEDCOM files above 3.5 MB are uploaded directly from the authenticated browser to a private Blob store, bypassing Vercel's fixed function request limit. Files are capped at 25 MB each and current-plus-previous diff inputs at 32 MB total to stay inside the parser's tested memory envelope. Import APIs receive only a scoped object reference, validate the path, ETag, size, and content type, then remove the temporary object after a successful apply. Abandoned staging objects older than 24 hours are pruned both opportunistically and by a daily authenticated Vercel Cron job. General source-file uploads still target local disk in this slice, so those attachments require separate object-storage support before production use. Transcript-only source records and all Postgres-backed workflows are unaffected.

## Project map

| Path | What lives there |
| --- | --- |
| `app/` | Next.js App Router pages and API routes |
| `components/` | Shared UI and workspace components |
| `lib/` | GEDCOM parsing, workspace store, search, DNA, AI, privacy, publishing, and report logic |
| `tests/` | Vitest coverage for core domain behavior |
| `docs/architecture.md` | Architecture notes and privacy model |
| `scripts/worker.mjs` | Placeholder worker entry point |
| `db/migrations/` | Postgres and pgvector schema |

## Privacy model

Anonymous visitors only see manually published public content. Private workspace pages and APIs are password-protected when `KINSLEUTH_APP_PASSWORD` is configured. Public profile rendering also applies publication and privacy gates so living, private, and sensitive records are withheld from public routes.

Before publishing real data, review `/app/publishing` and `/app/reports`, then inspect public `/people` and `/people/[slug]` pages manually.

## Current status

KinSleuth is an early vertical slice, not a production genealogy platform. The main workflows are functional enough for local/self-hosted beta exploration, and runtime persistence now uses Postgres. Known gaps that are on the roadmap but not yet built: GEDCOM export, semantic (pgvector) retrieval, background job processing, S3/MinIO-backed uploads, enforced role management and per-user accounts, restorable backups, and multi-archive hosting. Treat single-editor use as the supported mode; concurrent editing of the same archive can lose updates.

## License

KinSleuth is free software licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). You may self-host, modify, and redistribute it under the AGPL's terms; if you run a modified version as a network service, the AGPL requires you to offer its source to users of that service. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution terms.
