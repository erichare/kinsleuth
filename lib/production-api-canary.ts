import { createHash, createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import {
  createApiTokenForOwner,
  deriveApiTokenDigest,
  revokeApiTokenForOwner,
  type BetaApiTokenServiceOptions
} from "./beta-api-tokens";
import {
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "./database-attestation";
import { withClient, withTransaction, type DatabaseOptions } from "./db";
// Imported from ./db-rls directly so unit tests that mock "@/lib/db" keep the
// real scope helper.
import { withRlsArchiveScope } from "./db-rls";

type ApiEnvironment = Record<string, string | undefined>;

export const productionApiCanaryMaximumLifetimeMs = 120 * 60_000;
export const productionApiCanaryScope = "archive:read" as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tokenPattern = /^kr_beta_[A-Za-z0-9_-]{43}$/;
const tokenPrefixPattern = /^kr_beta_[A-Za-z0-9_-]{8}$/;
const releaseCommitPattern = /^[0-9a-f]{40}$/;
const databaseIdentityPattern = /^[a-f0-9]{64}$/;
const archiveIdPattern = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const positiveIntegerPattern = /^[1-9][0-9]{0,19}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const canaryContextAdvisoryNamespace = 160_017;

export type ProductionApiCanaryContext = Readonly<{
  releaseCommitSha: string;
  repository: string;
  workflowRunId: string;
  workflowRunAttempt: number;
}>;

/**
 * Runner-local metadata. It is safe to keep separate from the bearer secret,
 * but it must not be uploaded or copied into release summaries.
 */
export type ProductionApiCanaryMetadata = Readonly<{
  schemaVersion: 1;
  context: ProductionApiCanaryContext;
  databaseIdentity: string;
  archiveBindingSha256: string;
  archiveResourceBindingSha256: string;
  ownerBindingSha256: string;
  tokenId: string;
  tokenPrefix: string;
  tokenName: string;
  scopes: readonly [typeof productionApiCanaryScope];
  createdAt: string;
  expiresAt: string;
  createRequestId: string;
}>;

export type ProductionApiCanaryProbeEvidence = Readonly<{
  passed: true;
  status: 200;
  requestIdPresent: true;
  exactSchema: true;
  expectedProductVersion: true;
  archiveResourceIdIsOpaque: true;
  leastPrivilegeCapabilities: true;
  privateNoStore: true;
  rateLimitHeadersPresent: true;
  deploymentProtectionBypassUsed: boolean;
}>;

export type ProductionApiCanaryEvidence = Readonly<{
  schemaVersion: 1;
  context: ProductionApiCanaryContext;
  databaseIdentityAttested: boolean;
  archiveBindingAttested: boolean;
  ownerBindingAttested: boolean;
  leastPrivilegeScopeAttested: boolean;
  boundedExpiryAttested: boolean;
  secretFileModeAttested: boolean;
  candidate?: ProductionApiCanaryProbeEvidence;
  canonical?: ProductionApiCanaryProbeEvidence;
  revocation?: Readonly<{
    revoked: boolean;
    immediateCanonical401: boolean;
    invalidTokenContract: boolean;
    requestIdPresent: boolean;
    cleanupConfirmed: boolean;
  }>;
}>;

export type PreparedProductionApiCanary = Readonly<{
  token: string;
  metadata: ProductionApiCanaryMetadata;
  evidence: ProductionApiCanaryEvidence;
}>;

type PrepareProductionApiCanaryInput = Readonly<{
  context: ProductionApiCanaryContext;
  databaseUrl: string;
  expectedDatabaseIdentity: string;
  expectedArchiveId: string;
  expectedOwnerUserId: string;
  apiEnvironment: ApiEnvironment;
  now?: Date;
}>;

type RevokeProductionApiCanaryInput = Readonly<{
  metadata: ProductionApiCanaryMetadata;
  context: ProductionApiCanaryContext;
  databaseUrl: string;
  expectedDatabaseIdentity: string;
  expectedArchiveId: string;
  expectedOwnerUserId: string;
  apiEnvironment: ApiEnvironment;
  requestId?: string;
}>;

type ProbeProductionApiCanaryInput = Readonly<{
  phase: "candidate" | "canonical";
  origin: string;
  token: string;
  metadata: ProductionApiCanaryMetadata;
  context: ProductionApiCanaryContext;
  expectedProductVersion: string;
  vercelAutomationBypassSecret?: string;
  fetchImplementation?: typeof fetch;
  now?: Date;
}>;

type RevokedProbeInput = Readonly<{
  origin: string;
  token: string;
  metadata: ProductionApiCanaryMetadata;
  context: ProductionApiCanaryContext;
  fetchImplementation?: typeof fetch;
  now?: Date;
}>;

export function validateProductionApiCanaryContext(
  value: ProductionApiCanaryContext
): ProductionApiCanaryContext {
  if (!releaseCommitPattern.test(value.releaseCommitSha)) {
    throw new Error("The API canary release commit is invalid.");
  }
  if (!repositoryPattern.test(value.repository)) {
    throw new Error("The API canary repository is invalid.");
  }
  if (!positiveIntegerPattern.test(value.workflowRunId)) {
    throw new Error("The API canary workflow run is invalid.");
  }
  if (
    !Number.isSafeInteger(value.workflowRunAttempt)
    || value.workflowRunAttempt < 1
    || value.workflowRunAttempt > 9_999_999_999
  ) {
    throw new Error("The API canary workflow attempt is invalid.");
  }
  return value;
}

export function productionApiCanaryName(context: ProductionApiCanaryContext): string {
  validateProductionApiCanaryContext(context);
  const runSuffix = context.workflowRunId.slice(-12);
  return `release-api-canary-${context.releaseCommitSha.slice(0, 12)}-${runSuffix}-${context.workflowRunAttempt}`;
}

export async function prepareProductionApiCanary(
  input: PrepareProductionApiCanaryInput
): Promise<PreparedProductionApiCanary> {
  const context = validateProductionApiCanaryContext(input.context);
  const target = validateTargetInput(input);
  const now = requiredDate(input.now ?? new Date(), "API canary creation time");
  const expiresAt = new Date(now.getTime() + productionApiCanaryMaximumLifetimeMs);
  const createRequestId = productionApiCanaryCreationRequestId(
    context,
    target,
    input.apiEnvironment
  );

  const prepared = await withProductionApiCanaryContextLock(
    input.databaseUrl,
    context,
    target,
    async (client) => {
      const attestation = await attestProductionApiCanaryTarget(
        target,
        { databaseUrl: input.databaseUrl }
      );
      const existing = await findProductionApiCanaryRows(
        client,
        context,
        target,
        input.apiEnvironment
      );
      if (existing.length !== 0) {
        throw new Error("The API canary context already has retained token metadata.");
      }
      const created = await createApiTokenForOwner(
        {
          archiveId: target.expectedArchiveId,
          userId: target.expectedOwnerUserId,
          name: productionApiCanaryName(context),
          scopes: [productionApiCanaryScope],
          expiresAt,
          requestId: createRequestId
        },
        tokenServiceOptions(input.databaseUrl, input.apiEnvironment)
      );
      return { created, archiveResourceBindingSha256: attestation.archiveResourceBindingSha256 };
    }
  );
  const { created } = prepared;

  if (created.scopes.length !== 1 || created.scopes[0] !== productionApiCanaryScope) {
    throw new Error("The API canary token was not least privilege.");
  }
  const lifetimeMs = created.expiresAt.getTime() - created.createdAt.getTime();
  if (lifetimeMs <= 0 || lifetimeMs > productionApiCanaryMaximumLifetimeMs) {
    throw new Error("The API canary token lifetime exceeded its release bound.");
  }

  const metadata: ProductionApiCanaryMetadata = {
    schemaVersion: 1,
    context,
    databaseIdentity: target.expectedDatabaseIdentity,
    archiveBindingSha256: bindingDigest("archive", target.expectedArchiveId),
    archiveResourceBindingSha256: prepared.archiveResourceBindingSha256,
    ownerBindingSha256: bindingDigest("owner", target.expectedOwnerUserId),
    tokenId: created.id,
    tokenPrefix: created.prefix,
    tokenName: created.name,
    scopes: [productionApiCanaryScope],
    createdAt: created.createdAt.toISOString(),
    expiresAt: created.expiresAt.toISOString(),
    createRequestId
  };
  validateProductionApiCanaryMetadata(metadata, context);
  if (!tokenPattern.test(created.token) || created.token.slice(0, 16) !== created.prefix) {
    throw new Error("The API canary token secret is malformed.");
  }

  return {
    token: created.token,
    metadata,
    evidence: {
      schemaVersion: 1,
      context,
      databaseIdentityAttested: true,
      archiveBindingAttested: true,
      ownerBindingAttested: true,
      leastPrivilegeScopeAttested: true,
      boundedExpiryAttested: true,
      secretFileModeAttested: false
    }
  };
}

export async function revokeProductionApiCanary(
  input: RevokeProductionApiCanaryInput
): Promise<{ revoked: true }> {
  const context = validateProductionApiCanaryContext(input.context);
  const metadata = validateProductionApiCanaryMetadata(input.metadata, context);
  const target = validateTargetInput(input);
  validateMetadataTarget(metadata, target);
  const result = await cleanupProductionApiCanary({
    context,
    databaseUrl: input.databaseUrl,
    expectedDatabaseIdentity: target.expectedDatabaseIdentity,
    expectedArchiveId: target.expectedArchiveId,
    expectedOwnerUserId: target.expectedOwnerUserId,
    apiEnvironment: input.apiEnvironment,
    expectedTokenId: metadata.tokenId,
    expectedArchiveResourceBindingSha256: metadata.archiveResourceBindingSha256,
    requestId: input.requestId
  });
  if (!result.found || !result.revoked) {
    throw new Error("The API canary token revocation was not durable.");
  }
  return { revoked: true };
}

export async function cleanupProductionApiCanary(input: Readonly<{
  context: ProductionApiCanaryContext;
  databaseUrl: string;
  expectedDatabaseIdentity: string;
  expectedArchiveId: string;
  expectedOwnerUserId: string;
  apiEnvironment: ApiEnvironment;
  expectedTokenId?: string;
  expectedArchiveResourceBindingSha256?: string;
  requestId?: string;
}>): Promise<Readonly<{ found: boolean; revoked: boolean }>> {
  const context = validateProductionApiCanaryContext(input.context);
  const target = validateTargetInput(input);
  if (input.expectedTokenId !== undefined && !uuidPattern.test(input.expectedTokenId)) {
    throw new Error("The expected API canary token identifier is invalid.");
  }
  if (
    input.expectedArchiveResourceBindingSha256 !== undefined
    && !databaseIdentityPattern.test(input.expectedArchiveResourceBindingSha256)
  ) {
    throw new Error("The expected API canary archive resource binding is invalid.");
  }
  return withProductionApiCanaryContextLock(
    input.databaseUrl,
    context,
    target,
    async (client) => {
      const attestation = await attestProductionApiCanaryTarget(
        target,
        { databaseUrl: input.databaseUrl }
      );
      if (
        input.expectedArchiveResourceBindingSha256 !== undefined
        && input.expectedArchiveResourceBindingSha256
          !== attestation.archiveResourceBindingSha256
      ) {
        throw new Error("The retained API canary archive resource binding is invalid.");
      }
      const rows = await findProductionApiCanaryRows(
        client,
        context,
        target,
        input.apiEnvironment
      );
      if (rows.length === 0) return { found: false, revoked: false };
      const row = rows[0]!;
      if (input.expectedTokenId !== undefined && row.id !== input.expectedTokenId) {
        throw new Error("The retained API canary token does not match runner-local metadata.");
      }
      const revoked = await revokeApiTokenForOwner(
        {
          archiveId: target.expectedArchiveId,
          userId: target.expectedOwnerUserId,
          tokenId: row.id,
          requestId: input.requestId ?? randomUUID()
        },
        tokenServiceOptions(input.databaseUrl, input.apiEnvironment)
      );
      if (!revoked.revokedAt || revoked.id !== row.id) {
        throw new Error("The API canary token revocation was not durable.");
      }
      return { found: true, revoked: true };
    }
  );
}

export async function probeProductionApiCanary(
  input: ProbeProductionApiCanaryInput
): Promise<ProductionApiCanaryProbeEvidence> {
  const context = validateProductionApiCanaryContext(input.context);
  const metadata = validateProductionApiCanaryMetadata(input.metadata, context);
  validateTokenMatchesMetadata(input.token, metadata);
  requireUnexpired(metadata, input.now ?? new Date());
  const origin = strictOrigin(input.origin);
  validateProbeOrigin(input.phase, origin);
  const bypass = input.vercelAutomationBypassSecret?.trim();
  if (input.phase === "candidate" && !isSafeSecret(bypass)) {
    throw new Error("The candidate API canary requires the Vercel protection bypass.");
  }
  if (input.phase === "canonical" && bypass) {
    throw new Error("The canonical API canary must exercise the public edge without a bypass.");
  }

  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${input.token}`,
    "user-agent": "kinresolve-production-api-canary/1.0"
  });
  if (bypass) headers.set("x-vercel-protection-bypass", bypass);
  const response = await (input.fetchImplementation ?? fetch)(
    new URL("/api/v1/meta", origin),
    {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000)
    }
  );
  const body = parseJsonObject(await readBoundedBody(response), "API canary response");
  validateSuccessfulMetaResponse(
    response,
    body,
    input.expectedProductVersion,
    metadata.archiveResourceBindingSha256
  );
  return {
    passed: true,
    status: 200,
    requestIdPresent: true,
    exactSchema: true,
    expectedProductVersion: true,
    archiveResourceIdIsOpaque: true,
    leastPrivilegeCapabilities: true,
    privateNoStore: true,
    rateLimitHeadersPresent: true,
    deploymentProtectionBypassUsed: Boolean(bypass)
  };
}

export async function probeRevokedProductionApiCanary(
  input: RevokedProbeInput
): Promise<Readonly<{
  immediateCanonical401: true;
  invalidTokenContract: true;
  requestIdPresent: true;
}>> {
  const context = validateProductionApiCanaryContext(input.context);
  const metadata = validateProductionApiCanaryMetadata(input.metadata, context);
  validateTokenMatchesMetadata(input.token, metadata);
  const now = requiredDate(input.now ?? new Date(), "API canary probe time");
  if (now.getTime() >= requiredDate(new Date(metadata.expiresAt), "API canary expiry").getTime()) {
    throw new Error("The API canary expired before immediate revocation could be proven.");
  }
  const origin = strictOrigin(input.origin);
  validateProbeOrigin("canonical", origin);
  const response = await (input.fetchImplementation ?? fetch)(
    new URL("/api/v1/meta", origin),
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.token}`,
        "user-agent": "kinresolve-production-api-canary/1.0"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000)
    }
  );
  const body = parseJsonObject(await readBoundedBody(response), "revoked API canary response");
  validateRevokedResponse(response, body);
  return {
    immediateCanonical401: true,
    invalidTokenContract: true,
    requestIdPresent: true
  };
}

