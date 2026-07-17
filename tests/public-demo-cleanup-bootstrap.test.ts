import { pathToFileURL } from "node:url";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

type Diagnostics = {
  cleanup: {
    leaseHeld: boolean;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastFailedAt: string | null;
  };
};

type Operations = {
  cleanup: ReturnType<typeof vi.fn>;
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
  it("runs the leased cleanup from holding and proves its fresh idle postcondition", async () => {
    const runBootstrap = await loadBootstrap();
    const operations = stubOperations([
      diagnostics({
        lastStartedAt: "2026-07-17T01:00:00.000Z",
        lastCompletedAt: "2026-07-17T01:00:01.000Z"
      })
    ]);

    await expect(runBootstrap(environment, operations, clock)).resolves.toEqual({
      bootstrapped: true
    });
    const databaseOptions = { databaseUrl: runtimeDatabaseUrl };
    expect(operations.readRuntimeRoleIdentity).toHaveBeenCalledExactlyOnceWith(databaseOptions);
    expect(operations.readDiagnostics).toHaveBeenNthCalledWith(1, { now }, databaseOptions);
    expect(operations.cleanup).toHaveBeenCalledExactlyOnceWith(
      { limit: 100, now },
      databaseOptions
    );
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

    const missingPostcondition = stubOperations([diagnostics({})]);
    await expect(runBootstrap(environment, missingPostcondition, clock)).rejects.toThrow(
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
  leaseHeld?: boolean;
  lastStartedAt?: string | null;
  lastCompletedAt?: string | null;
  lastFailedAt?: string | null;
}): Diagnostics {
  return {
    cleanup: {
      leaseHeld: input.leaseHeld ?? false,
      lastStartedAt: input.lastStartedAt ?? null,
      lastCompletedAt: input.lastCompletedAt ?? null,
      lastFailedAt: input.lastFailedAt ?? null
    }
  };
}

function stubOperations(states: Diagnostics[]): Operations {
  return {
    cleanup: vi.fn(async () => ({
      expired: 0,
      staleProvisioningRecovered: 0,
      archivesCleaned: 0,
      eventsDeleted: 0
    })),
    readDiagnostics: vi.fn()
      .mockImplementation(async () => states.shift() ?? diagnostics({})),
    readRuntimeRoleIdentity: vi.fn(async () => expectedRoleIdentity),
    sleep: vi.fn(async () => undefined)
  };
}
