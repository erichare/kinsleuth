import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { PoolClient } from "pg";
import { z } from "zod";

import {
  currentBetaLegalAcceptance,
  isCurrentBetaLegalAcceptance,
  loadApprovedBetaLegalManifest,
  type ApprovedBetaLegalManifest,
  type BetaLegalAcceptance,
  type BetaLegalEnvironment
} from "./beta-legal-manifest";
import { validateApprovedBetaLegalDocuments } from "./beta-legal-document-validation";
import { cleanupExpiredAuthRateLimitsInTransaction } from "./durable-auth-rate-limit";
import { cleanupExpiredApiRateLimitsInTransaction } from "./durable-api-rate-limit";
import { cleanupExpiredBetaApplicationsInTransaction } from "./beta-applications";
import { query, withTransaction, type DatabaseOptions } from "./db";
// RLS maintenance mode (imported from ./db-rls so unit tests that mock
// "@/lib/db" keep the real helper): invitation, verification, terms, and
// audit writes are operator/identity-plane flows that span archives — audit
// events may carry no archive at all — so they cannot be pinned to one
// request archive. They are never reachable from guest demo traffic.
import { withRlsMaintenanceMode } from "./db-rls";
import type { Role } from "./models";
import type { VerifiedOperatorRequest } from "./operator-signature";
import {
  buildInviteActionUrl,
  buildVerificationActionUrl,
  type TransactionalActionUrl
} from "./transactional-email";

export const betaPrivacyHmacSecretEnvironmentName = "KINRESOLVE_BETA_PRIVACY_HMAC_SECRET" as const;

const invitationTokenBytes = 32;
const invitationTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invitationLifetimeMinimumSeconds = 15 * 60;
const invitationLifetimeMaximumSeconds = 7 * 24 * 60 * 60;
const verificationLifetimeSeconds = 24 * 60 * 60;
const operatorNonceLifetimeMilliseconds = 60 * 60 * 1000;
const emailSchema = z.string().trim().email().max(320);
const nameSchema = z.string().trim().min(1).max(100);
const roleValues: Role[] = ["owner", "admin", "editor", "contributor", "viewer"];

export type BetaInvitationPurpose = "initial-owner" | "member";

export type BetaInvitationServiceOptions = DatabaseOptions & {
  archiveId: string;
  legalEnvironment?: BetaLegalEnvironment;
  passwordHasher?: (password: string) => Promise<string>;
  privacyHmacSecret?: string;
  validateLegalDocuments?: (manifest: ApprovedBetaLegalManifest) => Promise<unknown>;
};

export type DeliverBetaInvitation = (input: Readonly<{
  actionUrl: TransactionalActionUrl<"invite">;
  expiresAt: Date;
  invitationId: string;
  to: string;
}>) => Promise<void>;

export type DeliverBetaEmailVerification = (input: Readonly<{
  actionUrl: TransactionalActionUrl<"verification">;
  expiresAt: Date;
  to: string;
  verificationId: string;
}>) => Promise<void>;

export type BetaInvitationErrorCode =
  | "ACTIVE_INVITATION_EXISTS"
  | "DELIVERY_FAILED"
  | "INITIAL_OWNER_EXISTS"
  | "INVALID_INPUT"
  | "INVITATIONS_PAUSED"
  | "INVITATION_UNAVAILABLE"
  | "LEGAL_NOT_APPROVED"
  | "OPERATION_FAILED"
  | "OPERATOR_REPLAY"
  | "VERIFICATION_UNAVAILABLE";

const betaInvitationErrorMessages: Record<BetaInvitationErrorCode, string> = {
  ACTIVE_INVITATION_EXISTS: "An active invitation already exists for this archive recipient or purpose.",
  DELIVERY_FAILED: "The private-beta message could not be delivered; its bearer token was revoked.",
  INITIAL_OWNER_EXISTS: "This archive already has an initial owner.",
  INVALID_INPUT: "The private-beta invitation request is invalid.",
  INVITATIONS_PAUSED: "Private-beta onboarding is paused.",
  INVITATION_UNAVAILABLE: "The invitation is invalid, expired, or no longer available.",
  LEGAL_NOT_APPROVED: "Approved private-beta legal metadata is not configured.",
  OPERATION_FAILED: "The private-beta onboarding operation could not be completed.",
  OPERATOR_REPLAY: "The operator request has already been used.",
  VERIFICATION_UNAVAILABLE: "The email-verification link is invalid, expired, or no longer available."
};

export class BetaInvitationError extends Error {
  constructor(
    readonly code: BetaInvitationErrorCode,
    options?: ErrorOptions
  ) {
    super(betaInvitationErrorMessages[code], options);
    this.name = "BetaInvitationError";
  }
}

export type IssueBetaInvitationInput = {
  appBaseUrl: string;
  deliver: DeliverBetaInvitation;
  email: string;
  expiresInSeconds: number;
  operator: VerifiedOperatorRequest;
  purpose: BetaInvitationPurpose;
  role: Role;
};

export type IssueBetaInvitationResult = Readonly<{
  archiveId: string;
  expiresAt: Date;
  invitationId: string;
  purpose: BetaInvitationPurpose;
  role: Role;
}>;

