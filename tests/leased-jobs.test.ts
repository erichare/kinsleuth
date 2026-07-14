import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { query } from "@/lib/db";
import {
  cancelJob,
  completeJob,
  enqueueJob,
  failJob,
  getJob,
  leaseNextJob
} from "@/lib/jobs/leased-job-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase("durable leased jobs", () => {
  const archiveId = `test-jobs-${randomUUID()}`;
  const options = { archiveId, databaseUrl: databaseUrl! };

  beforeEach(async () => {
    await query(
      `INSERT INTO archives (id, name, slug, tagline)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [archiveId, "Synthetic leased-job archive", archiveId, "Synthetic test data only"],
      options
    );
  });

  afterEach(async () => {
    await query("DELETE FROM archives WHERE id = $1", [archiveId], options);
  });

  it("leases one queued job exclusively and reclaims it only after the lease expires", async () => {
    const queuedAt = new Date("2026-07-14T16:00:00.000Z");
    const queued = await enqueueJob(
      {
        kind: "integration_snapshot_parse",
        payload: { connectionId: "connection-synthetic", snapshotId: "snapshot-synthetic" },
        idempotencyKey: "parse-snapshot-synthetic",
        maximumAttempts: 3,
        availableAt: queuedAt
      },
      options
    );

    const firstLease = await leaseNextJob(
      {
        workerId: "worker-one",
        kinds: ["integration_snapshot_parse"],
        now: queuedAt,
        leaseDurationMs: 60_000
      },
      options
    );

    expect(firstLease).toMatchObject({
      id: queued.id,
      state: "running",
      attempt: 1,
      leaseOwner: "worker-one"
    });
    await expect(
      leaseNextJob(
        {
          workerId: "worker-two",
          kinds: ["integration_snapshot_parse"],
          now: new Date("2026-07-14T16:00:59.999Z"),
          leaseDurationMs: 60_000
        },
        options
      )
    ).resolves.toBeNull();

    const reclaimed = await leaseNextJob(
      {
        workerId: "worker-two",
        kinds: ["integration_snapshot_parse"],
        now: new Date("2026-07-14T16:01:00.001Z"),
        leaseDurationMs: 60_000
      },
      options
    );

    expect(reclaimed).toMatchObject({
      id: queued.id,
      state: "running",
      attempt: 2,
      leaseOwner: "worker-two"
    });
    expect(reclaimed?.leaseToken).not.toBe(firstLease?.leaseToken);
    await expect(
      completeJob(
        {
          jobId: queued.id,
          leaseToken: firstLease!.leaseToken,
          result: { snapshotId: "stale-worker-result" },
          completedAt: new Date("2026-07-14T16:01:01.000Z")
        },
        options
      )
    ).rejects.toThrow(/lease|stale/i);
  });

  it("requeues a failed attempt at its retry time and stops after the attempt limit", async () => {
    const firstAvailableAt = new Date("2026-07-14T17:00:00.000Z");
    const retryAt = new Date("2026-07-14T17:05:00.000Z");
    const queued = await enqueueJob(
      {
        kind: "integration_snapshot_parse",
        payload: { connectionId: "connection-retry" },
        idempotencyKey: "retry-synthetic",
        maximumAttempts: 2,
        availableAt: firstAvailableAt
      },
      options
    );
    const firstLease = await leaseNextJob(
      { workerId: "worker-one", now: firstAvailableAt, leaseDurationMs: 60_000 },
      options
    );

    const retried = await failJob(
      {
        jobId: queued.id,
        leaseToken: firstLease!.leaseToken,
        failedAt: new Date("2026-07-14T17:00:10.000Z"),
        retryAt,
        error: new Error("Synthetic parser failure containing token=do-not-expose"),
        publicErrorCode: "source_package_invalid"
      },
      options
    );

    expect(retried).toMatchObject({ state: "queued", attempt: 1 });
    await expect(
      leaseNextJob(
        { workerId: "worker-two", now: new Date("2026-07-14T17:04:59.999Z"), leaseDurationMs: 60_000 },
        options
      )
    ).resolves.toBeNull();

    const secondLease = await leaseNextJob(
      { workerId: "worker-two", now: retryAt, leaseDurationMs: 60_000 },
      options
    );
    expect(secondLease).toMatchObject({ id: queued.id, attempt: 2, state: "running" });

    const exhausted = await failJob(
      {
        jobId: queued.id,
        leaseToken: secondLease!.leaseToken,
        failedAt: new Date("2026-07-14T17:05:10.000Z"),
        retryAt: new Date("2026-07-14T17:10:00.000Z"),
        error: new Error("Synthetic second failure containing password=do-not-expose"),
        publicErrorCode: "source_package_invalid"
      },
      options
    );

    expect(exhausted.state).toBe("failed");
    await expect(
      leaseNextJob(
        { workerId: "worker-three", now: new Date("2026-07-14T17:10:00.000Z"), leaseDurationMs: 60_000 },
        options
      )
    ).resolves.toBeNull();
  });

  it("cancels queued or running work idempotently and invalidates an active lease", async () => {
    const now = new Date("2026-07-14T18:00:00.000Z");
    const queued = await enqueueJob(
      {
        kind: "integration_snapshot_parse",
        payload: { connectionId: "connection-cancel-queued" },
        idempotencyKey: "cancel-queued-synthetic",
        maximumAttempts: 3,
        availableAt: now
      },
      options
    );

    const firstCancellation = await cancelJob({ jobId: queued.id, cancelledAt: now }, options);
    const repeatedCancellation = await cancelJob({ jobId: queued.id, cancelledAt: now }, options);

    expect(firstCancellation.state).toBe("cancelled");
    expect(repeatedCancellation).toEqual(firstCancellation);
    await expect(
      leaseNextJob({ workerId: "worker-one", now, leaseDurationMs: 60_000 }, options)
    ).resolves.toBeNull();

    const running = await enqueueJob(
      {
        kind: "integration_snapshot_parse",
        payload: { connectionId: "connection-cancel-running" },
        idempotencyKey: "cancel-running-synthetic",
        maximumAttempts: 3,
        availableAt: now
      },
      options
    );
    const lease = await leaseNextJob({ workerId: "worker-one", now, leaseDurationMs: 60_000 }, options);
    expect(lease?.id).toBe(running.id);
    await cancelJob({ jobId: running.id, cancelledAt: new Date("2026-07-14T18:00:01.000Z") }, options);

    await expect(
      completeJob(
        {
          jobId: running.id,
          leaseToken: lease!.leaseToken,
          result: { shouldNotPersist: true },
          completedAt: new Date("2026-07-14T18:00:02.000Z")
        },
        options
      )
    ).rejects.toThrow(/cancel|lease|state/i);
  });

  it("deduplicates enqueue requests by idempotency key inside an archive", async () => {
    const input = {
      kind: "integration_snapshot_parse" as const,
      payload: { snapshotId: "snapshot-original" },
      idempotencyKey: "parse-once-synthetic",
      maximumAttempts: 3,
      availableAt: new Date("2026-07-14T19:00:00.000Z")
    };

    const first = await enqueueJob(input, options);
    const duplicate = await enqueueJob(
      { ...input, payload: { snapshotId: "snapshot-must-not-replace-original" } },
      options
    );

    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({ id: first.id, duplicate: true });
    expect(duplicate.payload).toEqual({ snapshotId: "snapshot-original" });

    const otherArchiveId = `test-jobs-other-${randomUUID()}`;
    const otherOptions = { archiveId: otherArchiveId, databaseUrl: databaseUrl! };
    await query(
      `INSERT INTO archives (id, name, slug, tagline)
       VALUES ($1, $2, $3, $4)`,
      [otherArchiveId, "Other synthetic job archive", otherArchiveId, "Synthetic test data only"],
      otherOptions
    );
    try {
      const otherArchiveJob = await enqueueJob(input, otherOptions);
      expect(otherArchiveJob.id).not.toBe(first.id);
      expect(otherArchiveJob.duplicate).toBe(false);
    } finally {
      await query("DELETE FROM archives WHERE id = $1", [otherArchiveId], otherOptions);
    }
  });

  it("exposes only a safe error code and redacted message to status readers", async () => {
    const now = new Date("2026-07-14T20:00:00.000Z");
    const queued = await enqueueJob(
      {
        kind: "integration_snapshot_parse",
        payload: { snapshotId: "snapshot-redaction" },
        idempotencyKey: "redaction-synthetic",
        maximumAttempts: 1,
        availableAt: now
      },
      options
    );
    const lease = await leaseNextJob({ workerId: "worker-one", now, leaseDurationMs: 60_000 }, options);
    const secret = "postgres://private-user:private-password@database.internal/kinresolve";

    await failJob(
      {
        jobId: queued.id,
        leaseToken: lease!.leaseToken,
        failedAt: new Date("2026-07-14T20:00:01.000Z"),
        error: new Error(`Could not parse ${secret}`),
        publicErrorCode: "source_package_invalid"
      },
      options
    );
    const visible = await getJob(queued.id, options);
    const serialized = JSON.stringify(visible);

    expect(visible?.lastError?.code).toBe("source_package_invalid");
    expect(visible?.lastError?.message).toMatch(/could not|failed|retry/i);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("private-password");
  });
});
