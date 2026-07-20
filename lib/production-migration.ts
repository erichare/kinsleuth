import { createHash } from "node:crypto";

import { getDatabaseConnectionString } from "./connection-string.ts";
import {
  databaseIdentityPattern,
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "./database-attestation.ts";
import { findConnectionFailureCode } from "./migration-failure.ts";

export type ProductionMigrationEnvironment = {
  MIGRATION_DATABASE_URL?: string;
  EXPECTED_ARCHIVE_ID?: string;
  KINRESOLVE_DATABASE_IDENTITY?: string;
  EXPECTED_MIGRATION_PREFIX_COUNT?: string;
  EXPECTED_MIGRATION_PREFIX_LEDGER_SHA256?: string;
};

export type ProductionMigrationTarget = {
  connectionString: string;
  hostname: string;
  databaseName: string;
};

export type ProductionMigrationResult = {
  applied: string[];
  alreadyApplied: string[];
};

export type ProductionMigrationPool = {
  end(): Promise<unknown>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type ProductionMigrationLedgerPool = ProductionMigrationPool;

export type ProductionMigrationPoolOptions = {
  connectionString: string;
  max: 2;
};

export type RunProductionMigrationsOptions<TPool extends ProductionMigrationPool> = {
  environment: ProductionMigrationEnvironment;
  expectedVersions: readonly string[];
  createPool: (options: ProductionMigrationPoolOptions) => TPool;
  migrate: (pool: TPool) => Promise<ProductionMigrationResult>;
  log: (message: string) => void;
};

export type ProductionMigrationLedgerResult = {
  migrationCount: number;
};

export type RunProductionMigrationLedgerVerificationOptions<
  TPool extends ProductionMigrationLedgerPool
> = {
  environment: ProductionMigrationEnvironment;
  expectedVersions: readonly string[];
  createPool: (options: ProductionMigrationPoolOptions) => TPool;
  log: (message: string) => void;
};

type ParsedDatabaseTarget = ProductionMigrationTarget & {
  identity: string;
  port: string;
};

type EvidencedMigrationPrefix = {
  migrationCount: number;
  ledgerSha256: string;
};

const postgresProtocols = new Set(["postgres:", "postgresql:"]);
const routingQueryParameters = new Set([
  "host",
  "hostaddr",
  "port",
  "database",
  "dbname",
  "user",
  "password",
  "service"
]);
const migrationVersionPattern = /^\d{3}_[a-z0-9][a-z0-9_-]*$/;
const archiveIdPattern = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function validateProductionMigrationEnvironment(
  environment: ProductionMigrationEnvironment
): ProductionMigrationTarget {
  const connectionString = environment.MIGRATION_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("MIGRATION_DATABASE_URL is required for production migrations.");
  }

  const migrationTarget = parseDatabaseTarget(connectionString, "MIGRATION_DATABASE_URL");
  if (migrationTarget.port === "6543") {
    throw new Error(
      "MIGRATION_DATABASE_URL must use a direct or session connection; transaction pooler port 6543 is refused."
    );
  }
  if (!archiveIdPattern.test(environment.EXPECTED_ARCHIVE_ID ?? "")) {
    throw new Error("EXPECTED_ARCHIVE_ID is required and must be a safe lowercase archive identifier.");
  }
  if (!databaseIdentityPattern.test(environment.KINRESOLVE_DATABASE_IDENTITY ?? "")) {
    throw new Error("KINRESOLVE_DATABASE_IDENTITY must be a lowercase SHA-256 database fingerprint.");
  }

  const secureConnectionString = secureProductionConnectionString(migrationTarget);

  return {
    connectionString: secureConnectionString,
    hostname: migrationTarget.hostname,
    databaseName: migrationTarget.databaseName
  };
}

export async function runProductionMigrations<TPool extends ProductionMigrationPool>(
  options: RunProductionMigrationsOptions<TPool>
): Promise<ProductionMigrationResult> {
  const target = validateProductionMigrationEnvironment(options.environment);
  let pool: TPool;

  try {
    pool = options.createPool({ connectionString: target.connectionString, max: 2 });
  } catch (error) {
    throw wrapProductionMigrationFailure(error, "Production migration failed");
  }

  try {
    await verifyProductionMigrationPreflight(
      pool,
      options.expectedVersions,
      options.environment.EXPECTED_ARCHIVE_ID!,
      options.environment.KINRESOLVE_DATABASE_IDENTITY!,
      parseEvidencedMigrationPrefix(options.environment)
    );
  } catch (error) {
    try {
      await pool.end();
    } catch {
      // Preserve the fixed, secret-free preflight failure below.
    }
    throw wrapProductionMigrationFailure(error, "Production migration preflight failed");
  }
  options.log(
    `Verified production migration preflight: approved ledger prefix and expected archive identity.`
  );

  let result: ProductionMigrationResult;
  try {
    result = await options.migrate(pool);
  } catch (error) {
    try {
      await pool.end();
    } catch {
      // Preserve the fixed, secret-free migration failure below.
    }
    throw wrapProductionMigrationFailure(error, "Production migration failed");
  }

  try {
    await pool.end();
  } catch (error) {
    throw wrapProductionMigrationFailure(error, "Production migration failed");
  }

  for (const version of result.applied) {
    options.log(`applied ${version}`);
  }
  options.log(
    `Applied ${result.applied.length} migration(s); ${result.alreadyApplied.length} already recorded.`
  );

  return result;
}

export function validateProductionMigrationLedger(
  expectedVersions: readonly string[],
  appliedVersions: readonly string[]
): ProductionMigrationLedgerResult {
  validateMigrationVersionLists(expectedVersions, appliedVersions);
  if (
    appliedVersions.length !== expectedVersions.length
    || appliedVersions.some((version, index) => version !== expectedVersions[index])
  ) {
    throw new Error("The production migration ledger does not exactly match the release policy.");
  }

  return {
    migrationCount: expectedVersions.length
  };
}

export function validateProductionMigrationLedgerPrefix(
  expectedVersions: readonly string[],
  appliedVersions: readonly string[]
): { migrationCount: number } {
  validateMigrationVersionLists(expectedVersions, appliedVersions);
  if (appliedVersions.length > expectedVersions.length) {
    throw new Error("The production migration ledger is not an approved release-policy prefix.");
  }
  for (let index = 0; index < appliedVersions.length; index += 1) {
    if (appliedVersions[index] !== expectedVersions[index]) {
      throw new Error("The production migration ledger is not an approved release-policy prefix.");
    }
  }
  return { migrationCount: appliedVersions.length };
}

export async function runProductionMigrationLedgerVerification<
  TPool extends ProductionMigrationLedgerPool
>(
  options: RunProductionMigrationLedgerVerificationOptions<TPool>
): Promise<ProductionMigrationLedgerResult> {
  const target = validateProductionMigrationEnvironment(options.environment);
  let pool: TPool;
  try {
    pool = options.createPool({ connectionString: target.connectionString, max: 2 });
  } catch (error) {
    throw wrapProductionMigrationFailure(error, "Production migration ledger verification failed");
  }

  let rows: Array<{ version?: unknown }>;
  try {
    validateConfiguredDatabaseIdentity(
      options.environment.KINRESOLVE_DATABASE_IDENTITY,
      await readDatabaseIdentity(pool)
    );
    await verifyExpectedArchive(pool, options.environment.EXPECTED_ARCHIVE_ID!);
    const result = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version COLLATE "C" ASC'
    );
    if (!Array.isArray(result.rows)) {
      throw new Error("Invalid production migration ledger query result.");
    }
    rows = result.rows;
  } catch (error) {
    try {
      await pool.end();
    } catch {
      // Preserve the fixed, secret-free query failure below.
    }
    throw wrapProductionMigrationFailure(error, "Production migration ledger verification failed");
  }

  let result: ProductionMigrationLedgerResult;
  try {
    const versions = rows.map((row) => {
      if (typeof row.version !== "string") {
        throw new Error("The production migration ledger contains a malformed version.");
      }
      return row.version;
    });
    result = validateProductionMigrationLedger(options.expectedVersions, versions);
  } finally {
    try {
      await pool.end();
    } catch (error) {
      throw wrapProductionMigrationFailure(error, "Production migration ledger verification failed");
    }
  }

  options.log(
    `Verified production migration ledger: ${result.migrationCount} expected migration(s) applied.`
  );
  return result;
}

