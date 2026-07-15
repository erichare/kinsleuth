# Kin Resolve architecture

Kin Resolve separates three layers of genealogy data:

1. **Raw imports** preserve every GEDCOM record, custom tag, source reference, URL, media pointer, and import snapshot.
2. **Normalized research data** powers search, profiles, relationships, facts, sources, places, cases, DNA matches, and AI retrieval.
3. **Curated public content** currently uses person-level publish, living-status, and privacy gates. Granular fact/source curation and persisted public stories remain planned.

The V0.1 implementation is intentionally one-family-archive-per-deployment. That keeps privacy, branding, and permission decisions simple while leaving room for multi-archive hosting later.

## Runtime

- Next.js App Router renders public and private routes.
- Postgres stores normalized workspace data, import snapshots, backups, case tasks, and AI run history.
- `pgvector` is provisioned for semantic embeddings for source notes, facts, case evidence, and DNA match notes.
- Data-source artifacts use private, archive-namespaced object storage backed by either Vercel Blob or S3-compatible storage such as MinIO. Legacy general source-file attachments still use local disk and have not yet moved to this contract.
- Data-source parsing uses Postgres-backed leased jobs with retries, cancellation, and bounded worker batches. Self-hosted deployments run the long-lived worker; hosted deployments invoke the same worker protocol on a schedule. Individual parse jobs do not yet checkpoint mid-file, and durable embedding and long-running AI jobs remain planned.

## Privacy

Data-backed anonymous profile routes apply manual publication plus living/privacy gates. Private routes require authentication; whole-tree AI has an explicit role check, while route-wide permission enforcement remains in progress. Living people are conservatively inferred when no death fact exists and the birth date is within the last 100 years, or when dates are missing but recent relatives imply the person may be living.

## AI

AI is a provider abstraction, not a hard dependency. Structured checks run deterministically. Provider-backed analysis uses an OpenAI-compatible API when configured, sends full private workspace context, and stages suggestions for explicit user confirmation. Whole-tree AI is owner/admin only by default.
