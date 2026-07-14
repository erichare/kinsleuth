# Contributing to Kin Resolve

Thanks for your interest in Kin Resolve. This document covers how to contribute and the
legal terms that apply to contributions.

## Development setup

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run dev
```

Before opening a pull request, make sure the checks pass:

```bash
npm run lint
npm run typecheck
npm run test
npm run migrations:verify
npm run build
npm audit --omit=dev --audit-level=high
```

For workspace, import, or database changes, use disposable local databases and run the
same fail-closed commands as product CI:

```bash
TEST_DATABASE_URL=postgres://... npm run test:db
TEST_DATABASE_URL=postgres://... npm run test:db:large
TEST_RELEASE_UPGRADE_DATABASE_URL=postgres://... npm run test:release-upgrade
```

`test:db` covers every suite gated by `TEST_DATABASE_URL`; do not replace it with a
hand-maintained file list. The large-import command uses the same disposable database
guard. The upgrade rehearsal creates and drops child databases, so its control URL must
be local, disposable, and distinct from both `TEST_DATABASE_URL` and `DATABASE_URL`.

## Ground rules

- Never commit real genealogy data. The repository uses synthetic fixtures only; real
  GEDCOM exports, DNA match files, and source uploads belong in ignored local storage
  (`data/`, `uploads/`).
- Keep changes focused. Small, reviewable pull requests with tests are much easier to
  land than large ones.
- New behavior needs tests; bug fixes need a regression test.

## License and contribution terms

Kin Resolve is licensed under the [GNU Affero General Public License v3.0](LICENSE)
(AGPL-3.0-only).

To keep the project sustainable, Kin Resolve is developed under an open-core model: the
open-source project is a working self-hosted beta, and the maintainer plans a hosted
service after its security, privacy, tenancy, and operations gates are met. Commercially
licensed editions may also be offered. Supporting that model requires the ability to
license contributed code under terms other than the AGPL.

By submitting a contribution (pull request, patch, or code snippet) you agree that:

1. **You have the right to contribute it.** The contribution is your original work, or
   you have sufficient rights to submit it under these terms.
2. **Inbound = outbound, plus a relicensing grant.** Your contribution is licensed to
   the project under AGPL-3.0-only, and you additionally grant the project maintainer
   (Eric Hare) a perpetual, worldwide, non-exclusive, royalty-free right to relicense
   your contribution — including under commercial license terms — as part of Kin Resolve.
3. **You retain your copyright.** This is a license grant, not a copyright transfer.
   Nothing prevents you from using your own contribution elsewhere.

To record agreement, sign off each commit (Developer Certificate of Origin style):

```bash
git commit -s
```

which adds a `Signed-off-by: Your Name <you@example.com>` line. Sign-off on a Kin Resolve
pull request signifies agreement to the terms above.

If you contribute on behalf of an employer, make sure you are authorized to agree to
these terms for that work.

## Questions

Open a GitHub issue or discussion. For anything sensitive (security reports, privacy
concerns about published data), email the maintainer instead of filing a public issue.
