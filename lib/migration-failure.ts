// This module is executed directly by scripts/migrate.mjs and
// scripts/migrate-production.mjs under Node's type stripping, so it must only
// use erasable TypeScript syntax and must not import other project modules.

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

export function findConnectionFailureCode(error: unknown, depth = 0): string | undefined {
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

// Names the database target without echoing connection-string credentials.
function describeDatabaseTarget(databaseUrl: string | undefined, variableName: string): string {
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      const database = parsed.pathname.replace(/^\//, "");
      return `${parsed.hostname}:${parsed.port || "5432"}${database ? `/${database}` : ""}`;
    } catch {
      // Unparseable URLs fall through to the generic description.
    }
  }
  return `the database configured in ${variableName}`;
}

export function describeMigrationFailure(
  error: unknown,
  databaseUrl?: string,
  variableName = "DATABASE_URL"
): string {
  const target = describeDatabaseTarget(databaseUrl, variableName);
  const connectionCode = findConnectionFailureCode(error);
  const connectionTimedOut =
    error instanceof Error && error.message.includes("timeout exceeded when trying to connect");
  if (connectionCode || connectionTimedOut) {
    return (
      `Cannot reach ${variableName} at ${target} (${connectionCode ?? "connection timeout"}). ` +
      `Start Postgres (docker compose up -d postgres) or fix ${variableName}.`
    );
  }

  const sqlState = readErrorCode(error);
  if (sqlState === "3D000") {
    return `Database missing at ${target} — create it (or fix ${variableName}), then rerun npm run db:migrate.`;
  }
  if (sqlState === "28P01" || sqlState === "28000") {
    return `Database authentication failed for ${target} — check the ${variableName} credentials.`;
  }

  const message = error instanceof Error ? error.message.trim() : String(error).trim();
  if (message) {
    return message;
  }
  const name = error instanceof Error ? error.constructor.name : typeof error;
  return `Migration failed without an error message (${name}${sqlState ? ` ${sqlState}` : ""}).`;
}
