import { createHash, randomBytes, randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import type { Pool } from "pg";

import { demoFixtureVersion } from "../lib/archive-provisioning.ts";
import {
  currentBetaLegalAcceptance,
  loadApprovedBetaLegalManifest,
  type BetaLegalAcceptance
} from "../lib/beta-legal-manifest.ts";
import { deriveBetaPrivacyDigest } from "../lib/beta-invitations.ts";
import type { VerifiedOperatorRequest } from "../lib/operator-signature.ts";
import {
  assertFreshDisposableIdentityCounts,
  identityBrowserCanaryDatabaseName,
  passwordResetIdentifierDigest,
  type DisposableIdentityCounts,
  type IdentityBrowserCanaryConfiguration
} from "./identity-browser-canary-contract.ts";

export type SyntheticCredentials = Readonly<{
  email: string;
  name: string;
  password: string;
}>;

export type IdentityCanarySecrets = Readonly<{
  membershipless: SyntheticCredentials;
  newOwnerPassword: string;
  owner: SyntheticCredentials;
  unknownRecoveryEmail: string;
  wrongArchive: SyntheticCredentials;
}>;

export type ProductMutationBaseline = Readonly<{
  aiRuns: number;
  binarySources: number;
  dnaMatches: number;
  integrationArtifacts: number;
  integrationMedia: number;
  packageConnections: number;
  publishedPeople: number;
}>;

export type DisposableDatabasePreflight = Readonly<{
  baseline: ProductMutationBaseline;
  unpublishedPersonId: string;
}>;

export function createIdentityCanarySecrets(runId: string): IdentityCanarySecrets {
  const suffix = runId.replace(/[^a-z0-9]/g, "").slice(-24);
  return Object.freeze({
    owner: credential("Owner", `owner-${suffix}`),
    membershipless: credential("Membershipless", `membershipless-${suffix}`),
    wrongArchive: credential("Wrong archive", `wrong-archive-${suffix}`),
    newOwnerPassword: syntheticPassword("NewOwner"),
    unknownRecoveryEmail: `unknown-recovery-${suffix}@example.test`
  });
}

export function identityCanaryOperatorClaim(): VerifiedOperatorRequest {
  return {
    keyId: "disposable-identity-canary",
    nonce: randomUUID(),
    requestDigest: randomBytes(32).toString("hex"),
    timestamp: new Date()
  };
}

export function tokenFromActionUrl(actionUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(actionUrl);
  } catch {
    throw new Error("The synthetic action URL is invalid.");
  }
  const parameters = new URLSearchParams(parsed.hash.slice(1));
  const token = parameters.get("token");
  if (
    parsed.origin !== "https://app.kinresolve.com"
    || parsed.search !== ""
    || parameters.size !== 1
    || !token
    || !/^[A-Za-z0-9_-]{24,512}$/.test(token)
  ) {
    throw new Error("The synthetic action URL is invalid.");
  }
  return token;
}

export function currentIdentityCanaryLegalAcceptance(): BetaLegalAcceptance {
  return currentBetaLegalAcceptance(loadApprovedBetaLegalManifest(process.env));
}

