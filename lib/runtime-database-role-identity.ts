import { query, type DatabaseOptions } from "./db";
import { runtimeDatabaseRoleIdentitySha256 } from "./runtime-database-role-attestation";

export async function readRuntimeDatabaseRoleIdentitySha256(
  options: DatabaseOptions = {}
): Promise<string> {
  const result = await query<{ role_name: string }>(
    "SELECT current_user::text AS role_name",
    [],
    options
  );
  if (result.rows.length !== 1) {
    throw new Error("The runtime database role identity is unavailable.");
  }
  return runtimeDatabaseRoleIdentitySha256(result.rows[0]?.role_name);
}
