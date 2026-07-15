import { afterEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  cleanupAllStaleGedcomUploads: vi.fn()
}));

vi.mock("@/lib/gedcom/blob-storage", () => storageMocks);

import { GET } from "@/app/api/cron/import-uploads/route";

const originalCronSecret = process.env.CRON_SECRET;

afterEach(() => {
  vi.clearAllMocks();
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
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

  it("deletes stale uploads for an authenticated Vercel Cron request", async () => {
    process.env.CRON_SECRET = "expected-secret";
    storageMocks.cleanupAllStaleGedcomUploads.mockResolvedValue(3);

    const response = await GET(cleanupRequest("expected-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: 3 });
    expect(storageMocks.cleanupAllStaleGedcomUploads).toHaveBeenCalledOnce();
  });
});

function cleanupRequest(secret?: string): Request {
  return new Request("https://kinsleuth.example/api/cron/import-uploads", {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined
  });
}
