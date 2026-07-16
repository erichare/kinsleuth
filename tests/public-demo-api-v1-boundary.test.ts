import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { authenticateApiToken } from "@/lib/beta-api-tokens";

describe("public demo API v1 boundary", () => {
  it("never treats a demo session cookie as an API v1 bearer credential", async () => {
    const requestId = randomUUID();
    const request = new Request("https://demo.kinresolve.com/api/v1/meta", {
      headers: {
        cookie: `__Host-kinresolve-demo=${"a".repeat(43)}`
      }
    });

    await expect(authenticateApiToken(request, {
      scope: "archive:read",
      routeTemplate: "/api/v1/meta",
      requestId
    }, {
      environment: {
        KINRESOLVE_API_V1_ENABLED: "true",
        KINRESOLVE_API_CURSOR_SECRET: "public-demo-api-v1-boundary-secret"
      }
    })).resolves.toEqual({
      ok: false,
      status: 401,
      code: "invalid_token",
      message: "The bearer token is invalid, expired, or revoked.",
      requestId
    });
  });
});