export async function issueBetaInvitation(
  input: IssueBetaInvitationInput,
  options: BetaInvitationServiceOptions
): Promise<IssueBetaInvitationResult> {
  const context = serviceContext(options, true);
  const email = normalizeEmail(input.email);
  validateInvitationRole(input.purpose, input.role);
  validateInvitationLifetime(input.expiresInSeconds);
  validateOperator(input.operator);
  if (typeof input.deliver !== "function") throw new BetaInvitationError("INVALID_INPUT");

  const token = generateBearerToken();
  const tokenDigest = tokenSha256(token);
  const emailDigest = privateDigest(context.secret, "invitation-email", email);
  const operatorDigest = privateDigest(context.secret, "operator-actor", input.operator.keyId);
  const invitationId = randomUUID();
  const actionUrl = safeInviteActionUrl(input.appBaseUrl, token);

  let issued: { expiresAt: Date };
  try {
    issued = await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await consumeOperatorNonce(client, input.operator, context.secret);
      await requireActiveInvitationControl(client);
      await closeExpiredInvitations(client, {
        archiveId: options.archiveId,
        emailDigest,
        limit: 10
      });

      try {
        const result = await client.query<{ expires_at: Date }>(
          `INSERT INTO public.beta_invitations (
             id, archive_id, purpose, email_digest, role, token_digest,
             participation_terms_version, participation_terms_sha256, participation_terms_url,
             privacy_notice_version, privacy_notice_sha256, privacy_notice_url,
             beta_boundary_version, beta_boundary_sha256, beta_boundary_url,
             issued_by_digest, expires_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, now() + ($17::bigint * interval '1 second')
           )
           RETURNING expires_at`,
          [
            invitationId,
            options.archiveId,
            input.purpose,
            emailDigest,
            input.role,
            tokenDigest,
            context.legal.participationTerms.version,
            context.legal.participationTerms.sha256,
            context.legal.participationTerms.url,
            context.legal.privacyNotice.version,
            context.legal.privacyNotice.sha256,
            context.legal.privacyNotice.url,
            context.legal.betaBoundary.version,
            context.legal.betaBoundary.sha256,
            context.legal.betaBoundary.url,
            operatorDigest,
            input.expiresInSeconds
          ]
        );
        await appendAudit(client, {
          archiveId: options.archiveId,
          invitationId,
          eventType: "invitation-issued",
          actorKind: "operator",
          actorDigest: operatorDigest,
          requestId: input.operator.nonce
        });
        return { expiresAt: requiredDate(result.rows[0]?.expires_at) };
      } catch (error) {
        if (databaseConstraint(error) === "beta_invitations_one_initial_owner_lifecycle_idx") {
          throw new BetaInvitationError("INITIAL_OWNER_EXISTS");
        }
        if (databaseConstraint(error) === "beta_invitations_one_pending_email_idx") {
          throw new BetaInvitationError("ACTIVE_INVITATION_EXISTS");
        }
        throw error;
      }
    });
  } catch (error) {
    throw safeServiceError(error);
  }

  try {
    await input.deliver({ actionUrl, expiresAt: issued.expiresAt, invitationId, to: email });
    await recordInvitationDelivery(invitationId, options, "invitation-delivered");
  } catch {
    try {
      await recordInvitationDelivery(invitationId, options, "invitation-delivery-failed");
    } catch {
      throw new BetaInvitationError("OPERATION_FAILED");
    }
    throw new BetaInvitationError("DELIVERY_FAILED");
  }

  return {
    invitationId,
    archiveId: options.archiveId,
    purpose: input.purpose,
    role: input.role,
    expiresAt: issued.expiresAt
  };
}

export type InspectBetaInvitationResult = Readonly<{
  archiveName: string;
  expiresAt: Date;
  legal: ApprovedBetaLegalManifest;
  purpose: BetaInvitationPurpose;
  role: Role;
}>;

export async function inspectBetaInvitation(
  input: { token: string },
  options: BetaInvitationServiceOptions
): Promise<InspectBetaInvitationResult> {
  const context = serviceContext(options, true);
  const tokenDigest = validateAndDigestToken(input.token, "INVITATION_UNAVAILABLE");

  try {
    const outcome = await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await requireActiveInvitationControl(client);
      const result = await client.query<InvitationRow & { archive_name: string }>(
        `SELECT invitation.*, archive.name AS archive_name
         FROM public.beta_invitations AS invitation
         JOIN public.archives AS archive ON archive.id = invitation.archive_id
         WHERE invitation.archive_id = $1
           AND invitation.token_digest = $2
           AND invitation.state = 'pending'
         FOR UPDATE OF invitation`,
        [options.archiveId, tokenDigest]
      );
      const invitation = result.rows[0];
      if (!invitation) throw new BetaInvitationError("INVITATION_UNAVAILABLE");
      if (await expireInvitationIfNeeded(client, invitation)) return null;
      if (!invitationMatchesLegal(invitation, context.legal)) {
        throw new BetaInvitationError("INVITATION_UNAVAILABLE");
      }
      return {
        archiveName: invitation.archive_name,
        expiresAt: requiredDate(invitation.expires_at),
        legal: context.legal,
        purpose: invitation.purpose,
        role: invitation.role
      };
    });
    if (!outcome) throw new BetaInvitationError("INVITATION_UNAVAILABLE");
    return outcome;
  } catch (error) {
    throw safeServiceError(error);
  }
}

export type AcceptBetaInvitationInput = {
  appBaseUrl: string;
  deliverVerification: DeliverBetaEmailVerification;
  email: string;
  legalAcceptance: BetaLegalAcceptance;
  name: string;
  password: string;
  requestId: string;
  token: string;
};

export type AcceptBetaInvitationResult = Readonly<{
  archiveId: string;
  purpose: BetaInvitationPurpose;
  role: Role;
  verificationDelivery: "failed" | "sent";
  verificationRequired: true;
}>;

