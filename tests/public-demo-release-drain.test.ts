import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  withTransaction: vi.fn()
}));
const workspaceMocks = vi.hoisted(() => ({
  provisionArchive: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: dbMocks.withTransaction
}));
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import {
  drainPublicDemoSessionsForRelease,
  startPublicDemoSession
} from "@/lib/public-demo-session-store";
import { publicDemoNoticeVersion } from "@/lib/public-demo-contract";

const now = new Date("2026-07-17T12:00:00.000Z");
const databaseOptions = { databaseUrl: "postgres://release-drain.invalid/kinresolve" };

describe("public demo release drain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceMocks.provisionArchive.mockResolvedValue(undefined);
    dbMocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("AS in_flight")) {
        return { rows: [{ in_flight: false }], rowCount: 1 };
      }
      if (sql.includes("WITH drained_sessions")) {
        return {
          rows: [{ sessions_drained: 2, ai_attempts_closed: 1 }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    });
    dbMocks.withTransaction.mockImplementation(async (_options, callback) => callback({
      query: dbMocks.clientQuery
    }));
  });

  it("locks capacity before one aggregate-only transactional drain query", async () => {
    const result = await drainPublicDemoSessionsForRelease({ now }, databaseOptions);
    const sql = dbMocks.clientQuery.mock.calls.map(([text]) => String(text));

    expect(dbMocks.withTransaction).toHaveBeenCalledOnce();
    expect(dbMocks.withTransaction).toHaveBeenCalledWith(databaseOptions, expect.any(Function));
    expect(sql).toHaveLength(4);
    expect(sql[0]).toMatch(/INSERT INTO public\.public_demo_capacity/);
    expect(sql[1]).toMatch(
      /SELECT singleton FROM public\.public_demo_capacity WHERE singleton = true FOR UPDATE/
    );
    expect(sql[2]).toMatch(/AS in_flight/);
    expect(sql[2]).toMatch(/session\.status = 'provisioning'/);
    expect(sql[2]).toMatch(/generation\.state = 'provisioning'/);
    expect(sql[2]).toMatch(/interval '2 minutes'/);
    expect(sql[3]).toContain("WITH drained_sessions");
    expect(dbMocks.clientQuery).toHaveBeenNthCalledWith(4, expect.any(String), [now]);
    expect(result).toEqual({ sessionsDrained: 2, aiAttemptsClosed: 1 });
    expect(Object.keys(result)).toEqual(["sessionsDrained", "aiAttemptsClosed"]);
  });

  it("drains residual disposable state globally and preserves timestamp constraints", async () => {
    await drainPublicDemoSessionsForRelease({ now }, databaseOptions);
    const sql = String(dbMocks.clientQuery.mock.calls[3]?.[0]);
    const sessions = sql.indexOf("UPDATE public.public_demo_sessions");
    const generations = sql.indexOf("UPDATE public.public_demo_generations");
    const attempts = sql.indexOf("UPDATE public.public_demo_ai_attempts");

    expect(sessions).toBeGreaterThan(-1);
    expect(generations).toBeGreaterThan(sessions);
    expect(attempts).toBeGreaterThan(generations);
    expect(sql).toMatch(
      /SET status = 'ended',[\s\S]*token_digest = NULL,[\s\S]*ended_at = GREATEST\([\s\S]*session\.created_at[\s\S]*updated_at = GREATEST\(/
    );
    expect(sql).toMatch(/WHERE session\.status IN \('active', 'provisioning'\)/);
    expect(sql).toMatch(
      /UPDATE public\.public_demo_generations[\s\S]*SET state = 'retired',[\s\S]*retired_at = GREATEST\([\s\S]*generation\.created_at[\s\S]*generation\.state IN \('active', 'provisioning'\)/
    );
    expect(sql).toMatch(
      /UPDATE public\.public_demo_ai_attempts[\s\S]*SET state = 'failed',[\s\S]*completed_at = GREATEST\(attempt\.started_at, \$1::timestamptz\)[\s\S]*attempt\.state = 'running'/
    );
    expect(sql).toMatch(
      /SELECT[\s\S]*count\(\*\)::int FROM drained_sessions[\s\S]*AS sessions_drained,[\s\S]*count\(\*\)::int FROM closed_ai_attempts[\s\S]*AS ai_attempts_closed/
    );
    expect(sql).not.toMatch(
      /console\.|RETURNING\s+(session\.)?id|token_digest\s+AS|archive_id\s+AS|prompt_id\s+AS/
    );
    expect(sql).not.toContain("SELECT id FROM drained_sessions");
  });

  it("returns zero counts without skipping the fenced drain statement for empty inventory", async () => {
    dbMocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("AS in_flight")) {
        return { rows: [{ in_flight: false }], rowCount: 1 };
      }
      return sql.includes("WITH drained_sessions")
        ? { rows: [{ sessions_drained: 0, ai_attempts_closed: 0 }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    });

    await expect(drainPublicDemoSessionsForRelease({ now }, databaseOptions)).resolves.toEqual({
      sessionsDrained: 0,
      aiAttemptsClosed: 0
    });
    expect(dbMocks.clientQuery).toHaveBeenCalledTimes(4);
  });

  it("fails closed before mutation while a session or reset generation is provisioning", async () => {
    dbMocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("AS in_flight")) {
        return { rows: [{ in_flight: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      drainPublicDemoSessionsForRelease({ now }, databaseOptions)
    ).rejects.toThrow("The public demo release drain found an in-flight provisioning request.");

    const sql = dbMocks.clientQuery.mock.calls.map(([text]) => String(text));
    expect(sql).toHaveLength(3);
    expect(sql[2]).toContain("AS in_flight");
    expect(sql.join("\n")).not.toContain("WITH drained_sessions");
  });

  it("rejects an invalid release time before opening a transaction", async () => {
    await expect(drainPublicDemoSessionsForRelease({
      now: new Date(Number.NaN)
    }, databaseOptions)).rejects.toThrow("The public demo release drain time is invalid.");

    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
    expect(dbMocks.clientQuery).not.toHaveBeenCalled();
  });

  it("rolls back and exposes no partial counts when a drain query fails", async () => {
    const transactionEvents: string[] = [];
    let queryNumber = 0;
    dbMocks.clientQuery.mockImplementation(async () => {
      queryNumber += 1;
      if (queryNumber === 4) throw new Error("private release-drain database marker");
      if (queryNumber === 3) {
        return { rows: [{ in_flight: false }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    dbMocks.withTransaction.mockImplementation(async (_options, callback) => {
      transactionEvents.push("BEGIN");
      try {
        const result = await callback({ query: dbMocks.clientQuery });
        transactionEvents.push("COMMIT");
        return result;
      } catch (error) {
        transactionEvents.push("ROLLBACK");
        throw error;
      }
    });

    await expect(
      drainPublicDemoSessionsForRelease({ now }, databaseOptions)
    ).rejects.toThrow("private release-drain database marker");
    expect(transactionEvents).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("serializes activation after provisioning and before either lifecycle update", async () => {
    const source = await readFile(
      path.join(process.cwd(), "lib/public-demo-session-store.ts"),
      "utf8"
    );
    const activation = source.slice(
      source.indexOf("async function activateProvisionedSession"),
      source.indexOf("async function failProvisioningSession")
    );
    const provision = activation.indexOf("await provisionArchive");
    const transaction = activation.indexOf("await withTransaction");
    const capacityLock = activation.indexOf("await lockCapacity(client)");
    const generationUpdate = activation.indexOf("UPDATE public.public_demo_generations");
    const sessionUpdate = activation.indexOf("UPDATE public.public_demo_sessions");

    expect(provision).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(provision);
    expect(capacityLock).toBeGreaterThan(transaction);
    expect(generationUpdate).toBeGreaterThan(capacityLock);
    expect(sessionUpdate).toBeGreaterThan(generationUpdate);
  });

  it("serializes provisioning failure before locking session or generation rows", async () => {
    const source = await readFile(
      path.join(process.cwd(), "lib/public-demo-session-store.ts"),
      "utf8"
    );
    const failure = source.slice(
      source.indexOf("async function failProvisioningSession"),
      source.indexOf("async function failResetGeneration")
    );
    const transaction = failure.indexOf("await withTransaction");
    const capacityLock = failure.indexOf("await lockCapacity(client)");
    const sessionUpdate = failure.indexOf("UPDATE public.public_demo_sessions");
    const generationUpdate = failure.indexOf("UPDATE public.public_demo_generations");

    expect(transaction).toBeGreaterThan(-1);
    expect(capacityLock).toBeGreaterThan(transaction);
    expect(sessionUpdate).toBeGreaterThan(capacityLock);
    expect(generationUpdate).toBeGreaterThan(sessionUpdate);
  });

  it.each([
    { path: "new", rawToken: undefined },
    { path: "resumed", rawToken: "r".repeat(43) }
  ])("deletes a late-created demo archive for a $path provisioning request", async ({ rawToken }) => {
    dbMocks.clientQuery.mockImplementation(async (sql: string) => {
      if (rawToken && sql.includes("WHERE session.token_digest = $1") && sql.includes("FOR UPDATE")) {
        return {
          rows: [{
            session_id: "11111111-1111-4111-8111-111111111111",
            archive_id: "demo-11111111111111111111111111111111",
            generation: 1,
            token_digest: "b".repeat(64),
            status: "provisioning",
            reset_count: 0,
            ai_attempts_used: 0,
            created_at: new Date(now.getTime() - 60_000),
            expires_at: new Date(now.getTime() + 86_340_000)
          }],
          rowCount: 1
        };
      }
      if (sql.includes("count(*) FILTER")) {
        return { rows: [{ active: 0, provisioning: rawToken ? 1 : 0 }], rowCount: 1 };
      }
      if (sql.includes("SET status = 'active'") && sql.includes("status = 'provisioning'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SET status = 'failed'") && sql.includes("RETURNING id::text")) {
        return { rows: [], rowCount: 0 };
      }
      if (
        sql.includes("FROM public.public_demo_generations AS generation")
        && sql.includes("generation.state = 'cleaned'")
      ) {
        return { rows: [{ archive_id: "tracked-cleaned-generation" }], rowCount: 1 };
      }
      if (sql.includes("DELETE FROM public.archives")) {
        return { rows: [{ id: "late-created-demo-archive" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(startPublicDemoSession({
      ...(rawToken ? { rawToken } : {}),
      noticeVersion: publicDemoNoticeVersion,
      networkSubjectDigest: "a".repeat(64),
      isCanary: true,
      now
    }, databaseOptions)).rejects.toThrow("The public demo session activation is stale.");

    const sql = dbMocks.clientQuery.mock.calls.map(([text]) => String(text));
    const eligibility = sql.find((text) => (
      text.includes("FROM public.public_demo_generations AS generation")
      && text.includes("generation.state = 'cleaned'")
    ));
    expect(workspaceMocks.provisionArchive).toHaveBeenCalledOnce();
    expect(eligibility).toMatch(/generation\.state IN \('retired', 'failed'\)/);
    expect(eligibility).toMatch(/OR generation\.state = 'cleaned'/);
    expect(eligibility).toMatch(/session\.status IN \('active', 'provisioning'\)/);
    expect(sql).toContain(
      "DELETE FROM public.archives WHERE id = $1 AND dataset_mode = 'demo' RETURNING id"
    );
  });
});
