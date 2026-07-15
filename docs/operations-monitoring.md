# Hosted beta monitoring and observability contract

**Status:** Prelaunch operating contract. Provider configuration, private alert
destinations, and an owner-observed test alert are still launch gates.

This runbook defines what Kin Resolve may send to an observability provider, what
the hosted monitors must prove, and how an operator responds without leaking family
research. It complements the incident procedure in
[`incident-response.md`](incident-response.md).

## Safety rules

- Monitor only the canonical HTTPS product origin. Never put credentials, tokens,
  email addresses, archive IDs, object paths, or family data in a monitor URL.
- Keep the public health endpoint content-free. Detailed readiness belongs behind
  the dedicated observability probe secret.
- Treat monitor request and response bodies as private operational data. Do not paste
  the protected health body into a public issue, chat, or status page.
- Do not enable provider request-body capture, session replay, DOM recording, user
  profiling, URL query capture, raw breadcrumbs, or automatic console collection.
- A telemetry failure must not change a participant request or worker result. The
  signed operator test alert is the one exception: it fails unless delivery succeeds.
- Secrets used for auth, cron, release fencing, event ingestion, and internal probing
  must all be different.

## HTTP probe surfaces

### Public readiness

`GET /api/health` requires no credential. It returns `cache-control: no-store` and
only these fields:

```json
{
  "status": "ok",
  "product": "KinSleuth",
  "version": "<release version>"
}
```

`KinSleuth` is the current backwards-compatible machine product identity even though the
participant-facing brand is Kin Resolve. Change it only with the release validators,
workflow probes, monitors, and compatibility tests in the same release.

The response is HTTP 200 when the runtime is ready and HTTP 503 with
`status: "degraded"` otherwise. A monitor must reject redirects, HTML, extra fields,
an unexpected product/version, and any status other than 200 or 503. The static
holding deployment intentionally returns 404 here and must never be mistaken for a
healthy product.

### Protected readiness and worker freshness

`GET /api/internal/health` requires:

```text
Authorization: Bearer <KINRESOLVE_OBSERVABILITY_PROBE_SECRET>
```

The application authenticates this request before it touches the database or object
store. The secret must be a distinct 43–128 character base64url value and must not
equal `AUTH_SECRET`, `CRON_SECRET`, `RELEASE_FENCE_SECRET`, or
`KINRESOLVE_OBSERVABILITY_INGEST_SECRET`.

The protected body includes version, a sanitized 40-character
`releaseCommitSha`, database identity posture, dataset mode, capability flags,
scheduled-write state, object-storage identity posture, and the three durable worker
heartbeats plus bounded job-lag health. The SHA is present only when the build-bound
`KINRESOLVE_BUILD_COMMIT_SHA` is a full lowercase Git SHA. Release and recovery
workflows inject the exact checked-out SHA at build time; a valid platform-provided
`VERCEL_GIT_COMMIT_SHA` is only a fallback for non-workflow builds. An absent/null SHA
fails production release and backup binding. The body
deliberately omits database hosts, connection errors, object keys, participant
identity, archive names, and record counts. A 401 is an
authentication/configuration failure; a 503 is a readiness failure. `workers: null` or
`jobLag: null` means the bounded operations query failed and is a critical monitor
condition even if another field appears healthy.

Current worker thresholds are part of the code contract:

| Worker kind | Expected schedule | Warning | Critical |
| --- | --- | ---: | ---: |
| `integration-jobs` | Every five minutes | 10 minutes | 20 minutes |
| `import-upload-cleanup` | Daily | 30 hours | 48 hours |
| `retention-cleanup` | Daily, with import cleanup | 30 hours | 48 hours |

A missing heartbeat is critical. A durable `failed` outcome is critical. A running
heartbeat is warning until it completes.

The separate `jobLag` object reports only bounded, archive-scoped operational values:

| Field | Contract |
| --- | --- |
| `eligibleCount` | Queued jobs already available plus expired running leases eligible for retry, capped at 1,000 |
| `eligibleCountCapped` | `true` when the real count is greater than 1,000 |
| `oldestEligibleAgeSeconds` | Age of the oldest eligible job/expired lease, or `null` when none exists |
| `recentFailedCount` | Terminal failed jobs updated within the last 24 hours, capped at 1,000 |
| `recentFailedCountCapped` | `true` when the real recent-failure count is greater than 1,000 |
| `freshness` | `healthy`, `warning`, or `critical` |