export async function acceptBetaInvitation(
  input: AcceptBetaInvitationInput,
  options: BetaInvitationServiceOptions
): Promise<AcceptBetaInvitationResult> {
  const context = serviceContext(options, true);
  const tokenDigest = validateAndDigestToken(input.token, "INVITATION_UNAVAILABLE");
  const email = normalizeEmail(input.email);
  const name = normalizeName(input.name);
  validatePassword(input.password);
  validateRequestId(input.requestId);
  if (!isCurrentBetaLegalAcceptance(input.legalAcceptance, context.legal)) {
    throw new BetaInvitationError("INVITATION_UNAVAILABLE");
  }
  if (typeof input.deliverVerification !== "function") throw new BetaInvitationError("INVALID_INPUT");
  const emailDigest = privateDigest(context.secret, "invitation-email", email);
  await requireAcceptableInvitationPreflight(
    tokenDigest,
    emailDigest,
    context.legal,
    options
  );
  let passwordHash: string;
  try {
    passwordHash = await (options.passwordHasher ?? hashPassword)(input.password);
  } catch {
    throw new BetaInvitationError("OPERATION_FAILED");
  }
  const verificationToken = generateBearerToken();
  const verificationTokenDigest = tokenSha256(verificationToken);
  const verificationActionUrl = safeVerificationActionUrl(input.appBaseUrl, verificationToken);
  const verificationId = randomUUID();
  const userId = randomUUID();
  const accountId = randomUUID();
  const acceptanceId = randomUUID();

  try {
    await (options.validateLegalDocuments ?? validateRuntimeLegalDocuments)(context.legal);
  } catch {
    throw new BetaInvitationError("LEGAL_NOT_APPROVED");
  }

  type Accepted = {
    expiresAt: Date;
    purpose: BetaInvitationPurpose;
    role: Role;
  };
  let accepted: Accepted | null;
  try {
    accepted = await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await requireActiveInvitationControl(client);
      const result = await client.query<InvitationRow>(
        `SELECT invitation.*
         FROM public.beta_invitations AS invitation
         JOIN public.archives AS archive ON archive.id = invitation.archive_id
         WHERE invitation.archive_id = $1
           AND invitation.token_digest = $2
           AND invitation.state = 'pending'
         FOR UPDATE OF invitation, archive`,
        [options.archiveId, tokenDigest]
      );
      const invitation = result.rows[0];
      if (!invitation) throw new BetaInvitationError("INVITATION_UNAVAILABLE");
      if (await expireInvitationIfNeeded(client, invitation, input.requestId)) return null;
      if (
        !safeDigestEqual(invitation.email_digest, emailDigest)
        || !invitationMatchesLegal(invitation, context.legal)
      ) {
        throw new BetaInvitationError("INVITATION_UNAVAILABLE");
      }

      const existingUsers = await client.query<{ id: string }>(
        `SELECT id
         FROM public."user"
         WHERE lower(email) = $1
         FOR UPDATE`,
        [email]
      );
      if (existingUsers.rows.length > 0) {
        throw new BetaInvitationError("INVITATION_UNAVAILABLE");
      }
      if (invitation.purpose === "initial-owner") {
        const existingOwner = await client.query(
          `SELECT 1
           FROM public.memberships
           WHERE archive_id = $1 AND role = 'owner'
           LIMIT 1`,
          [options.archiveId]
        );
        if (existingOwner.rowCount) throw new BetaInvitationError("INITIAL_OWNER_EXISTS");
      }

      await client.query(
        `INSERT INTO public."user" (
           "id", "name", "email", "emailVerified", "createdAt", "updatedAt"
         )
         VALUES ($1, $2, $3, false, now(), now())`,
        [userId, name, email]
      );
      await client.query(
        `INSERT INTO public."account" (
           "id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt"
         )
         VALUES ($1, $2, $2, 'credential', $3, now(), now())`,
        [accountId, userId, passwordHash]
      );

      const consumed = await client.query(
        `UPDATE public.beta_invitations
         SET state = 'consumed', token_digest = NULL, closed_at = now(), consumed_by_user_id = $3
         WHERE id = $1 AND token_digest = $2 AND state = 'pending'`,
        [invitation.id, tokenDigest, userId]
      );
      if (consumed.rowCount !== 1) throw new BetaInvitationError("INVITATION_UNAVAILABLE");

      await client.query(
        `INSERT INTO public.memberships (archive_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [options.archiveId, userId, invitation.role]
      );
      await client.query(
        `INSERT INTO public.beta_terms_acceptances (
           id, invitation_id, archive_id, user_id,
           participation_terms_version, participation_terms_sha256, participation_terms_url,
           privacy_notice_version, privacy_notice_sha256, privacy_notice_url,
           beta_boundary_version, beta_boundary_sha256, beta_boundary_url,
           acceptance_method, request_id
         )
         VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8, $9, $10, $11, $12, $13,
           'invitation-clickwrap', $14
         )`,
        [
          acceptanceId,
          invitation.id,
          options.archiveId,
          userId,
          invitation.participation_terms_version,
          invitation.participation_terms_sha256,
          invitation.participation_terms_url,
          invitation.privacy_notice_version,
          invitation.privacy_notice_sha256,
          invitation.privacy_notice_url,
          invitation.beta_boundary_version,
          invitation.beta_boundary_sha256,
          invitation.beta_boundary_url,
          input.requestId
        ]
      );
      const verification = await client.query<{ expires_at: Date }>(
        `INSERT INTO public.beta_email_verification_tokens (
           id, invitation_id, archive_id, user_id, email_digest, token_digest, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, now() + ($7::bigint * interval '1 second'))
         RETURNING expires_at`,
        [
          verificationId,
          invitation.id,
          options.archiveId,
          userId,
          emailDigest,
          verificationTokenDigest,
          verificationLifetimeSeconds
        ]
      );
      const participantDigest = privateDigest(context.secret, "participant-actor", userId);
      await appendAudit(client, {
        archiveId: options.archiveId,
        invitationId: invitation.id,
        eventType: "invitation-consumed",
        actorKind: "participant",
        actorDigest: participantDigest,
        requestId: input.requestId
      });
      await appendAudit(client, {
        archiveId: options.archiveId,
        invitationId: invitation.id,
        verificationId,
        eventType: "email-verification-issued",
        actorKind: "system",
        requestId: input.requestId
      });
      return {
        expiresAt: requiredDate(verification.rows[0]?.expires_at),
        purpose: invitation.purpose,
        role: invitation.role
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new BetaInvitationError("INVITATION_UNAVAILABLE");
    throw safeServiceError(error);
  }
  if (!accepted) throw new BetaInvitationError("INVITATION_UNAVAILABLE");

  let verificationDelivery: "failed" | "sent" = "sent";
  try {
    await input.deliverVerification({
      actionUrl: verificationActionUrl,
      expiresAt: accepted.expiresAt,
      to: email,
      verificationId
    });
    await recordVerificationDelivery(verificationId, options, "email-verification-delivered");
  } catch {
    verificationDelivery = "failed";
    try {
      await recordVerificationDelivery(verificationId, options, "email-verification-delivery-failed");
    } catch {
      throw new BetaInvitationError("OPERATION_FAILED");
    }
  }

  return {
    archiveId: options.archiveId,
    purpose: accepted.purpose,
    role: accepted.role,
    verificationDelivery,
    verificationRequired: true
  };
}

export async function verifyBetaEmail(
  input: { requestId: string; token: string },
  options: BetaInvitationServiceOptions
): Promise<Readonly<{ verified: true }>> {
  const context = serviceContext(options, false);
  const tokenDigest = validateAndDigestToken(input.token, "VERIFICATION_UNAVAILABLE");
  validateRequestId(input.requestId);

  try {
    const verified = await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await requireActiveInvitationControl(client);
      const result = await client.query<VerificationRow & { email: string }>(
        `SELECT verification.*, user_record.email
         FROM public.beta_email_verification_tokens AS verification
         JOIN public."user" AS user_record ON user_record.id = verification.user_id
         WHERE verification.archive_id = $1
           AND verification.token_digest = $2
           AND verification.state = 'pending'
         FOR UPDATE OF verification, user_record`,
        [options.archiveId, tokenDigest]
      );
      const verification = result.rows[0];
      if (!verification) throw new BetaInvitationError("VERIFICATION_UNAVAILABLE");
      if (await expireVerificationIfNeeded(client, verification, input.requestId)) return false;

      const currentEmailDigest = privateDigest(
        context.secret,
        "invitation-email",
        normalizeEmail(verification.email)
      );
      if (!safeDigestEqual(verification.email_digest, currentEmailDigest)) {
        throw new BetaInvitationError("VERIFICATION_UNAVAILABLE");
      }

      const closed = await client.query(
        `UPDATE public.beta_email_verification_tokens
         SET state = 'consumed', token_digest = NULL, closed_at = now()
         WHERE id = $1 AND token_digest = $2 AND state = 'pending'`,
        [verification.id, tokenDigest]
      );
      if (closed.rowCount !== 1) throw new BetaInvitationError("VERIFICATION_UNAVAILABLE");
      await client.query(
        `UPDATE public."user"
         SET "emailVerified" = true, "updatedAt" = now()
         WHERE id = $1`,
        [verification.user_id]
      );
      await appendAudit(client, {
        archiveId: verification.archive_id,
        invitationId: verification.invitation_id,
        verificationId: verification.id,
        eventType: "email-verification-completed",
        actorKind: "participant",
        actorDigest: privateDigest(context.secret, "participant-actor", verification.user_id),
        requestId: input.requestId
      });
      return true;
    });
    if (!verified) throw new BetaInvitationError("VERIFICATION_UNAVAILABLE");
    return { verified: true };
  } catch (error) {
    throw safeServiceError(error);
  }
}

// A raw verification token is never stored, so resend is intentionally a
// reissue: any previous pending token is atomically revoked before a fresh
// one is inserted. The result is existence-neutral for a public request path.
export async function reissueBetaEmailVerification(
  input: {
    appBaseUrl: string;
    deliver: DeliverBetaEmailVerification;
    email: string;
    requestId: string;
  },
  options: BetaInvitationServiceOptions
): Promise<Readonly<{ requested: true }>> {
  const context = serviceContext(options, false);
  const email = normalizeEmail(input.email);
  validateRequestId(input.requestId);
  if (typeof input.deliver !== "function") throw new BetaInvitationError("INVALID_INPUT");
  const emailDigest = privateDigest(context.secret, "invitation-email", email);
  const token = generateBearerToken();
  const tokenDigest = tokenSha256(token);
  const verificationId = randomUUID();
  const actionUrl = safeVerificationActionUrl(input.appBaseUrl, token);

  let issued: null | {
    expiresAt: Date;
    invitationId: string;
  };
  try {
    issued = await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await requireActiveInvitationControl(client);
      const eligible = await client.query<{
        email: string;
        emailVerified: boolean;
        invitation_id: string;
        user_id: string;
      }>(
        `SELECT user_record.email,
                user_record."emailVerified" AS "emailVerified",
                invitation.id AS invitation_id,
                invitation.consumed_by_user_id AS user_id
         FROM public.beta_invitations AS invitation
         JOIN public.beta_terms_acceptances AS acceptance
           ON acceptance.invitation_id = invitation.id
         JOIN public."user" AS user_record
           ON user_record.id = invitation.consumed_by_user_id
         WHERE invitation.archive_id = $1
           AND invitation.email_digest = $2
           AND invitation.state = 'consumed'
         ORDER BY invitation.closed_at DESC
         LIMIT 1
         FOR UPDATE OF user_record`,
        [options.archiveId, emailDigest]
      );
      const account = eligible.rows[0];
      if (
        !account
        || account.emailVerified
        || normalizeEmail(account.email) !== email
      ) {
        return null;
      }

      const previous = await client.query<VerificationRow>(
        `UPDATE public.beta_email_verification_tokens
         SET state = 'revoked', token_digest = NULL, closed_at = now()
         WHERE user_id = $1 AND state = 'pending'
         RETURNING *`,
        [account.user_id]
      );
      for (const verification of previous.rows) {
        await appendAudit(client, {
          archiveId: verification.archive_id,
          invitationId: verification.invitation_id,
          verificationId: verification.id,
          eventType: "email-verification-revoked",
          actorKind: "participant",
          actorDigest: privateDigest(context.secret, "participant-actor", account.user_id),
          requestId: input.requestId
        });
      }

      const created = await client.query<{ expires_at: Date }>(
        `INSERT INTO public.beta_email_verification_tokens (
           id, invitation_id, archive_id, user_id, email_digest, token_digest, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, now() + ($7::bigint * interval '1 second'))
         RETURNING expires_at`,
        [
          verificationId,
          account.invitation_id,
          options.archiveId,
          account.user_id,
          emailDigest,
          tokenDigest,
          verificationLifetimeSeconds
        ]
      );
      await appendAudit(client, {
        archiveId: options.archiveId,
        invitationId: account.invitation_id,
        verificationId,
        eventType: "email-verification-issued",
        actorKind: "participant",
        actorDigest: privateDigest(context.secret, "participant-actor", account.user_id),
        requestId: input.requestId
      });
      return {
        expiresAt: requiredDate(created.rows[0]?.expires_at),
        invitationId: account.invitation_id
      };
    });
  } catch (error) {
    throw safeServiceError(error);
  }
  if (!issued) return { requested: true };

  try {
    await input.deliver({ actionUrl, expiresAt: issued.expiresAt, to: email, verificationId });
    await recordVerificationDelivery(verificationId, options, "email-verification-delivered");
  } catch {
    try {
      await recordVerificationDelivery(verificationId, options, "email-verification-delivery-failed");
    } catch {
      throw new BetaInvitationError("OPERATION_FAILED");
    }
  }
  return { requested: true };
}

export async function revokeBetaInvitation(
  input: { invitationId: string; operator: VerifiedOperatorRequest },
  options: BetaInvitationServiceOptions
): Promise<Readonly<{ revoked: boolean }>> {
  const context = serviceContext(options, false);
  validateIdentifier(input.invitationId);
  validateOperator(input.operator);
  try {
    return await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await consumeOperatorNonce(client, input.operator, context.secret);
      const revoked = await client.query<{ id: string }>(
        `UPDATE public.beta_invitations
         SET state = 'revoked', token_digest = NULL, closed_at = now()
         WHERE id = $1 AND archive_id = $2 AND state = 'pending'
         RETURNING id`,
        [input.invitationId, options.archiveId]
      );
      if (revoked.rowCount === 1) {
        await appendAudit(client, {
          archiveId: options.archiveId,
          invitationId: input.invitationId,
          eventType: "invitation-revoked",
          actorKind: "operator",
          actorDigest: privateDigest(context.secret, "operator-actor", input.operator.keyId),
          requestId: input.operator.nonce
        });
      }
      return { revoked: revoked.rowCount === 1 };
    });
  } catch (error) {
    throw safeServiceError(error);
  }
}

export async function revokeAllPendingBetaInvitations(
  input: { operator: VerifiedOperatorRequest },
  options: BetaInvitationServiceOptions
): Promise<Readonly<{ revokedCount: number }>> {
  const context = serviceContext(options, false);
  validateOperator(input.operator);
  try {
    return await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await consumeOperatorNonce(client, input.operator, context.secret);
      const revoked = await client.query<{ id: string }>(
        `UPDATE public.beta_invitations
         SET state = 'revoked', token_digest = NULL, closed_at = now()
         WHERE archive_id = $1 AND state = 'pending'
         RETURNING id`,
        [options.archiveId]
      );
      const operatorDigest = privateDigest(context.secret, "operator-actor", input.operator.keyId);
      for (const invitation of revoked.rows) {
        await appendAudit(client, {
          archiveId: options.archiveId,
          invitationId: invitation.id,
          eventType: "invitation-revoked",
          actorKind: "operator",
          actorDigest: operatorDigest,
          requestId: input.operator.nonce
        });
      }
      return { revokedCount: revoked.rows.length };
    });
  } catch (error) {
    throw safeServiceError(error);
  }
}

export type BetaInvitationControlState = "active" | "paused";
export type BetaInvitationControlReason =
  | "cleanup"
  | "email-disabled"
  | "incident"
  | "launch-gate"
  | "maintenance"
  | "operator";

export async function setBetaInvitationControl(
  input: {
    operator: VerifiedOperatorRequest;
    reasonCode: BetaInvitationControlReason;
    state: BetaInvitationControlState;
  },
  options: BetaInvitationServiceOptions
): Promise<Readonly<{ generation: number; state: BetaInvitationControlState }>> {
  const context = input.state === "active"
    ? serviceContext(options, true)
    : serviceContext(options, false);
  validateOperator(input.operator);
  validateControlInput(input);
  try {
    return await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await consumeOperatorNonce(client, input.operator, context.secret);
      const current = await client.query<{
        generation: string;
        reason_code: string;
        state: BetaInvitationControlState;
      }>(
        `SELECT state, generation, reason_code
         FROM public.beta_invitation_control
         WHERE scope = 'hosted'
         FOR UPDATE`
      );
      const control = current.rows[0];
      if (!control) throw new BetaInvitationError("OPERATION_FAILED");
      const changed = control.state !== input.state || control.reason_code !== input.reasonCode;
      if (!changed) {
        return { state: control.state, generation: Number(control.generation) };
      }
      const updated = await client.query<{ generation: string; state: BetaInvitationControlState }>(
        `UPDATE public.beta_invitation_control
         SET state = $1,
             reason_code = $2,
             generation = generation + 1,
             updated_by_digest = $3,
             updated_at = now()
         WHERE scope = 'hosted'
         RETURNING state, generation`,
        [
          input.state,
          input.reasonCode,
          privateDigest(context.secret, "operator-actor", input.operator.keyId)
        ]
      );
      await appendAudit(client, {
        eventType: input.state === "active" ? "invitations-resumed" : "invitations-paused",
        actorKind: "operator",
        actorDigest: privateDigest(context.secret, "operator-actor", input.operator.keyId),
        requestId: input.operator.nonce
      });
      const row = updated.rows[0];
      return { state: row.state, generation: Number(row.generation) };
    });
  } catch (error) {
    throw safeServiceError(error);
  }
}

export async function cleanupBetaInvitationState(
  input: { limit?: number; operator: VerifiedOperatorRequest },
  options: BetaInvitationServiceOptions
): Promise<Readonly<{
  expiredInvitations: number;
  expiredApplications: number;
  expiredApiRateLimits: number;
  expiredRateLimits: number;
  expiredVerificationTokens: number;
  removedOperatorNonces: number;
}>> {
  const context = serviceContext(options, false);
  validateOperator(input.operator);
  const limit = input.limit ?? 500;
  validateCleanupLimit(limit);
  try {
    return await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await consumeOperatorNonce(client, input.operator, context.secret);
      const expiredInvitations = await closeExpiredInvitations(client, {
        archiveId: options.archiveId,
        limit,
        requestId: input.operator.nonce
      });
      const expiredVerificationTokens = await closeExpiredVerifications(
        client,
        options.archiveId,
        limit,
        input.operator.nonce
      );
      const expiredApplications = await cleanupExpiredBetaApplicationsInTransaction(client, limit);
      const expiredRateLimits = await cleanupExpiredAuthRateLimitsInTransaction(client, limit);
      const expiredApiRateLimits = await cleanupExpiredApiRateLimitsInTransaction(client, limit);
      const removedOperatorNonces = await cleanupOperatorNonces(client, limit);
      return {
        expiredApplications,
        expiredInvitations,
        expiredApiRateLimits,
        expiredRateLimits,
        expiredVerificationTokens,
        removedOperatorNonces
      };
    });
  } catch (error) {
    throw safeServiceError(error);
  }
}

export async function consumeBetaOperatorRequest(
  operator: VerifiedOperatorRequest,
  options: BetaInvitationServiceOptions
): Promise<void> {
  const context = serviceContext(options, false);
  validateOperator(operator);
  try {
    await withTransaction(withRlsMaintenanceMode(options), (client) => consumeOperatorNonce(client, operator, context.secret));
  } catch (error) {
    throw safeServiceError(error);
  }
}

export async function cleanupExpiredBetaStateForSystem(
  input: { limit?: number; requestId: string },
  options: BetaInvitationServiceOptions
): Promise<Readonly<{
  expiredInvitations: number;
  expiredApplications: number;
  expiredApiRateLimits: number;
  expiredRateLimits: number;
  expiredVerificationTokens: number;
  removedOperatorNonces: number;
}>> {
  serviceContext(options, false);
  validateRequestId(input.requestId);
  const limit = input.limit ?? 500;
  validateCleanupLimit(limit);
  try {
    return await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      const expiredInvitations = await closeExpiredInvitations(client, {
        archiveId: options.archiveId,
        limit,
        requestId: input.requestId
      });
      const expiredVerificationTokens = await closeExpiredVerifications(
        client,
        options.archiveId,
        limit,
        input.requestId
      );
      const expiredApplications = await cleanupExpiredBetaApplicationsInTransaction(client, limit);
      const expiredRateLimits = await cleanupExpiredAuthRateLimitsInTransaction(client, limit);
      const expiredApiRateLimits = await cleanupExpiredApiRateLimitsInTransaction(client, limit);
      const removedOperatorNonces = await cleanupOperatorNonces(client, limit);
      return {
        expiredApplications,
        expiredInvitations,
        expiredApiRateLimits,
        expiredRateLimits,
        expiredVerificationTokens,
        removedOperatorNonces
      };
    });
  } catch (error) {
    throw safeServiceError(error);
  }
}

export type BetaSecurityAuditEventType =
  | "password-changed"
  | "password-recovery-completed"
  | "password-recovery-requested"
  | "security-notification-delivered"
  | "security-notification-delivery-failed"
  | "sessions-revoked";

export async function recordBetaSecurityAuditEvent(
  input: {
    actorKind: "participant" | "system";
    eventType: BetaSecurityAuditEventType;
    requestId?: string;
    subject: string;
  },
  options: BetaInvitationServiceOptions
): Promise<void> {
  const context = serviceContext(options, false);
  if (input.requestId !== undefined) validateRequestId(input.requestId);
  if (
    typeof input.subject !== "string"
    || Buffer.byteLength(input.subject, "utf8") < 1
    || Buffer.byteLength(input.subject, "utf8") > 2048
  ) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
  try {
    await withTransaction(withRlsMaintenanceMode(options), (client) => appendAudit(client, {
      archiveId: options.archiveId,
      eventType: input.eventType,
      actorKind: input.actorKind,
      subjectDigest: privateDigest(context.secret, "security-subject", input.subject),
      requestId: input.requestId
    }));
  } catch (error) {
    throw safeServiceError(error);
  }
}

type InvitationRow = {
  archive_id: string;
  beta_boundary_sha256: string;
  beta_boundary_url: string;
  beta_boundary_version: string;
  email_digest: string;
  expires_at: Date;
  id: string;
  participation_terms_sha256: string;
  participation_terms_url: string;
  participation_terms_version: string;
  privacy_notice_sha256: string;
  privacy_notice_url: string;
  privacy_notice_version: string;
  purpose: BetaInvitationPurpose;
  role: Role;
};

type VerificationRow = {
  archive_id: string;
  email_digest: string;
  expires_at: Date;
  id: string;
  invitation_id: string;
  user_id: string;
};

type BetaIdentityAuditEventType =
  | BetaSecurityAuditEventType
  | "email-verification-completed"
  | "email-verification-delivered"
  | "email-verification-delivery-failed"
  | "email-verification-expired"
  | "email-verification-issued"
  | "email-verification-revoked"
  | "invitation-consumed"
  | "invitation-delivered"
  | "invitation-delivery-failed"
  | "invitation-expired"
  | "invitation-issued"
  | "invitation-revoked"
  | "invitations-paused"
  | "invitations-resumed";

type AppendAuditInput = {
  actorDigest?: string;
  actorKind: "operator" | "participant" | "system";
  archiveId?: string;
  eventType: BetaIdentityAuditEventType;
  invitationId?: string;
  requestId?: string;
  subjectDigest?: string;
  verificationId?: string;
};

async function appendAudit(client: PoolClient, input: AppendAuditInput): Promise<void> {
  await client.query(
    `INSERT INTO public.beta_identity_audit_events (
       id, invitation_id, verification_id, archive_id, event_type,
       actor_kind, actor_digest, subject_digest, request_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      input.invitationId ?? null,
      input.verificationId ?? null,
      input.archiveId ?? null,
      input.eventType,
      input.actorKind,
      input.actorDigest ?? null,
      input.subjectDigest ?? null,
      input.requestId ?? null
    ]
  );
}

