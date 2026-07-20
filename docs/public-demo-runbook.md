# Public demo release and operations runbook

**Status:** The application and automation contracts are implemented. The public demo is
not launch-ready until every external item in this runbook is configured and rehearsed.
`demo.kinresolve.com` is the only public product runtime. `kinresolve.com` remains the
marketing site and `app.kinresolve.com` remains private-beta holding.

This runbook is the source of truth for the synthetic Hartwell–Mercer public demo. It does
not authorize real-family data, visitor uploads, accounts, email, object storage, arbitrary
prompts, arbitrary text, or external integrations. The staging and production product
release procedure lives in [releases.md](releases.md).

## Control-plane prerequisites

1. Create the dedicated Vercel project `kinresolve-demo`. It must differ from both the
   marketing and private-beta product projects. Disable Git deployments and production
   custom-domain auto-assignment, and enable Standard Protection without generated-URL
   exceptions.
2. Create a dedicated demo database and separate migration/runtime credentials. Record its
   catalog-derived SHA-256 identity. It must never share a database, identity, or credential
   with a real-family pilot. Do not provision object storage or transactional email.
3. Keep `demo.kinresolve.com` attached only to `kinresolve-demo`. The holding workflow can
   move it atomically from the marketing project. Marketing deploys fail unless they prove
   the demo project owns the hostname and marketing does not.
4. Keep the retired **Operate Kin Resolve synthetic staging demo session** workflow manually
   disabled in GitHub, and keep repository variable `KINRESOLVE_STAGING_DEMO_WORKFLOW_ID`
   set to its immutable numeric ID. The retired workflow file has been removed from the
   repository, but GitHub retains the workflow record under that ID, and release remains
   blocked unless GitHub reports it as `disabled_manually` with no active run.
5. Set repository variable `PRODUCT_CI_WORKFLOW_ID` to the immutable numeric ID of
   `.github/workflows/ci.yml`. Release requires a successful exact-SHA `main` push run whose
   `Product release contract` job succeeded.
6. Resolve every open high or critical code-scanning alert. The release preflight queries
   GitHub directly and fails closed before protected demo credentials are available.

## Protected environment inventory

Do not replace environment-scoped credentials with repository-wide secrets.

### `demo-production`

Require reviewers and no deployment wait timer. Configure these secrets:

- `DEMO_HOLDING_DEPLOYMENT_ID`
- `KINRESOLVE_DEMO_CANARY_SECRET`
- `KINRESOLVE_OBSERVABILITY_PROBE_SECRET`
- `MIGRATION_DATABASE_URL`
- `PUBLIC_DEMO_RUNTIME_DATABASE_URL`
- `SENTRY_AUTH_TOKEN` (optional; workflow-only source-map upload — never a
  Vercel setting)
- `VERCEL_AUTOMATION_BYPASS_SECRET`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `VERCEL_TOKEN`

Configure these readable variables:

- `AI_GATEWAY_API_KEY_ID`
- `AI_GATEWAY_MONTHLY_BUDGET_USD=50`
- `APP_BASE_URL=https://demo.kinresolve.com`
- `KINRESOLVE_DATABASE_IDENTITY`
- `MARKETING_VERCEL_PROJECT_ID`
- `PRODUCTION_DATABASE_IDENTITY`
- `PRODUCTION_VERCEL_PROJECT_ID`
- `SENTRY_ORG` and `SENTRY_PROJECT` (optional; set together with
  `SENTRY_AUTH_TOKEN` or source-map upload stays disabled)
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The secret and readable Vercel identities must match. Demo project and database identities
must differ from the marketing/private-beta exclusions. The protected runtime URL must be
the same bounded `krdemo_runtime` connection configured as Vercel's Sensitive
`DATABASE_URL`; rotate and update both copies together.

### `demo-containment`

This is automatic safety infrastructure: no required reviewer and no wait timer. Configure
`DEMO_HOLDING_DEPLOYMENT_ID`, both demo canary/observability secrets, and the three Vercel
secrets. Configure `APP_BASE_URL`, both Vercel identity variables,
`MARKETING_VERCEL_PROJECT_ID`, and `PRODUCTION_VERCEL_PROJECT_ID`. Values must identify the
same dedicated demo project as `demo-production`.

### `demo-monitoring`

