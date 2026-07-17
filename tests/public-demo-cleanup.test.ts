import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));
const workspaceMocks = vi.hoisted(() => ({
  provisionArchive: vi.fn()
}));

vi.mock("@/lib/db", () => dbMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import {
  cleanupPublicDemoSessions,
  startPublicDemoSession
} from "@/lib/public-demo-session-store";
import { publicDemoNoticeVersion } from "@/lib/public-demo-contract";

const now = new Date("2026-07-16T12:00:00.000Z");
const staleSessionId = "11111111-1111-4111-8111-111111111111";
const staleArchiveId = "demo-11111111111111111111111111111111";

describe("public demo provisioning recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("uses the database clock for a repeatable cleanup lease transition", async () => {
    let leaseAvailabilitySql = "";
    let leaseUpdateSql = "";
    dbMocks.withTransaction.mockImplementation(async (_options, callback) => callback({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("AS available")) {
          leaseAvailabilitySql = sql;
          return { rows: [{ available: true }], rowCount: 1 };
        }
        if (sql.includes("cleanup_lease_expires_at =")) leaseUpdateSql = sql;
        return { rows: [], rowCount: 0 };
      })
    }));

    await cleanupPublicDemoSessions({
      now,
      leaseOwner: "22222222-2222-4222-8222-222222222222"
    });

    expect(leaseAvailabilitySql).toMatch(
      /cleanup_lease_expires_at\s*<=\s*clock_timestamp\(\)/
    );
    expect(leaseUpdateSql).toMatch(
      /cleanup_lease_expires_at\s*=\s*clock_timestamp\(\)\s*\+\s*interval '4 minutes'/
    );
    expect(leaseUpdateSql).toMatch(/last_cleanup_started_at\s*=\s*clock_timestamp\(\)/);
    expect(leaseUpdateSql).toMatch(/last_cleanup_completed_at\s*=\s*NULL/);
    expect(leaseUpdateSql).toMatch(/last_cleanup_failed_at\s*=\s*NULL/);
    expect(leaseUpdateSql).not.toContain("$2");
  });

  it("fails provisioning sessions stale for two minutes and queues their generation for cleanup", async () => {
    const transactionSql: string[] = [];
    const directSql: string[] = [];
    dbMocks.withTransaction.mockImplementation(async (_options, callback) => callback({
      query: vi.fn(async (sql: string) => {
        transactionSql.push(sql);
        if (sql.includes("AS available")) return { rows: [{ available: true }], rowCount: 1 };
        if (sql.includes("updated_at <= $1::timestamptz - interval '2 minutes'")) {
          return { rows: [{ id: staleSessionId }], rowCount: 1 };
        }
        if (sql.includes("status IN ('active', 'provisioning') AND expires_at <= $1")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM public.public_demo_generations") && sql.includes("FOR UPDATE SKIP LOCKED")) {
          return {
            rows: [{ archive_id: staleArchiveId, session_id: staleSessionId, generation: 1 }],
            rowCount: 1
          };
        }
        if (sql.includes("generation.state IN ('retired', 'failed')")) {
          return { rows: [{ archive_id: staleArchiveId }], rowCount: 1 };
        }
        if (sql.includes("DELETE FROM public.archives")) {
          return { rows: [{ id: staleArchiveId }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    }));
    dbMocks.query.mockImplementation(async (sql: string) => {
      directSql.push(sql);
      return { rows: [], rowCount: sql.includes("public_demo_events") ? 0 : 1 };
    });

    const result = await cleanupPublicDemoSessions({
      now,
      leaseOwner: "22222222-2222-4222-8222-222222222222"
    });

    expect(transactionSql).toEqual(expect.arrayContaining([
      expect.stringMatching(
        /SET status = 'failed'.*updated_at <= \$1::timestamptz - interval '2 minutes'/s
      ),
      expect.stringMatching(/SET state = 'failed'.*session_id = ANY/s)
    ]));
    expect(transactionSql).toContain(
      "DELETE FROM public.archives WHERE id = $1 AND dataset_mode = 'demo' RETURNING id"
    );
    expect(result).toMatchObject({ archivesCleaned: 1, staleProvisioningRecovered: 1 });
  });

  it("retries a cleaned generation when its demo archive appears after the first pass", async () => {
    const selectionSql: string[] = [];
    let cleanupPass = 0;
    let archiveExists = false;
    let deleteAttempts = 0;
    dbMocks.withTransaction.mockImplementation(async (_options, callback) => callback({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("AS available")) {
          return { rows: [{ available: true }], rowCount: 1 };
        }
        if (sql.includes("status IN ('active', 'provisioning') AND expires_at <= $1")) {
          return { rows: [], rowCount: 0 };
        }
        if (
          sql.includes("FROM public.public_demo_generations AS generation")
          && sql.includes("FOR UPDATE SKIP LOCKED")
        ) {
          cleanupPass += 1;
          selectionSql.push(sql);
          return {
            rows: [{ archive_id: staleArchiveId, session_id: staleSessionId, generation: 1 }],
            rowCount: 1
          };
        }
        if (
          sql.includes("FROM public.public_demo_generations AS generation")
          && sql.includes("generation.state = 'cleaned'")
        ) {
          return { rows: [{ archive_id: staleArchiveId }], rowCount: 1 };
        }
        if (sql.includes("DELETE FROM public.archives")) {
          deleteAttempts += 1;
          return archiveExists
            ? { rows: [{ id: staleArchiveId }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.includes("SELECT id FROM public.archives")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      })
    }));
    dbMocks.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await cleanupPublicDemoSessions({
      now,
      leaseOwner: "22222222-2222-4222-8222-222222222222"
    });
    archiveExists = true;
    await cleanupPublicDemoSessions({
      now: new Date(now.getTime() + 1_000),
      leaseOwner: "33333333-3333-4333-8333-333333333333"
    });

    expect(cleanupPass).toBe(2);
    expect(selectionSql[1]).toMatch(
      /generation\.state = 'cleaned'[\s\S]*EXISTS[\s\S]*archive\.id = generation\.archive_id[\s\S]*archive\.dataset_mode = 'demo'/
    );
    expect(deleteAttempts).toBe(2);
  });

  it("marks the reserved generation failed when initial archive provisioning fails", async () => {
    const transactionSql: string[] = [];
    dbMocks.withTransaction.mockImplementation(async (_options, callback) => callback({
      query: vi.fn(async (sql: string) => {
        transactionSql.push(sql);
        if (sql.includes("SELECT request_count")) {
          return { rows: [{ request_count: 0, expires_at: new Date(now.getTime() + 3_600_000) }], rowCount: 1 };
        }
        if (sql.includes("count(*) FILTER")) {
          return { rows: [{ active: 0, provisioning: 0 }], rowCount: 1 };
        }
        if (sql.includes("SET status = 'failed'")) {
          return { rows: [{ id: staleSessionId }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      })
    }));
    workspaceMocks.provisionArchive.mockRejectedValueOnce(new Error("fixture provisioning failed"));

    await expect(startPublicDemoSession({
      noticeVersion: publicDemoNoticeVersion,
      networkSubjectDigest: "a".repeat(64),
      now
    })).rejects.toThrow("fixture provisioning failed");

    expect(transactionSql).toEqual(expect.arrayContaining([
      expect.stringMatching(/SET status = 'failed'.*status = 'provisioning'/s),
      expect.stringMatching(/SET state = 'failed'.*state = 'provisioning'/s)
    ]));
  });
});