async function requireAcceptableInvitationPreflight(
  tokenDigest: string,
  emailDigest: string,
  legal: ApprovedBetaLegalManifest,
  options: BetaInvitationServiceOptions
): Promise<void> {
  try {
    const result = await query<{
      available: boolean;
      state: BetaInvitationControlState;
    }>(
      `SELECT control.state,
              EXISTS (
                SELECT 1
                FROM public.beta_invitations AS invitation
                WHERE invitation.archive_id = $1
                  AND invitation.token_digest = $2
                  AND invitation.email_digest = $3
                  AND invitation.state = 'pending'
                  AND invitation.expires_at > now()
                  AND invitation.participation_terms_version = $4
                  AND invitation.participation_terms_sha256 = $5
                  AND invitation.participation_terms_url = $6
                  AND invitation.privacy_notice_version = $7
                  AND invitation.privacy_notice_sha256 = $8
                  AND invitation.privacy_notice_url = $9
                  AND invitation.beta_boundary_version = $10
                  AND invitation.beta_boundary_sha256 = $11
                  AND invitation.beta_boundary_url = $12
              ) AS available
       FROM public.beta_invitation_control AS control
       WHERE control.scope = 'hosted'`,
      [
        options.archiveId,
        tokenDigest,
        emailDigest,
        legal.participationTerms.version,
        legal.participationTerms.sha256,
        legal.participationTerms.url,
        legal.privacyNotice.version,
        legal.privacyNotice.sha256,
        legal.privacyNotice.url,
        legal.betaBoundary.version,
        legal.betaBoundary.sha256,
        legal.betaBoundary.url
      ],
      { databaseUrl: options.databaseUrl }
    );
    const preflight = result.rows[0];
    if (!preflight) throw new BetaInvitationError("OPERATION_FAILED");
    if (preflight.state !== "active") throw new BetaInvitationError("INVITATIONS_PAUSED");
    if (!preflight.available) throw new BetaInvitationError("INVITATION_UNAVAILABLE");
  } catch (error) {
    throw safeServiceError(error);
  }
}