Configure `APP_BASE_URL=https://demo.kinresolve.com` plus
`KINRESOLVE_DEMO_CANARY_SECRET`, `KINRESOLVE_OBSERVABILITY_PROBE_SECRET`, and the optional
fixed-schema `DEMO_MONITOR_ALERT_URL`. This environment must not receive database, AI,
authentication, migration, Vercel deployment, object-storage, or email credentials.

The Vercel Production environment for `kinresolve-demo` must match the exact hosted-demo
contract validated in `.github/workflows/public-demo-release.yml`, including the dedicated
database identity, `datasetMode=demo`, public-demo origin, disabled API v1/uploads/accounts,
the aggregate analytics mode (`KINRESOLVE_PUBLIC_DEMO_ANALYTICS=plausible`; cookieless
Plausible page and fixed-event counts, no identifier or record content), and the
server-only AI, cookie, privacy-HMAC, cron, canary, and health-probe secrets, and the
deliberate connection-pool bound (`DATABASE_POOL_MAX=10`, sized against the Supabase
session-pooler limits of the dedicated demo database so a landing spike saturates the
demo's own pool before it can exhaust the pooler). Optional readable settings are
allowed for launch hardening: `NEXT_PUBLIC_SENTRY_DSN`, the public Sentry ingest
identifier for aggressively scrubbed error events (no headers, cookies, query
strings, bodies, or user identity; tracing and replay disabled);
`KINRESOLVE_DEMO_TURNSTILE_MODE` (`off`, `shadow`, or `required` — launch ladder:
`shadow` soaks for at least a week before `required`); and
`NEXT_PUBLIC_KINRESOLVE_DEMO_TURNSTILE_SITE_KEY`, the public widget key required by
any enabled Turnstile rung. The matching siteverify secret
`KINRESOLVE_TURNSTILE_SECRET_KEY` is an optional Sensitive setting. Authorized
canaries, the load test, and the spike test bypass the Turnstile challenge through
the canary header, so monitoring never depends on Cloudflare availability.
`SENTRY_AUTH_TOKEN` remains workflow-only and is rejected as a Vercel setting.

## First holding cutover

1. Run **Deploy Kin Resolve static holding page** from the exact current `main` SHA with
   target `public-demo` and a blank promotion acknowledgement. Record the validated
   candidate deployment ID.
2. Store that ID as `DEMO_HOLDING_DEPLOYMENT_ID` in `demo-production` and
   `demo-containment`.
3. Rerun from the same SHA and target with this exact acknowledgement:

   ```text
   PROMOTE KIN RESOLVE STATIC HOLDING TO DEMO.KINRESOLVE.COM
   ```

4. The workflow must atomically move the hostname from marketing when necessary, prove the
   destination domain record belongs to `kinresolve-demo`, prove marketing returns `404`
   for that project-domain lookup, byte-compare the canonical body with `holding/login.html`,
   and prove `/api/health` returns `404`.
5. Copy the successful workflow receipt into the launch evidence record. Do not continue if
   the project was paused, the domain remains on marketing, or canonical bytes differ.

## Release procedure

Public-demo releases are holding-only. Before dispatching a release, use action `contain` to
move `demo.kinresolve.com` to the pinned holding deployment, then verify the canonical body
matches `holding/login.html` and `/api/health` returns `404`. A release fails closed if the
captured canonical deployment is not verified holding.

After that containment proof, run **Release Kin Resolve public demo** with action `release`
and the exact 40-character SHA currently at `main`. Every release resets temporary visitor
progress; operators must treat all guest sandbox state as disposable before containment.

The workflow refuses release unless the legacy controller is disabled/idle, the exact-SHA
Product CI gate passed, code scanning has no open high/critical alert, the dedicated project
and hostname identities match, the demo database differs from production, and the current
canonical deployment is verified holding. It then:

1. captures the canonical deployment, requires the pinned holding identity, byte-compares
   `holding/login.html`, proves `/api/health` is `404`, and records the holding-proof time
   before any database or runtime-grant mutation;
2. validates the pulled hosted-demo configuration and fictional fixture boundary;
3. attests the migration database identity, migrates with the migration role, performs only
   the explicitly confirmed canonical fixture rotation compiled into that release when the
   persisted synthetic fixture is the expected previous version, provisions and verifies
   `kinresolve-demo-public`, and grants/re-attests only the runtime operations;
4. deploys an unaliased protected candidate without waiting inside the Vercel CLI, then
   bounded-polls the exact REST record until it is both `READY` and `STAGED`; an
   `INITIALIZING/STAGED` record remains retryable and can never reach canaries or promotion.
   The candidate carries exact SHA/run/version plus `releaseRole=public-demo`,
   `datasetMode=demo`, and `canonicalArchiveId=kinresolve-demo-public` metadata;
5. waits until at least 65 seconds have elapsed since the holding proof (covering the
   session start/reset endpoints' 60-second execution ceiling), revalidates the exact same
   canonical holding deployment and bytes, then uses the attested runtime credential to revoke every
   disposable guest sandbox and AI lease, clean their synthetic archives, durably retry
   tracked late-created archives, require an explicit zero-archive batch, and prove zero
   occupied capacity. After protected health and Chromium/WebKit/Firefox
   archive-isolation/reset journeys, it
   revalidates holding and repeats the zero-capacity drain immediately before the unchanged
   25-session capacity and five-second p95 gate; and
6. rechecks current `main`, promotes the exact candidate, proves the canonical deployment,
   then runs the full public monitor.

Never promote a Vercel dashboard-selected candidate or a typed deployment URL.

## Rollback and containment

For a known compatible prior public-demo deployment, dispatch action `rollback` with its
exact `dpl_...` ID. The workflow accepts only a READY production deployment in the
dedicated project whose metadata proves `public-demo`, `demo`, the canonical archive, and
well-formed GitHub/version provenance. It promotes that exact target, proves the canonical
ID, and runs the full demo monitor.

For immediate unpublish, dispatch action `contain` with no rollback ID. The workflow
validates and promotes `DEMO_HOLDING_DEPLOYMENT_ID`, proves its exact static metadata and
canonical ID, byte-compares the holding body, and proves `/api/health` is `404`.

If a new candidate promotes but canonical proof fails, automation first promotes and proves
the already validated previous target. A successful `vercel promote` is not sufficient.
If that proof fails, it promotes and proves the pinned holding deployment. A failed,
cancelled, or timed-out release also triggers `.github/workflows/public-demo-safety.yml`,
which restores domain ownership and the pinned holding page or pauses `kinresolve-demo`
fail-closed. Do not rerun release until the exact safety receipt exists.

The safety workflow first proves whether the pinned holding deployment is already current;
that idempotent state is a successful restore and must not be converted into a project pause
because Vercel returned an “already current” promotion conflict. If an operator manually
unpauses `kinresolve-demo`, immediately restore and re-attest
`autoAssignCustomDomains=false` before creating any deployment.

## Rehearsal sequence

Before launch, record one complete rehearsal from a single exact `main` SHA:

`holding -> candidate -> public -> rollback -> holding -> same-SHA re-promotion`

Required evidence:

- holding deployment ID, exact canonical byte proof, and domain ownership proof;
- candidate ID and exact GitHub run/attempt/SHA metadata;
- cross-browser, isolation, capacity, AI-quota/fallback, accessibility, and monitor results;
- successful manual rollback with canonical monitor proof;
- successful containment with holding bytes and health `404`;
- successful release of the same SHA after containment; and
- deliberate failed-candidate or cancelled-run exercise showing the automatic safety
  workflow reaches a proved holding state or pauses the exact project.

The demo database is rebuildable synthetic state. Fixture/source RPO is zero, visitor
progress is disposable, and the recovery objective is a clean reprovision within 30
minutes. Time and record one destroy/reprovision exercise.

## Landing-view sampling

`landing_viewed` database events are sampled: one in ten non-canary landing renders
records an event, so a front-page traffic spike cannot turn every page view into a
durable write. When reading the KPI funnel, multiply landing counts by 10 before
comparing them with the unsampled `session_started`, `outcome_completed`, and
`capacity_rejected` events. Canary traffic remains fully excluded from the sample by
the canary header, and Plausible page counts (when enabled) stay unsampled, so the
two sources are reconciled with the same factor. Spike and load runs
(`scripts/public-demo-spike-test.mjs`, `scripts/public-demo-load-test.mjs`) deliberately
drive over-capacity session starts and therefore inject `capacity_rejected` events that
carry no canary attribution, at the recorded run timestamp and rejection count, so KPI
reviews must subtract each recorded run's rejections from the funnel.

## Monitoring and incident response

`.github/workflows/public-demo-monitoring.yml` checks landing, health, and family bodies
every 15 minutes. Every six hours it runs a disposable start-task-end journey excluded from
human conversion metrics. Protected health additionally checks capacity, cleanup
freshness, stale provisioning, and AI budget state.

On failure:

1. inspect the exact Actions run and fixed operational event only; never paste protected
   health bodies or credentials into an issue;
2. use action `contain` for uncertain privacy, isolation, database, AI, or domain state;
3. verify canonical holding bytes and health `404`, or confirm the dedicated project is
   paused;
4. preserve fixed-schema aggregate events only; never collect IP, user agent, search,
   prompt/output, arbitrary feedback, or third-party identifiers—the optional Plausible
   counts stay cookieless and identifier-free; and
5. apply the incident procedure in `docs/incident-response.md` before restoring traffic.

## External launch checklist

- [ ] Dedicated `kinresolve-demo` project exists and Git/auto-domain deployment is disabled.
- [ ] `demo.kinresolve.com` serves the exact holding artifact from that project; marketing
      and `app.kinresolve.com` do not own it.
- [ ] Dedicated synthetic database and distinct migration/runtime roles are configured;
      no object store or email service is attached.
- [ ] GitHub protected environments and immutable workflow-ID variables match this runbook.
- [ ] Legacy staging controller is manually disabled and idle.
- [ ] Product CI is green and there are zero open high/critical code-scanning alerts.
- [ ] The dedicated AI Gateway key has a $50 monthly hard budget inside the overall $250
      demo envelope; the 150-call daily application cap and overall 50%, 80%, and 100%
      spend alerts are configured; deterministic fallback is visibly labeled.
- [ ] Full release/rollback/holding/same-SHA rehearsal and 30-minute rebuild exercise passed.
- [ ] Chromium, WebKit, Firefox core, 390-pixel mobile, keyboard-only, and WCAG 2.2 AA gates
      passed with zero serious/critical automated findings.
- [ ] Twenty-session KPI instrumentation review confirms canaries are excluded from both
      the database funnel (the canary header and `is_canary` session flag) and Plausible
      (the browser canary sets the `plausible_ignore` localStorage flag before any
      navigation).
- [ ] The launch-scale spike gate (`scripts/public-demo-spike-test.mjs`) passed against
      the launch candidate: 200 concurrent landing requests with p95 under 2 seconds,
      over-capacity session starts fast-429 in under 1 second, zero 5xx responses,
      and healthy post-run protected diagnostics.
- [ ] Demo session Turnstile completed at least a one-week `shadow` soak and was
      flipped to `required` (or a signed deferral is recorded), with the canary bypass
      verified in monitoring.
- [ ] Five unfamiliar testers each complete the research outcome without assistance in
      under two minutes.
- [ ] Two or three attributable tester quotes are captured during the five-tester gate,
      with written consent recorded, attributed by first name and researcher type only,
      per [`public-demo-launch-materials.md`](public-demo-launch-materials.md).
- [ ] Plausible is receiving pageviews and the fixed custom events on both
      `kinresolve.com` and `demo.kinresolve.com`, and a full canary monitoring run
      produces zero Plausible events.
- [ ] Sentry received one deliberate, scrubbed test error from demo production, and the
      recorded event was spot-checked to contain no headers, cookies, query, body, or
      user context.
- [ ] `GET /api/public/demo-stats` is live with its cache headers verified, and the
      marketing counter was proven to disappear gracefully with the demo contained
      (holding artifact serving).
- [ ] The demo cell's runtime role passed the `NOBYPASSRLS` attestation with the
      archive-scoped policies active, or a signed deferral of the role flip is recorded
      here.
- [ ] The deployed landing notice is the version that names Plausible, Cloudflare
      Turnstile, and Sentry, and founder/legal review re-approved that exact wording.
- [ ] The marketing flip was rehearsed end to end: `KINRESOLVE_MARKETING_DEMO_MODE=live`
      on a preview deployment (repository variable plus `site-deploy` input), hero and
      counter verified, then rolled back to `pending`.
- [ ] Founder/legal review approves the fictional-data notice, privacy wording, feedback
      fields, and the August 13, 2026 launch (or August 20 contingency).
