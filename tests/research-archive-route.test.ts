import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  complete: vi.fn(),
  createExport: vi.fn(),
  emit: vi.fn(),
  fail: vi.fn(),
  capture: vi.fn(),
  session: vi.fn()
}));

vi.mock("@/lib/auth-session", () => ({ getSessionContext: mocks.session }));
vi.mock("@/lib/beta-operations", () => ({
  beginDataOperation: mocks.begin,
  completeDataOperation: mocks.complete,
  failDataOperation: mocks.fail
}));
vi.mock("@/lib/research-archive-export", () => ({
  createResearchArchiveExport: mocks.createExport
}));
vi.mock("@/lib/observability", () => ({
  captureOperationalError: mocks.capture,
  emitOperationalEvent: mocks.emit
}));

import { POST } from "@/app/api/exports/research-archive/route";

const marker = "PRIVATE_EXPORT_FAILURE_WITH_FAMILY_NAME";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    userId: "owner-1",
    email: "owner@example.test",
    name: "Owner",
    role: "owner",
    archiveId: "pilot-archive"
  });
  mocks.begin.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", state: "requested" });
  mocks.complete.mockResolvedValue(undefined);
  mocks.fail.mockResolvedValue(undefined);
  mocks.emit.mockResolvedValue(undefined);
  mocks.capture.mockResolvedValue(undefined);
  mocks.createExport.mockResolvedValue({
    content: '{"manifest":{"schemaVersion":1}}\n',
    fileName: "kin-resolve-research-archive-2026-07-15.json",
    manifestDigest: "d".repeat(64)
  });
});

describe("POST /api/exports/research-archive", () => {
  it("records and completes an owner-only export before returning the bundle", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="kin-resolve-research-archive-2026-07-15.json"'
    );
    expect(response.headers.get("x-content-sha256")).toBe("d".repeat(64));
    expect(await response.text()).toBe('{"manifest":{"schemaVersion":1}}\n');
    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(mocks.createExport).toHaveBeenCalledWith({ archiveId: "pilot-archive", userId: "owner-1" });
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({
      event: "export_completed",
      operationType: "research-export",
      route: "/api/exports/research-archive"
    }));
    expect(mocks.begin.mock.invocationCallOrder[0]).toBeLessThan(mocks.createExport.mock.invocationCallOrder[0]);
    expect(mocks.createExport.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]);
  });

  it("denies an administrator because full data portability is owner-only", async () => {
    mocks.session.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      archiveId: "pilot-archive"
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.createExport).not.toHaveBeenCalled();
  });

  it("records a fixed failure code and returns no private exception content", async () => {
    mocks.createExport.mockRejectedValueOnce(Object.assign(new Error(marker), { code: marker }));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Research archive export failed." });
    expect(JSON.stringify(body)).not.toContain(marker);
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "EXPORT_FAILED",
      operationType: "research-export",
      userId: "owner-1"
    }), { archiveId: "pilot-archive" });
    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({
      event: "api_error",
      route: "/api/exports/research-archive"
    }), expect.any(Error));
  });
});

function request(): Request {
  return new Request("https://app.kinresolve.com/api/exports/research-archive", {
    method: "POST",
    headers: { origin: "https://app.kinresolve.com" }
  });
}