async function requireActiveInvitationControl(client: PoolClient): Promise<void> {
  const result = await client.query<{ state: BetaInvitationControlState }>(
    `SELECT state
     FROM public.beta_invitation_control
     WHERE scope = 'hosted'
     FOR SHARE`
  );
  if (!result.rows[0]) throw new BetaInvitationError("OPERATION_FAILED");
  if (result.rows[0].state !== "active") throw new BetaInvitationError("INVITATIONS_PAUSED");
}

async function consumeOperatorNonce(
  client: PoolClient,
  operator: VerifiedOperatorRequest,
  secret: string
): Promise<void> {
  const result = await client.query(
    `INSERT INTO public.beta_operator_nonces (
       operator_key_digest, nonce, request_timestamp, request_digest, expires_at
     )
     VALUES (
       $1, $2, $3, $4,
       now() + ($5::bigint * interval '1 millisecond')
     )
     ON CONFLICT (operator_key_digest, nonce) DO NOTHING
     RETURNING nonce`,
    [
      privateDigest(secret, "operator-key", operator.keyId),
      operator.nonce,
      operator.timestamp,
      operator.requestDigest,
      operatorNonceLifetimeMilliseconds
    ]
  );
  if (result.rowCount !== 1) throw new BetaInvitationError("OPERATOR_REPLAY");
}

