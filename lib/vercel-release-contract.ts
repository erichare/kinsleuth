type JsonObject = Record<string, unknown>;

export type DeploymentOwnershipExpectations = {
  expectedProjectId: string;
  expectedOrgId: string;
};

export type CandidateDeploymentExpectations = DeploymentOwnershipExpectations & {
  appBaseUrl: string;
  expectedGithubCommitSha: string;
  expectedGithubRunAttempt: string;
  expectedGithubRunId: string;
  expectedReleaseTag: string;
  expectedPackageVersion: string;
  previousDeploymentId: string;
};

export type HoldingDeploymentExpectations = DeploymentOwnershipExpectations & {
  appBaseUrl: string;
  canonicalLookupHostname: string;
  approvedHoldingDeploymentId: string;
};

export type PromotedDeploymentExpectations = DeploymentOwnershipExpectations & {
  appBaseUrl: string;
  canonicalLookupHostname: string;
  candidateDeploymentId: string;
};

export type ContainmentCanonicalExpectations = DeploymentOwnershipExpectations & {
  appBaseUrl: string;
  canonicalLookupHostname: string;
  approvedHoldingDeploymentId: string;
  expectedGithubCommitSha: string;
  expectedGithubRunAttempt: string;
  expectedGithubRunId: string;
};

export type ValidatedVercelDeployment = {
  id: string;
  url: string;
  status: "READY";
};

export type ValidatedContainmentCanonical = ValidatedVercelDeployment & {
  containmentRequired: boolean;
  state: "holding" | "source-release" | "other-release";
};

type NormalizedDeployment = ValidatedVercelDeployment & {
  aliases: readonly string[];
  metadata: JsonObject | null;
};

export const staticHoldingDeploymentMetadata = {
  releaseRole: "kinresolve-static-holding-v1",
  databaseAccess: "none",
  rollbackPolicy: "forward-only",
  packageVersion: "holding-v1"
} as const;

export function parseVercelDeploymentJson(contents: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error("The Vercel deployment response must be valid JSON.", { cause: error });
  }

  if (!isObject(parsed)) {
    throw new Error("The Vercel deployment response must contain a JSON object.");
  }
  return parsed;
}

export function validatePreviousDeployment(
  document: unknown,
  expectations: DeploymentOwnershipExpectations
): ValidatedVercelDeployment {
  return publicResult(normalizeReadyProductionDeployment(document, expectations));
}

export function validateHoldingDeployment(
  document: unknown,
  expectations: HoldingDeploymentExpectations
): ValidatedVercelDeployment {
  validateCanonicalLookupHostname(
    expectations.canonicalLookupHostname,
    expectations.appBaseUrl
  );
  const deployment = normalizeReadyProductionDeployment(document, expectations);
  const approvedId = validateDeploymentId(
    expectations.approvedHoldingDeploymentId,
    "The approved holding deployment ID"
  );
  if (deployment.id !== approvedId) {
    throw new Error("The canonical application must resolve to the approved holding deployment.");
  }
  if (!deployment.metadata) {
    throw new Error("The approved holding deployment metadata is missing.");
  }
  for (const [name, expectedValue] of Object.entries(staticHoldingDeploymentMetadata)) {
    requireExactMetadata(deployment.metadata, name, expectedValue, "holding");
  }
  return publicResult(deployment);
}

export function validateCandidateDeployment(
  document: unknown,
  expectations: CandidateDeploymentExpectations
): ValidatedVercelDeployment {
  const deployment = normalizeReadyProductionDeployment(document, expectations);
  const previousDeploymentId = validateDeploymentId(
    expectations.previousDeploymentId,
    "The previous Vercel deployment ID"
  );
  if (deployment.id === previousDeploymentId) {
    throw new Error("The candidate deployment must be different from the previous deployment.");
  }

  const canonicalHostname = validateCanonicalAppOrigin(expectations.appBaseUrl).hostname;
  if (deployment.aliases.includes(canonicalHostname)) {
    throw new Error("The candidate deployment must not own the canonical application alias before promotion.");
  }

  const metadata = deployment.metadata;
  if (!metadata) {
    throw new Error("The candidate deployment metadata is missing.");
  }
  validateGithubCommitSha(expectations.expectedGithubCommitSha);
  validateGithubRunId(expectations.expectedGithubRunId);
  validateGithubRunAttempt(expectations.expectedGithubRunAttempt);
  requireExactMetadata(metadata, "githubCommitSha", expectations.expectedGithubCommitSha);
  requireExactMetadata(metadata, "githubRunId", expectations.expectedGithubRunId);
  requireExactMetadata(metadata, "githubRunAttempt", expectations.expectedGithubRunAttempt);
  requireExactMetadata(metadata, "releaseTag", expectations.expectedReleaseTag);
  requireExactMetadata(metadata, "packageVersion", expectations.expectedPackageVersion);

  return publicResult(deployment);
}

