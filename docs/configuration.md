# Configuration

This is the full environment-variable reference for Kin Resolve. It moved here from the repository README, which keeps only an essentials table. The hosted cohort boundary behind the capability flags is defined in [the hosted beta contract](hosted-beta-contract.md), and the data-source storage variables are explained in [Data source integrations](data-source-integrations.md).

## Environment variables

`.env.example` documents every supported variable:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | **Required.** Postgres connection string for workspace storage |
| `DATABASE_POOL_MAX` | Max connections per instance; use `2` for serverless |
| `DATABASE_AUTO_MIGRATE` | Applies pending versioned migrations at boot; hosted production requires exactly `false` and uses the candidate workflow's dedicated migration connection |
| `KINRESOLVE_DEPLOYMENT_MODE` | `self-hosted` or `hosted`; required in hosted production and set explicitly by the bundled Compose stack |
| `KINRESOLVE_DATASET_MODE` | Persisted archive contract: `empty`, versioned fictional `demo`, or real-data `pilot`; required for hosted deployments and provisioning |
| `KINRESOLVE_DNA_ENABLED` | Hosted cohort one: `false`; server-side DNA capability gate |
| `KINRESOLVE_EXTERNAL_AI_ENABLED` | Hosted cohort one: `false`; prevents external-provider analysis calls |
| `KINRESOLVE_PUBLIC_ARCHIVE_ENABLED` | Hosted cohort one: `false`; disables anonymous archive surfaces |
| `KINRESOLVE_PUBLIC_PUBLISHING_ENABLED` | Hosted cohort one: `false`; disables publication mutations independently from archive visibility |
| `KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED` | Hosted cohort one: `false`; permits transcript-only sources while rejecting binary source/evidence uploads |
| `KINRESOLVE_PACKAGE_MEDIA_ENABLED` | Hosted cohort one: `false`; disables ZIP/package media retention |
| `KINRESOLVE_PLAIN_GEDCOM_ENABLED` | Hosted cohort one: `true`; admits only `.ged`/`.gedcom` files subject to the fixed 10 MiB and 40,000-person limits |
| `KINSLEUTH_ALLOW_SIGNUPS` | Hosted releases require exactly `false`; self-hosted first-run signup remains available when no account exists |
| `KINRESOLVE_GUIDED_RESEARCH_ENABLED` | Server-side kill switch for the private case guide and its mutation APIs; defaults to `true`, set `false` to disable without deleting research history |
| `KINRESOLVE_EXPORT_REFRESH_ENABLED` | Data-source tree import/refresh gate; defaults to `true` |
| `KINRESOLVE_DESKTOP_MEDIA_ENABLED` | Requests the private FTM/RootsMagic media path; defaults to `false` and is ineffective without the legal-review gate and per-package rights acknowledgement |
| `KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED` | Independent operator assertion that the private media rights language and release were reviewed; defaults to `false` |
| `KINRESOLVE_MALWARE_SCANNER` | Worker malware scanner provider: `clamd` or `none`; media-bearing ZIPs fail closed when unset |
| `KINRESOLVE_CLAMD_HOST` / `KINRESOLVE_CLAMD_PORT` | Private clamd TCP endpoint; no filenames or genealogy metadata are sent |
| `KINRESOLVE_MALWARE_SCAN_TIMEOUT_MS` | Whole-file clamd connection/scan timeout, default `30000` |
| `KINRESOLVE_MALWARE_SCAN_MAX_BYTES` | Per-file INSTREAM ceiling, default `25165824`; must not exceed clamd `StreamMaxLength` |
| `KINRESOLVE_ANCESTRY_API_ENABLED` | Future partner-API rollout request; defaults to `false` and has no effect without separate written approval |
| `KINRESOLVE_ANCESTRY_PARTNER_APPROVED` | Independent operator assertion that written Ancestry approval exists; both Ancestry API gates must be true |
| `AUTH_SECRET` | Secret for account sessions (better-auth); required in production |
| `KINRESOLVE_BETA_PRIVACY_HMAC_SECRET` | Separate high-entropy hosted secret used only to HMAC emails, client addresses, actors, and durable rate-limit subjects; never reuse `AUTH_SECRET` |
| `KINRESOLVE_BETA_APPLICATIONS_ENABLED` | Public native application endpoint gate; defaults off and accepts only exact `true` or `false`. Keep it independent from the API release mode |
| `KINRESOLVE_BETA_APPLICATION_HMAC_SECRET` | Required only when native applications are enabled; distinct 32-byte-or-stronger server-only HMAC key for application/email/idempotency identities. Never reuse any app, provider, recovery, database, storage, AI, or release credential |
| `KINRESOLVE_BETA_OPERATOR_AUDIENCE` / `KINRESOLVE_BETA_OPERATOR_KEY_ID` / `KINRESOLVE_BETA_OPERATOR_PUBLIC_KEY_SPKI` | Hosted operator cell identity: exact canonical product origin plus the ID and Ed25519 public key used to verify signed invitation commands |
| `KINRESOLVE_BETA_LEGAL_STATUS` / `KINRESOLVE_BETA_*_{VERSION,SHA256,URL}` | Exact approved participation-terms, privacy-notice, and cohort-boundary metadata; URLs must be versioned paths on `https://kinresolve.com` and their bytes are verified during release, viewing, and acceptance |
| `KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER` / `KINRESOLVE_TRANSACTIONAL_EMAIL_FROM` / `KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO` | Hosted release requires Resend with the approved `beta@kinresolve.com` sender and reply-to contract |
| `RESEND_API_KEY` | Sensitive server-only Resend credential for invitations, verification, recovery, and security notifications |
| `KINSLEUTH_ARCHIVE_ID` | Archive id; set explicitly before `npm run archive:provision` (the runtime fallback remains `archive-default` for legacy self-hosted installs) |
| `KINRESOLVE_OBJECT_STORAGE_BACKEND` | Private data-source artifact backend (`s3` or `vercel-blob`); archive namespace enforcement is fixed by the storage contract |
| `BLOB_READ_WRITE_TOKEN` | Server-only credential for Vercel Blob artifact storage and archive-namespaced legacy large-GEDCOM staging |
| `S3_ENDPOINT` | Server/worker endpoint for S3-compatible private artifact reads and writes |
| `S3_PUBLIC_ENDPOINT` | Browser-reachable endpoint used only when signing direct-upload POST policies |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | **Required for Docker Compose.** Operator-supplied credentials shared by the bundled MinIO service, app, worker, and bucket initializer |
| `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Private S3/MinIO bucket and server-only credentials for non-Compose runtimes; Compose derives its access keys from the required MinIO values |
| `KINRESOLVE_WORKER_*` | Worker identity, polling and maintenance intervals, lease duration, per-run parse bound, and bounded staged-upload cleanup limit |
| `CRON_SECRET` | Bearer token for scheduled integration parsing and stale-upload cleanup jobs |
| `RELEASE_FENCE_SECRET` | Dedicated 256-bit-or-stronger base64url/hex bearer token for protected production release-fence transitions; generate with `openssl rand -hex 32` and never reuse `CRON_SECRET` |
| `AI_BASE_URL` / `AI_API_KEY` | OpenAI-compatible provider; deterministic fallback runs without a key |
| `AI_API_MODE` | `responses` (default) or `chat` |
| `AI_CHAT_MODEL` / `AI_EMBEDDING_MODEL` | Chat model for analysis; the embedding model is reserved for planned pgvector retrieval (not implemented yet) |
| `APP_BASE_URL` | Exact canonical origin of the running app; production requires one HTTPS origin such as `https://app.kinresolve.com` and uses it for redirects and cookie-mutation origin checks |