async function recordInvitationDelivery(
  invitationId: string,
  options: BetaInvitationServiceOptions,
  eventType: "invitation-delivered" | "invitation-delivery-failed"
): Promise<void> {
  await withTransaction(withRlsMaintenanceMode(options), async (client) => {
    if (eventType === "invitation-delivery-failed") {
      const revoked = await client.query<{ archive_id: string }>(
        `UPDATE public.beta_invitations
         SET state = 'revoked', token_digest = NULL, closed_at = now()
         WHERE id = $1 AND archive_id = $2 AND state = 'pending'
         RETURNING archive_id`,
        [invitationId, options.archiveId]
      );
      if (revoked.rowCount === 0) return;
      await appendAudit(client, {
        archiveId: revoked.rows[0].archive_id,
        invitationId,
        eventType,
        actorKind: "system"
      });
      return;
    }

    const invitation = await client.query<{ archive_id: string }>(
      `SELECT archive_id
       FROM public.beta_invitations
       WHERE id = $1 AND archive_id = $2
       FOR UPDATE`,
      [invitationId, options.archiveId]
    );
    if (!invitation.rows[0]) throw new BetaInvitationError("OPERATION_FAILED");
    await appendAudit(client, {
      archiveId: invitation.rows[0].archive_id,
      invitationId,
      eventType,
      actorKind: "system"
    });
  });
}

