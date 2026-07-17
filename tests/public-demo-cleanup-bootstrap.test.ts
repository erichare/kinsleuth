import { pathToFileURL } from "node:url";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

type Diagnostics = {
  capacity: {
    maximum: 25;
    active: number;
    provisioning: number;
    available: number;
  };
  cleanup: {
    leaseHeld: boolean;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastFailedAt: string | null;
  };
};

type Operations = {
  cleanup: ReturnType<typeof vi.fn>;
  drain: ReturnType<typeof vi.fn>;
  readDiagnostics: ReturnType<typeof vi.fn>;
  readRuntimeRoleIdentity: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
};

type Bootstrap = (
  environment?: Readonly<Record<string, string | undefined>>,
  operations?: Operations,
  clock?: () => Date
) => Promise<Readonly<{ bootstrapped: boolean }>>;

const runtimeDatabaseUrl = "postgresql://demo-runtime:synthetic@db.example.test:5432/postgres";
const expectedRoleIdentity = "a".repeat(64);
const environment = {
  DATABASE_AUTO_MIGRATE: "false",
  EXPECTED_RUNTIME_ROLE_IDENTITY_SHA256: expectedRoleIdentity,
  KINRESOLVE_DATASET_MODE: "demo",
  KINRESOLVE_PUBLIC_DEMO_ENABLED: "true",
  PUBLIC_DEMO_RUNTIME_DATABASE_URL: runtimeDatabaseUrl,
  ROLLBACK_KIND: "holding"
};
const now = new Date("2026-07-17T01:00:00.000Z");
const clock = () => now;

