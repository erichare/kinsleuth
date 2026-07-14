const allowedReleaseDatabaseHosts = new Set(["loopback", "postgres", "release-postgres"]);

type ReleaseUpgradeDatabaseOptions = {
  releaseDatabaseUrl?: string;
  testDatabaseUrl?: string;
  databaseUrl?: string;
};

function canonicalHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" ? "loopback" : normalized;
}

function parsePostgresUrl(value: string, variableName: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`, { cause: error });
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.pathname === "" || url.pathname === "/") {
    throw new Error(`${variableName} must be a valid PostgreSQL URL with an explicit database name.`);
  }
  return url;
}

function databaseIdentity(value: string, variableName: string): string {
  const url = parsePostgresUrl(value, variableName);
  const hostname = canonicalHostname(url.hostname);
  return `${hostname}:${url.port || "5432"}${url.pathname}`;
}

export function validateReleaseUpgradeDatabase(options: ReleaseUpgradeDatabaseOptions): void {
  if (!options.releaseDatabaseUrl) {
    throw new Error("TEST_RELEASE_UPGRADE_DATABASE_URL is required for the dedicated release-upgrade command.");
  }

  const releaseUrl = parsePostgresUrl(options.releaseDatabaseUrl, "TEST_RELEASE_UPGRADE_DATABASE_URL");
  if (!allowedReleaseDatabaseHosts.has(canonicalHostname(releaseUrl.hostname))) {
    throw new Error(
      "TEST_RELEASE_UPGRADE_DATABASE_URL must use localhost or the dedicated CI PostgreSQL service; remote databases are refused."
    );
  }

  const releaseIdentity = databaseIdentity(options.releaseDatabaseUrl, "TEST_RELEASE_UPGRADE_DATABASE_URL");
  for (const [name, value] of [
    ["TEST_DATABASE_URL", options.testDatabaseUrl],
    ["DATABASE_URL", options.databaseUrl]
  ] as const) {
    if (value && databaseIdentity(value, name) === releaseIdentity) {
      throw new Error(`TEST_RELEASE_UPGRADE_DATABASE_URL must not identify the same database as ${name}.`);
    }
  }
}