export function validateProductionApiCanaryMetadata(
  value: unknown,
  expectedContext: ProductionApiCanaryContext
): ProductionApiCanaryMetadata {
  const object = parseObject(value, "API canary metadata");
  requireExactKeys(object, [
    "archiveBindingSha256", "archiveResourceBindingSha256", "context", "createRequestId",
    "createdAt", "databaseIdentity", "expiresAt", "ownerBindingSha256", "schemaVersion",
    "scopes", "tokenId", "tokenName", "tokenPrefix"
  ], "API canary metadata");
  if (object.schemaVersion !== 1) throw new Error("The API canary metadata version is invalid.");
  const context = validateProductionApiCanaryContext(
    parseObject(object.context, "API canary metadata context") as ProductionApiCanaryContext
  );
  if (JSON.stringify(context) !== JSON.stringify(validateProductionApiCanaryContext(expectedContext))) {
    throw new Error("The API canary metadata is bound to a different workflow run.");
  }
  if (!databaseIdentityPattern.test(stringValue(object.databaseIdentity))) {
    throw new Error("The API canary database identity is invalid.");
  }
  for (const digest of [
    object.archiveBindingSha256,
    object.archiveResourceBindingSha256,
    object.ownerBindingSha256
  ]) {
    if (!databaseIdentityPattern.test(stringValue(digest))) {
      throw new Error("The API canary target binding is invalid.");
    }
  }
  if (!uuidPattern.test(stringValue(object.tokenId))) {
    throw new Error("The API canary token identifier is invalid.");
  }
  if (!tokenPrefixPattern.test(stringValue(object.tokenPrefix))) {
    throw new Error("The API canary token prefix is invalid.");
  }
  if (object.tokenName !== productionApiCanaryName(context)) {
    throw new Error("The API canary token name is invalid.");
  }
  if (
    !Array.isArray(object.scopes)
    || object.scopes.length !== 1
    || object.scopes[0] !== productionApiCanaryScope
  ) {
    throw new Error("The API canary token scope is invalid.");
  }
  if (!uuidPattern.test(stringValue(object.createRequestId))) {
    throw new Error("The API canary creation request is invalid.");
  }
  const createdAt = requiredDate(new Date(stringValue(object.createdAt)), "API canary creation time");
  const expiresAt = requiredDate(new Date(stringValue(object.expiresAt)), "API canary expiry");
  const lifetimeMs = expiresAt.getTime() - createdAt.getTime();
  if (lifetimeMs <= 0 || lifetimeMs > productionApiCanaryMaximumLifetimeMs) {
    throw new Error("The API canary metadata exceeds the maximum lifetime.");
  }
  return object as unknown as ProductionApiCanaryMetadata;
}

