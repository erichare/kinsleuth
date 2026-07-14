import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

const requiredProductionSettings = [
  "APP_BASE_URL",
  "AUTH_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "CRON_SECRET",
  "DATABASE_AUTO_MIGRATE",
  "DATABASE_POOL_MAX",
  "DATABASE_URL"
] as const;

export type ReleaseContractInput = {
  releaseTag: string;
  packageVersion: string;
  releaseCommit: string;
  checkedOutCommit: string;
  releaseIsOnMain: boolean;
  project: {
    projectId?: unknown;
    orgId?: unknown;
    settings?: {
      framework?: unknown;
    };
  };
  expectedProjectId: string;
  expectedOrgId: string;
  productionEnvironment: Record<string, string | undefined>;
};

type ReleaseContractResult = {
  version: string;
  appOrigin: string;
};

type LoadReleaseContractOptions = {
  repositoryRoot: string;
};

type LoginRedirectInput = {
  deploymentUrl: string;
  appBaseUrl: string;
  location: string;
};

function parseUrl(value: string, variableName: string): URL {
  try {
    return new URL(value);
  } catch (error) {
    throw new Error(`${variableName} must be a valid URL.`, { cause: error });
  }
}

function validateHttpsOrigin(value: string, variableName: string): URL {
  const url = parseUrl(value, variableName);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${variableName} must be an HTTPS origin without credentials, a path, a query, or a fragment.`);
  }
  return url;
}

function validateSecret(name: string, value: string, minimumLength: number): void {
  const normalized = value.trim();
  if (/^(change|replace|placeholder|example|todo|xxx|your[-_])/i.test(normalized)) {
    throw new Error(`${name} must not use a placeholder value.`);
  }
  if (normalized.length < minimumLength) {
    throw new Error(`${name} must be at least ${minimumLength} characters.`);
  }
}

export function validateReleaseContract(input: ReleaseContractInput): ReleaseContractResult {
  const expectedTag = `v${input.packageVersion}`;
  if (input.releaseTag !== expectedTag) {
    throw new Error(`Release tag must match package version ${input.packageVersion}.`);
  }
  if (input.releaseCommit !== input.checkedOutCommit) {
    throw new Error("The release tag commit must equal the checked-out revision.");
  }
  if (!input.releaseIsOnMain) {
    throw new Error("The released revision must be an ancestor of origin/main.");
  }
  if (!input.expectedProjectId || input.project.projectId !== input.expectedProjectId) {
    throw new Error("The linked project ID must match the expected Vercel project.");
  }
  if (!input.expectedOrgId || input.project.orgId !== input.expectedOrgId) {
    throw new Error("The linked organization ID must match the expected Vercel organization.");
  }
  if (input.project.settings?.framework !== "nextjs") {
    throw new Error("The linked Vercel project framework must be nextjs.");
  }

  const missing = requiredProductionSettings.filter((name) => !input.productionEnvironment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required production settings: ${missing.join(", ")}.`);
  }

  const environment = Object.fromEntries(
    requiredProductionSettings.map((name) => [name, input.productionEnvironment[name]!])
  ) as Record<(typeof requiredProductionSettings)[number], string>;
  const databaseUrl = parseUrl(environment.DATABASE_URL, "DATABASE_URL");
  if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  }
  if (!databaseUrl.hostname) {
    throw new Error("DATABASE_URL must include a database host.");
  }
  if (databaseUrl.pathname === "" || databaseUrl.pathname === "/") {
    throw new Error("DATABASE_URL must include a database name.");
  }
  if (!/^[1-9]\d*$/.test(environment.DATABASE_POOL_MAX) || Number(environment.DATABASE_POOL_MAX) > 100) {
    throw new Error("DATABASE_POOL_MAX must be a positive integer no greater than 100.");
  }
  if (environment.DATABASE_AUTO_MIGRATE !== "false") {
    throw new Error("DATABASE_AUTO_MIGRATE must be exactly false for production releases.");
  }

  const appUrl = validateHttpsOrigin(environment.APP_BASE_URL, "APP_BASE_URL");
  validateSecret("AUTH_SECRET", environment.AUTH_SECRET, 32);
  validateSecret("BLOB_READ_WRITE_TOKEN", environment.BLOB_READ_WRITE_TOKEN, 16);
  validateSecret("CRON_SECRET", environment.CRON_SECRET, 32);

  return { version: input.packageVersion, appOrigin: appUrl.origin };
}

