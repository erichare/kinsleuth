# Static maintenance holding deployment

Kin Resolve keeps its maintenance target in the repository as a deterministic Vercel
Build Output API v3 artifact. It is the rollback target for the release procedure in
[releases.md](releases.md) and a deliberately separate deployment surface from the
Next.js product:

- `GET` or `HEAD /login` (and `/`) renders the checked-in private-beta holding page.
- `/api/health` returns `404`; the holding deployment cannot impersonate a healthy app.
- Every response carries the product's private security, HSTS, and `noindex` headers.
- The output contains one HTML file and `config.json`, with no functions, runtime code,
  cron schedule, environment values, database connection, or object-storage client.

Build and verify it locally without credentials:

```bash
npm run holding:build
npm run holding:verify
```

The builder replaces only `.vercel/output` and produces the same bytes from the same
checked-in source. The verifier fails if any file is added, either expected file changes,
or a symlink or runtime function appears.

## Protected deployment workflow

Run **Deploy Kin Resolve static holding page** (`.github/workflows/vercel-holding.yml`)
manually from `main`. Supply the exact 40-character commit shown by the workflow dispatch
form and select `beta-staging`, `public-demo`, or `production`. The first and last use the
`kinresolve-beta-release` queue. `public-demo` uses `demo-production` and the
`kinresolve-public-demo-release` queue.

Before checkout, enter both protected-infrastructure acknowledgements required by the
product release workflow:

```text
I acknowledge Vercel production deployment auto-assignment is disabled in the protected project dashboard.
I acknowledge Vercel Standard Protection covers every generated deployment URL and has no exceptions.
```

These record the reviewer's dashboard checks. Standard Protection remains a dashboard
prerequisite backed by an unauthenticated generated-URL probe. The workflow separately
proves that candidate returns `401` or `403` without credentials or Kin Resolve page
content, then fetches and byte-compares the checked-in holding page through the automation
bypass before promotion.

Each target environment needs only these Vercel deployment secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `VERCEL_AUTOMATION_BYPASS_SECRET`

It also needs readable `APP_BASE_URL` and `VERCEL_PROJECT_ID` environment variables. The
secret project ID must equal the readable project ID. Production is pinned to
`https://app.kinresolve.com` and the production Vercel project; beta-staging must use a
different HTTPS origin and Vercel project. Public demo is pinned to
`https://demo.kinresolve.com` and project name `kinresolve-demo`; it also requires readable
`MARKETING_VERCEL_PROJECT_ID`, and the demo project must differ from marketing and
production.

The workflow does not pull Vercel environment variables and never receives application,
database, Blob, authentication, or cron credentials. It links the selected project locally,
deploys the prebuilt artifact with that project's production target and `--skip-domain`,
and validates the Vercel REST record for exact ownership, readiness, absence of the target's
canonical alias, and this metadata:

| Metadata | Exact value |
| --- | --- |
| `releaseRole` | `kinresolve-static-holding-v1` |
| `databaseAccess` | `none` |
| `rollbackPolicy` | `forward-only` |
| `packageVersion` | `holding-v1` |

The default, blank promotion acknowledgement stages the holding deployment without moving
any domain. To intentionally place a target's canonical origin on this static deployment,
enter the exact acknowledgement for the selected environment:

| Target | Exact acknowledgement |
| --- | --- |
| `beta-staging` | `PROMOTE KIN RESOLVE STATIC HOLDING TO BETA-STAGING` |
| `public-demo` | `PROMOTE KIN RESOLVE STATIC HOLDING TO DEMO.KINRESOLVE.COM` |
| `production` | `PROMOTE KIN RESOLVE STATIC HOLDING TO APP.KINRESOLVE.COM` |

For example, the production acknowledgement is:

```text
PROMOTE KIN RESOLVE STATIC HOLDING TO APP.KINRESOLVE.COM
```

Any other non-empty value fails before checkout. After an acknowledged promotion, the
workflow immediately PATCHes the supported Vercel project `autoAssignCustomDomains` field
to `false`, independently GETs and validates the exact unpaused project, then polls and
proves that the selected environment's `APP_BASE_URL` resolves to the exact validated
holding deployment. If the field cannot be disabled and proven on the same runner, the
workflow attempts to pause and independently re-read that exact project; the source run
still fails so an operator must resolve and rerun the safety path before another release.
For `public-demo`, promotion also atomically moves the hostname from marketing when needed,
proves the dedicated-project domain record, proves marketing no longer owns it,
byte-compares the canonical page with `holding/login.html`, and requires `/api/health` to
return `404`.

## Automatic runner-loss repair

Every dispatch is marked with its target, run ID, and attempt. After an exact failed,
cancelled, or timed-out attempt, `.github/workflows/holding-safety.yml` inspects that
attempt's GitHub job record without credentials to determine whether the promotion step was
skipped. It then uses a target-specific automatic environment:

- `beta-staging-containment` for `beta-staging`;
- `demo-containment` for `public-demo`;
- `production-containment` for `production`.

None of these environments may require a reviewer or wait timer. They carry only the Vercel
control secrets needed by this repair plus independently protected readable
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` variables; the secret and readable identities must
match before any Vercel mutation. Production is additionally pinned to the checked-in
production project ID, while beta-staging must differ. Public-demo repair also restores and
proves dedicated hostname ownership and exact holding bytes. The repair PATCHes auto-assignment to `false` and
independently GET-validates the project. If that cannot be proved and promotion may have
run, it pauses and re-reads the exact project. A pre-promotion failure never triggers a
pause, but a failed repair still withholds the exact safety receipt and blocks later
release, recovery, and holding workflows. Successful repair records
`Repair holding run <id> attempt <n>`; reruns bind historical attempts by immutable
workflow/repository/SHA provenance rather than GitHub's mutable display title.

The workflow exposes the validated deployment ID as a job output and writes this copyable
environment-specific line to the run summary:

```text
STAGING_HOLDING_DEPLOYMENT_ID=dpl_...             # beta-staging
DEMO_HOLDING_DEPLOYMENT_ID=dpl_...                # public-demo
FIRST_CUTOVER_HOLDING_DEPLOYMENT_ID=dpl_...       # production
```

Review that deployment, then store the exact ID as the named secret in the same protected
environment. Before a product release, beta-staging's canonical origin must already resolve
to its approved static holding deployment. The staging release job proves that exact ID,
static metadata, canonical alias, and holding-page smoke before it can mutate the isolated
database. It then deploys and smokes the product candidate only on its generated, unaliased
URL; it never promotes the candidate. Production permits its forward-only alias rollback
only to its metadata-attested holding deployment. Creating the artifact or merging this
path does not deploy or promote it automatically.
