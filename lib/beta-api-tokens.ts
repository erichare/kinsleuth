import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";

import {
  apiV1Scopes,
  isApiV1Scope,
  resolveApiV1RouteDefinition,
  type ApiV1RateLimitProfile,
  type ApiV1Scope
} from "./api-v1-contract";
import {
  consumeApiRateLimitInTransaction,
  type ApiRateLimitHeaders
} from "./durable-api-rate-limit";
import { withTransaction, type DatabaseOptions } from "./db";
// RLS maintenance mode (imported from ./db-rls so unit tests that mock
// "@/lib/db" keep the real helper): token issuance/rotation/revocation and
// append-only security events are operator/identity-plane writes where the
// row's archive is derived from stored token data rather than a
// request-scoped archive, so they cannot be pinned to one archive setting.
import { withRlsMaintenanceMode } from "./db-rls";
import {
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "./database-attestation";
import { captureOperationalError } from "./observability";
import {
  forbiddenWorkflowOnlyEnvironmentNames,
  requiredSensitiveProductionEnvironmentNames
} from "./vercel-environment-contract";

type Environment = Record<string, string | undefined>;

export type BetaApiTokenServiceOptions = DatabaseOptions & {
  environment?: Environment;
};

export type ApiTokenAuthenticationContext = {
  tokenId: string;
  userId: string;
  archiveId: string;
  scopes: ApiV1Scope[];
  requestId: string;
  rateLimit: ApiRateLimitHeaders;
};

export type ApiTokenAuthenticationFailureCode =
  | "api_disabled"
  | "invalid_token"
  | "insufficient_scope"
  | "rate_limit_exceeded"
  | "service_unavailable";

export type ApiTokenAuthenticationResult =
  | { ok: true; context: ApiTokenAuthenticationContext }
  | {
      ok: false;
      status: number;
      code: ApiTokenAuthenticationFailureCode;
      message: string;
      requestId: string;
      rateLimit?: ApiRateLimitHeaders;
    };

export type ApiV1ConfigurationStatus = Readonly<{
  enabled: boolean;
  configured: boolean;
}>;

export type ApiTokenMetadata = Readonly<{
  id: string;
  archiveId: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: ApiV1Scope[];
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}>;

export type CreatedApiToken = ApiTokenMetadata & Readonly<{
  token: string;
}>;

export type BetaApiTokenErrorCode =
  | "API_DISABLED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "NOT_FOUND"
  | "OPERATION_FAILED";

const serviceErrorMessages: Record<BetaApiTokenErrorCode, string> = {
  API_DISABLED: "The API developer preview is not enabled.",
  FORBIDDEN: "Only an archive owner can manage API tokens.",
  INVALID_INPUT: "The API token request is invalid.",
  LIMIT_EXCEEDED: "The archive has reached its API token inventory limit.",
  NOT_FOUND: "The API token is unavailable.",
  OPERATION_FAILED: "The API token operation could not be completed."
};

export class BetaApiTokenError extends Error {
  constructor(readonly code: BetaApiTokenErrorCode, options?: ErrorOptions) {
    super(serviceErrorMessages[code], options);
    this.name = "BetaApiTokenError";
  }
}

type TokenRow = {
  id: string;
  archive_id: string;
  user_id: string;
  name: string;
  prefix: string;
  digest: string;
  scopes: string[];
  created_at: Date;
  expires_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
};

const bearerTokenBytes = 32;
const bearerTokenPattern = /^kr_beta_[A-Za-z0-9_-]{43}$/;
const prefixPattern = /^kr_beta_[A-Za-z0-9_-]{8}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const minimumLifetimeMs = 5 * 60_000;
const maximumLifetimeMs = 365 * 24 * 60 * 60_000;
export const apiTokenInventoryLimits = Object.freeze({ total: 100, active: 10 });
const apiTokenInventoryAdvisoryNamespace = 160_016;
const additionalCredentialEnvironmentNames = [
  "AI_API_KEY",
  "KINRESOLVE_BETA_APPLICATION_HMAC_SECRET",
  "KINSLEUTH_APP_PASSWORD",
  "MINIO_ROOT_PASSWORD",
  "MINIO_ROOT_USER",
  "OPENAI_API_KEY",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY"
] as const;
const apiCursorDistinctCredentialEnvironmentNames = new Set<string>([
  ...requiredSensitiveProductionEnvironmentNames,
  ...forbiddenWorkflowOnlyEnvironmentNames,
  ...additionalCredentialEnvironmentNames
]);
const structuredDatabaseCredentialEnvironmentNames = [
  "ADMIN_DATABASE_URL",
  "DATABASE_ADMIN_URL",
  "DATABASE_IDENTITY_URL",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "RECOVERY_DATABASE_URL",
  "RECOVERY_SOURCE_DATABASE_URL",
  "RECOVERY_TARGET_DATABASE_URL",
  "RECOVERY_TARGET_RUNTIME_DATABASE_URL",
  "PUBLIC_DEMO_RUNTIME_DATABASE_URL",
  "RELEASE_FENCE_DATABASE_URL"
] as const;
const dummyTokenDigest = createHash("sha256")
  .update("kinresolve-api-v1-unknown-token", "utf8")
  .digest("hex");

export function apiV1Enabled(environment: Environment = process.env): boolean {
  const value = environment.KINRESOLVE_API_V1_ENABLED?.trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  const error = new Error("KINRESOLVE_API_V1_ENABLED must be exactly true or false.");
  Object.assign(error, { code: "CONFIG_INVALID" });
  throw error;
}

export function apiV1ConfigurationStatus(
  environment: Environment = process.env
): ApiV1ConfigurationStatus {
  let enabled: boolean;
  try {
    enabled = apiV1Enabled(environment);
  } catch {
    return { enabled: false, configured: false };
  }
  if (!enabled) return { enabled: false, configured: true };
  try {
    validateApiV1Configuration(environment);
    return { enabled: true, configured: true };
  } catch {
    return { enabled: true, configured: false };
  }
}

export async function authenticateApiToken(
  request: Request,
  input: { scope: ApiV1Scope; routeTemplate: string; requestId: string },
  options: BetaApiTokenServiceOptions = {}
): Promise<ApiTokenAuthenticationResult> {
  let enabled: boolean;
  try {
    enabled = apiV1Enabled(options.environment ?? process.env);
  } catch (error) {
    await captureOperationalError({
      event: "api_error",
      requestId: input.requestId,
      route: input.routeTemplate
    }, error);
    return authenticationFailure(503, "service_unavailable", input.requestId);
  }
  if (!enabled) {
    return authenticationFailure(404, "api_disabled", input.requestId);
  }
  try {
    validateApiV1Configuration(options.environment ?? process.env);
  } catch (error) {
    await captureOperationalError({
      event: "api_error",
      requestId: input.requestId,
      route: input.routeTemplate
    }, error);
    return authenticationFailure(503, "service_unavailable", input.requestId);
  }
  const route = resolveApiV1RouteDefinition(input.routeTemplate);
  if (!route || route.scope !== input.scope) {
    return authenticationFailure(503, "service_unavailable", input.requestId);
  }
  const token = bearerTokenFromRequest(request);
  if (!token) return authenticationFailure(401, "invalid_token", input.requestId);
  const digest = deriveApiTokenDigest(token);
  const prefix = token.slice(0, "kr_beta_".length + 8);

  try {
    return await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      const result = await client.query<TokenRow & { unexpired: boolean }>(
        `SELECT token.*, token.expires_at > clock_timestamp() AS unexpired
         FROM public.api_tokens AS token
         WHERE token.prefix = $1`,
        [prefix]
      );
      const row = result.rows[0];
      const candidateDigest = row?.digest ?? dummyTokenDigest;
      const digestMatches = timingSafeEqual(
        Buffer.from(digest, "hex"),
        Buffer.from(candidateDigest, "hex")
      );
      const membership = await client.query<{ role: string }>(
        `SELECT role
         FROM public.memberships
         WHERE archive_id = $1 AND user_id = $2
         FOR SHARE`,
        [row?.archive_id ?? "unknown-api-archive", row?.user_id ?? "unknown-api-user"]
      );
      if (
        !row
        || !digestMatches
        || membership.rows[0]?.role !== "owner"
      ) {
        return authenticationFailure(401, "invalid_token", input.requestId);
      }
      const locked = await client.query<TokenRow & { unexpired: boolean }>(
        `SELECT token.*, token.expires_at > clock_timestamp() AS unexpired
         FROM public.api_tokens AS token
         WHERE token.id = $1 AND token.prefix = $2
         FOR UPDATE`,
        [row.id, prefix]
      );
      const lockedRow = locked.rows[0];
      if (
        !lockedRow
        || lockedRow.revoked_at !== null
        || lockedRow.unexpired !== true
      ) {
        return authenticationFailure(401, "invalid_token", input.requestId);
      }
      const scopes = validateStoredScopes(lockedRow.scopes);
      const profile = route.rateLimitProfile as ApiV1RateLimitProfile;
      const rateLimit = await consumeApiRateLimitInTransaction(client, {
        tokenId: lockedRow.id,
        profile
      });
      if (!rateLimit.allowed) {
        return authenticationFailure(
          429,
          "rate_limit_exceeded",
          input.requestId,
          rateLimit.rateLimit
        );
      }
      if (!scopes.includes(input.scope)) {
        return authenticationFailure(
          403,
          "insufficient_scope",
          input.requestId,
          rateLimit.rateLimit
        );
      }
      await client.query(
        `UPDATE public.api_tokens
         SET last_used_at = GREATEST(
           COALESCE(last_used_at, created_at),
           clock_timestamp()
         )
         WHERE id = $1`,
        [lockedRow.id]
      );
      return {
        ok: true,
        context: {
          tokenId: lockedRow.id,
          userId: lockedRow.user_id,
          archiveId: lockedRow.archive_id,
          scopes,
          requestId: input.requestId,
          rateLimit: rateLimit.rateLimit
        }
      };
    });
  } catch (error) {
    await captureOperationalError({
      event: "api_error",
      requestId: input.requestId,
      route: input.routeTemplate
    }, error);
    return authenticationFailure(503, "service_unavailable", input.requestId);
  }
}