export function validateProductionApiCanaryEvidence(
  value: unknown,
  expectedContext: ProductionApiCanaryContext,
  options: { complete: boolean }
): ProductionApiCanaryEvidence {
  const object = parseObject(value, "API canary evidence");
  const allowedKeys = [
    "archiveBindingAttested", "boundedExpiryAttested", "candidate", "canonical", "context",
    "databaseIdentityAttested", "leastPrivilegeScopeAttested", "ownerBindingAttested",
    "revocation", "schemaVersion", "secretFileModeAttested"
  ];
  requireExactKeys(object, allowedKeys.filter((key) => key in object), "API canary evidence", allowedKeys);
  if (object.schemaVersion !== 1) throw new Error("The API canary evidence version is invalid.");
  const context = validateProductionApiCanaryContext(
    parseObject(object.context, "API canary evidence context") as ProductionApiCanaryContext
  );
  if (JSON.stringify(context) !== JSON.stringify(validateProductionApiCanaryContext(expectedContext))) {
    throw new Error("The API canary evidence is bound to a different workflow run.");
  }
  for (const key of [
    "databaseIdentityAttested", "archiveBindingAttested", "ownerBindingAttested",
    "leastPrivilegeScopeAttested", "boundedExpiryAttested", "secretFileModeAttested"
  ]) {
    if (object[key] !== true) throw new Error("The API canary target attestation is incomplete.");
  }
  if (object.candidate !== undefined) validateProbeEvidence(object.candidate, true);
  if (object.canonical !== undefined) validateProbeEvidence(object.canonical, false);
  if (object.revocation !== undefined) validateRevocationEvidence(object.revocation);
  if (options.complete && (!object.candidate || !object.canonical || !object.revocation)) {
    throw new Error("The API canary evidence is incomplete.");
  }
  if (options.complete) {
    const revocation = object.revocation as Record<string, unknown>;
    if (
      revocation.revoked !== true
      || revocation.immediateCanonical401 !== true
      || revocation.invalidTokenContract !== true
      || revocation.requestIdPresent !== true
      || revocation.cleanupConfirmed !== true
    ) {
      throw new Error("The API canary cleanup evidence is incomplete.");
    }
  }
  return object as unknown as ProductionApiCanaryEvidence;
}