// Replaces caught errors with fixed, secret-free messages. Connection-level
// failures additionally name the syscall code — allowlisted by
// findConnectionFailureCode, never upstream message text or the URL — and
// carry it as `code` so describeMigrationFailure can render the redacted
// cannot-reach line instead of an indistinguishable preflight failure.
function wrapProductionMigrationFailure(error: unknown, failureSummary: string): Error {
  const connectionCode = findConnectionFailureCode(error);
  if (!connectionCode) {
    return new Error(`${failureSummary}.`);
  }
  return Object.assign(
    new Error(`${failureSummary}: cannot reach the configured database (${connectionCode}).`),
    { code: connectionCode }
  );
}

async function verifyProductionMigrationPreflight(
  pool: ProductionMigrationPool,
  expectedVersions: readonly string[],
  expectedArchiveId: string,
  configuredDatabaseIdentity: string,
  evidencedPrefix: EvidencedMigrationPrefix | undefined
): Promise<void> {
  validateProductionMigrationLedgerPrefix(expectedVersions, []);
  validateConfiguredDatabaseIdentity(configuredDatabaseIdentity, await readDatabaseIdentity(pool));
  const catalog = await pool.query(
    "SELECT to_regclass('public.archives') IS NOT NULL AS archives_exists, "
      + "to_regclass('public.schema_migrations') IS NOT NULL AS ledger_exists"
  );
  const row = catalog.rows[0];
  if (!row || row.archives_exists !== true) {
    throw new Error("The production migration target is not a provisioned Kin Resolve database.");
  }
  await verifyExpectedArchive(pool, expectedArchiveId);

  let versions: string[] = [];
  if (row.ledger_exists === true) {
    const ledger = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version COLLATE "C" ASC'
    );
    versions = ledger.rows.map((entry) => {
      if (typeof entry.version !== "string") {
        throw new Error("The production migration ledger contains a malformed version.");
      }
      return entry.version;
    });
  }
  validateProductionMigrationLedgerPrefix(expectedVersions, versions);
  if (
    evidencedPrefix
    && (
      versions.length !== evidencedPrefix.migrationCount
      || migrationLedgerSha256(versions) !== evidencedPrefix.ledgerSha256
    )
  ) {
    throw new Error("The production migration ledger does not match the exact evidenced recovery prefix.");
  }
}