export async function createApiTokenForOwner(
  input: {
    archiveId: string;
    userId: string;
    name: string;
    scopes: ApiV1Scope[];
    expiresAt: Date;
    requestId: string;
  },
  options: BetaApiTokenServiceOptions = {}
): Promise<CreatedApiToken> {
  requireEnabled(options);
  validateArchiveAndUser(input.archiveId, input.userId);
  const name = validateName(input.name);
  const scopes = validateRequestedScopes(input.scopes);
  const expiresAt = validateExpiration(input.expiresAt);
  validateRequestId(input.requestId);
  const secret = randomBytes(bearerTokenBytes).toString("base64url");
  const token = `kr_beta_${secret}`;
  const prefix = `kr_beta_${secret.slice(0, 8)}`;
  const tokenId = randomUUID();

  try {
    const row = await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await requireOwnerForTokenCreation(client, input.archiveId, input.userId);
      const inventory = await client.query<{ total_tokens: number; active_tokens: number }>(
        `SELECT count(*)::integer AS total_tokens,
                count(*) FILTER (
                  WHERE revoked_at IS NULL AND expires_at > clock_timestamp()
                )::integer AS active_tokens
         FROM public.api_tokens
         WHERE archive_id = $1`,
        [input.archiveId]
      );
      const counts = inventory.rows[0];
      if (
        !counts
        || counts.total_tokens >= apiTokenInventoryLimits.total
        || counts.active_tokens >= apiTokenInventoryLimits.active
      ) {
        throw new BetaApiTokenError("LIMIT_EXCEEDED");
      }
      const inserted = await client.query<TokenRow>(
        `INSERT INTO public.api_tokens (
           id, archive_id, user_id, name, prefix, digest, scopes, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)
         RETURNING *`,
        [
          tokenId,
          input.archiveId,
          input.userId,
          name,
          prefix,
          deriveApiTokenDigest(token),
          scopes,
          expiresAt
        ]
      );
      await appendSecurityEvent(client, {
        archiveId: input.archiveId,
        actorKind: "owner",
        userId: input.userId,
        tokenId,
        eventType: "api-token-created",
        requestId: input.requestId
      });
      const value = inserted.rows[0];
      if (!value) throw new Error("The API token could not be inserted.");
      return value;
    });
    return { ...mapTokenRow(row), token };
  } catch (error) {
    throw safeServiceError(error);
  }
}

