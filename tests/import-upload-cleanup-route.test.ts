import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  cleanupAllStaleGedcomUploads: vi.fn()
}));
const releaseFenceMocks = vi.hoisted(() => ({
  getActiveReleaseFence: vi.fn().mockResolvedValue(null)
}));
const operationMocks = vi.hoisted(() => ({
  recordWorkerFailed: vi.fn(),
  recordWorkerStarted: vi.fn(),
  recordWorkerSucceeded: vi.fn()
}));
const invitationMocks = vi.hoisted(() => ({
  cleanupExpiredBetaStateForSystem: vi.fn()
}));

vi.mock("@/lib/gedcom/blob-storage", () => storageMocks);
vi.mock("@/lib/release-fence", () => releaseFenceMocks);
vi.mock("@/lib/beta-operations", () => operationMocks);
vi.mock("@/lib/beta-invitations", () => invitationMocks);

import { GET } from "@/app/api/cron/import-uploads/route";

const originalEnvironment = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  releaseFenceMocks.getActiveReleaseFence.mockResolvedValue(null);
  operationMocks.recordWorkerFailed.mockResolvedValue(true);
  operationMocks.recordWorkerStarted.mockResolvedValue(undefined);
  operationMocks.recordWorkerSucceeded.mockResolvedValue(true);
  invitationMocks.cleanupExpiredBetaStateForSystem.mockResolvedValue({
    expiredInvitations: 0,
    expiredVerifications: 0,
    staleRateLimits: 0
  });
  process.env.KINRESOLVE_DEPLOYMENT_MODE = "self-hosted";
  delete process.env.KINRESOLVE_SCHEDULED_WRITES_ENABLED;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
});

describe("scheduled GEDCOM upload cleanup", () => {
  it("fails closed when the cron secret is missing", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(cleanupRequest());

    expect(response.status).toBe(503);
    expect(storageMocks.cleanupAllStaleGedcomUploads).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token", async () => {
    process.env.CRON_SECRET = "expected-secret";

    const response = await GET(cleanupRequest("wrong-secret"));

    expect(response.status).toBe(401);
    expect(storageMocks.cleanupAllStaleGedcomUploads).not.toHaveBeenCalled();
  });

  it("authenticates before checking a disabled hosted scheduled-write gate", async () => {
    process.env.CRON_SECRET = "expected-secret";
    setHostedScheduledWrites("false");

    const response = await GET(cleanupRequest("wrong-secret"));

    expect(response.status).toBe(401);
    expect(releaseFenceMocks.getActiveReleaseFence).not.toHaveBeenCalled();
    expect(storageMocks.cleanupAllStaleGedcomUploads).not.toHaveBeenCalled();
  });

  it.each([undefined, "invalid"])(
    "fails closed without inspecting the fence for a hosted scheduled-write value of %s",
    async (value) => {
      process.env.CRON_SECRET = "expected-secret";
      setHostedScheduledWrites(value);

      const response = await GET(cleanupRequest("expected-secret"));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "Scheduled work is unavailable." });
      expect(releaseFenceMocks.getActiveReleaseFence).not.toHaveBeenCalled();
      expect(storageMocks.cleanupAllStaleGedcomUploads).not.toHaveBeenCalled();
    }
  );

  it("returns a generic non-mutating response while hosted scheduled writes are disabled", async () => {
    process.env.CRON_SECRET = "expected-secret";
    setHostedScheduledWrites("false");
    releaseFenceMocks.getActiveReleaseFence.mockResolvedValue(activeFence());

    const response = await GET(cleanupRequest("expected-secret"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "Scheduled work is unavailable." });
    expect(JSON.stringify(body)).not.toContain("fence-private-beta-01");
    expect(releaseFenceMocks.getActiveReleaseFence).not.toHaveBeenCalled();
    expect(storageMocks.cleanupAllStaleGedcomUploads).not.toHaveBeenCalled();
  });

  it("deletes stale uploads for an authenticated Vercel Cron request", async () => {
    process.env.CRON_SECRET = "expected-secret";
    storageMocks.cleanupAllStaleGedcomUploads.mockResolvedValue(3);

    const response = await GET(cleanupRequest("expected-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: 3, retention: null });
    expect(storageMocks.cleanupAllStaleGedcomUploads).toHaveBeenCalledOnce();
    expect(operationMocks.recordWorkerStarted).toHaveBeenCalledWith(
      "import-upload-cleanup",
      expect.any(String),
      { archiveId: expect.any(String) }
    );
    expect(operationMocks.recordWorkerSucceeded).toHaveBeenCalledWith(
      "import-upload-cleanup",
      expect.any(String),
      { archiveId: expect.any(String) }
    );
    expect(invitationMocks.cleanupExpiredBetaStateForSystem).not.toHaveBeenCalled();
  });

  it("records both upload and retention cleanup heartbeats in hosted mode", async () => {
    process.env.CRON_SECRET = "expected-secret";
    setHostedScheduledWrites("true");
    storageMocks.cleanupAllStaleGedcomUploads.mockResolvedValue(2);

    const response = await GET(cleanupRequest("expected-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: 2,
      retention: {
        expiredInvitations: 0,
        expiredVerifications: 0,
        staleRateLimits: 0
      }
    });
    expect(invitationMocks.cleanupExpiredBetaStateForSystem).toHaveBeenCalledWith(
      { requestId: expect.any(String) },
      { archiveId: expect.any(String) }
    );
    expect(operationMocks.recordWorkerStarted.mock.calls.map(([kind]) => kind)).toEqual([
      "import-upload-cleanup",
      "retention-cleanup"
    ]);
    expect(operationMocks.recordWorkerSucceeded.mock.calls.map(([kind]) => kind)).toEqual([
      "import-upload-cleanup",
      "retention-cleanup"
    ]);
  });

  it("returns 423 with the exact active fence before cleanup starts", async () => {
    process.env.CRON_SECRET = "expected-secret";
    releaseFenceMocks.getActiveReleaseFence.mockResolvedValue(activeFence());

    const response = await GET(cleanupRequest("expected-secret"));

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toMatchObject({
      fenceId: "fence-private-beta-01",
      releaseCommitSha: "a".repeat(40)
    });
    expect(storageMocks.cleanupAllStaleGedcomUploads).not.toHaveBeenCalled();
  });
});

function activeFence() {
  return {
    fenceId: "fence-private-beta-01",
    releaseCommitSha: "a".repeat(40),
    state: "active" as const,
    activationGeneration: 1,
    firstActivatedAt: "2026-07-15T06:00:00.000Z",
    activatedAt: "2026-07-15T06:00:00.000Z",
    releasedAt: null,
    updatedAt: "2026-07-15T06:00:00.000Z"
  };
}

function cleanupRequest(secret?: string): Request {
  return new Request("https://kinsleuth.example/api/cron/import-uploads", {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined
  });
}

function setHostedScheduledWrites(value: string | undefined) {
  process.env.KINRESOLVE_DEPLOYMENT_MODE = "hosted";
  process.env.KINRESOLVE_DATASET_MODE = "pilot";
  if (value === undefined) delete process.env.KINRESOLVE_SCHEDULED_WRITES_ENABLED;
  else process.env.KINRESOLVE_SCHEDULED_WRITES_ENABLED = value;
}