async function readRequiredFile(filePath: string, missingMessage: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(missingMessage, { cause: error });
    }
    throw error;
  }
}

function parseJsonObject(contents: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function findClosingQuote(value: string, quote: "'" | '"', start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] !== quote) continue;
    let backslashes = 0;
    for (let previous = index - 1; previous >= 0 && value[previous] === "\\"; previous -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

function validateEnvironmentFileShape(contents: string): void {
  const names = new Set<string>();
  let activeQuote: "'" | '"' | undefined;

  for (const line of contents.split(/\r?\n/)) {
    if (activeQuote) {
      const closing = findClosingQuote(line, activeQuote, 0);
      if (closing === -1) continue;
      if (!/^\s*(?:#.*)?$/.test(line.slice(closing + 1))) {
        throw new Error("The pulled Vercel production environment file could not be parsed.");
      }
      activeQuote = undefined;
      continue;
    }

    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!assignment) {
      throw new Error("The pulled Vercel production environment file could not be parsed.");
    }
    const [, name, rawValue] = assignment;
    if (names.has(name)) {
      throw new Error(`The pulled Vercel production environment file contains duplicate ${name} assignments.`);
    }
    names.add(name);

    const value = rawValue.trimStart();
    const quote = value[0];
    if (quote !== "'" && quote !== '"') continue;
    const closing = findClosingQuote(value, quote, 1);
    if (closing === -1) {
      activeQuote = quote;
    } else if (!/^\s*(?:#.*)?$/.test(value.slice(closing + 1))) {
      throw new Error("The pulled Vercel production environment file could not be parsed.");
    }
  }

  if (activeQuote) {
    throw new Error("The pulled Vercel production environment file could not be parsed.");
  }
}

export async function loadReleaseContractFiles(options: LoadReleaseContractOptions): Promise<
  Pick<ReleaseContractInput, "packageVersion" | "project" | "productionEnvironment">
> {
  const environmentPath = path.join(options.repositoryRoot, ".vercel", ".env.production.local");
  const projectPath = path.join(options.repositoryRoot, ".vercel", "project.json");
  const packagePath = path.join(options.repositoryRoot, "package.json");

  const environmentContents = await readRequiredFile(
    environmentPath,
    "The pulled Vercel production environment file is missing. Run `vercel pull --environment=production` first."
  );
  let productionEnvironment: Record<string, string | undefined>;
  validateEnvironmentFileShape(environmentContents);
  try {
    productionEnvironment = parseEnv(environmentContents);
  } catch (error) {
    throw new Error("The pulled Vercel production environment file could not be parsed.", { cause: error });
  }

  const project = parseJsonObject(
    await readRequiredFile(projectPath, "The linked Vercel project file is missing."),
    "The linked Vercel project file"
  ) as ReleaseContractInput["project"];
  const packageFile = parseJsonObject(
    await readRequiredFile(packagePath, "package.json is missing."),
    "package.json"
  );
  if (typeof packageFile.version !== "string" || packageFile.version.trim() === "") {
    throw new Error("package.json must contain a nonempty version string.");
  }

  return { packageVersion: packageFile.version, project, productionEnvironment };
}

export function validateLoginRedirect(input: LoginRedirectInput): void {
  const deploymentOrigin = validateHttpsOrigin(input.deploymentUrl, "Deployment URL").origin;
  const appOrigin = validateHttpsOrigin(input.appBaseUrl, "APP_BASE_URL").origin;
  const location = parseUrl(new URL(input.location, deploymentOrigin).toString(), "Login redirect");
  if (location.origin !== appOrigin) {
    throw new Error("The login redirect must use the configured APP_BASE_URL origin.");
  }
  if (
    location.username !== "" ||
    location.password !== "" ||
    location.pathname !== "/login" ||
    location.hash !== "" ||
    location.searchParams.size !== 1 ||
    location.searchParams.get("next") !== "/app"
  ) {
    throw new Error("The deployed /app route must redirect exactly /login?next=/app.");
  }
}