export function validateContainmentCanonicalDeployment(
  document: unknown,
  expectations: ContainmentCanonicalExpectations
): ValidatedContainmentCanonical {
  validateCanonicalLookupHostname(
    expectations.canonicalLookupHostname,
    expectations.appBaseUrl
  );
  const deployment = normalizeReadyProductionDeployment(document, expectations);
  const approvedHoldingDeploymentId = validateDeploymentId(
    expectations.approvedHoldingDeploymentId,
    "The approved holding deployment ID"
  );
  if (deployment.id === approvedHoldingDeploymentId) {
    if (!deployment.metadata) {
      throw new Error("The approved holding deployment metadata is missing.");
    }
    for (const [name, expectedValue] of Object.entries(staticHoldingDeploymentMetadata)) {
      requireExactMetadata(deployment.metadata, name, expectedValue, "holding");
    }
    return {
      ...publicResult(deployment),
      containmentRequired: false,
      state: "holding"
    };
  }

  validateGithubCommitSha(expectations.expectedGithubCommitSha);
  validateGithubRunId(expectations.expectedGithubRunId);
  validateGithubRunAttempt(expectations.expectedGithubRunAttempt);
  if (!deployment.metadata) {
    throw new Error("The canonical release deployment metadata is missing.");
  }
  const actualCommit = validatedMetadataValue(
    deployment.metadata,
    "githubCommitSha",
    /^[a-f0-9]{40}$/
  );
  const actualRunId = validatedMetadataValue(
    deployment.metadata,
    "githubRunId",
    /^[1-9][0-9]{0,19}$/
  );
  const actualRunAttempt = validatedMetadataValue(
    deployment.metadata,
    "githubRunAttempt",
    /^[1-9][0-9]{0,9}$/
  );
  const sourceRelease = actualCommit === expectations.expectedGithubCommitSha
    && actualRunId === expectations.expectedGithubRunId
    && actualRunAttempt === expectations.expectedGithubRunAttempt;
  return {
    ...publicResult(deployment),
    containmentRequired: sourceRelease,
    state: sourceRelease ? "source-release" : "other-release"
  };
}

export function validatePromotedDeployment(
  document: unknown,
  expectations: PromotedDeploymentExpectations
): ValidatedVercelDeployment {
  validateCanonicalLookupHostname(
    expectations.canonicalLookupHostname,
    expectations.appBaseUrl
  );
  const deployment = normalizeReadyProductionDeployment(document, expectations);
  const candidateDeploymentId = validateDeploymentId(
    expectations.candidateDeploymentId,
    "The candidate Vercel deployment ID"
  );
  if (deployment.id !== candidateDeploymentId) {
    throw new Error("The promoted application alias must resolve to the exact candidate deployment.");
  }

  return publicResult(deployment);
}

function normalizeReadyProductionDeployment(
  document: unknown,
  expectations: DeploymentOwnershipExpectations
): NormalizedDeployment {
  if (!isObject(document)) {
    throw new Error("The Vercel deployment response must contain a JSON object.");
  }
  validateExpectedIdentifier(expectations.expectedProjectId, "Expected Vercel project ID");
  validateExpectedIdentifier(expectations.expectedOrgId, "Expected Vercel organization ID");

  const id = validateDeploymentId(
    readConsistentString(document, ["id", "uid"], "deployment ID"),
    "The Vercel deployment ID"
  );
  const url = validateGeneratedDeploymentOrigin(
    readConsistentString(document, ["url"], "deployment URL")
  ).origin;
  const status = readConsistentString(document, ["readyState", "state"], "deployment state");
  if (status !== "READY") {
    throw new Error("The Vercel deployment must be in the READY state.");
  }
  if (readConsistentString(document, ["target"], "deployment target") !== "production") {
    throw new Error("The Vercel deployment target must be production.");
  }

  const projectId = readConsistentString(document, ["projectId"], "project ID");
  if (projectId !== expectations.expectedProjectId) {
    throw new Error("The Vercel deployment must belong to the expected project.");
  }
  const ownerId = readConsistentString(document, ["ownerId", "teamId"], "organization ID");
  if (ownerId !== expectations.expectedOrgId) {
    throw new Error("The Vercel deployment must belong to the expected organization.");
  }

  const metadataValue = document.meta;
  if (metadataValue !== undefined && metadataValue !== null && !isObject(metadataValue)) {
    throw new Error("The Vercel deployment metadata must be a JSON object.");
  }

  return {
    id,
    url,
    status: "READY",
    aliases: readAliases(document),
    metadata: isObject(metadataValue) ? metadataValue : null
  };
}

