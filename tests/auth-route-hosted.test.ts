import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  countUsers: vi.fn(),
  ensureDatabaseSchema: vi.fn(),
  getAuth: vi.fn(),
  handlerGet: vi.fn(),
  handlerPost: vi.fn(),
  toNextJsHandler: vi.fn()
}));

vi.mock("@/lib/auth-session", () => ({ countUsers: routeMocks.countUsers }));
vi.mock("@/lib/db", () => ({ ensureDatabaseSchema: routeMocks.ensureDatabaseSchema }));
vi.mock("@/lib/auth", () => ({ getAuth: routeMocks.getAuth }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: routeMocks.toNextJsHandler }));

import { POST } from "@/app/api/auth/[...all]/route";

function signUpRequest(): NextRequest {
  return new NextRequest("https://app.kinresolve.com/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "pilot@example.com", name: "Pilot", password: "long-password-123" })
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
  vi.stubEnv("KINSLEUTH_ALLOW_SIGNUPS", "");
  routeMocks.countUsers.mockResolvedValue(0);
  routeMocks.ensureDatabaseSchema.mockResolvedValue(undefined);
  routeMocks.getAuth.mockReturnValue({ handler: "better-auth-handler" });
  routeMocks.handlerPost.mockResolvedValue(new Response(null, { status: 204 }));
  routeMocks.toNextJsHandler.mockReturnValue({ GET: routeMocks.handlerGet, POST: routeMocks.handlerPost });
});

describe("hosted auth route perimeter", () => {
  it("denies hosted sign-up before schema, user-count, or auth access even when the override is true", async () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");
    vi.stubEnv("KINSLEUTH_ALLOW_SIGNUPS", "true");

    const response = await POST(signUpRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Sign-up is unavailable." });
    expect(routeMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(routeMocks.countUsers).not.toHaveBeenCalled();
    expect(routeMocks.getAuth).not.toHaveBeenCalled();
    expect(routeMocks.toNextJsHandler).not.toHaveBeenCalled();
  });

  it("preserves first-account setup for a self-hosted deployment", async () => {
    const response = await POST(signUpRequest());

    expect(response.status).toBe(204);
    expect(routeMocks.ensureDatabaseSchema).toHaveBeenCalledOnce();
    expect(routeMocks.countUsers).toHaveBeenCalledOnce();
    expect(routeMocks.handlerPost).toHaveBeenCalledOnce();
  });
});