export async function listApiTokensForOwner(
  input: { archiveId: string; userId: string },
  options: BetaApiTokenServiceOptions = {}
): Promise<ApiTokenMetadata[]> {
  requireEnabled(options);
  validateArchiveAndUser(input.archiveId, input.userId);
  try {
    return await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await requireOwner(client, input.archiveId, input.userId);
      const result = await client.query<TokenRow>(
        `SELECT id, archive_id, user_id, name, prefix, scopes,
                created_at, expires_at, last_used_at, revoked_at
         FROM public.api_tokens
         WHERE archive_id = $1
         ORDER BY created_at DESC, id DESC`,
        [input.archiveId]
      );
      return result.rows.map(mapTokenRow);
    });
  } catch (error) {
    throw safeServiceError(error);
  }
}

export async function revokeApiTokenForOwner(
  input: {
    archiveId: string;
    userId: string;
    tokenId: string;
    requestId: string;
  },
  options: BetaApiTokenServiceOptions = {}
): Promise<ApiTokenMetadata> {
  requireEnabled(options);
  validateArchiveAndUser(input.archiveId, input.userId);
  validateTokenId(input.tokenId);
  validateRequestId(input.requestId);
  try {
    const row = await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      await requireOwner(client, input.archiveId, input.userId);
      const existing = await client.query<TokenRow>(
        `SELECT *
         FROM public.api_tokens
         WHERE id = $1 AND archive_id = $2
         FOR UPDATE`,
        [input.tokenId, input.archiveId]
      );
      const token = existing.rows[0];
      if (!token) throw new BetaApiTokenError("NOT_FOUND");
      if (token.revoked_at !== null) return token;
      const revoked = await client.query<TokenRow>(
        `UPDATE public.api_tokens
         SET revoked_at = clock_timestamp()
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING *`,
        [input.tokenId]
      );
      const value = revoked.rows[0];
      if (!value) throw new Error("The API token could not be revoked.");
      await appendSecurityEvent(client, {
        archiveId: input.archiveId,
        actorKind: "owner",
        userId: input.userId,
        tokenId: input.tokenId,
        eventType: "api-token-revoked",
        requestId: input.requestId
      });
      return value;
    });
    return mapTokenRow(row);
  } catch (error) {
    throw safeServiceError(error);
  }
}

