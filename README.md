# KinSleuth

KinSleuth is a self-hostable, AI-assisted genealogy investigation platform. It is designed for one family archive per deployment: a curated public family-history site on the outside and a private research workspace for GEDCOM imports, cases, evidence, DNA match triage, and whole-tree analysis on the inside.

This repository is MIT licensed and intentionally uses synthetic fixtures. Real family trees, GEDCOM exports, DNA match exports, uploads, and research files belong in `data/` or external storage and are ignored by Git.

## V0.1 vertical slice

- Public family archive at `/` with manually published ancestor/story/place indexes.
- Product information at `/kinsleuth`.
- Private workspace at `/app` with people, cases, DNA matches, imports, AI analysis, and settings.
- GEDCOM 5.5.1 parser/import scaffolding that preserves raw records, xrefs, custom Ancestry tags, notes, citations, URLs, media references, and import snapshots.
- DNA match triage with helpfulness scoring and connection hypotheses.
- Role model for owner, admin, editor, contributor, and viewer.
- OpenAI-compatible AI provider abstraction with structured checks and semantic-index scaffolding.
- Docker Compose for app, Postgres with pgvector, MinIO-compatible object storage, and worker.

## V0.2 work in progress

- Connected GEDCOM import preview in `/app/imports`, including browser file loading, parsed summaries, preserved raw-data counts, and optional re-import diff preview.
- Connected DNA match analysis in `/app/dna`, including editable match details, helpfulness scoring, candidate branch/geography/common-ancestor hypotheses, evidence, and uncertainty.
- Connected case drafting in `/app/cases`, including initial hypotheses and evidence notes.
- Quality reports in `/app/reports` for privacy risks, source gaps, DNA triage blockers, and under-evidenced cases.

## V0.3 checkpoint

- Browser-local persistence for DNA analyses, case drafts, and GEDCOM import previews.
- Workspace snapshot export/import/reset in `/app/settings` so local research edits can be saved as portable JSON.
- Recent local import preview history in `/app/imports`.
- Versioned health endpoint now reports the current KinSleuth checkpoint.

## V0.4 checkpoint

- Publication readiness review in `/app/publishing` for manually curated public profiles.
- Per-person publish gates for living status, privacy level, public facts, citation coverage, low-confidence facts, and story context.
- Publishing readiness API at `/api/publishing/readiness`.
- Private navigation now includes a dedicated publishing safety workflow before public sharing.

## V0.5 checkpoint

- Server-side workspace store at ignored `storage/workspace.json`, seeded from synthetic fixtures.
- Cases and DNA analyses now persist through workspace-backed APIs.
- Private dashboard, people, cases, DNA, AI, reports, and publishing pages read from the workspace store.
- Public people, profile, place, and home routes use runtime publish/privacy gates instead of static demo arrays.

## V0.6 checkpoint

- Private Sources workspace at `/app/sources`.
- Upload API now stores files under ignored `uploads/sources/` and records metadata in the workspace store.
- Sources support type, repository, citation date, transcript, notes, privacy, confidence, and person/case links.
- Source register and transcript views make uploaded evidence usable inside research workflows.

## V0.7 checkpoint

- Optional local password gate for `/app/*` and private workspace APIs.
- Signed httpOnly session cookie with seven-day expiry.
- Real `/login` form, `/api/auth/login`, `/api/auth/logout`, and sidebar sign-out.
- Set `KINSLEUTH_APP_PASSWORD` and `AUTH_SECRET` in `.env` to protect a self-hosted beta instance.

## V0.8 checkpoint

- Private person profile curation controls for published status, privacy level, and living status.
- Curation API at `/api/people/[id]/curation`.
- Public pages immediately respect curation edits through existing publish/privacy gates.
- Password gate now also protects private person curation APIs.

## V0.9 checkpoint

- GEDCOM preview can now be applied to the workspace from `/app/imports`.
- Applying a GEDCOM upserts imported people, extracts GEDCOM source records, preserves raw record text/checksums, and records applied-import history.
- A JSON backup is written under ignored `storage/backups/` before each apply.
- Person curation settings are preserved when the same GEDCOM xref is reapplied.

## V0.10 checkpoint

- Private people workspace now supports full-text search across names, places, dates, notes, facts, and GEDCOM identifiers.
- People can be filtered by publication state, privacy level, and living status.
- Large imported trees render through paginated result sets instead of dumping every person into one browser table.
- People table now surfaces publication/privacy/living safety states and fact counts for faster curation.

## V0.11 checkpoint

- DNA match triage now supports CSV bulk import from `/app/dna`.
- Import mapping accepts common match-name, shared-cM, tree-status, side, surname, place, shared-match, note, and URL headers.
- DNA CSV rows are validated with row-level skip reasons while valid rows still import.
- Bulk imports persist through the server workspace store and automatically mark very helpful matches as high priority.

## V0.12 checkpoint

- DNA match triage now has search, side/tree/status/helpfulness filters, sorting, and pagination for larger match lists.
- Selecting a DNA row updates the hypothesis panel instead of always showing the first match.
- Selected matches can be triaged, annotated, re-sided, reclassified by tree status, and deleted from the workspace.
- New `/api/dna/[id]` update/delete endpoints persist match queue cleanup through the server workspace store.

## V0.13 checkpoint

- Selected DNA matches can be linked directly into investigation cases as evidence from `/app/dna`.
- DNA evidence linking upserts an existing match link instead of creating duplicate evidence entries.
- New `/api/cases/[id]/evidence` endpoint persists linked DNA evidence to the workspace case store.
- Case list/detail views now make linked DNA evidence easier to spot during investigation review.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

The app runs at [http://localhost:3000](http://localhost:3000), Postgres at `localhost:5432`, and MinIO at [http://localhost:9001](http://localhost:9001).

## Private data

Do not commit real genealogy data. Put local-only files under `data/`, for example:

```text
data/Riemer - Zajicek 2015 with DNA.ged
data/dna-matches.csv
data/uploads/
```

The public repo should use only synthetic fixtures from `fixtures/`.

## Useful commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