function parseEvidencedMigrationPrefix(
  environment: ProductionMigrationEnvironment
): EvidencedMigrationPrefix | undefined {
  const countValue = environment.EXPECTED_MIGRATION_PREFIX_COUNT?.trim();
  const digestValue = environment.EXPECTED_MIGRATION_PREFIX_LEDGER_SHA256?.trim();
  if (!countValue && !digestValue) return undefined;
  if (!/^\d+$/.test(countValue ?? "") || !/^[a-f0-9]{64}$/.test(digestValue ?? "")) {
    throw new Error("The evidenced production migration prefix configuration is invalid.");
  }
  const migrationCount = Number(countValue);
  if (!Number.isSafeInteger(migrationCount) || migrationCount < 1) {
    throw new Error("The evidenced production migration prefix configuration is invalid.");
  }
  return { migrationCount, ledgerSha256: digestValue! };
}

function migrationLedgerSha256(versions: readonly string[]): string {
  return createHash("sha256").update(`${versions.join("\n")}\n`, "utf8").digest("hex");
}

async function verifyExpectedArchive(
  pool: ProductionMigrationPool,
  expectedArchiveId: string
): Promise<void> {
  if (!archiveIdPattern.test(expectedArchiveId)) {
    throw new Error("The expected production archive identity is invalid.");
  }
  const archive = await pool.query(
    "SELECT id FROM public.archives WHERE id = $1",
    [expectedArchiveId]
  );
  if (
    archive.rows.length !== 1
    || archive.rows[0]?.id !== expectedArchiveId
  ) {
    throw new Error("The production migration target does not contain the expected release-cell archive.");
  }
}

function validateMigrationVersionLists(
  expectedVersions: readonly string[],
  appliedVersions: readonly string[]
): void {
  if (expectedVersions.length === 0 || expectedVersions.some((version) => !migrationVersionPattern.test(version))) {
    throw new Error("The expected production migration ledger is invalid.");
  }
  if (appliedVersions.some((version) => !migrationVersionPattern.test(version))) {
    throw new Error("The production migration ledger contains a malformed version.");
  }
  if (findDuplicate(expectedVersions)) {
    throw new Error("The expected production migration ledger contains a duplicate version.");
  }
  if (findDuplicate(appliedVersions)) {
    throw new Error("The production migration ledger contains a duplicate version.");
  }
}

function secureProductionConnectionString(target: ParsedDatabaseTarget): string {
  const normalized = getDatabaseConnectionString(target.connectionString);
  const url = new URL(normalized);
  if (isLocalMigrationHost(target.hostname)) return normalized;

  if (url.searchParams.get("sslmode") !== "verify-full" || !url.searchParams.get("sslrootcert")) {
    throw new Error(
      "MIGRATION_DATABASE_URL must verify the remote database certificate with sslmode=verify-full and sslrootcert."
    );
  }
  return normalized;
}

function isLocalMigrationHost(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "postgres";
}

function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function parseDatabaseTarget(connectionString: string, variableName: string): ParsedDatabaseTarget {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (!postgresProtocols.has(url.protocol)) {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  if (!url.hostname) {
    throw new Error(`${variableName} must include a database host.`);
  }
  if (url.pathname === "" || url.pathname === "/") {
    throw new Error(`${variableName} must include a database name.`);
  }
  if ([...url.searchParams.keys()].some((parameter) => routingQueryParameters.has(parameter.toLowerCase()))) {
    throw new Error(`${variableName} connection query parameters must not override URL routing.`);
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(`${variableName} must include a valid encoded database name.`);
  }
  if (!databaseName) {
    throw new Error(`${variableName} must include a database name.`);
  }

  const hostname = normalizeHostname(url.hostname);
  const port = url.port || "5432";
  return {
    connectionString,
    hostname,
    databaseName,
    port,
    identity: `${hostname}:${port}/${databaseName}`
  };
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}