export function markProductionApiCanarySecretFileAttested(
  evidence: ProductionApiCanaryEvidence
): ProductionApiCanaryEvidence {
  return { ...evidence, secretFileModeAttested: true };
}

export function appendProductionApiCanaryProbeEvidence(
  evidence: ProductionApiCanaryEvidence,
  phase: "candidate" | "canonical",
  probe: ProductionApiCanaryProbeEvidence
): ProductionApiCanaryEvidence {
  validateProductionApiCanaryEvidence(evidence, evidence.context, { complete: false });
  if (phase === "candidate") {
    if (evidence.candidate || evidence.canonical || evidence.revocation) {
      throw new Error("The candidate API canary evidence transition is invalid.");
    }
    return { ...evidence, candidate: probe };
  }
  if (!evidence.candidate || evidence.canonical || evidence.revocation) {
    throw new Error("The canonical API canary evidence transition is invalid.");
  }
  return { ...evidence, canonical: probe };
}

export function markProductionApiCanaryRevoked(
  evidence: ProductionApiCanaryEvidence
): ProductionApiCanaryEvidence {
  if (!evidence.candidate || !evidence.canonical || evidence.revocation) {
    throw new Error("The API canary revocation evidence transition is invalid.");
  }
  return {
    ...evidence,
    revocation: {
      revoked: true,
      immediateCanonical401: false,
      invalidTokenContract: false,
      requestIdPresent: false,
      cleanupConfirmed: false
    }
  };
}