describe("protected public demo cleanup bootstrap", () => {
  it("requires a zero holding cleanup proof after a short batch", async () => {
    const runBootstrap = await loadBootstrap();
    const operations = stubOperations([
      diagnostics({
        lastStartedAt: "2026-07-17T01:00:00.000Z",
        lastCompletedAt: "2026-07-17T01:00:01.000Z"
      })
    ]);
    operations.cleanup
      .mockResolvedValueOnce(cleanupResult(99))
      .mockResolvedValueOnce(cleanupResult(0));

    await expect(runBootstrap(environment, operations, clock)).resolves.toEqual({
      bootstrapped: true
    });
    const databaseOptions = { databaseUrl: runtimeDatabaseUrl };
    expect(operations.readRuntimeRoleIdentity).toHaveBeenCalledExactlyOnceWith(databaseOptions);
    expect(operations.drain).toHaveBeenCalledExactlyOnceWith({ now }, databaseOptions);
    expect(operations.readDiagnostics).toHaveBeenNthCalledWith(1, { now }, databaseOptions);
    expect(operations.cleanup).toHaveBeenNthCalledWith(
      1,
      { limit: 100, now },
      databaseOptions
    );
    expect(operations.cleanup).toHaveBeenNthCalledWith(
      2,
      { limit: 100, now },
      databaseOptions
    );
    expect(operations.cleanup).toHaveBeenCalledTimes(2);
    expect(operations.readDiagnostics).toHaveBeenCalledTimes(1);
    expect(operations.readRuntimeRoleIdentity.mock.invocationCallOrder[0])
      .toBeLessThan(operations.drain.mock.invocationCallOrder[0]!);
    expect(operations.drain.mock.invocationCallOrder[0])
      .toBeLessThan(operations.cleanup.mock.invocationCallOrder[0]!);
    expect(operations.cleanup.mock.invocationCallOrder[0])
      .toBeLessThan(operations.readDiagnostics.mock.invocationCallOrder[0]!);
  });

  it("continues after a full holding cleanup batch before reading diagnostics", async () => {
    const runBootstrap = await loadBootstrap();
    const operations = stubOperations([
      diagnostics({
        lastStartedAt: "2026-07-17T01:00:00.000Z",
        lastCompletedAt: "2026-07-17T01:00:01.000Z"
      })
    ]);
    operations.cleanup
      .mockResolvedValueOnce(cleanupResult(100))
      .mockResolvedValueOnce(cleanupResult(12))
      .mockResolvedValueOnce(cleanupResult(0));

    await expect(runBootstrap(environment, operations, clock)).resolves.toEqual({
      bootstrapped: true
    });
    const databaseOptions = { databaseUrl: runtimeDatabaseUrl };
    expect(operations.cleanup).toHaveBeenNthCalledWith(
      1,
      { limit: 100, now },
      databaseOptions
    );
    expect(operations.cleanup).toHaveBeenNthCalledWith(
      3,
      { limit: 100, now },
      databaseOptions
    );
    expect(operations.cleanup).toHaveBeenCalledTimes(3);
    expect(operations.cleanup.mock.invocationCallOrder[2])
      .toBeLessThan(operations.readDiagnostics.mock.invocationCallOrder[0]!);
    expect(operations.readDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("does not mutate a healthy live-demo scheduler", async () => {
    const runBootstrap = await loadBootstrap();
    const operations = stubOperations([diagnostics({
      lastStartedAt: "2026-07-17T00:54:59.000Z",
      lastCompletedAt: "2026-07-17T00:55:00.000Z"
    })]);

    await expect(runBootstrap({
      ...environment,
      ROLLBACK_KIND: "public-demo"
    }, operations, clock)).resolves.toEqual({
      bootstrapped: false
    });
    expect(operations.drain).not.toHaveBeenCalled();
    expect(operations.cleanup).not.toHaveBeenCalled();
    expect(operations.readDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("refuses to mask stale, failed, or interrupted live-demo scheduler state", async () => {
    const runBootstrap = await loadBootstrap();
    const liveEnvironment = { ...environment, ROLLBACK_KIND: "public-demo" };
    const stale = stubOperations([diagnostics({
      lastStartedAt: "2026-07-17T00:49:58.000Z",
      lastCompletedAt: "2026-07-17T00:49:59.000Z"
    })]);
    const failed = stubOperations([diagnostics({
      lastStartedAt: "2026-07-17T00:58:59.000Z",
      lastCompletedAt: "2026-07-17T00:59:00.000Z",
      lastFailedAt: "2026-07-17T00:59:30.000Z"
    })]);
    const interrupted = stubOperations([diagnostics({
      lastStartedAt: "2026-07-17T00:59:30.000Z",
      lastCompletedAt: null
    })]);

    await expect(runBootstrap(liveEnvironment, stale, clock)).rejects.toThrow(/cleanup bootstrap/i);
    await expect(runBootstrap(liveEnvironment, failed, clock)).rejects.toThrow(/cleanup bootstrap/i);
    await expect(runBootstrap(liveEnvironment, interrupted, clock)).rejects.toThrow(
      /cleanup bootstrap/i
    );
    expect(stale.cleanup).not.toHaveBeenCalled();
    expect(failed.cleanup).not.toHaveBeenCalled();
    expect(interrupted.cleanup).not.toHaveBeenCalled();
  });

  it("waits for an in-flight live cleanup without performing a competing mutation", async () => {
    const runBootstrap = await loadBootstrap();
    const operations = stubOperations([
      diagnostics({ leaseHeld: true, lastStartedAt: "2026-07-17T00:59:59.000Z" }),
      diagnostics({
        lastStartedAt: "2026-07-17T00:59:59.000Z",
        lastCompletedAt: "2026-07-17T01:00:00.000Z"
      })
    ]);

    await expect(runBootstrap({
      ...environment,
      ROLLBACK_KIND: "public-demo"
    }, operations, clock)).resolves.toEqual({ bootstrapped: false });
    expect(operations.sleep).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(operations.cleanup).not.toHaveBeenCalled();
  });

  it("allows an in-flight live cleanup the full lease window to succeed", async () => {
    const runBootstrap = await loadBootstrap();
    const running = diagnostics({
      leaseHeld: true,
      lastStartedAt: "2026-07-17T00:59:59.000Z"
    });
    const operations = stubOperations([
      ...Array.from({ length: 48 }, () => running),
      diagnostics({
        lastStartedAt: "2026-07-17T00:59:59.000Z",
        lastCompletedAt: "2026-07-17T01:00:00.000Z"
      })
    ]);

    await expect(runBootstrap({
      ...environment,
      ROLLBACK_KIND: "public-demo"
    }, operations, clock)).resolves.toEqual({ bootstrapped: false });
    expect(operations.sleep).toHaveBeenCalledTimes(48);
    expect(operations.cleanup).not.toHaveBeenCalled();

    const exhausted = stubOperations(Array.from({ length: 49 }, () => running));
    await expect(runBootstrap({
      ...environment,
      ROLLBACK_KIND: "public-demo"
    }, exhausted, clock)).rejects.toThrow(/cleanup bootstrap/i);
    expect(exhausted.sleep).toHaveBeenCalledTimes(48);
    expect(exhausted.cleanup).not.toHaveBeenCalled();
  });

  it("binds the operation to the already attested runtime role", async () => {
    const runBootstrap = await loadBootstrap();
    const operations = stubOperations([diagnostics({})]);
    operations.readRuntimeRoleIdentity.mockResolvedValue("b".repeat(64));

    await expect(runBootstrap(environment, operations, clock)).rejects.toThrow(/cleanup bootstrap/i);
    expect(operations.readDiagnostics).not.toHaveBeenCalled();
    expect(operations.drain).not.toHaveBeenCalled();
    expect(operations.cleanup).not.toHaveBeenCalled();

    await expect(runBootstrap({
      ...environment,
      PUBLIC_DEMO_RUNTIME_DATABASE_URL: ""
    }, operations, clock)).rejects.toThrow(/PUBLIC_DEMO_RUNTIME_DATABASE_URL/);
    await expect(runBootstrap({
      ...environment,
      EXPECTED_RUNTIME_ROLE_IDENTITY_SHA256: "invalid"
    }, operations, clock)).rejects.toThrow(/EXPECTED_RUNTIME_ROLE_IDENTITY_SHA256/);

    await expect(runBootstrap({
      ...environment,
      DATABASE_AUTO_MIGRATE: "true"
    }, operations, clock)).rejects.toThrow(/cleanup profile/i);
    await expect(runBootstrap({
      ...environment,
      ROLLBACK_KIND: "unknown"
    }, operations, clock)).rejects.toThrow(/ROLLBACK_KIND/);
  });

  it("allows a protected holding release to recover stale or failed cleanup state", async () => {
    const runBootstrap = await loadBootstrap();
    const recovered = diagnostics({
      lastStartedAt: "2026-07-17T01:00:00.000Z",
      lastCompletedAt: "2026-07-17T01:00:01.000Z"
    });
    const staleRecovery = stubOperations([recovered]);
    const failedRecovery = stubOperations([recovered]);

    await expect(runBootstrap(environment, staleRecovery, clock)).resolves.toEqual({
      bootstrapped: true
    });
    await expect(runBootstrap(environment, failedRecovery, clock)).resolves.toEqual({
      bootstrapped: true
    });
    expect(staleRecovery.cleanup).toHaveBeenCalledTimes(1);
    expect(failedRecovery.cleanup).toHaveBeenCalledTimes(1);
  });

  it("requires the holding cleanup result and postcondition to remain exact", async () => {
    const runBootstrap = await loadBootstrap();
    const malformedResult = stubOperations([diagnostics({})]);
    malformedResult.cleanup.mockResolvedValue({ expired: 0 });
    await expect(runBootstrap(environment, malformedResult, clock)).rejects.toThrow(
      /cleanup bootstrap/i
    );
    expect(malformedResult.readDiagnostics).not.toHaveBeenCalled();

    const malformedFollowup = stubOperations([diagnostics({})]);
    malformedFollowup.cleanup
      .mockResolvedValueOnce(cleanupResult(100))
      .mockResolvedValueOnce({ expired: 0 });
    await expect(runBootstrap(environment, malformedFollowup, clock)).rejects.toThrow(
      /cleanup bootstrap/i
    );
    expect(malformedFollowup.cleanup).toHaveBeenCalledTimes(2);
    expect(malformedFollowup.readDiagnostics).not.toHaveBeenCalled();

    const overLimit = stubOperations([diagnostics({})]);
    overLimit.cleanup.mockResolvedValue(cleanupResult(101));
    await expect(runBootstrap(environment, overLimit, clock)).rejects.toThrow(
      /cleanup bootstrap/i
    );
    expect(overLimit.readDiagnostics).not.toHaveBeenCalled();

    const missingPostcondition = stubOperations([diagnostics({})]);
    await expect(runBootstrap(environment, missingPostcondition, clock)).rejects.toThrow(
      /cleanup bootstrap/i
    );
  });

  it("fails closed when every bounded holding cleanup batch is full", async () => {
    const runBootstrap = await loadBootstrap();
    const operations = stubOperations([diagnostics({})]);
    operations.cleanup.mockResolvedValue(cleanupResult(100));

    await expect(runBootstrap(environment, operations, clock)).rejects.toThrow(
      /cleanup bootstrap/i
    );
    expect(operations.cleanup).toHaveBeenCalledTimes(101);
    expect(operations.readDiagnostics).not.toHaveBeenCalled();
  });

  it("requires the holding drain result to contain only nonnegative integer counts", async () => {
    const runBootstrap = await loadBootstrap();
    const malformedResults = [
      { sessionsDrained: 0 },
      { sessionsDrained: 0, aiAttemptsClosed: 0, detail: "not-public" },
      { sessionsDrained: -1, aiAttemptsClosed: 0 },
      { sessionsDrained: 0, aiAttemptsClosed: 0.5 }
    ];

    for (const result of malformedResults) {
      const operations = stubOperations([diagnostics({})]);
      operations.drain.mockResolvedValue(result);

      await expect(runBootstrap(environment, operations, clock)).rejects.toThrow(
        /cleanup bootstrap/i
      );
      expect(operations.cleanup).not.toHaveBeenCalled();
      expect(operations.readDiagnostics).not.toHaveBeenCalled();
    }
  });

  it.each([
    { active: 1, provisioning: 0, available: 24 },
    { active: 0, provisioning: 1, available: 24 },
    { active: 0, provisioning: 0, available: 24 }
  ])("rejects an incomplete holding capacity postcondition: %o", async (capacity) => {
    const runBootstrap = await loadBootstrap();
    const operations = stubOperations([diagnostics({
      capacity,
      lastStartedAt: "2026-07-17T01:00:00.000Z",
      lastCompletedAt: "2026-07-17T01:00:01.000Z"
    })]);

    await expect(runBootstrap(environment, operations, clock)).rejects.toThrow(
      /cleanup bootstrap/i
    );
  });
});

async function loadBootstrap(): Promise<Bootstrap> {
  const moduleUrl = pathToFileURL(path.join(
    process.cwd(),
    "scripts/public-demo-cleanup-bootstrap.mjs"
  )).href;
  const loaded = await import(moduleUrl) as { runPublicDemoCleanupBootstrap?: Bootstrap };
  if (typeof loaded.runPublicDemoCleanupBootstrap !== "function") {
    throw new Error("The protected demo cleanup bootstrap is unavailable.");
  }
  return loaded.runPublicDemoCleanupBootstrap;
}

function diagnostics(input: {
  capacity?: {
    active: number;
    provisioning: number;
    available: number;
  };
  leaseHeld?: boolean;
  lastStartedAt?: string | null;
  lastCompletedAt?: string | null;
  lastFailedAt?: string | null;
}): Diagnostics {
  return {
    capacity: {
      maximum: 25,
      active: input.capacity?.active ?? 0,
      provisioning: input.capacity?.provisioning ?? 0,
      available: input.capacity?.available ?? 25
    },
    cleanup: {
      leaseHeld: input.leaseHeld ?? false,
      lastStartedAt: input.lastStartedAt ?? null,
      lastCompletedAt: input.lastCompletedAt ?? null,
      lastFailedAt: input.lastFailedAt ?? null
    }
  };
}

function cleanupResult(archivesCleaned: number) {
  return {
    expired: 0,
    staleProvisioningRecovered: 0,
    archivesCleaned,
    eventsDeleted: 0
  };
}

function stubOperations(states: Diagnostics[]): Operations {
  return {
    cleanup: vi.fn(async () => cleanupResult(0)),
    drain: vi.fn(async () => ({
      sessionsDrained: 0,
      aiAttemptsClosed: 0
    })),
    readDiagnostics: vi.fn()
      .mockImplementation(async () => states.shift() ?? diagnostics({})),
    readRuntimeRoleIdentity: vi.fn(async () => expectedRoleIdentity),
    sleep: vi.fn(async () => undefined)
  };
}
