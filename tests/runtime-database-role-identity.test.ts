import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/db", () => ({ query: mocks.query }));

import { runtimeDatabaseRoleIdentitySha256 } from "@/lib/runtime-database-role-attestation";
import { readRuntimeDatabaseRoleIdentitySha256 } from "@/lib/runtime-database-role-identity";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runtime database role identity", () => {
  it("hashes only the live connection's current role name", async () => {
    mocks.query.mockResolvedValue({ rows: [{ role_name: "krdemo_runtime" }] });

    await expect(readRuntimeDatabaseRoleIdentitySha256()).resolves.toBe(
      runtimeDatabaseRoleIdentitySha256("krdemo_runtime")
    );
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith(
      "SELECT current_user::text AS role_name",
      [],
      {}
    );
  });

  it("can bind the role proof to an explicit protected runtime credential", async () => {
    mocks.query.mockResolvedValue({ rows: [{ role_name: "krdemo_runtime" }] });
    const options = { databaseUrl: "postgresql://runtime:synthetic@db.example.test/postgres" };

    await readRuntimeDatabaseRoleIdentitySha256(options);

    expect(mocks.query).toHaveBeenCalledExactlyOnceWith(
      "SELECT current_user::text AS role_name",
      [],
      options
    );
  });

  it.each([
    { name: "missing", rows: [] },
    {
      name: "ambiguous",
      rows: [{ role_name: "krdemo_runtime" }, { role_name: "other_runtime" }]
    }
  ])("fails closed for a $name role result", async ({ rows }) => {
    mocks.query.mockResolvedValue({ rows });

    await expect(readRuntimeDatabaseRoleIdentitySha256()).rejects.toThrow(
      /role identity is unavailable/i
    );
  });

  it("rejects a malformed role name", async () => {
    mocks.query.mockResolvedValue({ rows: [{ role_name: "krdemo_runtime\n" }] });

    await expect(readRuntimeDatabaseRoleIdentitySha256()).rejects.toThrow(
      /runtime database role/i
    );
  });
});