export function markProductionApiCanaryImmediate401(
  evidence: ProductionApiCanaryEvidence
): ProductionApiCanaryEvidence {
  if (!evidence.revocation?.revoked) {
    throw new Error("The API canary must be revoked before the 401 proof.");
  }
  return {
    ...evidence,
    revocation: {
      ...evidence.revocation,
      immediateCanonical401: true,
      invalidTokenContract: true,
      requestIdPresent: true
    }
  };
}

export function markProductionApiCanaryCleanupConfirmed(
  evidence: ProductionApiCanaryEvidence
): ProductionApiCanaryEvidence {
  if (!evidence.revocation?.revoked) {
    throw new Error("The API canary must be revoked before cleanup can be confirmed.");
  }
  return {
    ...evidence,
    revocation: { ...evidence.revocation, cleanupConfirmed: true }
  };
}

export function markProductionApiCanaryEmergencyCleanup(
  evidence: ProductionApiCanaryEvidence
): ProductionApiCanaryEvidence {
  return {
    ...evidence,
    revocation: {
      revoked: true,
      immediateCanonical401: evidence.revocation?.immediateCanonical401 ?? false,
      invalidTokenContract: evidence.revocation?.invalidTokenContract ?? false,
      requestIdPresent: evidence.revocation?.requestIdPresent ?? false,
      cleanupConfirmed: true
    }
  };
}

export function productionApiCanaryEvidenceSha256(evidence: ProductionApiCanaryEvidence): string {
  validateProductionApiCanaryEvidence(evidence, evidence.context, { complete: true });
  return createHash("sha256").update(`${JSON.stringify(evidence)}\n`, "utf8").digest("hex");
}

async function attestProductionApiCanaryTarget(
  input: ReturnType<typeof validateTargetInput>,
  options: DatabaseOptions
): Promise<{ archiveResourceBindingSha256: string }> {
  // The archives FOR SHARE lock below is gated by the archive-scoped UPDATE
  // policy under a NOBYPASSRLS role, so the transaction pins the canary's
  // configured archive.
  return withTransaction(withRlsArchiveScope(options, input.expectedArchiveId), async (client) => {
    validateConfiguredDatabaseIdentity(
      input.expectedDatabaseIdentity,
      await readDatabaseIdentity(client)
    );
    const archive = await client.query<{ id: string; api_id: string }>(
      `SELECT id, api_id::text AS api_id
       FROM public.archives
       WHERE id = $1
       FOR SHARE`,
      [input.expectedArchiveId]
    );
    if (
      archive.rows.length !== 1
      || archive.rows[0]?.id !== input.expectedArchiveId
      || !uuidPattern.test(archive.rows[0]?.api_id ?? "")
    ) {
      throw new Error("The API canary archive binding is invalid.");
    }
    // Match exactly the protected expected owner. Other current archive owners
    // are valid and deliberately do not make this multi-owner archive ambiguous.
    const owner = await client.query<{ user_id: string }>(
      `SELECT user_id
       FROM public.memberships
       WHERE archive_id = $1 AND user_id = $2 AND role = 'owner'
       FOR SHARE`,
      [input.expectedArchiveId, input.expectedOwnerUserId]
    );
    if (owner.rows.length !== 1 || owner.rows[0]?.user_id !== input.expectedOwnerUserId) {
      throw new Error("The API canary expected owner is not a current archive owner.");
    }
    return {
      archiveResourceBindingSha256: bindingDigest("archive-resource", archive.rows[0]!.api_id)
    };
  });
}