export async function recordApiTokenExportUse(
  input: {
    tokenId: string;
    archiveId: string;
    userId: string;
    requestId: string;
    routeTemplate: string;
  },
  options: DatabaseOptions = {}
): Promise<void> {
  validateArchiveAndUser(input.archiveId, input.userId);
  validateTokenId(input.tokenId);
  validateRequestId(input.requestId);
  if (input.routeTemplate !== "/api/v1/exports/gedcom") {
    throw new BetaApiTokenError("INVALID_INPUT");
  }
  try {
    await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      const token = await client.query(
        `SELECT 1
         FROM public.api_tokens
         WHERE id = $1 AND archive_id = $2 AND user_id = $3
         FOR SHARE`,
        [input.tokenId, input.archiveId, input.userId]
      );
      if (token.rows.length !== 1) throw new BetaApiTokenError("NOT_FOUND");
      await appendSecurityEvent(client, {
        archiveId: input.archiveId,
        actorKind: "token",
        userId: input.userId,
        tokenId: input.tokenId,
        eventType: "api-export-used",
        requestId: input.requestId
      });
    });
  } catch (error) {
    throw safeServiceError(error);
  }
}

export function deriveApiTokenDigest(token: string): string {
  if (!bearerTokenPattern.test(token)) throw new BetaApiTokenError("INVALID_INPUT");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function revokeAllApiTokensForOperator(
  input: { archiveId: string; expectedDatabaseIdentity: string; requestId: string },
  options: DatabaseOptions = {}
): Promise<Readonly<{ revokedTokens: number }>> {
  validateArchiveAndUser(input.archiveId, "operator");
  validateRequestId(input.requestId);
  try {
    return await withTransaction(withRlsMaintenanceMode(options), async (client) => {
      validateConfiguredDatabaseIdentity(
        input.expectedDatabaseIdentity,
        await readDatabaseIdentity(client)
      );
      const archive = await client.query(
        `SELECT 1 FROM public.archives WHERE id = $1 FOR UPDATE`,
        [input.archiveId]
      );
      if (archive.rows.length !== 1) throw new BetaApiTokenError("NOT_FOUND");
      await lockApiTokenInventory(client, input.archiveId);
      const active = await client.query<{ id: string }>(
        `SELECT id
         FROM public.api_tokens
         WHERE archive_id = $1
           AND revoked_at IS NULL
           AND expires_at > clock_timestamp()
         ORDER BY id COLLATE "C"
         FOR UPDATE`,
        [input.archiveId]
      );
      if (active.rows.length === 0) return { revokedTokens: 0 };
      const tokenIds = active.rows.map((row) => validateTokenId(row.id));
      const revoked = await client.query(
        `UPDATE public.api_tokens
         SET revoked_at = clock_timestamp()
         WHERE id = ANY($1::text[]) AND revoked_at IS NULL`,
        [tokenIds]
      );
      if (revoked.rowCount !== tokenIds.length) {
        throw new Error("The API token containment update was incomplete.");
      }
      for (const tokenId of tokenIds) {
        await appendSecurityEvent(client, {
          archiveId: input.archiveId,
          actorKind: "operator",
          tokenId,
          eventType: "api-token-revoked",
          requestId: input.requestId
        });
      }
      return { revokedTokens: tokenIds.length };
    });
  } catch (error) {
    throw safeServiceError(error);
  }
}

function bearerTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.includes(",")) return null;
  const match = authorization.match(/^[Bb][Ee][Aa][Rr][Ee][Rr] +(kr_beta_[A-Za-z0-9_-]{43})$/);
  return match?.[1] ?? null;
}