Oldest eligible age becomes warning at 10 minutes and critical at 20 minutes. Any
recent terminal failure is critical. The SQL reads at most 1,001 rows from each bounded
set and returns no job ID, payload, lease owner/token, archive identity, error text, or
family data. Job-lag freshness is an alert signal independent of the top-level runtime
status; a healthy HTTP 200 with `jobLag.freshness: critical` still pages the operator.

### Browser error signal

The browser may send only this exact, same-origin JSON body to
`POST /api/observability/client-errors`:

```json
{"event":"browser-unhandled-error"}
```

The route accepts at most 128 bytes and emits a fixed route-level event. Stack traces,
messages, component state, URLs, query strings, user values, and browser context are
not accepted. HTTP 202 means the signal was accepted; it does not guarantee provider
delivery.

## Structured event contract

The server emits schema version 1 with a strict allowlist:

| Field | Allowed value |
| --- | --- |
| `schemaVersion` | `1` |
| `event` | A fixed event name listed below |
| `severity` | `info`, `warning`, or `error` |
| `release` | A 40-character Git SHA or package version |
| `environment` | `development`, `preview`, `production`, or `test` |
| `occurredAt` | ISO timestamp |
| `code` | Optional fixed code from the exact allowlist below |
| `durationMs` | Optional nonnegative bounded integer |
| `operationType` | Optional `research-export` or `deletion-request` |
| `requestId` | Optional UUID |
| `route` | Optional route template, never a raw URL |
| `workerKind` | Optional fixed worker kind |

The schema-recognized event names are:

```text
api_error
browser_unhandled_error
case_created
deletion_completed
deletion_requested
export_completed
import_applied
import_completed
import_rolled_back
import_staged
integration_worker_failed
invite_accepted
operator_test_alert
retention_cleanup_completed
worker_failed
worker_started
worker_succeeded
```

`deletion_completed` is reserved for the later complete teardown path; defining the
name does not mean deletion completion is currently implemented.

The only accepted codes are:

```text
AUTHORIZATION_ERROR
CONFIGURATION_ERROR
DATABASE_ERROR
NETWORK_ERROR
STORAGE_ERROR
TEST_ALERT
TIMEOUT
UNEXPECTED_ERROR
```

Known low-level timeout, network, configuration, and PostgreSQL codes are mapped into
that set. Every other exception value becomes `UNEXPECTED_ERROR`; an arbitrary
uppercase `error.code` is never forwarded.

The endpoint in `KINRESOLVE_OBSERVABILITY_ENDPOINT` must be HTTPS with no credentials,
query, or fragment. The bearer credential is
`KINRESOLVE_OBSERVABILITY_INGEST_SECRET`. Provider response bodies are never read.
Configure the provider to discard every field not present above. API-token used/revoked
events belong to the later API slice and are not implemented in this operational release.

The current implementation is a fixed, privacy-safe operational event stream, not a
stack-bearing exception SDK. It does not send exception messages or stack traces, and
the browser endpoint sends only a signal. Private production source-map upload,
release-to-map association, and a provider scrub configuration have not yet been
proven. Either complete that provider integration with redaction tests and no publicly
served source maps, or record the fixed-signal boundary as an explicit launch decision;
do not claim full exception tracking/source-map support from the event stream alone.

## Required monitor set

The reviewed machine contract lives in
[`config/production-monitors.json`](../config/production-monitors.json). Validate it
before translating it into provider configuration:

```bash
npm run monitoring:validate
```

The JSON contains only paths and fixed response contracts. Provider account IDs,
destinations, secrets, and the canonical origin remain in the protected provider
configuration, never in this repository.

