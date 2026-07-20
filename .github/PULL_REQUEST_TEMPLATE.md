## Summary

<!-- What does this change and why? Keep changes focused — small, reviewable
pull requests with tests are much easier to land than large ones. -->

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run migrations:verify` passes
- [ ] `npm run build` passes
- [ ] `npm audit --omit=dev --audit-level=high` passes
- [ ] For workspace, import, or database changes: `npm run test:db`,
      `npm run test:db:large`, and `npm run test:release-upgrade` pass against
      disposable local databases (see [CONTRIBUTING.md](https://github.com/erichare/kinresolve/blob/main/CONTRIBUTING.md))
- [ ] New behavior has tests; bug fixes have a regression test
- [ ] No real genealogy data anywhere in the change — synthetic fixtures only
- [ ] Every commit is signed off (`git commit -s`), agreeing to the contribution
      terms in [CONTRIBUTING.md](https://github.com/erichare/kinresolve/blob/main/CONTRIBUTING.md)
