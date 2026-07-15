import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

// getAuth() and the sign-up gate read env at call time; the better-auth pool
// must point at the test database before anything imports lib/auth.
if (databaseUrl) {
  vi.stubEnv("DATABASE_URL", databaseUrl);
  vi.stubEnv("AUTH_SECRET", "auth-accounts-test-secret-value");
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
}

import { getAuth } from "@/lib/auth";
import { countUsers, getSessionContext } from "@/lib/auth-session";
import { closeDatabasePools, query } from "@/lib/db";
import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";
import { POST as authCatchAllPost } from "@/app/api/auth/[...all]/route";

const archiveId = `test-auth-${randomUUID()}`;
const options = databaseUrl ? { databaseUrl, archiveId } : undefined;

async function cleanupUsers(): Promise<void> {
  await query('DELETE FROM "user"', [], { databaseUrl: databaseUrl! });
  await query("DELETE FROM archives WHERE id = $1", [archiveId], { databaseUrl: databaseUrl! });
}

beforeAll(async () => {
  if (!databaseUrl) return;
  vi.stubEnv("KINSLEUTH_ARCHIVE_ID", archiveId);
  await cleanupUsers();
});

beforeEach(async () => {
  if (!databaseUrl) return;
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
  vi.stubEnv("KINSLEUTH_ALLOW_SIGNUPS", "");
  await provisionTestArchive(options!);
});

afterEach(async () => {
  if (!databaseUrl) return;
  await cleanupUsers();
});

afterAll(async () => {
  await closeDatabasePools();
});

function signUpRequest(email: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "a-long-password-123", name: "Test Owner" })
  });
}

describeIfDatabase("account-based auth", () => {
  it("creates the first account with a session and hashed credentials", async () => {
    const response = await authCatchAllPost(signUpRequest("owner@example.com"));

    expect(response.status).toBe(200);
    expect(await countUsers(options)).toBe(1);

    const account = await query<{ password: string; providerId: string }>(
      'SELECT "password", "providerId" FROM "account"',
      [],
      { databaseUrl: databaseUrl! }
    );
    expect(account.rows).toHaveLength(1);
    expect(account.rows[0].password).not.toContain("a-long-password-123");

    const setCookie = response.headers.getSetCookie().join("; ");
    expect(setCookie).toContain("session_token");
  });

  it("blocks sign-up once an account exists", async () => {
    await authCatchAllPost(signUpRequest("owner@example.com"));

    const second = await authCatchAllPost(signUpRequest("intruder@example.com"));

    expect(second.status).toBe(403);
    expect(await countUsers(options)).toBe(1);
  });

  it("grants owner to exactly one account when first sign-ups race", async () => {
    // A best-effort gate may let both concurrent sign-ups create accounts, but
    // the security invariant must hold regardless: exactly one owner, and any
    // extra account is membership-less (null role).
    await Promise.all([
      authCatchAllPost(signUpRequest("racer-a@example.com")),
      authCatchAllPost(signUpRequest("racer-b@example.com"))
    ]);

    const users = await query<{ email: string }>('SELECT email FROM "user"', [], { databaseUrl: databaseUrl! });
    const roles: Array<string | null> = [];
    for (const { email } of users.rows) {
      const signIn = await getAuth().api.signInEmail({
        body: { email, password: "a-long-password-123" },
        asResponse: true
      });
      const cookie = signIn.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const context = await getSessionContext(new Headers({ cookie }), options);
      roles.push(context?.role ?? null);
    }

    expect(roles.filter((role) => role === "owner")).toHaveLength(1);

    const owners = await query<{ count: number }>(
      "SELECT count(*)::int AS count FROM memberships WHERE archive_id = $1 AND role = 'owner'",
      [archiveId],
      { databaseUrl: databaseUrl! }
    );
    expect(owners.rows[0].count).toBe(1);
  });

  it("denies data access to an authenticated account with no membership", async () => {
    // Two accounts exist, so neither qualifies for owner self-heal; a valid
    // session without a membership must resolve to null (no archive access).
    vi.stubEnv("KINSLEUTH_ALLOW_SIGNUPS", "true");
    await authCatchAllPost(signUpRequest("owner@example.com"));
    await authCatchAllPost(signUpRequest("stranger@example.com"));

    const signIn = await getAuth().api.signInEmail({
      body: { email: "stranger@example.com", password: "a-long-password-123" },
      asResponse: true
    });
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    const context = await getSessionContext(new Headers({ cookie }), options);
    expect(context).toBeNull();
    vi.stubEnv("KINSLEUTH_ALLOW_SIGNUPS", "");
  });

  it("does not self-heal a membership-less account in a hosted deployment", async () => {
    await authCatchAllPost(signUpRequest("pilot@example.com"));

    const signIn = await getAuth().api.signInEmail({
      body: { email: "pilot@example.com", password: "a-long-password-123" },
      asResponse: true
    });
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");

    await expect(getSessionContext(new Headers({ cookie }), options)).resolves.toBeNull();

    const memberships = await query<{ count: number }>(
      "SELECT count(*)::int AS count FROM memberships WHERE archive_id = $1",
      [archiveId],
      { databaseUrl: databaseUrl! }
    );
    expect(memberships.rows[0].count).toBe(0);
  });

  it("signs in and resolves the owner role from membership, self-healing the first account", async () => {
    await authCatchAllPost(signUpRequest("owner@example.com"));

    const signIn = await getAuth().api.signInEmail({
      body: { email: "owner@example.com", password: "a-long-password-123" },
      asResponse: true
    });
    expect(signIn.status).toBe(200);

    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const context = await getSessionContext(new Headers({ cookie }), options);

    expect(context).not.toBeNull();
    expect(context?.role).toBe("owner");
    expect(context?.archiveId).toBe(archiveId);

    const membership = await query<{ role: string }>(
      "SELECT role FROM memberships WHERE archive_id = $1",
      [archiveId],
      { databaseUrl: databaseUrl! }
    );
    expect(membership.rows).toEqual([{ role: "owner" }]);
  });

  it("rejects wrong passwords and anonymous session lookups", async () => {
    await authCatchAllPost(signUpRequest("owner@example.com"));

    const badSignIn = await getAuth().api.signInEmail({
      body: { email: "owner@example.com", password: "wrong-password-123" },
      asResponse: true
    });
    expect(badSignIn.status).toBeGreaterThanOrEqual(400);

    const context = await getSessionContext(new Headers(), options);
    expect(context).toBeNull();
  });
});