The seven hosted capability flags are required together and fail closed when absent or invalid. They remain commented in `.env.example` so copying that file does not change self-hosted defaults; a hosted operator must uncomment the complete cohort-one manifest. The 10 MiB (10,485,760-byte) and 40,000-person GEDCOM limits are fixed application boundaries, not environment overrides.

Browser-facing cookie mutations are registered explicitly and fail before database or
session access unless `Origin` equals `APP_BASE_URL` exactly and
`Sec-Fetch-Site: same-origin` is present. Better Auth endpoints keep Better Auth's own
origin validation, and cron endpoints require their independent bearer secret. Scripts
should not reuse browser session cookies as an API credential; the versioned bearer API
is a separate release surface. If a trusted diagnostic must reproduce a browser
mutation, it must send both request-origin headers in addition to the protected session
cookie.

## Docker Compose stack

Before starting Compose, set unique non-empty `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` values in `.env` (for example, generate the password with `openssl rand -hex 32`). Compose fails closed when either value is missing and supplies the same credential pair to the app, worker, MinIO, and bucket initializer.

Compose provisions Postgres with pgvector, explicitly provisions the versioned fictional demo, and starts private MinIO object storage alongside the production app. Both the app and worker wait for that one-shot provisioning service. The MinIO API and console are published only on the host loopback interface at ports `9000` and `9001`. The data-source storage contract uses archive-namespaced keys; legacy general source-file attachments still use local disk. MinIO allows direct-upload CORS from `http://localhost:3000`; production deployments must configure their exact HTTPS app origin for multipart `POST` uploads. Durable job state lives in Postgres, and the worker runs the registered export parser continuously by default. The web and worker processes share database, storage, and rollout configuration.