async function recordVerificationDelivery(
  verificationId: string,
  options: BetaInvitationServiceOptions,
  eventType: "email-verification-delivered" | "email-verification-delivery-failed"
): Promise<void> {
  await withTransaction(withRlsMaintenanceMode(options), async (client) => {
    if (eventType === "email-verification-delivery-failed") {
      const revoked = await client.query<VerificationRow>(
        `UPDATE public.beta_email_verification_tokens
         SET state = 'revoked', token_digest = NULL, closed_at = now()
         WHERE id = $1 AND archive_id = $2 AND state = 'pending'
         RETURNING *`,
        [verificationId, options.archiveId]
      );
      const verification = revoked.rows[0];
      if (!verification) return;
      await appendAudit(client, {
        archiveId: verification.archive_id,
        invitationId: verification.invitation_id,
        verificationId,
        eventType,
        actorKind: "system"
      });
      return;
    }

    const result = await client.query<VerificationRow>(
      `SELECT *
       FROM public.beta_email_verification_tokens
       WHERE id = $1 AND archive_id = $2
       FOR UPDATE`,
      [verificationId, options.archiveId]
    );
    const verification = result.rows[0];
    if (!verification) throw new BetaInvitationError("OPERATION_FAILED");
    await appendAudit(client, {
      archiveId: verification.archive_id,
      invitationId: verification.invitation_id,
      verificationId,
      eventType,
      actorKind: "system"
    });
  });
}

async function expireInvitationIfNeeded(
  client: PoolClient,
  invitation: InvitationRow,
  requestId?: string
): Promise<boolean> {
  const expired = await client.query(
    `UPDATE public.beta_invitations
     SET state = 'expired', token_digest = NULL, closed_at = now()
     WHERE id = $1 AND state = 'pending' AND expires_at <= now()`,
    [invitation.id]
  );
  if (expired.rowCount !== 1) return false;
  await appendAudit(client, {
    archiveId: invitation.archive_id,
    invitationId: invitation.id,
    eventType: "invitation-expired",
    actorKind: "system",
    requestId
  });
  return true;
}

async function expireVerificationIfNeeded(
  client: PoolClient,
  verification: VerificationRow,
  requestId?: string
): Promise<boolean> {
  const expired = await client.query(
    `UPDATE public.beta_email_verification_tokens
     SET state = 'expired', token_digest = NULL, closed_at = now()
     WHERE id = $1 AND state = 'pending' AND expires_at <= now()`,
    [verification.id]
  );
  if (expired.rowCount !== 1) return false;
  await appendAudit(client, {
    archiveId: verification.archive_id,
    invitationId: verification.invitation_id,
    verificationId: verification.id,
    eventType: "email-verification-expired",
    actorKind: "system",
    requestId
  });
  return true;
}

async function closeExpiredInvitations(
  client: PoolClient,
  input: { archiveId: string; emailDigest?: string; limit: number; requestId?: string }
): Promise<number> {
  const result = await client.query<{ archive_id: string; id: string }>(
    `WITH expired AS (
       SELECT id
       FROM public.beta_invitations
       WHERE archive_id = $1
         AND state = 'pending'
         AND expires_at <= now()
         AND ($2::text IS NULL OR email_digest = $2)
       ORDER BY expires_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $3
     )
     UPDATE public.beta_invitations AS invitation
     SET state = 'expired', token_digest = NULL, closed_at = now()
     FROM expired
     WHERE invitation.id = expired.id
     RETURNING invitation.id, invitation.archive_id`,
    [input.archiveId, input.emailDigest ?? null, input.limit]
  );
  for (const invitation of result.rows) {
    await appendAudit(client, {
      archiveId: invitation.archive_id,
      invitationId: invitation.id,
      eventType: "invitation-expired",
      actorKind: "system",
      requestId: input.requestId
    });
  }
  return result.rows.length;
}

async function closeExpiredVerifications(
  client: PoolClient,
  archiveId: string,
  limit: number,
  requestId?: string
): Promise<number> {
  const result = await client.query<VerificationRow>(
    `WITH expired AS (
       SELECT id
       FROM public.beta_email_verification_tokens
       WHERE archive_id = $1 AND state = 'pending' AND expires_at <= now()
       ORDER BY expires_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE public.beta_email_verification_tokens AS verification
     SET state = 'expired', token_digest = NULL, closed_at = now()
     FROM expired
     WHERE verification.id = expired.id
     RETURNING verification.*`,
    [archiveId, limit]
  );
  for (const verification of result.rows) {
    await appendAudit(client, {
      archiveId: verification.archive_id,
      invitationId: verification.invitation_id,
      verificationId: verification.id,
      eventType: "email-verification-expired",
      actorKind: "system",
      requestId
    });
  }
  return result.rows.length;
}

async function cleanupOperatorNonces(client: PoolClient, limit: number): Promise<number> {
  const result = await client.query(
    `WITH expired AS (
       SELECT ctid
       FROM public.beta_operator_nonces
       WHERE expires_at <= now()
       ORDER BY expires_at, operator_key_digest, nonce
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     DELETE FROM public.beta_operator_nonces AS nonce_record
     USING expired
     WHERE nonce_record.ctid = expired.ctid`,
    [limit]
  );
  return result.rowCount ?? 0;
}