export async function assertDisposableDatabasePreflight(
  pool: Pool,
  configuration: IdentityBrowserCanaryConfiguration
): Promise<DisposableDatabasePreflight> {
  const identity = await pool.query<{
    archive_id: string;
    dataset_mode: string;
    demo_fixture_version: number | null;
    database_name: string;
    unpublished_person_id: string | null;
  }>(
    `SELECT current_database() AS database_name,
            archive.id AS archive_id,
            archive.dataset_mode,
            archive.demo_fixture_version,
            (SELECT id FROM public.people
             WHERE archive_id = archive.id AND published = false
             ORDER BY sort_order, id COLLATE "C" LIMIT 1) AS unpublished_person_id
     FROM public.archives AS archive
     WHERE archive.id = $1`,
    [configuration.archiveId]
  );
  const row = identity.rows[0];
  if (
    !row
    || row.database_name !== identityBrowserCanaryDatabaseName
    || row.database_name !== configuration.databaseName
    || row.archive_id !== configuration.archiveId
    || row.dataset_mode !== "demo"
    || row.demo_fixture_version !== demoFixtureVersion
    || !row.unpublished_person_id
  ) {
    throw new Error("The disposable identity database binding is invalid.");
  }

  const countsResult = await pool.query<Record<keyof DisposableIdentityCounts, number>>(
    `SELECT
       (SELECT count(*)::int FROM public."account") AS accounts,
       (SELECT count(*)::int FROM public.api_rate_limit_buckets) AS "apiRateLimits",
       (SELECT count(*)::int FROM public.api_tokens) AS "apiTokens",
       (SELECT count(*)::int FROM public.auth_rate_limit_buckets) AS "authRateLimits",
       (SELECT count(*)::int FROM public.beta_identity_audit_events) AS "betaAuditEvents",
       (SELECT count(*)::int FROM public.beta_invitations) AS "betaInvitations",
       (SELECT count(*)::int FROM public.beta_operator_nonces) AS "betaOperatorNonces",
       (SELECT count(*)::int FROM public.beta_terms_acceptances) AS "betaTermsAcceptances",
       (SELECT count(*)::int FROM public.beta_email_verification_tokens) AS "betaVerificationTokens",
       (SELECT count(*)::int FROM public."session") AS sessions,
       (SELECT count(*)::int FROM public.security_events) AS "securityEvents",
       (SELECT count(*)::int FROM public."user") AS users,
       (SELECT count(*)::int FROM public."verification") AS verifications`
  );
  const counts = countsResult.rows[0];
  if (!counts) throw new Error("The disposable identity database counts are unavailable.");
  assertFreshDisposableIdentityCounts(counts);

  return {
    baseline: await readProductMutationBaseline(pool, configuration.archiveId),
    unpublishedPersonId: row.unpublished_person_id
  };
}

export async function seedMembershiplessAccount(
  pool: Pool,
  credentials: SyntheticCredentials
): Promise<string> {
  const userId = randomUUID();
  const passwordHash = await hashPassword(credentials.password);
  await pool.query(
    `WITH inserted_user AS (
       INSERT INTO public."user" (
         "id", "name", "email", "emailVerified", "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, true, now(), now())
       RETURNING id
     )
     INSERT INTO public."account" (
       "id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt"
     )
     SELECT $4, id, id, 'credential', $5, now(), now() FROM inserted_user`,
    [userId, credentials.name, credentials.email, randomUUID(), passwordHash]
  );
  return userId;
}

export async function seedExpiredInvitation(
  pool: Pool,
  input: {
    archiveId: string;
    email: string;
    privacyHmacSecret: string;
  }
): Promise<Readonly<{ invitationId: string; token: string }>> {
  const token = randomBytes(32).toString("base64url");
  const invitationId = randomUUID();
  const legal = loadApprovedBetaLegalManifest(process.env);
  await pool.query(
    `INSERT INTO public.beta_invitations (
       id, archive_id, purpose, email_digest, role, token_digest,
       participation_terms_version, participation_terms_sha256, participation_terms_url,
       privacy_notice_version, privacy_notice_sha256, privacy_notice_url,
       beta_boundary_version, beta_boundary_sha256, beta_boundary_url,
       issued_by_digest, issued_at, expires_at
     ) VALUES (
       $1, $2, 'member', $3, 'viewer', $4,
       $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, now() - interval '2 hours', now() - interval '1 hour'
     )`,
    [
      invitationId,
      input.archiveId,
      deriveBetaPrivacyDigest({
        domain: "invitation-email",
        secret: input.privacyHmacSecret,
        value: input.email
      }),
      createHash("sha256").update(token, "utf8").digest("hex"),
      legal.participationTerms.version,
      legal.participationTerms.sha256,
      legal.participationTerms.url,
      legal.privacyNotice.version,
      legal.privacyNotice.sha256,
      legal.privacyNotice.url,
      legal.betaBoundary.version,
      legal.betaBoundary.sha256,
      legal.betaBoundary.url,
      createHash("sha256").update("disposable-identity-canary", "utf8").digest("hex")
    ]
  );
  return { invitationId, token };
}

export async function seedKnownPasswordReset(
  pool: Pool,
  userId: string
): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const identifier = passwordResetIdentifierDigest(token);
  await pool.query(
    `INSERT INTO public."verification" (
       "id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, now() + interval '20 minutes', now(), now())`,
    [randomUUID(), identifier, userId]
  );
  return token;
}

