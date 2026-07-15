# Workspace persistence design

## Problem

Until this change, every mutation ran read-modify-write on the whole archive:
`mutateWorkspace` locked the archive row, loaded every table into a `WorkspaceData`
object, applied the change in JS, then `persistWorkspace` deleted **all** rows across
twelve tables and re-inserted everything. Toggling one task status on a 65,000-person
archive rewrote the entire dataset — O(archive size) write amplification, constant
dead tuples, and mutation latency that scales with the largest tree.

## Approach: row-level writes behind the same facade

The public API of `lib/workspace-store.ts` is unchanged — routes and components keep
calling `createCase`, `addCaseTask`, `saveDnaMatch`, etc. Internally each mutator now:

1. Opens one transaction and runs
   `UPDATE archives SET updated_at = now() WHERE id = $1 RETURNING id` — this both
   takes the row lock that serializes concurrent mutations (the same guarantee the
   old `SELECT ... FOR UPDATE` provided) and bumps the workspace timestamp. A missing
   archive fails closed; only explicit archive provisioning creates archive data.
2. Reads only the rows it needs (a case and its children, one DNA match, the people
   list for hypothesis generation) via scoped loaders in `lib/store/rows.ts`.
3. Writes only the rows it changes with targeted `INSERT ... ON CONFLICT (archive_id, id)
   DO UPDATE` / `UPDATE` / `DELETE` statements.

`readWorkspace()` (full load) still exists for pages that genuinely need the whole
workspace and for GEDCOM export. The hottest read paths use scoped SQL instead:
people search/filter/sort/pagination and the public people pages run targeted
queries in `lib/store/people-queries.ts` (accent-insensitive matching via the
`unaccent` extension, migration 002), with `ensureWorkspaceProvisioned` validating
the persisted dataset contract without writing. Remaining surfaces (dashboard, reports, sources, DNA)
move over in later slices.

## Ordering without renumbering

List order is persisted in `sort_order` columns and every list is newest-first: the
old code prepended to arrays and re-persisted them with fresh indexes. Row-level
writes keep that contract by assigning
`sort_order = COALESCE(MIN(sort_order), 0) - 1` (scoped per archive, and per case for
case children) to prepended rows. Negative values are fine — only relative order
matters — and no existing row is ever renumbered. Bulk prepends (DNA CSV imports,
GEDCOM people) take a contiguous descending range below the current minimum.

## What stays bulk

- **Explicit archive provisioning**: `npm run archive:provision` creates an empty,
  versioned fictional demo, or pilot archive in one transaction. Ordinary reads and
  writes never create an archive. A demo upgrade rotates to a fresh archive rather
  than partially resetting an existing cell.
- **`writeWorkspace`**: kept for tests and whole-workspace restores; not used by any
  route mutator anymore.
- **GEDCOM apply**: still loads the full workspace once (the pre-import backup
  snapshot stores it as jsonb), but its writes are scoped: upserts touch only
  imported people/sources, facts are replaced only for imported people,
  `raw_records` are replaced only for the incoming `import_id`, and other tables
  (cases, DNA matches, AI runs) are no longer rewritten.
- **DNA hypotheses** (`dna_hypotheses`, derived + currently write-only): upserted
  per match on DNA mutations and refreshed for all matches after a GEDCOM apply
  (people changed), instead of being recomputed for every match on every mutation.

## Invariants preserved

- Concurrent mutators serialize on the archive row lock; no lost updates.
- Newest-first ordering of cases, tasks, sources, DNA matches, AI runs, imports,
  and backups as observed through `readWorkspace()`.
- AI run history capped at 25; backups capped at 10 (pruned by `sort_order`).
- Re-import curation carry-forward (`mergeImportedPeople` same-person check) and
  the pre-import backup snapshot, now written in the same statement that creates
  the backup row (no post-persist patch step).

## Performance note: cached foreign-key check plans

Postgres caches each foreign key's referenced-row lookup plan per session
(backend). If the first insert into `person_facts` happens while `people` is
tiny — exactly what in-transaction demo provisioning can do — that cached RI-check
plan can be a sequential scan. Every later fact insert in the same session then
seq-scans the (by now large) people table once per row: a 20k-person import
went from ~1s to ~20s this way, with the time invisible to `EXPLAIN` (it hides
inside constraint-trigger execution). `replacePersonFacts` therefore issues
`DISCARD PLANS` before bulk fact writes so the check re-plans against the
table's current size. This matters beyond seeding: a pooled connection whose
first fact write served a small archive would otherwise poison later large
imports on the same connection.

## Verification

`tests/workspace-store.test.ts` (behavior parity) and `tests/gedcom-apply.test.ts`
(including the 65k-person regression) provision their fixtures explicitly. New
`tests/workspace-row-store.test.ts` asserts the row-level property directly: it
captures `xmin` (the row-version system column) of unrelated rows before a mutation
and verifies they are untouched afterward — under the old delete-all/insert-all
path every row's identity changed on every write.
