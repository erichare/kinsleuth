import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  capture: vi.fn(),
  emit: vi.fn(),
  session: vi.fn()
}));

vi.mock("@/lib/auth-session", () => ({ getSessionContext: mocks.session }));
vi.mock("@/lib/beta-operations", () => ({ beginDataOperation: mocks.begin }));
vi.mock("@/lib/observability", () => ({
  captureOperationalError: mocks.capture,
  emitOperationalEvent: mocks.emit
}));

import { POST } from "@/app/api/data-operations/deletion-request/route";

const confirmation = "REQUEST DELETION REVIEW";
const marker = "PRIVATE_DELETION_REQUEST_FAILURE";

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
  mocks.capture.mockResolvedValue(undefined);
  mocks.emit.mockResolvedValue(undefined);
});

describe("POST /api/data-operations/deletion-request", () => {
  it("records a non-destructive owner request with exact confirmation", async () => {
    const response = await POST(jsonRequest({ confirmation }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      state: "requested",
      nextStep: "Kin Resolve support will verify export and whole-cell deletion with the archive owner."
    });
    expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({
      operationType: "deletion-request",
      userId: "owner-1"
    }), { archiveId: "pilot-archive" });
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({
      event: "deletion_requested",
      operationType: "deletion-request"
    }));
  });

  it.each([
    ["wrong phrase", () => jsonRequest({ confirmation: marker })],
    ["extra field", () => jsonRequest({ confirmation, privateDetail: marker })],
    ["non-JSON", () => new Request(url(), { method: "POST", body: confirmation })],
    ["oversized", () => new Request(url(), {
      method: "POST",
      headers: { "content-length": "129", "content-type": "application/json" },
      body: JSON.stringify({ confirmation })
    })]
  ])("rejects %s before writing", async (_label, buildRequest) => {
    const response = await POST(buildRequest());
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(marker);
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("denies non-owner roles", async () => {
    mocks.session.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      archiveId: "pilot-archive"
    });
    const response = await POST(jsonRequest({ confirmation }));
    expect(response.status).toBe(403);
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("returns a generic service error when durable recording fails", async () => {
    mocks.begin.mockRejectedValueOnce(Object.assign(new Error(marker), { code: marker }));
    const response = await POST(jsonRequest({ confirmation }));
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "Deletion review could not be requested." });
    expect(JSON.stringify(body)).not.toContain(marker);
    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({
      route: "/api/data-operations/deletion-request"
    }), expect.any(Error));
  });
});

function jsonRequest(body: unknown): Request {
  return new Request(url(), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.kinresolve.com" },
    body: JSON.stringify(body)
  });
}

function url(): string {
  return "https://app.kinresolve.com/api/data-operations/deletion-request";
}
