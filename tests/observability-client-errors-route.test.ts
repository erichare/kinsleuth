import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}));

vi.mock("@/lib/api-authorization", () => ({
  withPermission: (
    permission: string,
    handler: (request: Request, context: { requestId: string }, ...arguments_: unknown[]) => unknown
  ) => {
    if (permission !== "archive:read-private") throw new Error("Unexpected route permission.");
    return (request: Request, ...arguments_: unknown[]) => handler(
      request,
      { requestId: mocks.requestId },
      ...arguments_
    );
  }
}));
vi.mock("@/lib/observability", () => ({
  emitOperationalEvent: mocks.emit
}));

import { POST } from "@/app/api/observability/client-errors/route";

const requestId = mocks.requestId;
const marker = "PRIVATE_BROWSER_ERROR_WITH_PERSON_NAME";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.emit.mockResolvedValue(undefined);
});

describe("POST /api/observability/client-errors", () => {
  it("accepts only the fixed browser error signal", async () => {
    const response = await POST(jsonRequest({ event: "browser-unhandled-error" }));

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(mocks.emit).toHaveBeenCalledExactlyOnceWith({
      event: "browser_unhandled_error",
      severity: "error",
      code: "UNEXPECTED_ERROR",
      requestId,
      route: "/app"
    });
  });

  it.each([
    ["a non-JSON content type", () => new Request(url(), {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ event: "browser-unhandled-error" })
    })],
    ["an unknown event", () => jsonRequest({ event: marker })],
    ["additional browser fields", () => jsonRequest({
      event: "browser-unhandled-error",
      message: marker
    })],
    ["invalid JSON", () => new Request(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{${marker}`
    })],
    ["a declared oversized body", () => new Request(url(), {
      method: "POST",
      headers: {
        "content-length": "129",
        "content-type": "application/json"
      },
      body: JSON.stringify({ event: "browser-unhandled-error" })
    })],
    ["an actual oversized body", () => new Request(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `${JSON.stringify({ event: "browser-unhandled-error" })}${" ".repeat(129)}`
    })]
  ])("rejects %s without forwarding or echoing it", async (_label, buildRequest) => {
    const response = await POST(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ error: "Invalid error signal" });
    expect(JSON.stringify(body)).not.toContain(marker);
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown): Request {
  return new Request(url(), {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  });
}

function url(): string {
  return "https://app.kinresolve.com/api/observability/client-errors";
}
