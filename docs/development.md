# Development

Deeper development reference for Kin Resolve: migration machinery, test-database discipline, and the destructive release rehearsals. The everyday commands stay in the repository README.

## Migrations

Schema changes live as ordered SQL files in `db/migrations/` (`NNN_name.sql`). Applied versions are tracked in the `schema_migrations` table, each file runs in its own transaction, and concurrent runners serialize on an advisory lock. In development the app applies pending migrations at boot (`DATABASE_AUTO_MIGRATE`). The hosted workflow instead deploys an unaliased candidate first, proves that its runtime catalog fingerprint matches the dedicated `MIGRATION_DATABASE_URL`, refuses transaction-pooler port `6543`, preflights the exact approved ledger prefix before DDL, and proves the exact version ledger after applying the immutable checked-in SQL and release policy.

## Test databases

Set `TEST_DATABASE_URL` to a **disposable** Postgres database before running either DB
command (`npm run test:db` or `npm run test:db:large`)—never point it at real data. `test:db` intentionally runs every database-gated
suite serially because several legacy fixture cleanups share an archive prefix. The
command fails before Vitest when the URL is absent or identifies the same database as
`DATABASE_URL`.

## Upgrade and compatibility rehearsals

The upgrade rehearsal is destructive by design: set
`TEST_RELEASE_UPGRADE_DATABASE_URL` to a separate local disposable control database.
It creates and drops isolated child databases and refuses remote hosts, application/test
database reuse, and connection-routing overrides. The compatibility proof uses that same
guard, archives the exact locally pinned `v0.17.4` tag without fetching or running its
migrations, migrates only tracked `kr_compat_*` children forward to the current immutable
ledger, and executes the tagged login and workspace code with auto-migration disabled.
Its auth, guided-state, integration-reference, and pilot-seed observations must match
`db/release-policy.json` exactly. Product CI gives the standard suite, large-import
regressions, released-schema upgrade rehearsal, and legacy compatibility proof separate
required jobs.