async function requireOwner(client: PoolClient, archiveId: string, userId: string): Promise<void> {
  const result = await client.query<{ role: string }>(
    `SELECT role
     FROM public.memberships
     WHERE archive_id = $1 AND user_id = $2
     FOR SHARE`,
    [archiveId, userId]
  );
  if (result.rows[0]?.role !== "owner") throw new BetaApiTokenError("FORBIDDEN");
}

async function requireOwnerForTokenCreation(
  client: PoolClient,
  archiveId: string,
  userId: string
): Promise<void> {
  const archive = await client.query(
    `SELECT 1
     FROM public.archives
     WHERE id = $1
     FOR SHARE NOWAIT`,
    [archiveId]
  );
  if (archive.rows.length !== 1) throw new BetaApiTokenError("FORBIDDEN");
  await lockApiTokenInventory(client, archiveId);
  const result = await client.query<{ role: string }>(
    `SELECT role
     FROM public.memberships
     WHERE archive_id = $1 AND user_id = $2
     FOR UPDATE`,
    [archiveId, userId]
  );
  if (result.rows[0]?.role !== "owner") throw new BetaApiTokenError("FORBIDDEN");
}

async function lockApiTokenInventory(client: PoolClient, archiveId: string): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock($1, hashtext($2))",
    [apiTokenInventoryAdvisoryNamespace, archiveId]
  );
}

