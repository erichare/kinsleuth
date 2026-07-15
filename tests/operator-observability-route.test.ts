import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  consume: vi.fn(),
  createRequestId: vi.fn(),
  emit: vi.fn(),
  fence: vi.fn(),
  hosted: vi.fn()
}));

vi.mock("@/lib/operator-request", () => ({
  authenticateOperatorRequest: mocks.authenticate
}));
vi.mock("@/lib/beta-invitations", () => ({
  consumeBetaOperatorRequest: mocks.consume
}));
vi.mock("@/lib/api-response", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-response")>();
  return {
    ...original,
    createApiRequestId: mocks.createRequestId
  };
});
vi.mock("@/lib/hosted-config", () => ({
  isHostedDeployment: mocks.hosted
}));
vi.mock("@/lib/observability", () => ({
  emitOperationalEvent: mocks.emit
}));
vi.mock("@/lib/release-fence", () => ({
  getActiveReleaseFence: mocks.fence
}));
vi.mock("@/lib/workspace-store", () => ({
  getArchiveId: () => "pilot-archive"
}));

import { POST } from "@/app/api/operator/observability/route";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const claim = {
  keyId: "beta-operator-1",
  nonce: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  requestDigest: "d".repeat(64),
  timestamp: new Date("2026-07-15T18:00:00.000Z")
};
const marker = "PRIVATE_SIGNED_BODY_AND_KEY";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockImplementation(async (incoming: NextRequest) => ({
    body: await incoming.clone().text(),
    claim
  }));
  mocks.consume.mockResolvedValue(undefined);
  mocks.createRequestId.mockReturnValue(requestId);
  mocks.emit.mockResolvedValue(undefined);
  mocks.fence.mockResolvedValue(null);
  mocks.hosted.mockReturnValue(true);
});

describe("POST /api/operator/observability", () => {
  it("authenticates before deployment checks or durable mutations", async () => {
    mocks.authenticate.mockRejectedValue(new Error(marker));

    const response = await POST(request({ action: "test-alert" }));

    expect(response.status).toBe(401);
    expect(mocks.hosted).not.toHaveBeenCalled();
    expect(mocks.fence).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(marker);
  });

  it("is unavailable outside a hosted deployment", async () => {
    mocks.hosted.mockReturnValue(false);

    const response = await POST(request({ action: "test-alert" }));

    expect(response.status).toBe(404);
    expect(mocks.fence).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("checks the release fence after authentication and before consuming the nonce", async () => {
    mocks.fence.mockResolvedValue({
      activatedAt: new Date("2026-07-15T18:00:00.000Z"),
      activationGeneration: 1,
      fenceId: "fence-beta-release",
      releaseCommitSha: "a".repeat(40),
      state: "active"
    });

    const response = await POST(request({ action: "test-alert" }));

    expect(response.status).toBe(423);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(mocks.fence).toHaveBeenCalledOnce();
    expect(mocks.authenticate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fence.mock.invocationCallOrder[0]
    );
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("fails closed before nonce consumption when the release fence cannot be read", async () => {
    mocks.fence.mockRejectedValueOnce(new Error(marker));

    const response = await POST(request({ action: "test-alert" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Operator safety check unavailable." });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("consumes the signed nonce before requiring delivery of a fixed test alert", async () => {
    const response = await POST(request({ action: "test-alert" }));

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(mocks.consume).toHaveBeenCalledExactlyOnceWith(claim, {
      archiveId: "pilot-archive"
    });
    expect(mocks.emit).toHaveBeenCalledExactlyOnceWith({
      event: "operator_test_alert",
      severity: "error",
      code: "TEST_ALERT",
      requestId,
      route: "/api/operator/observability"
    }, { requireDelivery: true });
    expect(mocks.consume.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.emit.mock.invocationCallOrder[0]
    );
  });

  it.each([
    ["an unknown action", JSON.stringify({ action: marker }), "application/json"],
    ["additional fields", JSON.stringify({ action: "test-alert", detail: marker }), "application/json"],
    ["invalid JSON", `{${marker}`, "application/json"],
    ["a non-JSON content type", JSON.stringify({ action: "test-alert" }), "text/plain"]
  ])("rejects %s before consuming the nonce", async (_label, body, contentType) => {
    const response = await POST(rawRequest(body, contentType));

    expect(response.status).toBe(400);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(marker);
  });

  it("does not deliver an alert when nonce consumption fails", async () => {
    mocks.consume.mockRejectedValueOnce(new Error(marker));

    const response = await POST(request({ action: "test-alert" }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "The observability test alert could not be delivered." });
    expect(JSON.stringify(body)).not.toContain(marker);
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("returns a generic failure when required alert delivery fails", async () => {
    mocks.emit.mockRejectedValueOnce(new Error(marker));

    const response = await POST(request({ action: "test-alert" }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "The observability test alert could not be delivered." });
    expect(JSON.stringify(body)).not.toContain(marker);
    expect(mocks.consume).toHaveBeenCalledOnce();
  });
});

function request(body: unknown): NextRequest {
  return rawRequest(JSON.stringify(body), "application/json");
}

function rawRequest(body: string, contentType: string): NextRequest {
  return new NextRequest("https://app.kinresolve.com/api/operator/observability", {
    body,
    headers: { "content-type": contentType },
    method: "POST"
  });
}