function serviceContext(
  options: BetaInvitationServiceOptions,
  requireLegal: true
): { legal: ApprovedBetaLegalManifest; secret: string };
function serviceContext(
  options: BetaInvitationServiceOptions,
  requireLegal: false
): { secret: string };
function serviceContext(
  options: BetaInvitationServiceOptions,
  requireLegal: boolean
): { legal?: ApprovedBetaLegalManifest; secret: string } {
  validateArchiveId(options.archiveId);
  const secret = options.privacyHmacSecret ?? process.env[betaPrivacyHmacSecretEnvironmentName] ?? "";
  validatePrivacyHmacSecret(secret);
  if (!requireLegal) return { secret };
  try {
    return {
      secret,
      legal: loadApprovedBetaLegalManifest(options.legalEnvironment ?? process.env)
    };
  } catch {
    throw new BetaInvitationError("LEGAL_NOT_APPROVED");
  }
}

async function validateRuntimeLegalDocuments(manifest: ApprovedBetaLegalManifest): Promise<void> {
  await validateApprovedBetaLegalDocuments(manifest, {
    maxAttempts: 1,
    timeoutMs: 5_000
  });
}

export function deriveBetaPrivacyDigest(
  input: { domain: string; secret: string; value: string }
): string {
  validatePrivacyHmacSecret(input.secret);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(input.domain)) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
  if (
    typeof input.value !== "string"
    || Buffer.byteLength(input.value, "utf8") < 1
    || Buffer.byteLength(input.value, "utf8") > 2048
  ) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
  return privateDigest(input.secret, input.domain, input.value);
}

function privateDigest(secret: string, domain: string, value: string): string {
  return createHmac("sha256", secret)
    .update("kinresolve-beta-private-digest-v1", "utf8")
    .update("\0", "utf8")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function generateBearerToken(): string {
  return randomBytes(invitationTokenBytes).toString("base64url");
}

function tokenSha256(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validateAndDigestToken(
  token: string,
  errorCode: "INVITATION_UNAVAILABLE" | "VERIFICATION_UNAVAILABLE"
): string {
  if (typeof token !== "string" || !invitationTokenPattern.test(token)) {
    throw new BetaInvitationError(errorCode);
  }
  return tokenSha256(token);
}

function normalizeEmail(value: string): string {
  const parsed = emailSchema.safeParse(value);
  if (!parsed.success) throw new BetaInvitationError("INVALID_INPUT");
  return parsed.data.toLowerCase();
}

function normalizeName(value: string): string {
  const parsed = nameSchema.safeParse(value);
  if (!parsed.success || /[\u0000-\u001f\u007f]/.test(parsed.data)) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
  return parsed.data;
}

function validatePassword(value: string): void {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
}

function validateInvitationRole(purpose: BetaInvitationPurpose, role: Role): void {
  if (!roleValues.includes(role)) throw new BetaInvitationError("INVALID_INPUT");
  if (
    (purpose === "initial-owner" && role !== "owner")
    || (purpose === "member" && role === "owner")
    || !["initial-owner", "member"].includes(purpose)
  ) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
}

function validateInvitationLifetime(value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value < invitationLifetimeMinimumSeconds
    || value > invitationLifetimeMaximumSeconds
  ) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
}

function validateOperator(operator: VerifiedOperatorRequest): void {
  if (
    typeof operator !== "object"
    || operator === null
    || !keyIdPattern.test(operator.keyId)
    || !uuidPattern.test(operator.nonce)
    || !sha256Pattern.test(operator.requestDigest)
    || !(operator.timestamp instanceof Date)
    || !Number.isFinite(operator.timestamp.getTime())
  ) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
}

function validateArchiveId(value: string): void {
  if (
    typeof value !== "string"
    || value === ""
    || value !== value.trim()
    || Buffer.byteLength(value, "utf8") > 200
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
}

function validateIdentifier(value: string): void {
  if (!uuidPattern.test(value)) throw new BetaInvitationError("INVALID_INPUT");
}

function validateRequestId(value: string): void {
  if (!uuidPattern.test(value)) throw new BetaInvitationError("INVALID_INPUT");
}

function validatePrivacyHmacSecret(value: string): void {
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new BetaInvitationError("OPERATION_FAILED");
  }
}

function validateCleanupLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
}

function validateControlInput(input: {
  reasonCode: BetaInvitationControlReason;
  state: BetaInvitationControlState;
}): void {
  const reasons: BetaInvitationControlReason[] = [
    "cleanup",
    "email-disabled",
    "incident",
    "launch-gate",
    "maintenance",
    "operator"
  ];
  if (!reasons.includes(input.reasonCode) || !["active", "paused"].includes(input.state)) {
    throw new BetaInvitationError("INVALID_INPUT");
  }
}

function invitationMatchesLegal(
  invitation: InvitationRow,
  legal: ApprovedBetaLegalManifest
): boolean {
  const expected = currentBetaLegalAcceptance(legal);
  return invitation.participation_terms_version === expected.participationTermsVersion
    && invitation.participation_terms_sha256 === expected.participationTermsSha256
    && invitation.participation_terms_url === expected.participationTermsUrl
    && invitation.privacy_notice_version === expected.privacyNoticeVersion
    && invitation.privacy_notice_sha256 === expected.privacyNoticeSha256
    && invitation.privacy_notice_url === expected.privacyNoticeUrl
    && invitation.beta_boundary_version === expected.betaBoundaryVersion
    && invitation.beta_boundary_sha256 === expected.betaBoundarySha256
    && invitation.beta_boundary_url === expected.betaBoundaryUrl;
}

function safeDigestEqual(left: string, right: string): boolean {
  if (!sha256Pattern.test(left) || !sha256Pattern.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function safeInviteActionUrl(appBaseUrl: string, token: string): TransactionalActionUrl<"invite"> {
  try {
    return buildInviteActionUrl(appBaseUrl, token);
  } catch {
    throw new BetaInvitationError("INVALID_INPUT");
  }
}

function safeVerificationActionUrl(
  appBaseUrl: string,
  token: string
): TransactionalActionUrl<"verification"> {
  try {
    return buildVerificationActionUrl(appBaseUrl, token);
  } catch {
    throw new BetaInvitationError("INVALID_INPUT");
  }
}

function requiredDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new BetaInvitationError("OPERATION_FAILED");
  return date;
}

function databaseConstraint(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === "string" ? constraint : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && (error as { code?: unknown }).code === "23505";
}

function safeServiceError(error: unknown): BetaInvitationError {
  if (error instanceof BetaInvitationError) return error;
  return new BetaInvitationError("OPERATION_FAILED");
}
