import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/db", () => ({ query: mocks.query }));

import {
  beginDataOperation,
  readJobLagHealth,
  recordWorkerFailed
} from "@/lib/beta-operations";

const now = new Date("2026-07-15T12:00:00.000Z");
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const originalEnvironment = { ...process.env };

beforeEach(() => {
  vi.resetAllMocks();
  process.env.KINRESOLVE_BETA_PRIVACY_HMAC_SECRET = "p".repeat(48);
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("beta operational state", () => {
  it("reports a healthy empty queue from one bounded aggregate query", async () => {
    mocks.query.mockResolvedValue({
      rows: [{ eligible_count: "0", oldest_eligible_at: null, recent_failed_count: "0" }]
    });

    await expect(readJobLagHealth({ archiveId: "pilot-archive", now })).resolves.toEqual({
      eligibleCount: 0,
      eligibleCountCapped: false,
      oldestEligibleAgeSeconds: null,
      recentFailedCount: 0,
      recentFailedCountCapped: false,
      freshness: "healthy"
    });
    const [sql, values] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("LIMIT 1001");
    expect(sql).not.toContain("payload");
    expect(sql).not.toContain("last_error_message");
    expect(values).toEqual(["pilot-archive", now]);
  });

  it.each([
    ["warning", 11 * 60, "0"],
    ["critical", 21 * 60, "0"],
    ["critical", 0, "1"]
  ])("classifies queue state as %s", async (expected, ageSeconds, recentFailedCount) => {
    mocks.query.mockResolvedValue({
      rows: [{
        eligible_count: ageSeconds === 0 ? "0" : "1",
        oldest_eligible_at: ageSeconds === 0 ? null : new Date(now.getTime() - ageSeconds * 1_000),
        recent_failed_count: recentFailedCount
      }]
    });
    const result = await readJobLagHealth({ archiveId: "pilot-archive", now });
    expect(result.freshness).toBe(expected);
  });

  it("caps exposed counts and rejects results outside the SQL bound", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ eligible_count: "1001", oldest_eligible_at: now, recent_failed_count: "1001" }]
    });
    await expect(readJobLagHealth({ archiveId: "pilot-archive", now })).resolves.toMatchObject({
      eligibleCount: 1_000,
      eligibleCountCapped: true,
      recentFailedCount: 1_000,
      recentFailedCountCapped: true
    });

    mocks.query.mockResolvedValueOnce({
      rows: [{ eligible_count: "1002", oldest_eligible_at: now, recent_failed_count: "0" }]
    });
    await expect(readJobLagHealth({ archiveId: "pilot-archive", now })).rejects.toThrow(/bounded query/i);
  });

  it("accepts only fixed worker failure codes", async () => {
    await expect(recordWorkerFailed(
      "integration-jobs",
      requestId,
      "PRIVATE_PERSON_AND_DATABASE_PASSWORD",
      { archiveId: "pilot-archive" }
    )).rejects.toThrow(/failure code/i);
    expect(mocks.query).not.toHaveBeenCalled();

    mocks.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await expect(recordWorkerFailed(
      "integration-jobs",
      requestId,
      "DATABASE_ERROR",
      { archiveId: "pilot-archive" }
    )).resolves.toBe(true);
  });

  it("stores only an HMAC actor digest, never the raw participant ID", async () => {
    const userId = "private-user-id";
    mocks.query.mockResolvedValueOnce({
      rows: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", state: "requested" }]
    });
    await beginDataOperation({
      operationType: "research-export",
      requestId,
      userId
    }, { archiveId: "pilot-archive" });

    const [sql, values] = mocks.query.mock.calls[0]!;
    expect(sql).not.toContain("requested_by_user_id");
    expect(values).not.toContain(userId);
    expect(values[3]).toMatch(/^[a-f0-9]{64}$/);
  });
});