async function withProductionApiCanaryContextLock<T>(
  databaseUrl: string,
  context: ProductionApiCanaryContext,
  target: ReturnType<typeof validateTargetInput>,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const lockKey = createHash("sha256")
    .update("kinresolve-production-api-canary-context-lock-v1\0", "utf8")
    .update(target.expectedArchiveId, "utf8")
    .update("\0", "utf8")
    .update(target.expectedOwnerUserId, "utf8")
    .update("\0", "utf8")
    .update(productionApiCanaryName(context), "utf8")
    .digest("hex");
  return withClient({ databaseUrl }, async (client) => {
    await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [
      canaryContextAdvisoryNamespace,
      lockKey
    ]);
    try {
      return await callback(client);
    } finally {
      const unlocked = await client.query<{ unlocked: boolean }>(
        "SELECT pg_advisory_unlock($1, hashtext($2)) AS unlocked",
        [canaryContextAdvisoryNamespace, lockKey]
      );
      if (unlocked.rows[0]?.unlocked !== true) {
        throw new Error("The API canary context lock could not be released.");
      }
    }
  });
}

async function findProductionApiCanaryRows(
  client: PoolClient,
  context: ProductionApiCanaryContext,
  target: ReturnType<typeof validateTargetInput>,
  apiEnvironment: ApiEnvironment
): Promise<Array<{ id: string }>> {
  const creationRequestId = productionApiCanaryCreationRequestId(
    context,
    target,
    apiEnvironment
  );
  const result = await client.query<{ id: string }>(
    `SELECT token.id
     FROM public.security_events AS event
     JOIN public.api_tokens AS token
       ON token.id = event.token_id AND token.archive_id = event.archive_id
     WHERE event.request_id = $1::uuid
       AND event.archive_id = $2
       AND event.actor_kind = 'owner'
       AND event.actor_user_id = $3
       AND event.event_type = 'api-token-created'
       AND token.user_id = $3
       AND token.name = $4
       AND token.scopes = ARRAY['archive:read']::text[]
     ORDER BY token.id COLLATE "C"`,
    [
      creationRequestId,
      target.expectedArchiveId,
      target.expectedOwnerUserId,
      productionApiCanaryName(context)
    ]
  );
  if (result.rows.length > 1 || result.rows.some((row) => !uuidPattern.test(row.id))) {
    throw new Error("The API canary context token inventory is ambiguous.");
  }
  return result.rows;
}

