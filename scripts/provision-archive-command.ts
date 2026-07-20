import { pathToFileURL } from "node:url";

import { provisionArchive } from "../lib/archive-provisioning";
import {
  archiveIdEnvironmentAlias,
  describeEnvironmentAliasPair,
  readArchiveIdSetting
} from "../lib/environment-aliases";
import { datasetModes, resolveDatasetConfiguration, type DatasetMode } from "../lib/hosted-config";

type Environment = Record<string, string | undefined>;

export function resolveProvisioningMode(argv: string[], environment: Environment): DatasetMode {
  const configuredMode = environment.KINRESOLVE_DATASET_MODE?.trim().toLowerCase();

  if (argv.length === 0) {
    if (!configuredMode) {
      throw new Error("Archive provisioning requires an explicit --mode or KINRESOLVE_DATASET_MODE setting.");
    }
    return resolveDatasetConfiguration(environment).datasetMode;
  }

  if (argv[0] !== "--mode") {
    throw new Error("Archive provisioning accepts only --mode <empty|demo|pilot>.");
  }
  if (argv.length === 1) {
    throw new Error("--mode requires a value.");
  }
  if (argv.length !== 2) {
    throw new Error("Archive provisioning accepts only one --mode argument.");
  }

  const requestedMode = argv[1]?.trim().toLowerCase() ?? "";
  if (!isDatasetMode(requestedMode)) {
    throw new Error("Archive provisioning mode must be empty, demo, or pilot.");
  }
  if (configuredMode) {
    const configuration = resolveDatasetConfiguration(environment);
    if (configuration.datasetMode !== requestedMode) {
      throw new Error(
        `The deployment is configured as ${configuration.datasetMode}, but provisioning requested ${requestedMode}.`
      );
    }
  }
  return requestedMode;
}

export async function runProvisioningCommand(
  argv: string[] = process.argv.slice(2),
  environment: Environment = process.env
): Promise<void> {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for archive provisioning.");
  }
  const archiveId = readArchiveIdSetting(environment)?.trim();
  if (!archiveId) {
    throw new Error(
      `${describeEnvironmentAliasPair(archiveIdEnvironmentAlias)} is required for archive provisioning.`
    );
  }

  const datasetMode = resolveProvisioningMode(argv, environment);
  const result = await provisionArchive(datasetMode, { databaseUrl, archiveId, datasetMode });
  const action = result.created ? "Provisioned" : "Verified";
  console.log(
    `${action} ${result.datasetMode} archive ${result.archiveId}` +
      (result.demoFixtureVersion === null ? "." : ` with demo fixture version ${result.demoFixtureVersion}.`)
  );
}

function isDatasetMode(value: string): value is DatasetMode {
  return datasetModes.some((mode) => mode === value);
}

// Node's dual-stack connect failure is an AggregateError whose own message is
// the empty string and whose cause codes sit in the nested errors array, so a
// plain `console.error(error.message)` prints a blank line.
const connectionFailureCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EPIPE"
]);

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function findConnectionFailureCode(error: unknown, depth = 0): string | undefined {
  if (depth > 2 || typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = readErrorCode(error);
  if (code && connectionFailureCodes.has(code)) {
    return code;
  }
  const nested = (error as { errors?: unknown }).errors;
  if (Array.isArray(nested)) {
    for (const candidate of nested) {
      const nestedCode = findConnectionFailureCode(candidate, depth + 1);
      if (nestedCode) {
        return nestedCode;
      }
    }
  }
  return undefined;
}

// Names the database target without echoing DATABASE_URL credentials.
function describeDatabaseTarget(databaseUrl: string | undefined): string {
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      const database = parsed.pathname.replace(/^\//, "");
      return `${parsed.hostname}:${parsed.port || "5432"}${database ? `/${database}` : ""}`;
    } catch {
      // Unparseable URLs fall through to the generic description.
    }
  }
  return "the database configured in DATABASE_URL";
}

export function describeProvisioningFailure(error: unknown, databaseUrl?: string): string {
  const target = describeDatabaseTarget(databaseUrl);
  const connectionCode = findConnectionFailureCode(error);
  const connectionTimedOut =
    error instanceof Error && error.message.includes("timeout exceeded when trying to connect");
  if (connectionCode || connectionTimedOut) {
    return (
      `Cannot reach DATABASE_URL at ${target} (${connectionCode ?? "connection timeout"}). ` +
      "Start Postgres (docker compose up -d postgres) or fix DATABASE_URL."
    );
  }

  const sqlState = readErrorCode(error);
  if (sqlState === "42P01") {
    return `Schema missing at ${target} — run npm run db:migrate first.`;
  }
  if (sqlState === "3D000") {
    return `Database missing at ${target} — create it (or fix DATABASE_URL), then run npm run db:migrate.`;
  }
  if (sqlState === "28P01" || sqlState === "28000") {
    return `Database authentication failed for ${target} — check the DATABASE_URL credentials.`;
  }

  const message = error instanceof Error ? error.message.trim() : String(error).trim();
  if (message) {
    return message;
  }
  const name = error instanceof Error ? error.constructor.name : typeof error;
  return `Archive provisioning failed without an error message (${name}${sqlState ? ` ${sqlState}` : ""}).`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProvisioningCommand().catch((error) => {
    console.error(describeProvisioningFailure(error, process.env.DATABASE_URL));
    process.exitCode = 1;
  });
}
