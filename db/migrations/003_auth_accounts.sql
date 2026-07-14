-- Account-based authentication (better-auth) and archive memberships.
--
-- better-auth owns the "user", "session", "account", and "verification"
-- tables and queries them with its default camelCase field names, so those
-- columns are quoted camelCase identifiers by design — unlike the app's own
-- snake_case tables. Do not rename them without configuring better-auth
-- field mappings to match.

-- Preserve the legacy users table for operator review instead of silently
-- deleting rows during an upgrade. These records cannot be converted into
-- better-auth accounts because the old table never stored credentials.
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    IF to_regclass('public.legacy_users') IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot preserve legacy users because public.users and public.legacy_users both exist';
    END IF;
    ALTER TABLE public.users RENAME TO legacy_users;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token" text NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_user_idx ON "session" ("userId");

-- Credential storage: email/password lives here (provider_id 'credential'),
-- alongside any future OAuth providers.
CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "accessToken" text,
  "refreshToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "idToken" text,
  "password" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_user_idx ON "account" ("userId");

-- Email verification and password reset tokens (flows arrive in a later
-- slice, but better-auth expects the table to exist).
CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification" ("identifier");

-- Archive membership: user -> archive -> role, using the roles lib/rbac.ts
-- already defines. Single-archive deployments have one archive; the shape is
-- multi-archive-ready like the rest of the schema.
CREATE TABLE IF NOT EXISTS memberships (
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'contributor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);

-- Server-only access, matching 001: RLS on, and 001's default-privilege
-- revokes already deny the Supabase API roles on newly created tables.
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