function productionApiCanaryCreationRequestId(
  context: ProductionApiCanaryContext,
  target: ReturnType<typeof validateTargetInput>,
  apiEnvironment: ApiEnvironment
): string {
  const secret = apiEnvironment.KINRESOLVE_API_CURSOR_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 512) {
    throw new Error("The API canary request namespace credential is invalid.");
  }
  const bytes = createHmac("sha256", secret)
    .update("kinresolve-production-api-canary-creation-request-v1\0", "utf8")
    .update(context.releaseCommitSha, "utf8")
    .update("\0", "utf8")
    .update(context.repository, "utf8")
    .update("\0", "utf8")
    .update(context.workflowRunId, "utf8")
    .update("\0", "utf8")
    .update(String(context.workflowRunAttempt), "utf8")
    .update("\0", "utf8")
    .update(target.expectedArchiveId, "utf8")
    .update("\0", "utf8")
    .update(target.expectedOwnerUserId, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateTargetInput(input: {
  databaseUrl: string;
  expectedDatabaseIdentity: string;
  expectedArchiveId: string;
  expectedOwnerUserId: string;
}): {
  expectedDatabaseIdentity: string;
  expectedArchiveId: string;
  expectedOwnerUserId: string;
} {
  if (!input.databaseUrl?.trim()) throw new Error("The API canary database connection is missing.");
  if (!databaseIdentityPattern.test(input.expectedDatabaseIdentity)) {
    throw new Error("The API canary database identity is invalid.");
  }
  if (!archiveIdPattern.test(input.expectedArchiveId)) {
    throw new Error("The API canary archive identity is invalid.");
  }
  if (
    typeof input.expectedOwnerUserId !== "string"
    || Buffer.byteLength(input.expectedOwnerUserId, "utf8") < 1
    || Buffer.byteLength(input.expectedOwnerUserId, "utf8") > 255
    || /[\0\r\n]/u.test(input.expectedOwnerUserId)
  ) {
    throw new Error("The API canary expected owner identity is invalid.");
  }
  return {
    expectedDatabaseIdentity: input.expectedDatabaseIdentity,
    expectedArchiveId: input.expectedArchiveId,
    expectedOwnerUserId: input.expectedOwnerUserId
  };
}

function validateMetadataTarget(
  metadata: ProductionApiCanaryMetadata,
  target: ReturnType<typeof validateTargetInput>
): void {
  if (
    metadata.databaseIdentity !== target.expectedDatabaseIdentity
    || metadata.archiveBindingSha256 !== bindingDigest("archive", target.expectedArchiveId)
    || metadata.ownerBindingSha256 !== bindingDigest("owner", target.expectedOwnerUserId)
  ) {
    throw new Error("The API canary metadata target binding is invalid.");
  }
}

function tokenServiceOptions(
  databaseUrl: string,
  apiEnvironment: ApiEnvironment
): BetaApiTokenServiceOptions {
  return {
    databaseUrl,
    environment: { ...apiEnvironment, MIGRATION_DATABASE_URL: databaseUrl }
  };
}

function validateTokenMatchesMetadata(token: string, metadata: ProductionApiCanaryMetadata): void {
  if (!tokenPattern.test(token) || token.slice(0, 16) !== metadata.tokenPrefix) {
    throw new Error("The API canary token does not match its runner-local metadata.");
  }
  // Exercise the production token parser without retaining or exposing the digest.
  deriveApiTokenDigest(token);
}

function requireUnexpired(metadata: ProductionApiCanaryMetadata, nowValue: Date): void {
  const now = requiredDate(nowValue, "API canary probe time");
  const expiresAt = requiredDate(new Date(metadata.expiresAt), "API canary expiry");
  if (now.getTime() >= expiresAt.getTime()) {
    throw new Error("The API canary token expired before the release probe.");
  }
}

function strictOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error("The API canary origin must be one HTTPS origin.");
  }
}

function validateProbeOrigin(phase: "candidate" | "canonical", origin: string): void {
  const hostname = new URL(origin).hostname;
  if (phase === "canonical") {
    if (origin !== "https://app.kinresolve.com") {
      throw new Error("The canonical API canary origin is invalid.");
    }
    return;
  }
  if (
    hostname === "app.kinresolve.com"
    || hostname === "vercel.app"
    || !hostname.endsWith(".vercel.app")
    || !/^[a-z0-9.-]+$/.test(hostname)
  ) {
    throw new Error("The candidate API canary must target a generated Vercel deployment.");
  }
}

function validateSuccessfulMetaResponse(
  response: Response,
  body: Record<string, unknown>,
  expectedProductVersion: string,
  expectedArchiveResourceBindingSha256: string
): void {
  if (response.status !== 200) throw new Error("The API canary did not receive HTTP 200.");
  validatePrivateApiHeaders(response.headers, true);
  requireExactKeys(body, ["data"], "API canary response");
  const data = parseObject(body.data, "API canary response data");
  requireExactKeys(
    data,
    ["apiVersion", "archive", "capabilities", "productVersion"],
    "API canary response data"
  );
  if (data.apiVersion !== "v1" || data.productVersion !== expectedProductVersion) {
    throw new Error("The API canary product contract is invalid.");
  }
  const archive = parseObject(data.archive, "API canary archive");
  requireExactKeys(archive, ["id", "name", "tagline"], "API canary archive");
  const archiveId = stringValue(archive.id);
  if (
    !uuidPattern.test(archiveId)
    || bindingDigest("archive-resource", archiveId) !== expectedArchiveResourceBindingSha256
    || typeof archive.name !== "string"
    || archive.name.length < 1
    || typeof archive.tagline !== "string"
  ) {
    throw new Error("The API canary archive projection is invalid.");
  }
  const capabilities = parseObject(data.capabilities, "API canary capabilities");
  requireExactKeys(
    capabilities,
    ["cases", "gedcomExport", "people", "qualityReport", "sources"],
    "API canary capabilities"
  );
  if (
    capabilities.people !== true
    || capabilities.sources !== false
    || capabilities.cases !== false
    || capabilities.qualityReport !== false
    || capabilities.gedcomExport !== false
  ) {
    throw new Error("The API canary token has capabilities beyond archive:read.");
  }
}

function validateRevokedResponse(response: Response, body: Record<string, unknown>): void {
  if (response.status !== 401) throw new Error("The revoked API canary did not receive HTTP 401.");
  validatePrivateApiHeaders(response.headers, false);
  requireExactKeys(body, ["code", "message", "requestId"], "revoked API canary response");
  if (
    body.code !== "invalid_token"
    || body.message !== "The bearer token is invalid, expired, or revoked."
    || !uuidPattern.test(stringValue(body.requestId))
  ) {
    throw new Error("The revoked API canary response contract is invalid.");
  }
  const challenge = response.headers.get("www-authenticate");
  if (challenge !== 'Bearer realm="Kin Resolve API", error="invalid_token"') {
    throw new Error("The revoked API canary authentication challenge is invalid.");
  }
}

