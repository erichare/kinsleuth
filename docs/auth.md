# Identity, accounts, and tenancy design

_Status: Phase 1 identity core. This document records the auth-library decision the
roadmap deferred to "Phase 1 design" and the phased plan for replacing the shared
password with real accounts._

## Where this starts from

Access control today is a single shared password: `proxy.ts` gates `/app/*` and the
private API prefixes, and the session cookie is an HMAC-signed timestamp carrying no
identity. `lib/rbac.ts` defines five roles and twelve permissions but is enforced in
exactly one place — with a role read from the request body, which any authenticated
caller can forge. The `users` table from the initial schema has never been read or
written.

## Library decision: better-auth

Considered: Auth.js (next-auth v5), better-auth, and hand-rolling on the existing
HMAC session machinery.

- **Hand-rolling** is disqualified for a hosted service that will store DNA-adjacent
  data: password hashing, session revocation, reset tokens, and invitation flows are
  exactly the code that should come from a maintained, widely-audited library.
- **Auth.js** treats credentials (email + password) as a second-class provider — no
  built-in verification or reset flows for it — and its adapter model fights this
  repo's plain-`pg`, own-migrations approach.
- **better-auth** is credentials-first, TypeScript-native, self-hostable (MIT),
  works against a plain `pg` Pool, ships session revocation and auth-endpoint rate
  limiting, and has organization/invitation and SSO/OIDC plugins that line up with
  the paid-tier collaboration and enterprise items in the roadmap.

Schema note: better-auth's tables are created through **our** versioned migration
framework (hand-written SQL in `db/migrations/`, verified against the library's
schema reference), not its CLI — migrations stay reviewable and self-hosters run
`npm run db:migrate` as usual.

## Model

- **Users** are global (better-auth `user` table). The stub `users` table from 001 is
  preserved as `legacy_users` for operator review because it cannot be converted into
  credential-bearing better-auth accounts.
- **Memberships** map user → archive → role (`owner | admin | editor | contributor |
  viewer`, the roles `lib/rbac.ts` already defines). Single-archive deployments have
  one archive; the schema is multi-archive-ready like everything else.
- **Self-hosted first-run setup** (Ghost/Gitea pattern): while no user exists, private routes
  redirect to `/setup`, which creates the first account and an `owner` membership on
  the default archive. Once a user exists, open sign-up is disabled (invitations
  arrive in a later slice). Hosted deployments disable `/setup`, open sign-up, and
  automatic owner promotion; accounts must arrive through a controlled provisioning
  or invitation path.
- **Sessions** are database-backed better-auth sessions (revocable), replacing the
  stateless HMAC timestamp. `AUTH_SECRET` is reused as the better-auth secret.
  `KINSLEUTH_APP_PASSWORD` is retired.
- **Role resolution**: server surfaces derive the caller's role from session →
  membership, never from request input. The first enforcement fix lands here (the
  AI whole-tree route's client-supplied role); sweeping every mutating route is the
  next slice.

## Phasing

1. **This slice — identity core**: better-auth integration, migration 003 (auth
   tables + memberships, preserve stub users as `legacy_users`), first-run setup flow, login/logout
   replacement, proxy rewired to real sessions (Next 16 `proxy.ts` runs on the
   Node runtime, so full session validation stays centralized), session-derived
   role for the AI route, auth-endpoint rate limiting.
2. **Route-level RBAC sweep**: `assertPermission` on every mutating route with the
   session-derived role; audit log groundwork.
3. **Invitations + multi-member archives**: invitation flow (email delivery
   config), member management UI, per-member roles.
4. **Tenant resolution**: archive resolved from the authenticated principal
   (membership) instead of `KINSLEUTH_ARCHIVE_ID`; RLS policies as defense in
   depth.
5. **Email verification + password reset**: requires SMTP configuration surface
   for self-hosters; deliberately deferred so the identity core doesn't grow a
   mail dependency.

## Preserved behaviors

- Fail-closed in production when auth is unconfigured (503, matching today).
- `/login?next=` redirect flow for pages; JSON 401 for APIs.
- Public archive routes stay public; `/api/health` stays open; cron keeps
  `CRON_SECRET` bearer auth.

## Integration notes

- better-auth wraps the app's node-postgres `Pool` directly (`lib/auth.ts`);
  the instance is a lazy singleton because `next build` runs without
  `DATABASE_URL`.
- The auth tables use better-auth's default singular names and camelCase
  columns (`"user"."emailVerified"` etc.) so no field-mapping layer exists to
  drift; migration `003_auth_accounts.sql` documents this.
- The sign-up gate lives in our catch-all route wrapper
  (`app/api/auth/[...all]/route.ts`) as plain route code — first account only,
  `KINSLEUTH_ALLOW_SIGNUPS=true` overrides for self-hosted testing — rather than in
  better-auth hook APIs. Hosted sign-up is rejected before database or better-auth
  access regardless of the override, and the release contract requires the setting
  to be exactly `false`.
- Self-hosted membership resolution self-heals: the sole account becomes `owner` of
  the default archive even if the explicit `/api/setup/claim` step never lands.
  Hosted membership resolution never infers ownership from account creation order.
- `jose` is pinned as a direct dependency: `@vercel/oidc` hoists `jose@5` and
  npm mis-deduped `@better-auth/core`'s `jose@^6` onto it; the root pin gives
  v6 the top-level slot while oidc keeps its nested v5.
- Rate limiting uses better-auth's built-in per-instance limiter on auth
  endpoints (enabled in production by default); durable cross-instance
  storage is listed in the phasing above.