function publicResult(deployment: NormalizedDeployment): ValidatedVercelDeployment {
  return { id: deployment.id, url: deployment.url, status: deployment.status };
}

function readConsistentString(document: JsonObject, keys: readonly string[], label: string): string {
  const values: string[] = [];
  for (const key of keys) {
    const value = document[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`The Vercel ${label} must be a nonempty string.`);
    }
    values.push(value);
  }

  if (values.length === 0) {
    throw new Error(`The Vercel ${label} is missing.`);
  }
  if (new Set(values).size !== 1) {
    throw new Error(`The Vercel response contains an ambiguous ${label}.`);
  }
  return values[0];
}

function validateDeploymentId(value: string, label: string): string {
  if (!/^dpl_[A-Za-z0-9]{8,96}$/.test(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function validateExpectedIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9_]{4,128}$/.test(value)) {
    throw new Error(`${label} is missing or malformed.`);
  }
}

function validateGeneratedDeploymentOrigin(value: string): URL {
  const url = parseOrigin(value, "The Vercel deployment URL");
  if (!url.hostname.endsWith(".vercel.app") || url.hostname === "vercel.app") {
    throw new Error("The Vercel deployment URL must be a generated Vercel origin.");
  }
  return url;
}

function validateCanonicalAppOrigin(value: string): URL {
  return parseOrigin(value, "APP_BASE_URL");
}

function validateCanonicalLookupHostname(value: string, appBaseUrl: string): void {
  const expectedHostname = validateCanonicalAppOrigin(appBaseUrl).hostname;
  if (typeof value !== "string" || value !== expectedHostname) {
    throw new Error(
      "The canonical lookup hostname must exactly match the APP_BASE_URL hostname."
    );
  }
}

function parseOrigin(value: string, label: string): URL {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be an HTTPS origin.`);
  }

  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch (error) {
    throw new Error(`${label} must be a valid HTTPS origin.`, { cause: error });
  }

  if (url.protocol !== "https:") {
    throw new Error(`${label} must be an HTTPS origin.`);
  }
  if (
    url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || (url.pathname !== "" && url.pathname !== "/")
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error(`${label} must be an origin without credentials, a port, a path, a query, or a fragment.`);
  }
  return url;
}

function readAliases(document: JsonObject): readonly string[] {
  const lists: string[][] = [];
  for (const key of ["aliases", "alias"] as const) {
    const value = document[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      throw new Error("The Vercel deployment aliases must be an array.");
    }
    const aliases = value.map((alias) => {
      if (typeof alias !== "string") {
        throw new Error("Every Vercel deployment alias must be a string origin.");
      }
      return parseOrigin(alias, "A Vercel deployment alias").hostname;
    });
    lists.push(aliases);
  }

  if (lists.length === 0) return [];
  const normalizedLists = lists.map((list) => [...new Set(list)].sort());
  if (
    normalizedLists.length > 1
    && JSON.stringify(normalizedLists[0]) !== JSON.stringify(normalizedLists[1])
  ) {
    throw new Error("The Vercel response contains ambiguous deployment aliases.");
  }
  return normalizedLists[0];
}

function requireExactMetadata(
  metadata: JsonObject,
  name: string,
  expectedValue: string,
  deploymentKind = "candidate"
): void {
  if (typeof expectedValue !== "string" || expectedValue.trim() === "") {
    throw new Error(`The expected ${name} metadata value is missing.`);
  }
  if (metadata[name] !== expectedValue) {
    throw new Error(`The ${deploymentKind} deployment ${name} metadata does not match the release.`);
  }
}

function validatedMetadataValue(metadata: JsonObject, name: string, pattern: RegExp): string {
  const value = metadata[name];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`The deployment ${name} metadata is missing or malformed.`);
  }
  return value;
}

function validateGithubCommitSha(value: string): void {
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new Error("The expected githubCommitSha metadata is malformed.");
  }
}

function validateGithubRunId(value: string): void {
  if (!/^[1-9][0-9]{0,19}$/.test(value)) {
    throw new Error("The expected githubRunId metadata is malformed.");
  }
}

function validateGithubRunAttempt(value: string): void {
  if (!/^[1-9][0-9]{0,9}$/.test(value)) {
    throw new Error("The expected githubRunAttempt metadata is malformed.");
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