function validatePrivateApiHeaders(headers: Headers, requireRateLimit: boolean): void {
  const mediaType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new Error("The API canary response is not JSON.");
  }
  const requestId = headers.get("x-request-id") ?? "";
  if (!uuidPattern.test(requestId)) throw new Error("The API canary request ID is invalid.");
  const cacheDirectives = new Map<string, string | null>();
  for (const rawDirective of (headers.get("cache-control") ?? "").split(",")) {
    const directive = rawDirective.trim();
    const match = /^([a-z][a-z0-9-]*)(?:=("[^"]*"|[^\s,;]+))?$/i.exec(directive);
    if (!match) throw new Error("The API canary cache policy is malformed.");
    const name = match[1]!.toLowerCase();
    if (cacheDirectives.has(name)) {
      throw new Error("The API canary cache policy contains duplicate directives.");
    }
    cacheDirectives.set(name, match[2] ?? null);
  }
  if (
    cacheDirectives.get("private") !== null
    || cacheDirectives.get("no-store") !== null
    || cacheDirectives.has("public")
    || cacheDirectives.has("s-maxage")
  ) {
    throw new Error("The API canary response is not private and non-cacheable.");
  }
  const maxAge = cacheDirectives.get("max-age");
  if (maxAge !== undefined && maxAge !== "0" && maxAge !== '"0"') {
    throw new Error("The API canary response has positive cache freshness.");
  }
  if (headers.get("x-content-type-options")?.toLowerCase() !== "nosniff") {
    throw new Error("The API canary content-type protection is missing.");
  }
  const vary = headers.get("vary")?.toLowerCase().split(",").map((value) => value.trim()) ?? [];
  if (!vary.includes("authorization")) throw new Error("The API canary Vary contract is invalid.");
  if (!requireRateLimit) return;
  const limit = headers.get("ratelimit-limit") ?? "";
  const remaining = headers.get("ratelimit-remaining") ?? "";
  const reset = headers.get("ratelimit-reset") ?? "";
  if (
    limit !== "60"
    || !/^(?:0|[1-9][0-9]{0,4})$/.test(remaining)
    || Number(remaining) >= 60
    || !/^[1-9][0-9]{0,4}$/.test(reset)
  ) {
    throw new Error("The API canary durable rate-limit headers are invalid.");
  }
}

function validateProbeEvidence(value: unknown, expectedBypass: boolean): void {
  const object = parseObject(value, "API canary probe evidence");
  requireExactKeys(object, [
    "archiveResourceIdIsOpaque", "deploymentProtectionBypassUsed", "exactSchema",
    "expectedProductVersion", "leastPrivilegeCapabilities", "passed", "privateNoStore",
    "rateLimitHeadersPresent", "requestIdPresent", "status"
  ], "API canary probe evidence");
  for (const key of [
    "archiveResourceIdIsOpaque", "exactSchema", "expectedProductVersion",
    "leastPrivilegeCapabilities", "passed", "privateNoStore", "rateLimitHeadersPresent",
    "requestIdPresent"
  ]) {
    if (object[key] !== true) throw new Error("The API canary probe evidence is incomplete.");
  }
  if (object.status !== 200 || object.deploymentProtectionBypassUsed !== expectedBypass) {
    throw new Error("The API canary probe phase is invalid.");
  }
}

function validateRevocationEvidence(value: unknown): void {
  const object = parseObject(value, "API canary revocation evidence");
  requireExactKeys(object, [
    "cleanupConfirmed", "immediateCanonical401", "invalidTokenContract",
    "requestIdPresent", "revoked"
  ], "API canary revocation evidence");
  for (const value of Object.values(object)) {
    if (typeof value !== "boolean") throw new Error("The API canary revocation evidence is invalid.");
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const maximumBytes = 65_536;
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maximumBytes) {
    await response.body?.cancel();
    throw new Error("The API canary response body exceeded its bound.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new Error("The API canary response body exceeded its bound.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    return parseObject(JSON.parse(value), label);
  } catch (error) {
    throw new Error(`${label} is invalid.`, { cause: error });
  }
}

function parseObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  requiredKeys: string[],
  label: string,
  allowedKeys: string[] = requiredKeys
): void {
  const keys = Object.keys(value).sort();
  const required = [...requiredKeys].sort();
  const allowed = new Set(allowedKeys);
  if (
    required.some((key) => !(key in value))
    || keys.some((key) => !allowed.has(key))
  ) {
    throw new Error(`${label} has an unexpected shape.`);
  }
}

function requiredDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bindingDigest(kind: "archive" | "archive-resource" | "owner", value: string): string {
  return createHash("sha256")
    .update(`kinresolve-production-api-canary-${kind}-v1\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function isSafeSecret(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{32,256}$/.test(value));
}