| Monitor | Interval | Success contract | Alert policy |
| --- | ---: | --- | --- |
| Public JSON health | 1 minute, two regions | Exact HTTPS origin, HTTP 200, JSON `status: ok`, expected product/version, no redirect | Warning on first failure; SEV-1 after two consecutive failures or a version mismatch |
| Login page | 5 minutes | `/login` returns HTTP 200 HTML containing Kin Resolve and the invitation-only boundary | SEV-1 after two consecutive failures |
| Anonymous app redirect | 5 minutes | `/app` redirects only to canonical `/login?next=/app` | Immediate SEV-1 on cross-origin or unexpected destination |
| Anonymous API denial | 5 minutes | `/api/people` without cookies returns the fixed private 401 contract | Immediate SEV-0 on data/2xx; SEV-1 on repeated unexpected response |
| Unsigned cron denial | 15 minutes | `/api/cron/integration-jobs` without a secret returns 401 | Immediate SEV-0 on 2xx |
| Protected readiness | 1 minute | HTTP 200; exact 40-character deployed commit, version, database/storage identities, and hosted capability posture | SEV-1 after one commit/identity mismatch; otherwise after two failures |
| Worker freshness | 5 minutes | All three protected heartbeat entries healthy | Warning/critical at the code thresholds above |
| Durable job lag/failure | 5 minutes | `jobLag` non-null and healthy; no eligible job older than 10 minutes; no terminal failure in the 24-hour window | Warning at 10 minutes; SEV-1 at 20 minutes, any recent terminal failure, null result, or capped count |
| Synthetic canary | After B6 only | Isolated synthetic account completes the approved non-content canary | Do not configure against participant data; SEV-1 on two failures |
| Backup deadman | Daily backup plus grace period | Fresh attested/checksummed backup evidence exists | SEV-1 when missed; never signal success before checksum round-trip |

Monitor requests must use `cache-control: no-cache`, disable redirects where the
contract expects none, and cap response bytes. The protected monitor credential belongs
only in the monitor secret store; it must not appear in the target URL or alert text.

## Alert routing and acceptance

Route SEV-0 and SEV-1 alerts to the private on-call channel and a second independent
path. Route warnings to the operations queue with a daily review. Public status updates
contain impact only; raw event payloads and protected health responses stay private.

Before inviting a participant, the owner must observe a real provider alert generated
through the signed operator path:

```bash
npm run beta:alert:test
```

The command requires the offline operator environment documented in
[`auth.md`](auth.md). Acceptance requires all of the following:

1. The CLI returns `accepted: true` and a request ID.
2. The provider receives exactly one `operator_test_alert` with code `TEST_ALERT`.
3. The event contains no operator key, signature, nonce, environment secret, URL, or
   participant value.
4. The primary and secondary alert paths notify the current responder.
5. The responder acknowledges and records the elapsed delivery time.

Repeat the test after provider changes, credential rotation, alert-routing changes,
and at least monthly during a real-data pilot.

## Prelaunch failure drills

Run failure drills only in a disposable or isolated staging cell with synthetic data.
Before the first real invitation, prove:

- a stale/missing integration heartbeat, a durable failed heartbeat, an eligible job
  older than each threshold, an expired retryable lease, and a recent terminal job
  failure reach the expected warning/critical alert paths;
- database unavailability makes public/protected health fail safely and does not send a
  connection string, host, raw error, or family value;
- object-storage unavailability returns a safe participant error and alerts without an
  object key or Blob URL;
- an invalid/expired cron credential gets 401, stops heartbeat freshness, and triggers
  the expected stale-worker alert;
- a failed candidate migration never promotes, retains the exact write fence/holding
  posture required by the release workflow, and triggers release containment; and
- redaction fixtures containing names, email addresses, GEDCOM lines, cookies,
  authorization headers, bearer tokens, query strings, and Blob URLs are absent from
  console and provider payloads.

Record release SHA, synthetic cell identity digests, event/request IDs, alert delivery
times, safe UI result, containment result, and pass/fail. Do not deliberately break a
real participant cell to satisfy this drill.

## Retention and review

The proposed limits are 14 days for operational events and 90 days for non-content
security/audit events, but they are not active promises until owner/counsel approval and
provider lifecycle verification. Keep alert evidence longer only as a privacy-safe
incident or rehearsal receipt. Review provider field configuration, alert recipients,
failed heartbeats, and test-alert delivery monthly. Record only event names, timestamps,
release IDs, request IDs, fixed codes, response actions, and evidence digests.

## Disable and rollback

Removing `KINRESOLVE_OBSERVABILITY_ENDPOINT` or its ingest secret disables external
event delivery without disabling health or the product. Do not remove the protected
probe while an external monitor or recovery workflow depends on it. If the provider
itself is suspected of exposure, disable delivery, rotate the ingest secret, preserve
privacy-safe evidence, and follow [`incident-response.md`](incident-response.md).
