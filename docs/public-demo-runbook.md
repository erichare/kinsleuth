# Public demo release and operations runbook

**Status:** The application and automation contracts are implemented. The public demo is
not launch-ready until every external item in this runbook is configured and rehearsed.
`demo.kinresolve.com` is the only public product runtime. `kinresolve.com` remains the
marketing site and `app.kinresolve.com` remains private-beta holding.

This runbook is the source of truth for the synthetic Hartwell–Mercer public demo. It does
not authorize real-family data, visitor uploads, accounts, email, object storage, arbitrary
prompts, arbitrary text, or external integrations.

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
4. Manually disable **Operate Kin Resolve synthetic staging demo session** in GitHub. Set
   repository variable `KINRESOLVE_STAGING_DEMO_WORKFLOW_ID` to its immutable numeric ID.
   The checked-in workflow is a credential-free tombstone, but release remains blocked
   unless GitHub reports it as `disabled_manually` with no active run.
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
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The secret and readable Vercel identities must match. Demo project and database identities
must differ from the marketing/private-beta exclusions.

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
and the server-only AI, cookie, privacy-HMAC, cron, canary, and health-probe secrets.

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

Run **Release Kin Resolve public demo** with action `release` and the exact 40-character SHA
currently at `main`.

The workflow refuses release unless the legacy controller is disabled/idle, the exact-SHA
Product CI gate passed, code scanning has no open high/critical alert, the dedicated project
and hostname identities match, and the demo database differs from production. It then:

1. validates the pulled hosted-demo configuration and fictional fixture boundary;
2. attests the migration database identity, migrates with the migration role, provisions
   and verifies `kinresolve-demo-public`, and grants/re-attests only the runtime operations;
3. validates the current canonical rollback target and pinned holding deployment;
4. deploys an unaliased protected candidate carrying exact SHA/run/version plus
   `releaseRole=public-demo`, `datasetMode=demo`, and
   `canonicalArchiveId=kinresolve-demo-public` metadata;
5. runs protected health, Chromium/WebKit/Firefox journeys, archive-isolation/reset checks,
   and the 25-session capacity/p95 gate; and
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
   prompt/output, arbitrary feedback, or third-party identifiers; and
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
- [ ] Twenty-session KPI instrumentation review confirms canaries are excluded.
- [ ] Five unfamiliar testers each complete the research outcome without assistance in
      under two minutes.
- [ ] Founder/legal review approves the fictional-data notice, privacy wording, feedback
      fields, and the August 13, 2026 launch (or August 20 contingency).
