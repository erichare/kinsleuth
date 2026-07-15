import { getAuth } from "./auth";
import { query } from "./db";
import { isHostedDeployment } from "./hosted-config";
import type { Role } from "./models";
import { ensureWorkspaceProvisioned, getArchiveId, type WorkspaceStoreOptions } from "./workspace-store";

export type SessionContext = {
  userId: string;
  email: string;
  name: string;
  role: Role;
  archiveId: string;
};

// Resolves the caller's identity and archive role from the better-auth
// session — never from request input. Returns null for anonymous callers and
// for authenticated users with no membership on the archive.
export async function getSessionContext(
  requestHeaders: Headers,
  options: WorkspaceStoreOptions = {}
): Promise<SessionContext | null> {
  const archiveId = getArchiveId(options);

  // Local development without AUTH_SECRET keeps the workspace open, matching
  // the proxy's dev-open behavior; production fails closed there instead.
  if (!process.env.AUTH_SECRET && process.env.NODE_ENV !== "production") {
    return { userId: "dev", email: "dev@localhost", name: "Development", role: "owner", archiveId };
  }

  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) {
    return null;
  }

  const role = await resolveMembershipRole(session.user.id, archiveId, options);
  if (!role) {
    return null;
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role,
    archiveId
  };
}

export async function countUsers(options: WorkspaceStoreOptions = {}): Promise<number> {
  const result = await query<{ total: number }>('SELECT count(*)::int AS total FROM "user"', [], options);
  return result.rows[0].total;
}

async function resolveMembershipRole(
  userId: string,
  archiveId: string,
  options: WorkspaceStoreOptions
): Promise<Role | null> {
  const membership = await query<{ role: Role }>(
    "SELECT role FROM memberships WHERE archive_id = $1 AND user_id = $2",
    [archiveId, userId],
    options
  );
  if (membership.rows[0]) {
    return membership.rows[0].role;
  }

  // Hosted accounts receive membership only through an operator-controlled
  // invitation or provisioning path. Never infer ownership from user order.
  if (isHostedDeployment()) {
    return null;
  }

  // Self-hosted first-run self-heal: while the archive has no members yet, the
  // earliest-created account becomes owner (covers the browser closing between
  // sign-up and the explicit /api/setup/claim step). This is deterministic
  // even if concurrent first sign-ups slipped several accounts past the gate —
  // exactly one is the owner; every later account stays membership-less and is
  // denied by the proxy until invited. Once any membership exists, no other
  // account can self-heal.
  const archiveHasMembers = await query(
    "SELECT 1 FROM memberships WHERE archive_id = $1 LIMIT 1",
    [archiveId],
    options
  );
  if (archiveHasMembers.rows.length > 0) {
    return null;
  }

  const earliest = await query<{ id: string }>(
    'SELECT id FROM "user" ORDER BY "createdAt" ASC, id ASC LIMIT 1',
    [],
    options
  );
  if (earliest.rows[0]?.id !== userId) {
    return null;
  }

  await ensureWorkspaceProvisioned(options);
  await query(
    "INSERT INTO memberships (archive_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (archive_id, user_id) DO NOTHING",
    [archiveId, userId],
    options
  );
  return "owner";
}