export async function readOwnerUserId(pool: Pool, email: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT user_record.id
     FROM public."user" AS user_record
     JOIN public.memberships AS membership ON membership.user_id = user_record.id
     JOIN public.beta_terms_acceptances AS acceptance
       ON acceptance.archive_id = membership.archive_id
      AND acceptance.user_id = membership.user_id
     WHERE lower(user_record.email) = lower($1)
       AND user_record."emailVerified" = true
       AND membership.role = 'owner'`,
    [email]
  );
  if (result.rows.length !== 1) throw new Error("The synthetic owner identity is invalid.");
  return result.rows[0]!.id;
}

export async function assertInvitationTerminalState(
  pool: Pool,
  invitationId: string,
  expectedState: "expired" | "revoked"
): Promise<void> {
  const result = await pool.query<{ state: string; token_digest: string | null }>(
    "SELECT state, token_digest FROM public.beta_invitations WHERE id = $1",
    [invitationId]
  );
  if (
    result.rows.length !== 1
    || result.rows[0]?.state !== expectedState
    || result.rows[0]?.token_digest !== null
  ) {
    throw new Error("The synthetic invitation terminal state is invalid.");
  }
}

export async function assertFinalProductMutationBoundary(
  pool: Pool,
  input: {
    archiveId: string;
    baseline: ProductMutationBaseline;
    unpublishedPersonId: string;
  }
): Promise<void> {
  const final = await readProductMutationBaseline(pool, input.archiveId);
  if (
    final.aiRuns !== input.baseline.aiRuns + 1
    || final.binarySources !== input.baseline.binarySources
    || final.dnaMatches !== input.baseline.dnaMatches
    || final.integrationArtifacts !== input.baseline.integrationArtifacts
    || final.integrationMedia !== input.baseline.integrationMedia
    || final.packageConnections !== input.baseline.packageConnections
    || final.publishedPeople !== input.baseline.publishedPeople
  ) {
    throw new Error("The disposable identity canary mutation boundary was exceeded.");
  }
  const invariant = await pool.query<{ local_runs: number; published: boolean }>(
    `SELECT person.published,
            (SELECT count(*)::int FROM public.ai_runs
             WHERE archive_id = $1 AND provider = 'local' AND model = 'deterministic') AS local_runs
     FROM public.people AS person
     WHERE person.archive_id = $1 AND person.id = $2`,
    [input.archiveId, input.unpublishedPersonId]
  );
  if (
    invariant.rows.length !== 1
    || invariant.rows[0]?.published !== false
    || invariant.rows[0]?.local_runs < 1
  ) {
    throw new Error("The disposable identity canary final state is invalid.");
  }
}

async function readProductMutationBaseline(pool: Pool, archiveId: string): Promise<ProductMutationBaseline> {
  const result = await pool.query<ProductMutationBaseline>(
    `SELECT
       (SELECT count(*)::int FROM public.ai_runs WHERE archive_id = $1) AS "aiRuns",
       (SELECT count(*)::int FROM public.sources
        WHERE archive_id = $1 AND (storage_key IS NOT NULL OR file_name IS NOT NULL OR size_bytes IS NOT NULL)) AS "binarySources",
       (SELECT count(*)::int FROM public.dna_matches WHERE archive_id = $1) AS "dnaMatches",
       (SELECT count(*)::int FROM public.integration_artifacts WHERE archive_id = $1) AS "integrationArtifacts",
       (SELECT count(*)::int FROM public.integration_media_objects WHERE archive_id = $1) AS "integrationMedia",
       (SELECT count(*)::int FROM public.integration_connections
        WHERE archive_id = $1 AND provider <> 'gedcom') AS "packageConnections",
       (SELECT count(*)::int FROM public.people WHERE archive_id = $1 AND published = true) AS "publishedPeople"`,
    [archiveId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("The disposable identity canary baseline is unavailable.");
  return row;
}

function credential(label: string, localPart: string): SyntheticCredentials {
  return Object.freeze({
    email: `${localPart}@example.test`,
    name: `Synthetic ${label} canary`,
    password: syntheticPassword(label)
  });
}

function syntheticPassword(label: string): string {
  return `${label}-${randomBytes(24).toString("base64url")}`;
}
