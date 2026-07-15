import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { getDatabaseConnectionString } from "./connection-string";
import { runPendingMigrations } from "./migrations";
import { captureOperationalError } from "./observability";

export { getDatabaseConnectionString, isDatabaseTransportVerified } from "./connection-string";

export type DatabaseOptions = {
  databaseUrl?: string;
};

const pools = new Map<string, Pool>();
const schemaPromises = new Map<string, Promise<void>>();

export function getDatabasePoolMax(): number {
  const configured = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  if (Number.isSafeInteger(configured) && configured > 0) {
    return configured;
  }

  return process.env.NODE_ENV === "development" ? 10 : 2;
}

export function isDatabaseAutoMigrateEnabled(): boolean {
  const configured = process.env.DATABASE_AUTO_MIGRATE?.trim().toLowerCase();
  return !configured || !["0", "false", "no", "off"].includes(configured);
}

export function getDatabaseUrl(options: DatabaseOptions = {}): string {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Start Postgres or set DATABASE_URL before running Kin Resolve.");
  }

  return databaseUrl;
}

export function getPool(options: DatabaseOptions = {}): Pool {
  const databaseUrl = getDatabaseUrl(options);
  const connectionString = getDatabaseConnectionString(databaseUrl);
  const existing = pools.get(connectionString);
  if (existing) {
    return existing;
  }

  const pool = new Pool({
    connectionString,
    max: getDatabasePoolMax(),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000
  });
  // Without a listener, an idle client's backend error is an unhandled 'error'
  // event that crashes the process; the pool already discards the broken client.
  pool.on("error", (error) => {
    void captureOperationalError({
      event: "api_error",
      route: "/internal/database-pool"
    }, error);
  });
  pools.set(connectionString, pool);
  return pool;
}

export async function ensureDatabaseSchema(options: DatabaseOptions = {}): Promise<void> {
  if (!isDatabaseAutoMigrateEnabled()) {
    return;
  }

  const databaseUrl = getDatabaseUrl(options);
  const existing = schemaPromises.get(databaseUrl);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    await runPendingMigrations(getPool(options));
  })();

  // Drop a failed migration from the cache so a transient outage does not
  // permanently reject every later query until the process restarts.
  promise.catch(() => {
    if (schemaPromises.get(databaseUrl) === promise) {
      schemaPromises.delete(databaseUrl);
    }
  });

  schemaPromises.set(databaseUrl, promise);
  return promise;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
  options: DatabaseOptions = {}
): Promise<QueryResult<T>> {
  await ensureDatabaseSchema(options);
  return getPool(options).query<T>(text, values);
}

export async function withClient<T>(options: DatabaseOptions, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureDatabaseSchema(options);
  const client = await getPool(options).connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(options: DatabaseOptions, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(options, async (client) => {
    await client.query("BEGIN");
    try {
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function closeDatabasePools(): Promise<void> {
  const openPools = [...pools.values()];
  pools.clear();
  schemaPromises.clear();
  await Promise.all(openPools.map((pool) => pool.end()));
}