async function appendSecurityEvent(
  client: PoolClient,
  input: {
    archiveId: string;
    actorKind: "owner" | "operator" | "token";
    userId?: string;
    tokenId: string;
    eventType: "api-token-created" | "api-token-revoked" | "api-export-used";
    requestId: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO public.security_events (
       id, archive_id, actor_kind, actor_user_id, token_id, event_type, request_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid)`,
    [
      randomUUID(),
      input.archiveId,
      input.actorKind,
      input.userId ?? null,
      input.tokenId,
      input.eventType,
      input.requestId
    ]
  );
}

function authenticationFailure(
  status: number,
  code: ApiTokenAuthenticationFailureCode,
  requestId: string,
  rateLimit?: ApiRateLimitHeaders
): Extract<ApiTokenAuthenticationResult, { ok: false }> {
  const messages: Record<ApiTokenAuthenticationFailureCode, string> = {
    api_disabled: "The API developer preview is not enabled.",
    invalid_token: "The bearer token is invalid, expired, or revoked.",
    insufficient_scope: "The token does not grant the required scope.",
    rate_limit_exceeded: "The API rate limit has been exceeded.",
    service_unavailable: "The API is temporarily unavailable."
  };
  return {
    ok: false,
    status,
    code,
    message: messages[code],
    requestId,
    ...(rateLimit ? { rateLimit } : {})
  };
}

function mapTokenRow(row: TokenRow): ApiTokenMetadata {
  const prefix = row.prefix;
  if (!prefixPattern.test(prefix)) throw new Error("The stored API token prefix is invalid.");
  return {
    id: validateTokenId(row.id),
    archiveId: row.archive_id,
    userId: row.user_id,
    name: validateName(row.name),
    prefix,
    scopes: validateStoredScopes(row.scopes),
    createdAt: requiredDate(row.created_at),
    expiresAt: requiredDate(row.expires_at),
    lastUsedAt: optionalDate(row.last_used_at),
    revokedAt: optionalDate(row.revoked_at)
  };
}

function validateRequestedScopes(value: ApiV1Scope[]): ApiV1Scope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > apiV1Scopes.length) {
    throw new BetaApiTokenError("INVALID_INPUT");
  }
  const unique = new Set(value);
  if (unique.size !== value.length || value.some((scope) => !isApiV1Scope(scope))) {
    throw new BetaApiTokenError("INVALID_INPUT");
  }
  return apiV1Scopes.filter((scope) => unique.has(scope));
}

function validateStoredScopes(value: unknown): ApiV1Scope[] {
  if (!Array.isArray(value) || value.some((scope) => typeof scope !== "string")) {
    throw new Error("The stored API token scopes are invalid.");
  }
  try {
    return validateRequestedScopes(value as ApiV1Scope[]);
  } catch {
    throw new Error("The stored API token scopes are invalid.");
  }
}

function validateExpiration(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new BetaApiTokenError("INVALID_INPUT");
  }
  const lifetime = value.getTime() - Date.now();
  if (lifetime < minimumLifetimeMs || lifetime > maximumLifetimeMs) {
    throw new BetaApiTokenError("INVALID_INPUT");
  }
  return value;
}

function validateName(value: string): string {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || value.length < 1
    || value.length > 80
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new BetaApiTokenError("INVALID_INPUT");
  }
  return value;
}

function validateArchiveAndUser(archiveId: string, userId: string): void {
  if (
    typeof archiveId !== "string"
    || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(archiveId)
    || typeof userId !== "string"
    || Buffer.byteLength(userId, "utf8") < 1
    || Buffer.byteLength(userId, "utf8") > 255
  ) {
    throw new BetaApiTokenError("INVALID_INPUT");
  }
}

function validateTokenId(value: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new BetaApiTokenError("INVALID_INPUT");
  }
  return value;
}

function validateRequestId(value: string): void {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new BetaApiTokenError("INVALID_INPUT");
  }
}

function requiredDate(value: Date): Date {
  const result = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error("The stored API token timestamp is invalid.");
  return result;
}

function optionalDate(value: Date | null): Date | null {
  return value === null ? null : requiredDate(value);
}

function requireEnabled(options: BetaApiTokenServiceOptions): void {
  try {
    if (!apiV1Enabled(options.environment ?? process.env)) {
      throw new BetaApiTokenError("API_DISABLED");
    }
    validateApiV1Configuration(options.environment ?? process.env);
  } catch (error) {
    if (error instanceof BetaApiTokenError) throw error;
    throw new BetaApiTokenError("OPERATION_FAILED", { cause: error });
  }
}

export function validateApiV1Configuration(environment: Environment = process.env): void {
  const cursorSecret = environment.KINRESOLVE_API_CURSOR_SECRET?.trim() ?? "";
  if (
    Buffer.byteLength(cursorSecret, "utf8") < 32
    || Buffer.byteLength(cursorSecret, "utf8") > 512
  ) {
    const error = new Error("KINRESOLVE_API_CURSOR_SECRET must contain 32 to 512 bytes.");
    Object.assign(error, { code: "CONFIG_INVALID" });
    throw error;
  }
  for (const name of apiCursorDistinctCredentialEnvironmentNames) {
    if (name === "KINRESOLVE_API_CURSOR_SECRET") continue;
    const other = environment[name]?.trim();
    if (other && other === cursorSecret) {
      const error = new Error("KINRESOLVE_API_CURSOR_SECRET must be a distinct credential.");
      Object.assign(error, { code: "CONFIG_INVALID" });
      throw error;
    }
  }
  for (const name of structuredDatabaseCredentialEnvironmentNames) {
    const value = environment[name]?.trim();
    if (!value) continue;
    for (const credential of databaseUrlCredentials(value)) {
      if (credential === cursorSecret) {
        const error = new Error("KINRESOLVE_API_CURSOR_SECRET must be a distinct credential.");
        Object.assign(error, { code: "CONFIG_INVALID" });
        throw error;
      }
    }
  }
}

function databaseUrlCredentials(value: string): string[] {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return [];
    return [parsed.username, parsed.password]
      .filter((credential) => credential.length > 0)
      .map((credential) => {
        try {
          return decodeURIComponent(credential);
        } catch {
          return credential;
        }
      });
  } catch {
    return [];
  }
}

function safeServiceError(error: unknown): BetaApiTokenError {
  return error instanceof BetaApiTokenError
    ? error
    : new BetaApiTokenError("OPERATION_FAILED", { cause: error });
}
